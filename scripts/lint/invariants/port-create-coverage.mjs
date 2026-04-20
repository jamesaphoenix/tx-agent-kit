import { existsSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

import {
  listFilesRecursively,
  parseTypeScriptSourceFile,
  readUtf8,
  repoRoot,
  toPosix,
  unwrapTsExpression,
  getPropertyNameText
} from './utils.mjs'

/**
 * Auto-excluded columns: they always have defaultRandom / defaultNow in schema.ts
 * and are never expected in port `create` inputs.
 */
const AUTO_EXCLUDED_COLUMNS = new Set(['id', 'createdAt', 'updatedAt'])

/**
 * Parse schema.ts and return a Map<tableName, Set<requiredNoDefaultColumns>>.
 *
 * A column is "required with no default" when its chain includes `.notNull()` and
 * does NOT include `.default(`, `.defaultRandom(`, or `.defaultNow(`.
 * We use source-text scanning per-column rather than full AST chain walking, which
 * is simpler and sufficient for the Drizzle column-builder pattern.
 */
const parseRequiredNoDefaultColumns = (schemaPath) => {
  const source = readUtf8(schemaPath)
  const sourceFile = parseTypeScriptSourceFile(schemaPath, source)
  const result = new Map()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) {
        continue
      }

      const init = unwrapTsExpression(decl.initializer)
      if (!ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== 'pgTable') {
        continue
      }

      const tableName = decl.name.text
      const columnsArg = init.arguments[1]
      if (!columnsArg || !ts.isObjectLiteralExpression(columnsArg)) {
        continue
      }

      const requiredCols = new Set()
      for (const prop of columnsArg.properties) {
        if (!ts.isPropertyAssignment(prop)) {
          continue
        }

        const colName = getPropertyNameText(prop.name)
        if (!colName || AUTO_EXCLUDED_COLUMNS.has(colName)) {
          continue
        }

        // Get the full source text of the column definition
        const colSource = prop.initializer.getText(sourceFile)

        const isNotNull = /\.notNull\(\)/.test(colSource)
        const hasDefault = /\.default\(|\.defaultRandom\(|\.defaultNow\(/.test(colSource)
        // Primary keys always have implicit defaults (gen_random_uuid)
        const isPrimaryKey = /\.primaryKey\(\)/.test(colSource)

        if (isNotNull && !hasDefault && !isPrimaryKey) {
          requiredCols.add(colName)
        }
      }

      if (requiredCols.size > 0) {
        result.set(tableName, requiredCols)
      }
    }
  }

  return result
}

/**
 * Parse a port file and return Map<portClassName, Map<methodName, Set<fieldName>>> for
 * `create` (and `create`-prefixed) methods that take an object-literal input type.
 *
 * Matches patterns like:
 *   create: (input: { teamId: string; name: string }) => ...
 *   createWithEvent: (input: { name: string; ... }) => ...
 */
const parsePortCreateInputs = (filePath) => {
  const source = readUtf8(filePath)
  const sourceFile = parseTypeScriptSourceFile(filePath, source)
  const ports = new Map()

  const visitor = (node) => {
    // Look for `Context.Tag(...)` class declarations with a service shape type literal
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text
      // Walk heritage clauses looking for the service type argument
      if (node.heritageClauses) {
        for (const heritage of node.heritageClauses) {
          for (const heritageType of heritage.types) {
            // The service shape is typically the 3rd type argument of Context.Tag(...)()
            // but it's easier to walk the whole call expression looking for type literals
            visitNodeForCreateMethods(heritageType, className, ports, sourceFile)
          }
        }
      }
    }

    ts.forEachChild(node, visitor)
  }

  ts.forEachChild(sourceFile, visitor)
  return ports
}

const visitNodeForCreateMethods = (node, className, ports, sourceFile) => {
  // Look for TypeLiteral nodes with `create` property signatures
  if (ts.isTypeLiteralNode(node)) {
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !member.name) {
        continue
      }

      const methodName = ts.isIdentifier(member.name) ? member.name.text : null
      if (!methodName || !methodName.startsWith('create')) {
        continue
      }

      // Walk the type annotation to find a function type with an object parameter
      if (member.type) {
        const fields = extractCreateInputFields(member.type, sourceFile)
        if (fields && fields.size > 0) {
          if (!ports.has(className)) {
            ports.set(className, new Map())
          }
          ports.get(className).set(methodName, fields)
        }
      }
    }
  }

  ts.forEachChild(node, (child) => visitNodeForCreateMethods(child, className, ports, sourceFile))
}

/**
 * Given a function type node `(input: { ... }) => Effect<...>`, extract the field
 * names from the first parameter's type literal.
 */
