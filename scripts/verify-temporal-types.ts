#!/usr/bin/env tsx

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import * as ts from 'typescript'

interface WorkflowInfo {
  name: string
  file: string
  inputType?: string
  outputType?: string
}

interface VerificationResult {
  success: boolean
  workflows: WorkflowInfo[]
  missingTypes: string[]
  errors: string[]
}

const rootDir = resolve(import.meta.dirname, '..')
const workerDir = join(rootDir, 'apps/worker/src')
const temporalClientDir = join(rootDir, 'packages/temporal-client/src')
const temporalClientIndexPath = join(temporalClientDir, 'index.ts')

const IGNORED_TYPE_NAMES = new Set([
  'any',
  'unknown',
  'never',
  'void',
  'null',
  'undefined',
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'object',
  'Promise',
  'Array',
  'ReadonlyArray',
  'Record',
  'Partial',
  'Pick',
  'Omit',
  'Exclude',
  'Extract',
  'NonNullable',
  'Awaited',
  'Date'
])

const findTsFiles = (dir: string, files: string[] = []): string[] => {
  if (!existsSync(dir)) {
    return files
  }

  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      findTsFiles(fullPath, files)
      continue
    }

    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.spec.ts')) {
      files.push(fullPath)
    }
  }

  return files
}

const parseSourceFile = (absoluteFilePath: string): ts.SourceFile =>
  ts.createSourceFile(
    absoluteFilePath,
    readFileSync(absoluteFilePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  node.modifiers?.some((modifier) => modifier.kind === kind) ?? false

const isExported = (node: ts.Node): boolean => hasModifier(node, ts.SyntaxKind.ExportKeyword)

const isAsync = (node: ts.Node): boolean => hasModifier(node, ts.SyntaxKind.AsyncKeyword)

const getTypeReferenceName = (typeName: ts.EntityName): string =>
  ts.isIdentifier(typeName) ? typeName.text : getTypeReferenceName(typeName.right)

const collectTypeReferenceNames = (typeNode: ts.TypeNode | undefined, accumulator: Set<string>): void => {
  if (!typeNode) {
    return
  }

  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      accumulator.add(getTypeReferenceName(node.typeName))
    }
    ts.forEachChild(node, visit)
  }

  visit(typeNode)
}

const unwrapPromiseTypeNode = (typeNode: ts.TypeNode | undefined): ts.TypeNode | undefined => {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) {
    return typeNode
  }

  if (getTypeReferenceName(typeNode.typeName) !== 'Promise') {
    return typeNode
  }

  return typeNode.typeArguments?.[0]
}

const pickPrimaryTypeName = (typeNode: ts.TypeNode | undefined): string | undefined => {
  const names = new Set<string>()
  collectTypeReferenceNames(typeNode, names)
  return [...names].find((name) => !IGNORED_TYPE_NAMES.has(name))
}

const collectRequiredTypesFromNode = (typeNode: ts.TypeNode | undefined, required: Set<string>): void => {
  const names = new Set<string>()
  collectTypeReferenceNames(typeNode, names)
  for (const name of names) {
    if (!IGNORED_TYPE_NAMES.has(name)) {
      required.add(name)
    }
  }
}

const workflowFromFunctionLike = (
  file: ts.SourceFile,
  filePath: string,
  name: string,
  fn:
    | ts.FunctionDeclaration
    | ts.ArrowFunction
    | ts.FunctionExpression
): { info: WorkflowInfo; requiredTypes: Set<string> } => {
  const requiredTypes = new Set<string>()
  const inputTypeNode = fn.parameters[0]?.type
  const outputTypeNode = unwrapPromiseTypeNode(fn.type)

  collectRequiredTypesFromNode(inputTypeNode, requiredTypes)
  collectRequiredTypesFromNode(outputTypeNode, requiredTypes)

  return {
    info: {
      name,
      file: filePath.replace(`${rootDir}/`, ''),
      inputType: pickPrimaryTypeName(inputTypeNode),
      outputType: pickPrimaryTypeName(outputTypeNode)
    },
    requiredTypes
  }
}

