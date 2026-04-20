import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import ts from 'typescript'

export const repoRoot = process.cwd()

export const toPosix = (value) => value.split(sep).join('/')
export const toKebabCase = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

export const readUtf8 = (path) => readFileSync(path, 'utf8')

export const listFilesRecursively = (rootDir) => {
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

export const extractTableConstants = (schemaSource) => {
  const names = new Set()
  const regex = /export const (\w+)\s*=\s*pgTable\(/g

  for (const match of schemaSource.matchAll(regex)) {
    names.add(match[1])
  }

  return [...names]
}

export const getTableNamesFromSchema = (errors) => {
  const schemaRoot = resolve(repoRoot, 'packages/infra/db/src')
  if (!existsSync(schemaRoot) || !statSync(schemaRoot).isDirectory()) {
    errors.push('Missing `packages/infra/db/src` directory.')
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
      errors.push(`Aliasing \`pgTable\` is disallowed for invariant safety: \`${relativePath}\`.`)
    }

    if (/(?:^|\n)\s*(?!export\s)(?:const|let|var)\s+[A-Za-z0-9_]+\s*=\s*pgTable\s*(?:;|\n|$)/.test(source)) {
      errors.push(`Wrapping \`pgTable\` in local aliases is disallowed for invariant safety: \`${relativePath}\`.`)
    }

    const directPgTableCalls = [...source.matchAll(/\bpgTable\s*\(/g)].length
    for (const tableName of extractTableConstants(source)) {
      tableNames.add(tableName)
    }

    const declaredTableExports = extractTableConstants(source).length
    if (directPgTableCalls > 0 && directPgTableCalls !== declaredTableExports) {
      errors.push(
        `Every \`pgTable(...)\` call must be declared as \`export const <name> = pgTable(...)\` in \`${relativePath}\`.`
      )
    }
  }

  const sortedNames = [...tableNames].sort()
  if (sortedNames.length === 0) {
    errors.push('No `pgTable(...)` declarations were found in `packages/infra/db/src`.')
  }

  return sortedNames
}

export const parseTypeScriptSourceFile = (filePath, source) =>
  ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

export const unwrapTsExpression = (expression) => {
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

export const unwrapTsTypeNode = (typeNode) => {
  let current = typeNode

  while (current && ts.isParenthesizedTypeNode(current)) {
    current = current.type
  }

  return current
}

export const getTypeReferenceName = (typeNameNode) => {
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

export const getWeakJsonTypeReason = (typeNode) => {
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

export const getPropertyNameText = (propertyName) => {
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

export const collectJsonBuilderIdentifiers = (sourceFile) => {
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

export const analyzeJsonColumnInitializer = (initializerExpression, jsonBuilderIdentifiers) => {
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

export const collectDbJsonColumnsByTable = (errors) => {
  const schemaRoot = resolve(repoRoot, 'packages/infra/db/src')
  if (!existsSync(schemaRoot) || !statSync(schemaRoot).isDirectory()) {
    errors.push('Missing `packages/infra/db/src` directory for JSON column invariant checks.')
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
            errors.push(
              [
                `JSON/JSONB column \`${tableConstName}.${columnName}\` in \`${relativePath}\` must call \`.$type<...>()\` with an explicit payload type.`,
                'Do not leave Drizzle JSON columns implicitly typed.'
              ].join(' ')
            )
          }

          if (analysis.weakTypeReason) {
            errors.push(
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

export const collectSchemaNamespaceIdentifiers = (sourceFile) => {
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

export const findStructObjectLiteral = (expression, schemaNamespaces) => {
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

export const parseEffectRowSchemaFields = (effectSchemaPath, errors) => {
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
    errors.push(
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

export const isWeakEffectJsonSchemaExpression = (schemaExpression, sourceFile, schemaNamespaces) => {
  const expressionSource = schemaExpression.getText(sourceFile)

  for (const schemaNamespace of schemaNamespaces) {
    const weakSchemaRegex = new RegExp(`\\b${schemaNamespace}\\.(?:Unknown|Json)\\b`, 'u')
    if (weakSchemaRegex.test(expressionSource)) {
      return true
    }
  }

  return false
}

export const importRegex = /(?:import|export)\s+(?:[\s\w{},*]+from\s+)?['"]([^'"]+)['"]/g
