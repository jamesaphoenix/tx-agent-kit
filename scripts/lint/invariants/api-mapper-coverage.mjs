import { existsSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

import {
  parseTypeScriptSourceFile,
  readUtf8,
  repoRoot,
  toPosix,
  unwrapTsExpression,
  collectSchemaNamespaceIdentifiers,
  getPropertyNameText
} from './utils.mjs'

/**
 * Derive candidate contract schema variable names from a mapper function name.
 * Returns candidates in priority order (most specific first):
 *   toApiMediaAsset -> ['mediaAssetApiResponseSchema', 'mediaAssetSchema']
 *   toApiCollection -> ['collectionApiResponseSchema', 'collectionSchema']
 */
const mapperFnToSchemaCandidates = (fnName) => {
  const stripped = fnName.replace(/^toApi/, '')
  const camelCase = stripped.charAt(0).toLowerCase() + stripped.slice(1)
  return [
    `${camelCase}ApiResponseSchema`,
    `${camelCase}Schema`
  ]
}

/**
 * Extract property names from an object literal that a mapper arrow function returns.
 * Handles both `=> ({...})` and `=> { return {...} }` patterns.
 *
 * Returns { keys: Set<string>, hasSpread: boolean }.
 * When hasSpread is true, the returned object uses spread syntax (e.g. `...otherMapper(x)`)
 * and we cannot statically determine the full set of keys.
 */
const extractReturnedObjectKeys = (arrowBody) => {
  const keys = new Set()
  let hasSpread = false

  const extractFromObjectLiteral = (node) => {
    if (!ts.isObjectLiteralExpression(node)) {
      return
    }
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
        const name = getPropertyNameText(prop.name)
        if (name) {
          keys.add(name)
        }
      } else if (ts.isSpreadAssignment(prop)) {
        hasSpread = true
      }
    }
  }

  // Case 1: concise body `=> ({...})`
  const unwrapped = unwrapTsExpression(arrowBody)
  if (ts.isObjectLiteralExpression(unwrapped)) {
    extractFromObjectLiteral(unwrapped)
    return { keys, hasSpread }
  }

  // Case 2: block body `=> { ... return {...} }`
  if (ts.isBlock(arrowBody)) {
    for (const statement of arrowBody.statements) {
      if (ts.isReturnStatement(statement) && statement.expression) {
        const returnExpr = unwrapTsExpression(statement.expression)
        if (ts.isObjectLiteralExpression(returnExpr)) {
          extractFromObjectLiteral(returnExpr)
        }
      }
    }
  }

  return { keys, hasSpread }
}

/**
 * Parse a mapper file and extract { functionName -> Set<field> } for every toApi* function.
 */
const parseMapperFunctions = (filePath) => {
  const source = readUtf8(filePath)
  const sourceFile = parseTypeScriptSourceFile(filePath, source)
  const functions = new Map()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.name.text.startsWith('toApi')) {
        continue
      }

      if (!decl.initializer) {
        continue
      }

      const init = unwrapTsExpression(decl.initializer)
      if (!ts.isArrowFunction(init)) {
        continue
      }

      const { keys, hasSpread } = extractReturnedObjectKeys(init.body)
      if (keys.size > 0) {
        functions.set(decl.name.text, { keys, hasSpread })
      }
    }
  }

  return functions
}

/**
 * Parse a contract file and extract { schemaName -> Set<field> } for every Schema.Struct.
 */
const parseContractSchemaFields = (filePath) => {
  const source = readUtf8(filePath)
  const sourceFile = parseTypeScriptSourceFile(filePath, source)
  const schemaNamespaces = collectSchemaNamespaceIdentifiers(sourceFile)
  const schemas = new Map()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.name.text.endsWith('Schema')) {
        continue
      }

      if (!decl.initializer) {
        continue
      }

      const init = unwrapTsExpression(decl.initializer)
      if (!ts.isCallExpression(init)) {
        continue
      }

      // Match Schema.Struct(...)
      if (
        ts.isPropertyAccessExpression(init.expression) &&
        ts.isIdentifier(init.expression.expression) &&
        schemaNamespaces.has(init.expression.expression.text) &&
        init.expression.name.text === 'Struct'
      ) {
        const arg = init.arguments[0]
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const fields = new Set()
          for (const prop of arg.properties) {
            if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
              const name = getPropertyNameText(prop.name)
              if (name) {
                fields.add(name)
              }
            }
            // Handle spread: `...listParamsSchema.fields` — skip, unknown contribution
          }
          schemas.set(decl.name.text, fields)
        }
      }
    }
  }

  return schemas
}

/**
 * Enforce that every contract Schema.Struct field is covered by the corresponding mapper's
 * returned object literal.
 *
 * Scans: apps/api/src/mappers/*.ts  <-> packages/contracts/src/*.ts
 */
export const enforceApiMapperFieldCoverage = (errors) => {
  const mappersDir = resolve(repoRoot, 'apps/api/src/mappers')
  if (!existsSync(mappersDir)) {
    return
  }

  const contractsDir = resolve(repoRoot, 'packages/contracts/src')
  if (!existsSync(contractsDir)) {
    return
  }

  // Collect all contract schemas across all contract files
  const allContractSchemas = new Map()
  const contractFiles = readdirSync(contractsDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  for (const file of contractFiles) {
    const schemas = parseContractSchemaFields(resolve(contractsDir, file))
    for (const [name, fields] of schemas) {
      allContractSchemas.set(name, { fields, file })
    }
  }

  // Scan each mapper file
  const mapperFiles = readdirSync(mappersDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  for (const mapperFile of mapperFiles) {
    const mapperPath = resolve(mappersDir, mapperFile)
    const mapperRelPath = toPosix(relative(repoRoot, mapperPath))
    const functions = parseMapperFunctions(mapperPath)

    for (const [fnName, { keys: mapperKeys, hasSpread }] of functions) {
      // When the mapper uses spread syntax (e.g. `...otherMapper(x)`), we cannot
      // statically determine the full set of returned keys, so we skip the check.
      if (hasSpread) {
        continue
      }

      const candidates = mapperFnToSchemaCandidates(fnName)
      let matchedSchemaName = null
      let contractEntry = null
      for (const candidate of candidates) {
        contractEntry = allContractSchemas.get(candidate)
        if (contractEntry) {
          matchedSchemaName = candidate
          break
        }
      }
      if (!contractEntry || !matchedSchemaName) {
        // No matching contract schema found — not an error, the mapper may map to
        // an inline type or a schema with a non-standard name.
        continue
      }

      const contractRelPath = toPosix(relative(repoRoot, resolve(contractsDir, contractEntry.file)))
      for (const contractField of contractEntry.fields) {
        if (!mapperKeys.has(contractField)) {
          errors.push(
            `Mapper \`${fnName}\` in \`${mapperRelPath}\` is missing field \`${contractField}\` ` +
            `declared in contract \`${matchedSchemaName}\` (\`${contractRelPath}\`).`
          )
        }
      }
    }
  }
}