const extractWorkflowsFromFile = (
  filePath: string
): { workflows: WorkflowInfo[]; requiredTypes: Set<string> } => {
  const source = parseSourceFile(filePath)
  const workflows: WorkflowInfo[] = []
  const requiredTypes = new Set<string>()

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      if (!statement.name || !isExported(statement) || !isAsync(statement)) {
        continue
      }

      const workflowName = statement.name.text
      if (!workflowName.endsWith('Workflow')) {
        continue
      }

      const extracted = workflowFromFunctionLike(source, filePath, workflowName, statement)
      workflows.push(extracted.info)
      for (const requiredType of extracted.requiredTypes) {
        requiredTypes.add(requiredType)
      }
      continue
    }

    if (!ts.isVariableStatement(statement) || !isExported(statement)) {
      continue
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue
      }

      const workflowName = declaration.name.text
      if (!workflowName.endsWith('Workflow')) {
        continue
      }

      if (
        !ts.isArrowFunction(declaration.initializer)
        && !ts.isFunctionExpression(declaration.initializer)
      ) {
        continue
      }

      if (!isAsync(declaration.initializer)) {
        continue
      }

      const extracted = workflowFromFunctionLike(
        source,
        filePath,
        workflowName,
        declaration.initializer
      )
      workflows.push(extracted.info)
      for (const requiredType of extracted.requiredTypes) {
        requiredTypes.add(requiredType)
      }
    }
  }

  return { workflows, requiredTypes }
}

const resolveModulePath = (fromFilePath: string, moduleSpecifier: string): string | undefined => {
  if (!moduleSpecifier.startsWith('.')) {
    return undefined
  }

  const basePath = resolve(dirname(fromFilePath), moduleSpecifier)
  const candidates = [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, 'index.ts')
  ]

  return candidates.find((candidate) => existsSync(candidate))
}

const collectPublicExportedTypes = (
  absoluteFilePath: string,
  visited: Set<string>
): Set<string> => {
  if (visited.has(absoluteFilePath) || !existsSync(absoluteFilePath)) {
    return new Set()
  }

  visited.add(absoluteFilePath)
  const source = parseSourceFile(absoluteFilePath)
  const exported = new Set<string>()

  for (const statement of source.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
      && isExported(statement)
    ) {
      exported.add(statement.name.text)
      continue
    }

    if (!ts.isExportDeclaration(statement)) {
      continue
    }

    const moduleSpecifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined

    if (!statement.exportClause) {
      if (!moduleSpecifier) {
        continue
      }

      const target = resolveModulePath(absoluteFilePath, moduleSpecifier)
      if (!target) {
        continue
      }

      const nested = collectPublicExportedTypes(target, visited)
      for (const typeName of nested) {
        exported.add(typeName)
      }
      continue
    }

    if (ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        exported.add(element.name.text)
      }
    }
  }

  return exported
}

const getExportedTemporalTypes = (): Set<string> => {
  if (!existsSync(temporalClientIndexPath)) {
    return new Set()
  }

  return collectPublicExportedTypes(temporalClientIndexPath, new Set())
}

export const verifyTemporalTypes = (): VerificationResult => {
  const result: VerificationResult = {
    success: true,
    workflows: [],
    missingTypes: [],
    errors: []
  }

  if (!existsSync(workerDir)) {
    result.errors.push(`Worker source directory not found: ${workerDir}`)
    result.success = false
    return result
  }

  if (!existsSync(temporalClientDir)) {
    result.errors.push(`Temporal client source directory not found: ${temporalClientDir}`)
    result.success = false
    return result
  }

  const workerFiles = findTsFiles(workerDir).filter((filePath) => filePath.includes('workflow'))
  const requiredTypes = new Set<string>()

  for (const filePath of workerFiles) {
    const extracted = extractWorkflowsFromFile(filePath)
    result.workflows.push(...extracted.workflows)
    for (const typeName of extracted.requiredTypes) {
      requiredTypes.add(typeName)
    }
  }

  const exportedTypes = getExportedTemporalTypes()
  for (const requiredType of requiredTypes) {
    if (!exportedTypes.has(requiredType)) {
      result.missingTypes.push(requiredType)
      result.success = false
    }
  }

  return result
}

const formatList = (items: string[]): string => {
  if (items.length === 0) {
    return 'none'
  }
  return items.map((item) => `- ${item}`).join('\n')
}

const main = (): void => {
  const result = verifyTemporalTypes()

  if (!result.success) {
    const errorBlock = result.errors.length > 0
      ? `Errors:\n${formatList(result.errors)}\n\n`
      : ''

    const missingBlock = result.missingTypes.length > 0
      ? `Missing temporal-client exports:\n${formatList(result.missingTypes)}\n`
      : ''

    console.error(`Temporal type verification failed.\n\n${errorBlock}${missingBlock}`.trim())
    process.exit(1)
  }

  const workflowNames = result.workflows.map((workflow) => workflow.name)
  console.log(`Temporal type verification passed. Workflows checked: ${workflowNames.join(', ') || 'none'}`)
}

main()
