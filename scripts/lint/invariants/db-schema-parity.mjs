import { existsSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import {
  collectDbJsonColumnsByTable,
  getTableNamesFromSchema,
  isWeakEffectJsonSchemaExpression,
  parseEffectRowSchemaFields,
  readUtf8,
  repoRoot,
  toKebabCase,
  toPosix
} from './utils.mjs'

export const enforceDbEffectSchemaParity = (errors) => {
  const effectSchemasDir = resolve(repoRoot, 'packages/infra/db/src/effect-schemas')
  const effectSchemaIndexPath = resolve(effectSchemasDir, 'index.ts')

  if (!existsSync(effectSchemasDir)) {
    errors.push('Missing `packages/infra/db/src/effect-schemas` directory.')
    return
  }

  const tableNames = getTableNamesFromSchema(errors)
  if (tableNames.length === 0) {
    return
  }

  const expectedSchemaFiles = tableNames.map((tableName) => `${toKebabCase(tableName)}.ts`).sort()
  const actualSchemaFiles = readdirSync(effectSchemasDir)
    .filter((fileName) => fileName.endsWith('.ts') && fileName !== 'index.ts')
    .sort()

  for (const expectedFileName of expectedSchemaFiles) {
    if (!actualSchemaFiles.includes(expectedFileName)) {
      errors.push(
        `Missing Effect schema file for table: expected \`packages/infra/db/src/effect-schemas/${expectedFileName}\`.`
      )
    }
  }

  for (const actualFileName of actualSchemaFiles) {
    if (!expectedSchemaFiles.includes(actualFileName)) {
      errors.push(
        `Orphan Effect schema file without matching table: \`packages/infra/db/src/effect-schemas/${actualFileName}\`.`
      )
    }
  }

  for (const actualFileName of actualSchemaFiles) {
    const filePath = resolve(effectSchemasDir, actualFileName)
    const source = readUtf8(filePath)
    const relativePath = toPosix(relative(repoRoot, filePath))

    if (!/from\s+['"]effect\/Schema['"]/.test(source)) {
      errors.push(`Missing \`effect/Schema\` import in \`${relativePath}\`.`)
    }

    if (!/export const [A-Za-z0-9_]+RowSchema\s*=/.test(source)) {
      errors.push(`Missing \`*RowSchema\` export in \`${relativePath}\`.`)
    }

    if (!/export type [A-Za-z0-9_]+RowShape\s*=/.test(source)) {
      errors.push(`Missing \`*RowShape\` export in \`${relativePath}\`.`)
    }
  }

  if (!existsSync(effectSchemaIndexPath)) {
    errors.push('Missing `packages/infra/db/src/effect-schemas/index.ts`.')
    return
  }

  const indexSource = readUtf8(effectSchemaIndexPath)
  const exportedSchemaFiles = new Set(
    [...indexSource.matchAll(/export \* from ['"]\.\/([^'"]+)\.js['"]/g)].map((match) => `${match[1]}.ts`)
  )

  for (const expectedFileName of expectedSchemaFiles) {
    if (!exportedSchemaFiles.has(expectedFileName)) {
      errors.push(
        `Missing re-export in \`packages/infra/db/src/effect-schemas/index.ts\` for \`${expectedFileName}\`.`
      )
    }
  }
}

export const enforceDbJsonColumnEffectSchemaParity = (errors) => {
  const effectSchemasDir = resolve(repoRoot, 'packages/infra/db/src/effect-schemas')
  if (!existsSync(effectSchemasDir) || !statSync(effectSchemasDir).isDirectory()) {
    return
  }

  const jsonColumnsByTable = collectDbJsonColumnsByTable(errors)
  if (jsonColumnsByTable.size === 0) {
    return
  }

  for (const [tableConstName, tableJsonMetadata] of jsonColumnsByTable.entries()) {
    const effectSchemaPath = resolve(effectSchemasDir, `${toKebabCase(tableConstName)}.ts`)
    if (!existsSync(effectSchemaPath) || !statSync(effectSchemaPath).isFile()) {
      continue
    }

    const parsedRowSchema = parseEffectRowSchemaFields(effectSchemaPath, errors)
    if (!parsedRowSchema) {
      continue
    }

    const effectSchemaRelativePath = toPosix(relative(repoRoot, effectSchemaPath))
    for (const columnName of tableJsonMetadata.columns) {
      const fieldSchemaExpression = parsedRowSchema.fieldInitializers.get(columnName)
      if (!fieldSchemaExpression) {
        errors.push(
          [
            `JSON/JSONB column \`${tableConstName}.${columnName}\` in \`${tableJsonMetadata.fileRelativePath}\` must exist in matching Effect row schema.`,
            `Add \`${columnName}\` to \`${effectSchemaRelativePath}\` \`Schema.Struct({ ... })\`.`
          ].join(' ')
        )
        continue
      }

      if (isWeakEffectJsonSchemaExpression(fieldSchemaExpression, parsedRowSchema.sourceFile, parsedRowSchema.schemaNamespaces)) {
        errors.push(
          [
            `Effect row schema field \`${tableConstName}.${columnName}\` in \`${effectSchemaRelativePath}\` is weakly typed.`,
            'Do not use `Schema.Unknown` or `Schema.Json` for DB JSON/JSONB columns; define explicit structured schemas.'
          ].join(' ')
        )
      }
    }
  }
}

export const enforceDbFactoryParity = (errors) => {
  const factoriesDir = resolve(repoRoot, 'packages/infra/db/src/factories')
  const factoryIndexPath = resolve(factoriesDir, 'index.ts')

  if (!existsSync(factoriesDir)) {
    errors.push('Missing `packages/infra/db/src/factories` directory.')
    return
  }

  const tableNames = getTableNamesFromSchema(errors)
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
      errors.push(
        `Missing factory file for table: expected \`packages/infra/db/src/factories/${expectedFileName}\`.`
      )
    }
  }

  for (const actualFileName of actualFactoryFiles) {
    if (!expectedFactoryFiles.includes(actualFileName)) {
      errors.push(
        `Orphan factory file without matching table: \`packages/infra/db/src/factories/${actualFileName}\`.`
      )
    }
  }

  for (const actualFileName of actualFactoryFiles) {
    const filePath = resolve(factoriesDir, actualFileName)
    const source = readUtf8(filePath)
    const relativePath = toPosix(relative(repoRoot, filePath))

    if (!/export (const|function) create[A-Za-z0-9_]+Factory/.test(source)) {
      errors.push(`Missing \`create*Factory\` export in \`${relativePath}\`.`)
    }
  }

  if (!existsSync(factoryIndexPath)) {
    errors.push('Missing `packages/infra/db/src/factories/index.ts`.')
    return
  }

  const indexSource = readUtf8(factoryIndexPath)
  const exportedFactoryFiles = new Set(
    [...indexSource.matchAll(/export \* from ['"]\.\/([^'"]+)\.js['"]/g)].map((match) => `${match[1]}.ts`)
  )

  for (const expectedFileName of expectedFactoryFiles) {
    if (!exportedFactoryFiles.has(expectedFileName)) {
      errors.push(
        `Missing re-export in \`packages/infra/db/src/factories/index.ts\` for \`${expectedFileName}\`.`
      )
    }
  }
}
