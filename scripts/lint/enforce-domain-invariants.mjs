#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const repoRoot = process.cwd()
const errors = []

const toPosix = (value) => value.split(sep).join('/')
const toKebabCase = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

const fail = (message) => {
  errors.push(message)
}

const readUtf8 = (path) => readFileSync(path, 'utf8')

const listFilesRecursively = (rootDir) => {
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    return []
  }

  const files = []
  const entries = readdirSync(rootDir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(fullPath))
      continue
    }

    files.push(fullPath)
  }

  return files
}

const extractTableConstants = (schemaSource) => {
  const names = new Set()
  const regex = /export const (\w+)\s*=\s*pgTable\(/g

  for (const match of schemaSource.matchAll(regex)) {
    names.add(match[1])
  }

  return [...names]
}

const getTableNamesFromSchema = () => {
  const schemaRoot = resolve(repoRoot, 'packages/infra/db/src')
  if (!existsSync(schemaRoot) || !statSync(schemaRoot).isDirectory()) {
    fail('Missing `packages/infra/db/src` directory.')
    return []
  }

  const tableNames = new Set()
  const sourceFiles = listFilesRecursively(schemaRoot)
    .filter((filePath) => filePath.endsWith('.ts'))
    .filter((filePath) => !toPosix(filePath).includes('/dist/'))

  for (const filePath of sourceFiles) {
    const source = readUtf8(filePath)
    const relativePath = toPosix(relative(repoRoot, filePath))

    if (/\bpgTable\s+as\s+[A-Za-z0-9_]+/.test(source)) {
      fail(`Aliasing \`pgTable\` is disallowed for invariant safety: \`${relativePath}\`.`)
    }

    if (/(?:^|\n)\s*(?!export\s)(?:const|let|var)\s+[A-Za-z0-9_]+\s*=\s*pgTable\s*(?:;|\n|$)/.test(source)) {
      fail(`Wrapping \`pgTable\` in local aliases is disallowed for invariant safety: \`${relativePath}\`.`)
    }

    const directPgTableCalls = [...source.matchAll(/\bpgTable\s*\(/g)].length
    for (const tableName of extractTableConstants(source)) {
      tableNames.add(tableName)
    }

    const declaredTableExports = extractTableConstants(source).length
    if (directPgTableCalls > 0 && directPgTableCalls !== declaredTableExports) {
      fail(
        `Every \`pgTable(...)\` call must be declared as \`export const <name> = pgTable(...)\` in \`${relativePath}\`.`
      )
    }
  }

  const sortedNames = [...tableNames].sort()
  if (sortedNames.length === 0) {
    fail('No `pgTable(...)` declarations were found in `packages/infra/db/src`.')
  }

  return sortedNames
}

const parseTypeScriptSourceFile = (filePath, source) =>
  ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

const unwrapTsExpression = (expression) => {
  let current = expression

  while (current) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression
      continue
    }

    if (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current)) {
      current = current.expression
      continue
    }

    return current
  }

  return expression
}

const unwrapTsTypeNode = (typeNode) => {
  let current = typeNode

  while (current && ts.isParenthesizedTypeNode(current)) {
    current = current.type
  }

  return current
}

const getTypeReferenceName = (typeNameNode) => {
  if (!typeNameNode) {
    return null
  }

  if (ts.isIdentifier(typeNameNode)) {
    return typeNameNode.text
  }

  if (ts.isQualifiedName(typeNameNode)) {
    return typeNameNode.right.text
  }

  return null
}

const getWeakJsonTypeReason = (typeNode) => {
  if (!typeNode) {
    return 'missing type argument'
  }

  const normalizedType = unwrapTsTypeNode(typeNode)
  if (!normalizedType) {
    return 'missing type argument'
  }

  if (normalizedType.kind === ts.SyntaxKind.AnyKeyword) {
    return '`any`'
  }

  if (normalizedType.kind === ts.SyntaxKind.UnknownKeyword) {
    return '`unknown`'
  }

  if (!ts.isTypeReferenceNode(normalizedType)) {
    return null
  }

  if (getTypeReferenceName(normalizedType.typeName) !== 'Record') {
    return null
  }

  const valueTypeNode = normalizedType.typeArguments?.[1]
  if (!valueTypeNode) {
    return null
  }

  const normalizedValueType = unwrapTsTypeNode(valueTypeNode)
  if (!normalizedValueType) {
    return null
  }

  if (normalizedValueType.kind === ts.SyntaxKind.AnyKeyword) {
    return '`Record<string, any>`'
  }

  if (normalizedValueType.kind === ts.SyntaxKind.UnknownKeyword) {
    return '`Record<string, unknown>`'
  }

  return null
}

const getPropertyNameText = (propertyName) => {
  if (!propertyName) {
    return null
  }

  if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName) || ts.isNumericLiteral(propertyName)) {
    return propertyName.text
  }

  if (ts.isNoSubstitutionTemplateLiteral(propertyName)) {
    return propertyName.text
  }

  return null
}

const collectJsonBuilderIdentifiers = (sourceFile) => {
  const identifiers = new Set()

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue
    }

    if (!ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }

    const importPath = statement.moduleSpecifier.text
    const isDrizzlePgCoreImport =
      importPath === 'drizzle-orm/pg-core' || importPath.startsWith('drizzle-orm/pg-core/')
    if (!isDrizzlePgCoreImport || !statement.importClause?.namedBindings) {
      continue
    }

    if (!ts.isNamedImports(statement.importClause.namedBindings)) {
      continue
    }

    for (const importSpecifier of statement.importClause.namedBindings.elements) {
      const importedName = importSpecifier.propertyName?.text ?? importSpecifier.name.text
      const localName = importSpecifier.name.text

      if (importedName === 'json' || importedName === 'jsonb') {
        identifiers.add(localName)
      }
    }
  }

  return identifiers
}

const analyzeJsonColumnInitializer = (initializerExpression, jsonBuilderIdentifiers) => {
  let current = unwrapTsExpression(initializerExpression)
  let hasTypeCall = false
  let weakTypeReason = null

  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const methodName = current.expression.name.text
    if (methodName === '$type') {
      hasTypeCall = true
      const typeWeakness = getWeakJsonTypeReason(current.typeArguments?.[0] ?? null)
      if (typeWeakness) {
        weakTypeReason = typeWeakness
      }
    }

    current = unwrapTsExpression(current.expression.expression)
  }

  if (!ts.isCallExpression(current) || !ts.isIdentifier(current.expression)) {
    return {
      isJsonColumn: false,
      hasTypeCall: false,
      weakTypeReason: null
    }
  }

  if (!jsonBuilderIdentifiers.has(current.expression.text)) {
    return {
      isJsonColumn: false,
      hasTypeCall: false,
      weakTypeReason: null
    }
  }

  return {
    isJsonColumn: true,
    hasTypeCall,
    weakTypeReason
  }
}

const collectDbJsonColumnsByTable = () => {
  const schemaRoot = resolve(repoRoot, 'packages/infra/db/src')
  if (!existsSync(schemaRoot) || !statSync(schemaRoot).isDirectory()) {
    fail('Missing `packages/infra/db/src` directory for JSON column invariant checks.')
    return new Map()
  }

  const sourceFiles = listFilesRecursively(schemaRoot)
    .filter((filePath) => filePath.endsWith('.ts'))
    .filter((filePath) => !toPosix(filePath).includes('/dist/'))

  const jsonColumnsByTable = new Map()

  for (const filePath of sourceFiles) {
    const source = readUtf8(filePath)
    const sourceFile = parseTypeScriptSourceFile(filePath, source)
    const jsonBuilderIdentifiers = collectJsonBuilderIdentifiers(sourceFile)
    const relativePath = toPosix(relative(repoRoot, filePath))

    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue
      }

      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          continue
        }

        const tableConstName = declaration.name.text
        const initializer = unwrapTsExpression(declaration.initializer)

        if (!ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression) || initializer.expression.text !== 'pgTable') {
          continue
        }

        const columnsArg = initializer.arguments[1]
        if (!columnsArg || !ts.isObjectLiteralExpression(columnsArg)) {
          continue
        }

        const jsonColumns = []
        for (const property of columnsArg.properties) {
          if (!ts.isPropertyAssignment(property)) {
            continue
          }

          const columnName = getPropertyNameText(property.name)
          if (!columnName) {
            continue
          }

          const analysis = analyzeJsonColumnInitializer(property.initializer, jsonBuilderIdentifiers)
          if (!analysis.isJsonColumn) {
            continue
          }

          jsonColumns.push(columnName)

          if (!analysis.hasTypeCall) {
            fail(
              [
                `JSON/JSONB column \`${tableConstName}.${columnName}\` in \`${relativePath}\` must call \`.$type<...>()\` with an explicit payload type.`,
                'Do not leave Drizzle JSON columns implicitly typed.'
              ].join(' ')
            )
          }

          if (analysis.weakTypeReason) {
            fail(
              [
                `JSON/JSONB column \`${tableConstName}.${columnName}\` in \`${relativePath}\` uses weak type ${analysis.weakTypeReason}.`,
                'Use a concrete payload interface/type alias for strong typing.'
              ].join(' ')
            )
          }
        }

        if (jsonColumns.length > 0) {
          jsonColumnsByTable.set(tableConstName, {
            fileRelativePath: relativePath,
            columns: jsonColumns
          })
        }
      }
    }
  }

  return jsonColumnsByTable
}