const extractCreateInputFields = (typeNode, sourceFile) => {
  if (!ts.isFunctionTypeNode(typeNode)) {
    return null
  }

  // Find the first parameter whose type is a type literal (object shape)
  for (const param of typeNode.parameters) {
    if (param.type && ts.isTypeLiteralNode(param.type)) {
      const fields = new Set()
      for (const member of param.type.members) {
        if (ts.isPropertySignature(member) && member.name) {
          const name = ts.isIdentifier(member.name) ? member.name.text : null
          if (name) {
            fields.add(name)
          }
        }
      }
      return fields
    }
  }

  return null
}

/**
 * Derive the primary entity name from a port class name.
 * e.g. MediaAssetStorePort -> 'mediaasset'
 *      PendingUploadStorePort -> 'pendingupload'
 *      TeamStorePort -> 'team'
 *      CollectionStorePort -> 'collection'
 *      OrganizationStorePort -> 'organization'
 */
const portEntityName = (className) => {
  return className
    .replace(/StorePort$/, '')
    .replace(/Port$/, '')
    .toLowerCase()
}

/**
 * Derive a normalized entity name from a table constant name.
 * e.g. teams -> 'team'
 *      teamMediaAssets -> 'teammediaasset'
 *      pendingUploads -> 'pendingupload'
 *      organizations -> 'organization'
 *      collectionAssets -> 'collectionasset'
 */
const tableEntityName = (tableName) => {
  // Remove trailing 's' for plural -> singular
  return tableName.toLowerCase().replace(/s$/, '')
}

/**
 * Columns that are commonly auto-generated by the repository adapter (not passed
 * through the port create input). These are excluded from the coverage check
 * in addition to id/createdAt/updatedAt.
 */
const ADAPTER_GENERATED_COLUMNS = new Set(['token'])

/**
 * Enforce that for each pgTable with required-no-default columns,
 * the corresponding port `create` method input covers those columns.
 *
 * Matching strategy:
 * - Derive the port's entity name (e.g. MediaAssetStorePort -> 'mediaasset')
 * - Derive the table's entity name (e.g. teamMediaAssets -> 'teammediaasset')
 * - Match only when the table entity equals the port entity (exact singular match)
 * - Only check the `create` method (not createWithEvent etc.)
 */
export const enforcePortCreateMatchesSchema = (errors) => {
  const schemaPath = resolve(repoRoot, 'packages/infra/db/src/schema.ts')
  if (!existsSync(schemaPath)) {
    return
  }

  const portsRoot = resolve(repoRoot, 'packages/core/src/domains')
  if (!existsSync(portsRoot) || !statSync(portsRoot).isDirectory()) {
    return
  }

  const tableRequiredCols = parseRequiredNoDefaultColumns(schemaPath)
  if (tableRequiredCols.size === 0) {
    return
  }

  // Collect all port create inputs
  const portFiles = listFilesRecursively(portsRoot)
    .filter((f) => f.endsWith('-ports.ts'))

  const allPortCreateInputs = new Map()
  for (const portFile of portFiles) {
    const ports = parsePortCreateInputs(portFile)
    for (const [className, methods] of ports) {
      allPortCreateInputs.set(className, { methods, file: portFile })
    }
  }

  // Build a lookup: portEntityName -> { className, createFields, file }
  const portsByEntity = new Map()
  for (const [className, portData] of allPortCreateInputs) {
    const entity = portEntityName(className)
    const createFields = portData.methods.get('create')
    if (createFields) {
      portsByEntity.set(entity, { className, createFields, file: portData.file })
    }
  }

  // Match each table to its owning port via exact entity name match
  for (const [tableName, requiredCols] of tableRequiredCols) {
    const entity = tableEntityName(tableName)
    const portMatch = portsByEntity.get(entity)

    if (!portMatch) {
      // No matching port found — not necessarily an error (some tables don't have
      // direct port create methods, e.g. join tables, system tables, audit tables)
      continue
    }

    const portRelPath = toPosix(relative(repoRoot, portMatch.file))
    const schemaRelPath = 'packages/infra/db/src/schema.ts'

    for (const requiredCol of requiredCols) {
      if (ADAPTER_GENERATED_COLUMNS.has(requiredCol)) {
        continue
      }

      if (!portMatch.createFields.has(requiredCol)) {
        errors.push(
          `Port \`${portMatch.className}.create\` in \`${portRelPath}\` is missing required column \`${requiredCol}\` ` +
          `from table \`${tableName}\` in \`${schemaRelPath}\` (NOT NULL without default).`
        )
      }
    }
  }
}