const collectSchemaNamespaceIdentifiers = (sourceFile) => {
  const schemaNamespaces = new Set(['Schema'])

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue
    }

    if (!ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'effect/Schema') {
      continue
    }

    const importClause = statement.importClause
    if (!importClause || !importClause.namedBindings) {
      continue
    }

    if (ts.isNamespaceImport(importClause.namedBindings)) {
      schemaNamespaces.add(importClause.namedBindings.name.text)
      continue
    }

    if (ts.isNamedImports(importClause.namedBindings)) {
      for (const importSpecifier of importClause.namedBindings.elements) {
        const importedName = importSpecifier.propertyName?.text ?? importSpecifier.name.text
        if (importedName === 'Schema') {
          schemaNamespaces.add(importSpecifier.name.text)
        }
      }
    }
  }

  return schemaNamespaces
}

const findStructObjectLiteral = (expression, schemaNamespaces) => {
  if (!expression) {
    return null
  }

  const normalizedExpression = unwrapTsExpression(expression)
  if (
    ts.isCallExpression(normalizedExpression) &&
    ts.isPropertyAccessExpression(normalizedExpression.expression) &&
    ts.isIdentifier(normalizedExpression.expression.expression) &&
    schemaNamespaces.has(normalizedExpression.expression.expression.text) &&
    normalizedExpression.expression.name.text === 'Struct'
  ) {
    const structArgument = normalizedExpression.arguments[0]
    if (structArgument && ts.isObjectLiteralExpression(structArgument)) {
      return structArgument
    }
  }

  let discoveredStructObject = null
  ts.forEachChild(normalizedExpression, (childNode) => {
    if (discoveredStructObject) {
      return
    }

    const found = findStructObjectLiteral(childNode, schemaNamespaces)
    if (found) {
      discoveredStructObject = found
    }
  })

  return discoveredStructObject
}

const parseEffectRowSchemaFields = (effectSchemaPath) => {
  const source = readUtf8(effectSchemaPath)
  const sourceFile = parseTypeScriptSourceFile(effectSchemaPath, source)
  const schemaNamespaces = collectSchemaNamespaceIdentifiers(sourceFile)
  const relativePath = toPosix(relative(repoRoot, effectSchemaPath))

  let structObject = null
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue
      }

      if (!declaration.name.text.endsWith('RowSchema')) {
        continue
      }

      structObject = findStructObjectLiteral(declaration.initializer, schemaNamespaces)
      if (structObject) {
        break
      }
    }

    if (structObject) {
      break
    }
  }

  if (!structObject) {
    fail(
      `Missing parseable \`Schema.Struct({ ... })\` for \`*RowSchema\` in \`${relativePath}\` required for JSON typing parity checks.`
    )
    return null
  }

  const fieldInitializers = new Map()
  for (const property of structObject.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue
    }

    const fieldName = getPropertyNameText(property.name)
    if (!fieldName) {
      continue
    }

    fieldInitializers.set(fieldName, property.initializer)
  }

  return {
    sourceFile,
    schemaNamespaces,
    fieldInitializers
  }
}

const isWeakEffectJsonSchemaExpression = (schemaExpression, sourceFile, schemaNamespaces) => {
  const expressionSource = schemaExpression.getText(sourceFile)

  for (const schemaNamespace of schemaNamespaces) {
    const weakSchemaRegex = new RegExp(`\\b${schemaNamespace}\\.(?:Unknown|Json)\\b`, 'u')
    if (weakSchemaRegex.test(expressionSource)) {
      return true
    }
  }

  return false
}

const enforceDbJsonColumnEffectSchemaParity = () => {
  const effectSchemasDir = resolve(repoRoot, 'packages/infra/db/src/effect-schemas')
  if (!existsSync(effectSchemasDir) || !statSync(effectSchemasDir).isDirectory()) {
    return
  }

  const jsonColumnsByTable = collectDbJsonColumnsByTable()
  if (jsonColumnsByTable.size === 0) {
    return
  }

  for (const [tableConstName, tableJsonMetadata] of jsonColumnsByTable.entries()) {
    const effectSchemaPath = resolve(effectSchemasDir, `${toKebabCase(tableConstName)}.ts`)
    if (!existsSync(effectSchemaPath) || !statSync(effectSchemaPath).isFile()) {
      continue
    }

    const parsedRowSchema = parseEffectRowSchemaFields(effectSchemaPath)
    if (!parsedRowSchema) {
      continue
    }

    const effectSchemaRelativePath = toPosix(relative(repoRoot, effectSchemaPath))
    for (const columnName of tableJsonMetadata.columns) {
      const fieldSchemaExpression = parsedRowSchema.fieldInitializers.get(columnName)
      if (!fieldSchemaExpression) {
        fail(
          [
            `JSON/JSONB column \`${tableConstName}.${columnName}\` in \`${tableJsonMetadata.fileRelativePath}\` must exist in matching Effect row schema.`,
            `Add \`${columnName}\` to \`${effectSchemaRelativePath}\` \`Schema.Struct({ ... })\`.`
          ].join(' ')
        )
        continue
      }

      if (isWeakEffectJsonSchemaExpression(fieldSchemaExpression, parsedRowSchema.sourceFile, parsedRowSchema.schemaNamespaces)) {
        fail(
          [
            `Effect row schema field \`${tableConstName}.${columnName}\` in \`${effectSchemaRelativePath}\` is weakly typed.`,
            'Do not use `Schema.Unknown` or `Schema.Json` for DB JSON/JSONB columns; define explicit structured schemas.'
          ].join(' ')
        )
      }
    }
  }
}

const enforceDbEffectSchemaParity = () => {
  const effectSchemasDir = resolve(repoRoot, 'packages/infra/db/src/effect-schemas')
  const effectSchemaIndexPath = resolve(effectSchemasDir, 'index.ts')

  if (!existsSync(effectSchemasDir)) {
    fail('Missing `packages/infra/db/src/effect-schemas` directory.')
    return
  }

  const tableNames = getTableNamesFromSchema()
  if (tableNames.length === 0) {
    return
  }

  const expectedSchemaFiles = tableNames.map((tableName) => `${toKebabCase(tableName)}.ts`).sort()
  const actualSchemaFiles = readdirSync(effectSchemasDir)
    .filter((fileName) => fileName.endsWith('.ts') && fileName !== 'index.ts')
    .sort()

  for (const expectedFileName of expectedSchemaFiles) {
    if (!actualSchemaFiles.includes(expectedFileName)) {
      fail(
        `Missing Effect schema file for table: expected \`packages/infra/db/src/effect-schemas/${expectedFileName}\`.`
      )
    }
  }

  for (const actualFileName of actualSchemaFiles) {
    if (!expectedSchemaFiles.includes(actualFileName)) {
      fail(
        `Orphan Effect schema file without matching table: \`packages/infra/db/src/effect-schemas/${actualFileName}\`.`
      )
    }
  }

  for (const actualFileName of actualSchemaFiles) {
    const filePath = resolve(effectSchemasDir, actualFileName)
    const source = readUtf8(filePath)
    const relativePath = toPosix(relative(repoRoot, filePath))

    if (!/from\s+['"]effect\/Schema['"]/.test(source)) {
      fail(`Missing \`effect/Schema\` import in \`${relativePath}\`.`)
    }

    if (!/export const [A-Za-z0-9_]+RowSchema\s*=/.test(source)) {
      fail(`Missing \`*RowSchema\` export in \`${relativePath}\`.`)
    }

    if (!/export type [A-Za-z0-9_]+RowShape\s*=/.test(source)) {
      fail(`Missing \`*RowShape\` export in \`${relativePath}\`.`)
    }
  }

  if (!existsSync(effectSchemaIndexPath)) {
    fail('Missing `packages/infra/db/src/effect-schemas/index.ts`.')
    return
  }

  const indexSource = readUtf8(effectSchemaIndexPath)
  const exportedSchemaFiles = new Set(
    [...indexSource.matchAll(/export \* from ['"]\.\/([^'"]+)\.js['"]/g)].map((match) => `${match[1]}.ts`)
  )

  for (const expectedFileName of expectedSchemaFiles) {
    if (!exportedSchemaFiles.has(expectedFileName)) {
      fail(
        `Missing re-export in \`packages/infra/db/src/effect-schemas/index.ts\` for \`${expectedFileName}\`.`
      )
    }
  }
}

const enforceDbFactoryParity = () => {
  const factoriesDir = resolve(repoRoot, 'packages/infra/db/src/factories')
  const factoryIndexPath = resolve(factoriesDir, 'index.ts')

  if (!existsSync(factoriesDir)) {
    fail('Missing `packages/infra/db/src/factories` directory.')
    return
  }

  const tableNames = getTableNamesFromSchema()
  if (tableNames.length === 0) {
    return
  }

  const expectedFactoryFiles = tableNames
    .map((tableName) => `${toKebabCase(tableName)}.factory.ts`)
    .sort()

  const actualFactoryFiles = readdirSync(factoriesDir)
    .filter((fileName) => fileName.endsWith('.factory.ts'))
    .sort()

  for (const expectedFileName of expectedFactoryFiles) {
    if (!actualFactoryFiles.includes(expectedFileName)) {
      fail(
        `Missing factory file for table: expected \`packages/infra/db/src/factories/${expectedFileName}\`.`
      )
    }
  }

  for (const actualFileName of actualFactoryFiles) {
    if (!expectedFactoryFiles.includes(actualFileName)) {
      fail(
        `Orphan factory file without matching table: \`packages/infra/db/src/factories/${actualFileName}\`.`
      )
    }
  }

  for (const actualFileName of actualFactoryFiles) {
    const filePath = resolve(factoriesDir, actualFileName)
    const source = readUtf8(filePath)
    const relativePath = toPosix(relative(repoRoot, filePath))

    if (!/export (const|function) create[A-Za-z0-9_]+Factory/.test(source)) {
      fail(`Missing \`create*Factory\` export in \`${relativePath}\`.`)
    }
  }

  if (!existsSync(factoryIndexPath)) {
    fail('Missing `packages/infra/db/src/factories/index.ts`.')
    return
  }

  const indexSource = readUtf8(factoryIndexPath)
  const exportedFactoryFiles = new Set(
    [...indexSource.matchAll(/export \* from ['"]\.\/([^'"]+)\.js['"]/g)].map((match) => `${match[1]}.ts`)
  )

  for (const expectedFileName of expectedFactoryFiles) {
    if (!exportedFactoryFiles.has(expectedFileName)) {
      fail(
        `Missing re-export in \`packages/infra/db/src/factories/index.ts\` for \`${expectedFileName}\`.`
      )
    }
  }
}

const requiredDomainFolders = ['domain', 'ports', 'application', 'adapters']
const forbiddenDomainFolders = ['repositories', 'services']
const domainLayers = ['domain', 'ports', 'application', 'adapters', 'runtime', 'ui']
const allowedLayerImports = {
  domain: new Set(['domain']),
  ports: new Set(['domain', 'ports']),
  application: new Set(['domain', 'ports', 'application']),
  adapters: new Set(['domain', 'ports', 'adapters']),
  runtime: new Set(['domain', 'ports', 'application', 'adapters', 'runtime']),
  ui: new Set(['domain', 'ports', 'application', 'adapters', 'runtime', 'ui'])
}

const inferLayerFromPath = (pathValue) => {
  const posixPath = toPosix(pathValue)
  for (const layer of domainLayers) {
    const token = `/${layer}/`
    if (posixPath.includes(token)) {
      return layer
    }
  }
  return null
}

const inferLayerFromImport = (importPath) => {
  for (const layer of domainLayers) {
    const regex = new RegExp(`(^|/)${layer}(/|$)`)
    if (regex.test(importPath)) {
      return layer
    }
  }
  return null
}

const inferDomainFromPath = (pathValue) => {
  const match = toPosix(pathValue).match(/\/domains\/([^/]+)\//)
  return match?.[1] ?? null
}

const resolveImportTarget = (sourceFilePath, importPath) => {
  if (!importPath.startsWith('.')) {
    return importPath
  }

  return resolve(dirname(sourceFilePath), importPath)
}

const importRegex = /(?:import|export)\s+(?:[\s\w{},*]+from\s+)?['"]([^'"]+)['"]/g

const isPublishedDomainSharedImport = (importPath, resolvedImportTarget) =>
  /(^|\/)(domain-shared|domains\/shared)(\/|$)/.test(importPath) ||
  /\/domains\/(?:shared|[^/]+\/domain-shared)\//.test(toPosix(resolvedImportTarget))

const enforceDomainDirectoryContracts = () => {
  const domainRoots = [
    resolve(repoRoot, 'packages/core/src/domains'),
    resolve(repoRoot, 'apps/api/src/domains')
  ]

  const existingDomainRoots = []
  let discoveredDomains = 0

  for (const domainRoot of domainRoots) {
    if (!existsSync(domainRoot) || !statSync(domainRoot).isDirectory()) {
      fail(`Missing required domain root: \`${toPosix(relative(repoRoot, domainRoot))}\`.`)
      continue
    }

    existingDomainRoots.push(domainRoot)

    const domainNames = readdirSync(domainRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    discoveredDomains += domainNames.length

    for (const domainName of domainNames) {
      const domainPath = join(domainRoot, domainName)

      for (const requiredFolder of requiredDomainFolders) {
        const requiredPath = join(domainPath, requiredFolder)
        if (!existsSync(requiredPath) || !statSync(requiredPath).isDirectory()) {
          fail(
            `Domain \`${toPosix(relative(repoRoot, domainPath))}\` is missing required folder \`${requiredFolder}/\`.`
          )
        }
      }

      for (const forbiddenFolder of forbiddenDomainFolders) {
        const forbiddenPath = join(domainPath, forbiddenFolder)
        if (existsSync(forbiddenPath) && statSync(forbiddenPath).isDirectory()) {
          fail(
            `Domain \`${toPosix(relative(repoRoot, domainPath))}\` must not include \`${forbiddenFolder}/\`. Use \`ports/\` for contracts and \`adapters/\` for implementations.`
          )
        }
      }

      const domainFiles = listFilesRecursively(join(domainPath, 'domain')).filter(
        (filePath) =>
          (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) &&
          !filePath.endsWith('.gitkeep')
      )
      if (domainFiles.length === 0) {
        fail(
          `Domain \`${toPosix(relative(repoRoot, domainPath))}\` must define at least one domain artifact in \`domain/\`.`
        )
      }

      const portFiles = listFilesRecursively(join(domainPath, 'ports')).filter(
        (filePath) =>
          (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) &&
          !filePath.endsWith('.gitkeep')
      )
      if (portFiles.length === 0) {
        fail(
          `Domain \`${toPosix(relative(repoRoot, domainPath))}\` must define at least one port contract in \`ports/\`.`
        )
      }

      for (const filePath of portFiles) {
        const source = readUtf8(filePath)
        if (!/Effect\.Effect\s*</.test(source)) {
          fail(
            `Port contract must declare Effect return types in \`${toPosix(relative(repoRoot, filePath))}\`.`
          )
        }
      }

      const applicationFiles = listFilesRecursively(join(domainPath, 'application')).filter(
        (filePath) =>
          (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) &&
          !filePath.endsWith('.gitkeep')
      )
      if (applicationFiles.length === 0) {
        fail(
          `Domain \`${toPosix(relative(repoRoot, domainPath))}\` must define at least one application use-case module in \`application/\`.`
        )
      }

      const concreteUseCaseFiles = applicationFiles.filter((filePath) => {
        const fileName = filePath.split(sep).pop() ?? ''
        return fileName !== 'index.ts' && fileName !== 'index.tsx'
      })
      if (concreteUseCaseFiles.length === 0) {
        fail(
          `Domain \`${toPosix(relative(repoRoot, domainPath))}\` must define at least one use-case file in \`application/\` (non-index file).`
        )
      }

      const adapterFiles = listFilesRecursively(join(domainPath, 'adapters')).filter(
        (filePath) =>
          (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) &&
          !filePath.endsWith('.gitkeep')
      )
      if (adapterFiles.length === 0) {
        fail(
          `Domain \`${toPosix(relative(repoRoot, domainPath))}\` must define at least one adapter implementation in \`adapters/\`.`
        )
      }

      for (const filePath of adapterFiles) {
        const source = readUtf8(filePath)
        if (!/from\s+['"][^'"]*ports\//.test(source)) {
          fail(
            `Adapter implementation must import at least one domain port in \`${toPosix(relative(repoRoot, filePath))}\`.`
          )
        }
      }

      const tsFiles = listFilesRecursively(domainPath).filter(
        (filePath) => filePath.endsWith('.ts') || filePath.endsWith('.tsx')
      )

      for (const filePath of tsFiles) {
        const sourceLayer = inferLayerFromPath(filePath)
        if (!sourceLayer) {
          continue
        }

        const source = readUtf8(filePath)
        const fileRelativePath = toPosix(relative(repoRoot, filePath))
        if (
          sourceLayer === 'ports' &&
          /(?:^|\n)\s*[^/\n]*Layer\.(?:succeed|effect)\s*\(/.test(source)
        ) {
          fail(
            `Ports must not implement layers with Layer.succeed/Layer.effect: \`${fileRelativePath}\`.`
          )
        }

        for (const match of source.matchAll(importRegex)) {
          const importPath = match[1]
          const resolvedImportTarget = resolveImportTarget(filePath, importPath)
          const importedDomain = inferDomainFromPath(resolvedImportTarget)
          const shouldCheckLayer = importPath.startsWith('.') || importedDomain === domainName

          if (
            importedDomain &&
            importedDomain !== domainName &&
            !isPublishedDomainSharedImport(importPath, resolvedImportTarget)
          ) {
            fail(
              [
                'Cross-domain import detected:',
                `source=${fileRelativePath}`,
                `import=${importPath}`,
                `expected-domain=${domainName}`,
                `actual-domain=${importedDomain}`
              ].join(' ')
            )
          }

          if (!shouldCheckLayer) {
            continue
          }

          const targetLayer = importPath.startsWith('.')
            ? inferLayerFromPath(resolvedImportTarget)
            : inferLayerFromImport(importPath)

          if (!targetLayer) {
            continue
          }

          if (!allowedLayerImports[sourceLayer].has(targetLayer)) {
            fail(
              [
                'Invalid domain-layer dependency:',
                `source=${fileRelativePath} (${sourceLayer})`,
                `import=${importPath} -> ${targetLayer}`,
                `allowed=${[...allowedLayerImports[sourceLayer]].join(', ')}`
              ].join(' ')
            )
          }
        }
      }
    }
  }

  if (existingDomainRoots.length === 0) {
    fail('No domain roots found. Expected at least one of `packages/core/src/domains` or `apps/api/src/domains`.')
  }

  if (discoveredDomains === 0) {
    fail('No domain modules found under domain roots. Add at least one domain with `domain/ports/application/adapters` implementation.')
  }
}

const enforceNoRootServiceBypass = () => {
  const disallowedRoots = [
    resolve(repoRoot, 'packages/core/src'),
    resolve(repoRoot, 'apps/api/src')
  ]

  for (const rootPath of disallowedRoots) {
    if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(rootPath).filter(
      (filePath) => filePath.endsWith('.ts') || filePath.endsWith('.tsx')
    )

    for (const sourceFile of sourceFiles) {
      const relativePath = toPosix(relative(repoRoot, sourceFile))
      if (relativePath.includes('/domains/')) {
        continue
      }

      const fileName = sourceFile.split(sep).pop() ?? ''
      if (/([a-z0-9-]+-service|[A-Za-z0-9]+Service)\.tsx?$/i.test(fileName)) {
        fail(`Service implementation outside domain layer is disallowed: \`${relativePath}\`.`)
      }
    }
  }
}

const enforceNoPromisePorts = () => {
  const domainRoots = [
    resolve(repoRoot, 'packages/core/src/domains'),
    resolve(repoRoot, 'apps/api/src/domains')
  ]

  for (const domainRoot of domainRoots) {
    if (!existsSync(domainRoot) || !statSync(domainRoot).isDirectory()) {
      continue
    }

    const portFiles = listFilesRecursively(domainRoot).filter((filePath) => {
      const normalized = toPosix(filePath)
      return (normalized.endsWith('.ts') || normalized.endsWith('.tsx')) && normalized.includes('/ports/')
    })

    for (const filePath of portFiles) {
      const source = readUtf8(filePath)
      if (/Promise\s*</.test(source)) {
        fail(
          `Port contracts must return Effect, not Promise: \`${toPosix(relative(repoRoot, filePath))}\`.`
        )
      }
    }
  }
}

const enforceDbRepositoryDecodeContracts = () => {
  const repositoriesDir = resolve(repoRoot, 'packages/infra/db/src/repositories')
  if (!existsSync(repositoriesDir) || !statSync(repositoriesDir).isDirectory()) {
    fail('Missing `packages/infra/db/src/repositories` directory.')
    return
  }

  const repositoryFiles = readdirSync(repositoriesDir)
    .filter((fileName) => fileName.endsWith('.ts'))
    .map((fileName) => resolve(repositoriesDir, fileName))

  for (const filePath of repositoryFiles) {
    const source = readUtf8(filePath)
    const relativePath = toPosix(relative(repoRoot, filePath))
    const isRepositoryImplementation = /export const [A-Za-z0-9_]+Repository\s*=/.test(source)

    if (!isRepositoryImplementation) {
      continue
    }

    if (!/from\s+['"]\.\.\/effect-schemas\//.test(source)) {
      fail(`DB repository must import matching Effect schema decoder(s): \`${relativePath}\`.`)
    }

    if (!/(Schema\.decodeUnknown|decode[A-Za-z0-9_]+)/.test(source)) {
      fail(`DB repository must decode DB row results via Effect schema: \`${relativePath}\`.`)
    }

    if (!/provideDB\(/.test(source)) {
      fail(`DB repository must execute queries through Effect DB provider: \`${relativePath}\`.`)
    }

    if (/\.then\(/.test(source)) {
      fail(`DB repository should use Effect workflow instead of Promise chaining: \`${relativePath}\`.`)
    }
  }
}

const enforceSingleRootEnvFilePolicy = () => {
  const allowedRootEnvFiles = new Set(['.env', '.env.example'])

  const rootEnvFiles = readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith('.env'))
    .map((entry) => entry.name)
    .sort()

  for (const fileName of rootEnvFiles) {
    if (!allowedRootEnvFiles.has(fileName)) {
      fail(
        `Only a single runtime env file is allowed at repository root. Remove \`${fileName}\` and consolidate into \`.env\`.`
      )
    }
  }

  const searchRoots = [
    'apps',
    'packages',
    'scripts',
    'docs',
    'monitoring',
    'skills',
    'todo'
  ]

  for (const rootName of searchRoots) {
    const rootPath = resolve(repoRoot, rootName)
    if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
      continue
    }

    const envFiles = listFilesRecursively(rootPath).filter((filePath) =>
      filePath.split(sep).pop()?.startsWith('.env')
    )

    for (const filePath of envFiles) {
      fail(
        `Environment files must live only at repository root: found \`${toPosix(relative(repoRoot, filePath))}\`.`
      )
    }
  }
}

const enforceNoSuppressionDirectives = () => {
  const roots = [resolve(repoRoot, 'apps'), resolve(repoRoot, 'packages')]

  const suppressionRegex = /(?:@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable)/

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(filePath)
      if (!/\.(ts|tsx|js|mjs)$/u.test(normalized)) {
        return false
      }

      if (normalized.includes('/.next/') || normalized.includes('/dist/') || normalized.includes('/node_modules/')) {
        return false
      }

      if (normalized.includes('/__tests__/') || normalized.endsWith('.test.ts') || normalized.endsWith('.test.tsx')) {
        return false
      }

      if (normalized.includes('/apps/docs/.source/') || normalized.startsWith('apps/docs/.source/')) {
        return false
      }

      if (normalized.includes('/lib/api/generated/')) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const source = readUtf8(sourceFile)
      if (!suppressionRegex.test(source)) {
        continue
      }

      fail(
        `Suppression directives are disallowed in source modules: \`${toPosix(relative(repoRoot, sourceFile))}\`. Fix root types/rules instead of suppressing.`
      )
    }
  }
}

const enforceWebApiGenerationContracts = () => {
  const requiredFiles = [
    resolve(repoRoot, 'apps/web/orval.config.ts'),
    resolve(repoRoot, 'apps/web/lib/api/orval-mutator.ts'),
    resolve(repoRoot, 'apps/api/openapi.json')
  ]

  for (const filePath of requiredFiles) {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      fail(`Missing required API client generation artifact: \`${toPosix(relative(repoRoot, filePath))}\`.`)
    }
  }

  const generatedRoot = resolve(repoRoot, 'apps/web/lib/api/generated')
  if (!existsSync(generatedRoot) || !statSync(generatedRoot).isDirectory()) {
    fail('Missing `apps/web/lib/api/generated` directory. Run `pnpm api:client:generate`.')
  } else {
    const generatedFiles = listFilesRecursively(generatedRoot).filter((filePath) =>
      /\.(ts|tsx)$/u.test(filePath)
    )

    if (generatedFiles.length === 0) {
      fail('Generated API client directory is empty. Run `pnpm api:client:generate`.')
    }
  }

  const rootPackageJsonPath = resolve(repoRoot, 'package.json')
  if (!existsSync(rootPackageJsonPath) || !statSync(rootPackageJsonPath).isFile()) {
    fail('Missing repository `package.json` for API client generation command checks.')
    return
  }

  const rootPackageJson = JSON.parse(readUtf8(rootPackageJsonPath))
  const scripts = rootPackageJson.scripts
  if (!scripts || typeof scripts !== 'object') {
    fail('Root `package.json` is missing `scripts` for API client generation checks.')
    return
  }

  if (typeof scripts['api:client:generate'] !== 'string') {
    fail('Missing root script `api:client:generate`. Add command to regenerate OpenAPI + web API client.')
  }

  const webPackageJsonPath = resolve(repoRoot, 'apps/web/package.json')
  if (!existsSync(webPackageJsonPath) || !statSync(webPackageJsonPath).isFile()) {
    fail('Missing `apps/web/package.json` for API generation checks.')
    return
  }

  const webPackageJson = JSON.parse(readUtf8(webPackageJsonPath))
  const webScripts = webPackageJson.scripts
  if (!webScripts || typeof webScripts !== 'object' || typeof webScripts['generate:api'] !== 'string') {
    fail('Missing `apps/web` script `generate:api` for Orval generation.')
  }
}

const enforceColocatedTestConventions = () => {
  const roots = [resolve(repoRoot, 'apps'), resolve(repoRoot, 'packages')]
  const testFileRegex = /\.(integration\.)?test\.tsx?$/u
  const specFileRegex = /\.spec\.tsx?$/u
  const legacyIntegrationRegex = /\.integration\.tsx?$/u

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(relative(repoRoot, filePath))
      if (!/\.(ts|tsx)$/u.test(normalized)) {
        return false
      }

      if (normalized.includes('/dist/') || normalized.includes('/node_modules/') || normalized.includes('/.next/')) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const relativePath = toPosix(relative(repoRoot, sourceFile))
      const fileName = sourceFile.split(sep).pop() ?? ''

      if (relativePath.includes('/__tests__/')) {
        fail(
          `Test colocation invariant: legacy \`__tests__\` directories are forbidden. Move to colocated \`<file>.test.ts[x]\` or \`<file>.integration.test.ts[x]\`: \`${relativePath}\`.`
        )
      }

      if (specFileRegex.test(fileName)) {
        fail(
          `Test naming invariant: \`.spec.ts[x]\` files are forbidden. Use \`.test.ts[x]\` or \`.integration.test.ts[x]\`: \`${relativePath}\`.`
        )
      }

      if (legacyIntegrationRegex.test(fileName) && !testFileRegex.test(fileName)) {
        fail(
          `Test naming invariant: \`.integration.ts[x]\` is forbidden. Use \`.integration.test.ts[x]\`: \`${relativePath}\`.`
        )
      }

      if (!testFileRegex.test(fileName)) {
        continue
      }

      const baseName = fileName
        .replace(/\.integration\.test\.tsx?$/u, '')
        .replace(/\.test\.tsx?$/u, '')

      const sourceDir = dirname(sourceFile)
      const sourceTs = resolve(sourceDir, `${baseName}.ts`)
      const sourceTsx = resolve(sourceDir, `${baseName}.tsx`)

      if (!existsSync(sourceTs) && !existsSync(sourceTsx)) {
        fail(
          [
            'Test colocation invariant:',
            `\`${relativePath}\` has no colocated source module.`,
            `Expected one of \`${toPosix(relative(repoRoot, sourceTs))}\` or \`${toPosix(relative(repoRoot, sourceTsx))}\`.`
          ].join(' ')
        )
      }
    }
  }
}

const enforceApiIntegrationHarnessContracts = () => {
  const apiIntegrationPath = resolve(repoRoot, 'apps/api/src/api.integration.test.ts')

  if (!existsSync(apiIntegrationPath) || !statSync(apiIntegrationPath).isFile()) {
    fail('Missing required API integration suite: `apps/api/src/api.integration.test.ts`.')
    return
  }

  const source = readUtf8(apiIntegrationPath)

  if (!/\bcreateDbAuthContext\s*\(/u.test(source)) {
    fail(
      'API integration suite must use `createDbAuthContext(...)` from `@tx-agent-kit/testkit` for idempotent shared setup.'
    )
  }

  if (/\bcreateSqlTestContext\s*\(/u.test(source)) {
    fail(
      'API integration suite must not use `createSqlTestContext(...)` directly. Use `createDbAuthContext(...)`.'
    )
  }

  if (/from\s+['"]node:child_process['"]/u.test(source) || /\bspawn\s*\(/u.test(source)) {
    fail(
      'API integration suite must not spawn child processes directly. Use shared testkit harness APIs.'
    )
  }
}

const enforceApiHarnessPathResolutionContracts = () => {
  const harnessCallerFiles = [
    'apps/api/src/api.integration.test.ts',
    'packages/testkit/src/db-auth-context.integration.test.ts',
    'apps/web/integration/support/web-integration-context.ts'
  ]

  for (const relativePath of harnessCallerFiles) {
    const absolutePath = resolve(repoRoot, relativePath)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      fail(`Missing API harness caller file: \`${relativePath}\`.`)
      continue
    }

    const source = readUtf8(absolutePath)
    if (!/\bcreateDbAuthContext\s*\(/u.test(source)) {
      fail(`API harness caller must instantiate \`createDbAuthContext(...)\`: \`${relativePath}\`.`)
    }

    if (/\bapiCwd\s*:\s*(?:process\.cwd\s*\(|resolve\s*\(\s*process\.cwd\s*\()/u.test(source)) {
      fail(
        [
          `API harness caller \`${relativePath}\` must not resolve \`apiCwd\` from \`process.cwd()\`.`,
          'Use `fileURLToPath(import.meta.url)` + `resolve(...)` to be workspace-safe.'
        ].join(' ')
      )
    }

    if (!/\bfileURLToPath\s*\(\s*import\.meta\.url\s*\)/u.test(source)) {
      fail(
        `API harness caller \`${relativePath}\` must resolve paths from \`fileURLToPath(import.meta.url)\` for workspace-safe execution.`
      )
    }
  }
}

const enforceCriticalIntegrationCoverage = () => {
  const apiIntegrationPath = resolve(repoRoot, 'apps/api/src/api.integration.test.ts')
  if (!existsSync(apiIntegrationPath) || !statSync(apiIntegrationPath).isFile()) {
    fail('Missing required API integration suite: `apps/api/src/api.integration.test.ts`.')
  } else {
    const source = readUtf8(apiIntegrationPath)
    const requiredApiPaths = [
      '/health',
      '/v1/auth/sign-in',
      '/v1/auth/me',
      '/v1/organizations',
      '/v1/invitations'
    ]

    for (const apiPath of requiredApiPaths) {
      if (!source.includes(apiPath)) {
        fail(
          `Critical API flow coverage missing in \`apps/api/src/api.integration.test.ts\`: expected path \`${apiPath}\`.`
        )
      }
    }

    const coversSignUpPath = source.includes('/v1/auth/sign-up')
    const coversSignUpViaFactory = /\bcreateUser\s*\(/u.test(source)
    if (!coversSignUpPath && !coversSignUpViaFactory) {
      fail(
        'Critical API flow coverage missing in `apps/api/src/api.integration.test.ts`: expected sign-up flow via `/v1/auth/sign-up` or `createUser(...)` factory helper.'
      )
    }

    if (!/idempotent/u.test(source)) {
      fail(
        'Critical API flow coverage missing: invitation acceptance idempotency scenario was not detected in API integration suite.'
      )
    }

    const hasHealthEndpointCaseName = /health-endpoint/u.test(source)
    const hasLiteralHealthLatencyBudgetAssertion = /toBeLessThan\((?:1500|1_500)\)/u.test(
      source
    )
    const hasNamedHealthLatencyBudget =
      (
        /const\s+healthReadinessLatencyBudgetMs\s*=\s*(?:1500|1_500)/u.test(source) ||
        /const\s+healthReadinessLatencyBudgetMs\s*=\s*parsePositiveInt\s*\(/u.test(source)
      ) &&
      /toBeLessThan\(healthReadinessLatencyBudgetMs\)/u.test(source)

    if (
      !hasHealthEndpointCaseName ||
      (!hasLiteralHealthLatencyBudgetAssertion && !hasNamedHealthLatencyBudget)
    ) {
      fail(
        'Critical API flow coverage missing: health endpoint readiness/performance assertion was not detected in API integration suite.'
      )
    }
  }

  const requiredWebIntegrationSuites = [
    'apps/web/app/dashboard/page.integration.test.tsx',
    'apps/web/app/invitations/page.integration.test.tsx',
    'apps/web/app/organizations/page.integration.test.tsx',
    'apps/web/components/AuthForm.integration.test.tsx',
    'apps/web/components/CreateOrganizationForm.integration.test.tsx',
    'apps/web/components/CreateInvitationForm.integration.test.tsx',
    'apps/web/components/AcceptInvitationForm.integration.test.tsx',
    'apps/web/components/SignOutButton.integration.test.tsx',
    'apps/web/lib/client-auth.test.ts'
  ]

  for (const requiredPath of requiredWebIntegrationSuites) {
    const absolutePath = resolve(repoRoot, requiredPath)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      fail(`Critical web integration coverage missing: \`${requiredPath}\`.`)
    }
  }

  const dashboardSuitePath = resolve(repoRoot, 'apps/web/app/dashboard/page.integration.test.tsx')
  if (existsSync(dashboardSuitePath) && statSync(dashboardSuitePath).isFile()) {
    const dashboardSource = readUtf8(dashboardSuitePath)
    if (!dashboardSource.includes('/sign-in?next=%2Fdashboard')) {
      fail(
        'Dashboard integration suite must assert unauthenticated redirect behavior (`/sign-in?next=%2Fdashboard`).'
      )
    }

    if (!/auth token is invalid/u.test(dashboardSource)) {
      fail(
        'Dashboard integration suite must cover invalid-token redirect behavior.'
      )
    }
  }

  const invitationsPageSuitePath = resolve(repoRoot, 'apps/web/app/invitations/page.integration.test.tsx')
  if (existsSync(invitationsPageSuitePath) && statSync(invitationsPageSuitePath).isFile()) {
    const invitationsSource = readUtf8(invitationsPageSuitePath)
    if (!invitationsSource.includes('/sign-in?next=%2Finvitations')) {
      fail(
        'Invitations page integration suite must assert unauthenticated redirect behavior (`/sign-in?next=%2Finvitations`).'
      )
    }

    if (!/auth token is invalid/u.test(invitationsSource)) {
      fail(
        'Invitations page integration suite must cover invalid-token redirect behavior.'
      )
    }

    if (!/\bcreateUser\s*\(/u.test(invitationsSource) || !/\bcreateTeam\s*\(/u.test(invitationsSource)) {
      fail(
        'Invitations page integration suite must cover authenticated data flow setup via `createUser(...)` and `createTeam(...)`.'
      )
    }

    if (!/\bclientApi\.createInvitation\s*\(/u.test(invitationsSource)) {
      fail(
        'Invitations page integration suite must cover invitation listing flow seeded through `clientApi.createInvitation(...)`.'
      )
    }
  }

  const organizationsPageSuitePath = resolve(repoRoot, 'apps/web/app/organizations/page.integration.test.tsx')
  if (existsSync(organizationsPageSuitePath) && statSync(organizationsPageSuitePath).isFile()) {
    const organizationsSource = readUtf8(organizationsPageSuitePath)
    if (!organizationsSource.includes('/sign-in?next=%2Forganizations')) {
      fail(
        'Organizations page integration suite must assert unauthenticated redirect behavior (`/sign-in?next=%2Forganizations`).'
      )
    }

    if (!/auth token is invalid/u.test(organizationsSource)) {
      fail(
        'Organizations page integration suite must cover invalid-token redirect behavior.'
      )
    }

    if (!/\bcreateUser\s*\(/u.test(organizationsSource) || !/\bcreateTeam\s*\(/u.test(organizationsSource)) {
      fail(
        'Organizations page integration suite must cover authenticated data flow setup via `createUser(...)` and `createTeam(...)`.'
      )
    }
  }

  const clientAuthSuitePath = resolve(repoRoot, 'apps/web/lib/client-auth.test.ts')
  if (existsSync(clientAuthSuitePath) && statSync(clientAuthSuitePath).isFile()) {
    const clientAuthSource = readUtf8(clientAuthSuitePath)
    if (!/handleUnauthorizedApiError/u.test(clientAuthSource)) {
      fail(
        'Client auth integration suite must cover `handleUnauthorizedApiError(...)` behavior.'
      )
    }
  }

  const workerActivitiesSuitePath = resolve(repoRoot, 'apps/worker/src/activities.integration.test.ts')
  if (!existsSync(workerActivitiesSuitePath) || !statSync(workerActivitiesSuitePath).isFile()) {
    fail('Critical worker integration coverage missing: `apps/worker/src/activities.integration.test.ts`.')
  } else {
    const workerActivitiesSource = readUtf8(workerActivitiesSuitePath)

    if (/\bTRUNCATE\s+TABLE\b/u.test(workerActivitiesSource) || /\bresetPublicTables\s*\(/u.test(workerActivitiesSource)) {
      fail(
        'Worker activities integration suite must not truncate shared tables; rely on unique fixtures to avoid cross-project clobbering.'
      )
    }

    if (!/\bactivities\.ping\s*\(/u.test(workerActivitiesSource)) {
      fail(
        'Worker activities integration suite must execute `activities.ping(...)` as a baseline smoke test.'
      )
    }

    if (!/\bpingWorkflow\b/u.test(workerActivitiesSource)) {
      fail(
        'Worker activities integration suite must execute the `pingWorkflow` end-to-end.'
      )
    }
  }

  const observabilitySuitePath = resolve(repoRoot, 'packages/infra/observability/src/stack.integration.test.ts')
  if (!existsSync(observabilitySuitePath) || !statSync(observabilitySuitePath).isFile()) {
    fail('Critical observability integration coverage missing: `packages/infra/observability/src/stack.integration.test.ts`.')
  } else {
    const observabilitySource = readUtf8(observabilitySuitePath)
    const requiredObservabilityMarkers = [
      'tx-agent-kit-api',
      'tx-agent-kit-worker',
      'tx-agent-kit-web',
      'tx-agent-kit-mobile',
      'clientRequestTotalSeriesQuery',
      'nodeServiceStartupSeriesQuery',
      'queryJaegerTraceCount'
    ]

    for (const marker of requiredObservabilityMarkers) {
      if (!observabilitySource.includes(marker)) {
        fail(
          `Critical observability flow coverage missing in \`packages/infra/observability/src/stack.integration.test.ts\`: expected marker \`${marker}\`.`
        )
      }
    }

    const hasDbAuthHarness = /\bcreateDbAuthContext\s*\(/u.test(observabilitySource)
    const hasInlineApiHarness = /\bstartApiHarness\s*=\s*async/u.test(observabilitySource)
    if (!hasDbAuthHarness && !hasInlineApiHarness) {
      fail(
        'Critical observability coverage missing: stack integration suite must include a real API harness flow (either `createDbAuthContext(...)` or `startApiHarness(...)`).'
      )
    }
  }
}

const enforceWebIntegrationHarnessContracts = () => {
  const setupPath = resolve(repoRoot, 'apps/web/vitest.integration.setup.ts')
  if (!existsSync(setupPath) || !statSync(setupPath).isFile()) {
    fail('Missing required web integration setup file: `apps/web/vitest.integration.setup.ts`.')
    return
  }

  const setupSource = readUtf8(setupPath)
  const requiredSetupMarkers = [
    'setupWebIntegrationSuite',
    'resetWebIntegrationCase',
    'teardownWebIntegrationSuite',
    'beforeAll',
    'beforeEach',
    'afterAll'
  ]

  for (const marker of requiredSetupMarkers) {
    if (!setupSource.includes(marker)) {
      fail(
        `Web integration setup must include \`${marker}\` in \`apps/web/vitest.integration.setup.ts\`.`
      )
    }
  }

  const webRoot = resolve(repoRoot, 'apps/web')
  if (!existsSync(webRoot) || !statSync(webRoot).isDirectory()) {
    return
  }

  const integrationTests = listFilesRecursively(webRoot).filter((filePath) =>
    /\.(integration\.test\.ts|integration\.test\.tsx)$/u.test(filePath)
  )

  for (const integrationTestPath of integrationTests) {
    const relativePath = toPosix(relative(repoRoot, integrationTestPath))
    if (relativePath === 'apps/web/vitest.integration.setup.ts') {
      continue
    }

    const source = readUtf8(integrationTestPath)
    if (
      /setupWebIntegrationSuite|resetWebIntegrationCase|teardownWebIntegrationSuite/u.test(source)
    ) {
      fail(
        [
          `Web integration test \`${relativePath}\` must not call suite lifecycle functions directly.`,
          'Use centralized lifecycle hooks in `apps/web/vitest.integration.setup.ts`.'
        ].join(' ')
      )
    }
  }
}

const enforcePgTapTriggerCoverage = () => {
  const migrationsDir = resolve(repoRoot, 'packages/infra/db/drizzle/migrations')
  const pgtapDir = resolve(repoRoot, 'packages/infra/db/pgtap')

  if (!existsSync(migrationsDir) || !statSync(migrationsDir).isDirectory()) {
    fail('Missing migrations directory: `packages/infra/db/drizzle/migrations`.')
    return
  }

  if (!existsSync(pgtapDir) || !statSync(pgtapDir).isDirectory()) {
    fail('Missing pgTAP directory: `packages/infra/db/pgtap`.')
    return
  }

  const migrationFiles = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .map((fileName) => resolve(migrationsDir, fileName))
    .sort()

  const triggerNames = new Set()
  const triggerRegex = /CREATE\s+TRIGGER\s+([A-Za-z0-9_]+)/giu

  for (const migrationPath of migrationFiles) {
    const source = readUtf8(migrationPath)
    for (const match of source.matchAll(triggerRegex)) {
      triggerNames.add(match[1])
    }
  }

  if (triggerNames.size === 0) {
    fail('No database triggers were detected in migrations; expected trigger coverage contracts.')
    return
  }

  const pgtapFiles = readdirSync(pgtapDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .map((fileName) => resolve(pgtapDir, fileName))
    .sort()

  if (pgtapFiles.length === 0) {
    fail('No pgTAP SQL suites found in `packages/infra/db/pgtap`.')
    return
  }

  const pgtapSource = pgtapFiles.map((filePath) => readUtf8(filePath)).join('\n')

  for (const triggerName of triggerNames) {
    const triggerReferenceRegex = new RegExp(`\\b${triggerName}\\b`, 'u')
    if (!triggerReferenceRegex.test(pgtapSource)) {
      fail(
        `Missing pgTAP coverage marker for trigger \`${triggerName}\`. Reference this trigger in \`packages/infra/db/pgtap/*.sql\`.`
      )
    }
  }
}

const enforceGlobalIntegrationWorkspaceContracts = () => {
  const workspaceConfigPath = resolve(repoRoot, 'vitest.integration.workspace.ts')
  if (!existsSync(workspaceConfigPath) || !statSync(workspaceConfigPath).isFile()) {
    fail('Missing required integration workspace config: `vitest.integration.workspace.ts`.')
    return
  }

  const workspaceConfigSource = readUtf8(workspaceConfigPath)
  const requiredWorkspaceMarkers = [
    'scripts/test/vitest-global-setup.ts',
    'apps/api/vitest.integration.config.ts',
    'apps/web/vitest.integration.config.ts',
    'packages/testkit/vitest.integration.config.ts',
    'apps/worker/vitest.integration.config.ts'
  ]

  for (const marker of requiredWorkspaceMarkers) {
    if (!workspaceConfigSource.includes(marker)) {
      fail(`Integration workspace config must include \`${marker}\` in \`vitest.integration.workspace.ts\`.`)
    }
  }

  const globalSetupPath = resolve(repoRoot, 'scripts/test/vitest-global-setup.ts')
  if (!existsSync(globalSetupPath) || !statSync(globalSetupPath).isFile()) {
    fail('Missing required integration global setup file: `scripts/test/vitest-global-setup.ts`.')
  }

  const runIntegrationScriptPath = resolve(repoRoot, 'scripts/test/run-integration.sh')
  if (!existsSync(runIntegrationScriptPath) || !statSync(runIntegrationScriptPath).isFile()) {
    fail('Missing integration runner script: `scripts/test/run-integration.sh`.')
  } else {
    const runIntegrationSource = readUtf8(runIntegrationScriptPath)
    if (!runIntegrationSource.includes('vitest.integration.workspace.ts')) {
      fail(
        'Integration runner must execute root Vitest workspace config (`vitest.integration.workspace.ts`) in `scripts/test/run-integration.sh`.'
      )
    }
  }

  const quietIntegrationScriptPath = resolve(repoRoot, 'scripts/test-integration-quiet.sh')
  if (!existsSync(quietIntegrationScriptPath) || !statSync(quietIntegrationScriptPath).isFile()) {
    fail('Missing quiet integration runner script: `scripts/test-integration-quiet.sh`.')
  } else {
    const quietIntegrationSource = readUtf8(quietIntegrationScriptPath)
    if (!quietIntegrationSource.includes('vitest.integration.workspace.ts')) {
      fail(
        'Quiet integration runner must execute root Vitest workspace config (`vitest.integration.workspace.ts`) in `scripts/test-integration-quiet.sh`.'
      )
    }
  }

  const disallowLocalGlobalSetupPaths = [
    'apps/api/vitest.integration.config.ts',
    'apps/web/vitest.integration.config.ts',
    'packages/testkit/vitest.integration.config.ts',
    'apps/worker/vitest.integration.config.ts'
  ]

  for (const relativePath of disallowLocalGlobalSetupPaths) {
    const absolutePath = resolve(repoRoot, relativePath)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      fail(`Missing integration project config: \`${relativePath}\`.`)
      continue
    }

    const source = readUtf8(absolutePath)
    if (/\bglobalSetup\s*:/u.test(source)) {
      fail(
        `Integration project config \`${relativePath}\` must not define local \`globalSetup\`. Use root workspace global setup instead.`
      )
    }
  }

  const integrationProjectConfigPaths = [
    'apps/api/vitest.integration.config.ts',
    'apps/web/vitest.integration.config.ts',
    'packages/testkit/vitest.integration.config.ts',
    'apps/worker/vitest.integration.config.ts'
  ]

  for (const relativePath of integrationProjectConfigPaths) {
    const absolutePath = resolve(repoRoot, relativePath)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      fail(`Missing integration project config: \`${relativePath}\`.`)
      continue
    }

    const source = readUtf8(absolutePath)
    if (/\bgroupOrder\s*:/u.test(source)) {
      fail(
        `Integration project config \`${relativePath}\` must not pin \`sequence.groupOrder\`; allow workspace-level parallel scheduling.`
      )
    }

    if (/maxWorkers:\s*1/u.test(source)) {
      fail(
        `Integration project config \`${relativePath}\` must not force \`maxWorkers: 1\`; use shared env-driven worker policy.`
      )
    }

    if (/fileParallelism:\s*false/u.test(source)) {
      fail(
        `Integration project config \`${relativePath}\` must not disable \`fileParallelism\`; use shared env-driven worker policy.`
      )
    }
  }

  const rootVitestConfigPath = resolve(repoRoot, 'vitest.config.ts')
  if (!existsSync(rootVitestConfigPath) || !statSync(rootVitestConfigPath).isFile()) {
    fail('Missing root unit workspace config: `vitest.config.ts`.')
  } else {
    const rootVitestConfigSource = readUtf8(rootVitestConfigPath)
    if (/maxWorkers:\s*1/u.test(rootVitestConfigSource)) {
      fail(
        'Root unit workspace config must not force `maxWorkers: 1`; use shared env-driven worker policy.'
      )
    }

    if (/fileParallelism:\s*false/u.test(rootVitestConfigSource)) {
      fail(
        'Root unit workspace config must not disable `fileParallelism`; use shared env-driven worker policy.'
      )
    }
  }
}

const enforceNoDirectProcessEnvInSource = () => {
  const sourceRoots = [
    resolve(repoRoot, 'apps'),
    resolve(repoRoot, 'packages')
  ]

  const allowedEnvFiles = new Set([
    'apps/api/src/config/env.ts',
    'apps/api/src/config/openapi-env.ts',
    'apps/worker/src/config/env.ts',
    'apps/web/lib/env.ts',
    'apps/mobile/lib/env.ts',
    'packages/infra/auth/src/env.ts',
    'packages/infra/db/src/env.ts',
    'packages/infra/logging/src/env.ts',
    'packages/infra/observability/src/env.ts',
    'packages/infra/ai/src/env.ts',
    'packages/testkit/src/env.ts'
  ])

  for (const sourceRoot of sourceRoots) {
    if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(sourceRoot).filter((filePath) => {
      const normalized = toPosix(relative(repoRoot, filePath))
      if (!/\.(ts|tsx)$/u.test(normalized)) {
        return false
      }

      if (!normalized.includes('/src/') && normalized !== 'apps/web/lib/env.ts' && !normalized.startsWith('apps/mobile/')) {
        return false
      }

      if (normalized.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/u.test(normalized)) {
        return false
      }

      if (allowedEnvFiles.has(normalized)) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const source = readUtf8(sourceFile)
      if (!/\bprocess\.env\b/u.test(source)) {
        continue
      }

      fail(
        [
          'Direct process.env access is forbidden in source modules.',
          `Move env reads into an allowed env module: \`${toPosix(relative(repoRoot, sourceFile))}\`.`
        ].join(' ')
      )
    }
  }
}

const enforceNoSourcePlaceholderComments = () => {
  const roots = [
    resolve(repoRoot, 'apps'),
    resolve(repoRoot, 'packages')
  ]

  const placeholderRegex = /(?:\/\/|\/\*+|\*+)\s*(?:TODO|FIXME|HACK)\b/u

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(relative(repoRoot, filePath))
      if (!/\.(ts|tsx|js|mjs)$/u.test(normalized)) {
        return false
      }

      const isSourcePath =
        normalized.includes('/src/') ||
        normalized.startsWith('apps/web/app/') ||
        normalized.startsWith('apps/web/components/') ||
        normalized.startsWith('apps/web/lib/') ||
        normalized.startsWith('apps/mobile/app/') ||
        normalized.startsWith('apps/mobile/components/') ||
        normalized.startsWith('apps/mobile/lib/') ||
        normalized.startsWith('apps/mobile/stores/') ||
        normalized.startsWith('apps/mobile/hooks/')
      if (!isSourcePath) {
        return false
      }

      if (normalized.includes('/.next/') || normalized.includes('/dist/') || normalized.includes('/node_modules/')) {
        return false
      }

      if (normalized.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/u.test(normalized)) {
        return false
      }

      if (normalized.includes('/apps/docs/.source/') || normalized.startsWith('apps/docs/.source/')) {
        return false
      }

      if (normalized.includes('/lib/api/generated/')) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const source = readUtf8(sourceFile)
      if (!placeholderRegex.test(source)) {
        continue
      }

      fail(
        `Source placeholders (TODO/FIXME/HACK comments) are forbidden: \`${toPosix(relative(repoRoot, sourceFile))}\`.`
      )
    }
  }
}

const enforceNoBuildArtifactsInSource = () => {
  const roots = [
    resolve(repoRoot, 'apps'),
    resolve(repoRoot, 'packages')
  ]

  const generatedPattern = /\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const generatedFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(relative(repoRoot, filePath))
      if (!normalized.includes('/src/')) {
        return false
      }

      return generatedPattern.test(normalized)
    })

    for (const generatedFile of generatedFiles) {
      fail(
        [
          'Build artifacts are forbidden under source trees.',
          `Remove generated file: \`${toPosix(relative(repoRoot, generatedFile))}\`.`,
          'Use package `dist/` outputs for emitted JS/declarations.'
        ].join(' ')
      )
    }
  }
}

const enforceNoDefaultExportsInDdd = () => {
  const roots = [
    resolve(repoRoot, 'packages/core/src/domains'),
    resolve(repoRoot, 'apps/api/src/domains'),
    resolve(repoRoot, 'apps/api/src/routes')
  ]

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(relative(repoRoot, filePath))
      if (!/\.(ts|tsx)$/u.test(normalized)) {
        return false
      }

      if (normalized.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/u.test(normalized)) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const source = readUtf8(sourceFile)
      if (!/\bexport\s+default\b/u.test(source)) {
        continue
      }

      fail(
        `Default exports are forbidden in DDD/route layers: \`${toPosix(relative(repoRoot, sourceFile))}\`.`
      )
    }
  }
}

enforceDbEffectSchemaParity()
enforceDbJsonColumnEffectSchemaParity()
enforceDbFactoryParity()
enforceDomainDirectoryContracts()
enforceNoRootServiceBypass()
enforceNoPromisePorts()
enforceDbRepositoryDecodeContracts()
enforceSingleRootEnvFilePolicy()
enforceNoSuppressionDirectives()
enforceWebApiGenerationContracts()
enforceColocatedTestConventions()
enforceApiIntegrationHarnessContracts()
enforceApiHarnessPathResolutionContracts()
enforceCriticalIntegrationCoverage()
enforceWebIntegrationHarnessContracts()
enforceGlobalIntegrationWorkspaceContracts()
enforcePgTapTriggerCoverage()
enforceNoDirectProcessEnvInSource()
enforceNoSourcePlaceholderComments()
enforceNoBuildArtifactsInSource()
enforceNoDefaultExportsInDdd()

// ── RPC placement ──────────────────────────────────────────────────────
const enforceRpcPlacement = () => {
  const dbRoot = resolve(repoRoot, 'packages/infra/db')
  const allowedRpcDir = resolve(dbRoot, 'src/rpcs')
  const migrationsDir = resolve(dbRoot, 'drizzle/migrations')
  const pgtapDir = resolve(dbRoot, 'pgtap')

  const sqlFiles = listFilesRecursively(dbRoot)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !f.startsWith(migrationsDir))
    .filter((f) => !f.startsWith(pgtapDir))

  for (const filePath of sqlFiles) {
    const content = readUtf8(filePath)
    const hasNonTriggerFunction =
      /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(content) &&
      !/RETURNS\s+trigger/i.test(content)

    if (hasNonTriggerFunction && !filePath.startsWith(allowedRpcDir)) {
      fail(
        `RPC/function definition found outside packages/infra/db/src/rpcs/: ${relative(repoRoot, filePath)}. ` +
        'Move non-trigger SQL functions to packages/infra/db/src/rpcs/.'
      )
    }
  }
}

enforceRpcPlacement()

if (errors.length > 0) {
  console.error('Domain invariant check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Domain invariant check passed.')
