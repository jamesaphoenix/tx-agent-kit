#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const errors = []

const toPosix = (value) => value.split(sep).join('/')
const toKebabCase = (value) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

const fail = (message) => {
  errors.push(message)
}

const readUtf8 = (path) => readFileSync(path, 'utf8')

const listFilesRecursively = (rootDir) => {
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
  return [...names].sort()
}

const getTableNamesFromSchema = () => {
  const schemaPath = resolve(repoRoot, 'packages/db/src/schema.ts')
  if (!existsSync(schemaPath)) {
    fail('Missing `packages/db/src/schema.ts`.')
    return []
  }

  const tableNames = extractTableConstants(readUtf8(schemaPath))
  if (tableNames.length === 0) {
    fail('No `pgTable(...)` declarations were found in `packages/db/src/schema.ts`.')
  }

  return tableNames
}

const enforceDbEffectSchemaParity = () => {
  const effectSchemasDir = resolve(repoRoot, 'packages/db/src/effect-schemas')
  const effectSchemaIndexPath = resolve(effectSchemasDir, 'index.ts')

  if (!existsSync(effectSchemasDir)) {
    fail('Missing `packages/db/src/effect-schemas` directory.')
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
        `Missing Effect schema file for table: expected \`packages/db/src/effect-schemas/${expectedFileName}\`.`
      )
    }
  }

  for (const actualFileName of actualSchemaFiles) {
    if (!expectedSchemaFiles.includes(actualFileName)) {
      fail(
        `Orphan Effect schema file without matching table: \`packages/db/src/effect-schemas/${actualFileName}\`.`
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
    fail('Missing `packages/db/src/effect-schemas/index.ts`.')
    return
  }

  const indexSource = readUtf8(effectSchemaIndexPath)
  const exportedSchemaFiles = new Set(
    [...indexSource.matchAll(/export \* from ['"]\.\/([^'"]+)\.js['"]/g)].map((match) => `${match[1]}.ts`)
  )

  for (const expectedFileName of expectedSchemaFiles) {
    if (!exportedSchemaFiles.has(expectedFileName)) {
      fail(
        `Missing re-export in \`packages/db/src/effect-schemas/index.ts\` for \`${expectedFileName}\`.`
      )
    }
  }
}

const enforceDbFactoryParity = () => {
  const factoriesDir = resolve(repoRoot, 'packages/db/src/factories')
  const factoryIndexPath = resolve(factoriesDir, 'index.ts')

  if (!existsSync(factoriesDir)) {
    fail('Missing `packages/db/src/factories` directory.')
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
        `Missing factory file for table: expected \`packages/db/src/factories/${expectedFileName}\`.`
      )
    }
  }

  for (const actualFileName of actualFactoryFiles) {
    if (!expectedFactoryFiles.includes(actualFileName)) {
      fail(
        `Orphan factory file without matching table: \`packages/db/src/factories/${actualFileName}\`.`
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
    fail('Missing `packages/db/src/factories/index.ts`.')
    return
  }

  const indexSource = readUtf8(factoryIndexPath)
  const exportedFactoryFiles = new Set(
    [...indexSource.matchAll(/export \* from ['"]\.\/([^'"]+)\.js['"]/g)].map((match) => `${match[1]}.ts`)
  )

  for (const expectedFileName of expectedFactoryFiles) {
    if (!exportedFactoryFiles.has(expectedFileName)) {
      fail(
        `Missing re-export in \`packages/db/src/factories/index.ts\` for \`${expectedFileName}\`.`
      )
    }
  }
}

const requiredDomainFolders = ['domain', 'ports', 'repositories', 'services']
const domainLayers = ['domain', 'ports', 'repositories', 'adapters', 'services', 'runtime', 'ui']
const allowedLayerImports = {
  domain: new Set(['domain']),
  ports: new Set(['domain', 'ports']),
  repositories: new Set(['domain', 'ports', 'repositories']),
  adapters: new Set(['domain', 'ports', 'adapters']),
  services: new Set(['domain', 'ports', 'repositories', 'adapters', 'services']),
  runtime: new Set(['domain', 'ports', 'repositories', 'adapters', 'services', 'runtime']),
  ui: new Set(['domain', 'ports', 'repositories', 'adapters', 'services', 'runtime', 'ui'])
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

const importRegex = /import(?:[\s\w{},*]+from\s+)?['"]([^'"]+)['"]/g

const enforceDomainDirectoryContracts = () => {
  const domainRoots = [
    resolve(repoRoot, 'packages/core/src/domains'),
    resolve(repoRoot, 'apps/api/src/domains')
  ]

  for (const domainRoot of domainRoots) {
    if (!existsSync(domainRoot) || !statSync(domainRoot).isDirectory()) {
      continue
    }

    const domainNames = readdirSync(domainRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

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

      const tsFiles = listFilesRecursively(domainPath).filter(
        (filePath) =>
          filePath.endsWith('.ts') || filePath.endsWith('.tsx')
      )

      for (const filePath of tsFiles) {
        const sourceLayer = inferLayerFromPath(filePath)
        if (!sourceLayer) {
          continue
        }

        const source = readUtf8(filePath)
        for (const match of source.matchAll(importRegex)) {
          const importPath = match[1]
          if (!importPath.startsWith('.')) {
            continue
          }

          const targetLayer = inferLayerFromImport(importPath)
          if (!targetLayer) {
            continue
          }

          if (!allowedLayerImports[sourceLayer].has(targetLayer)) {
            fail(
              [
                'Invalid domain-layer dependency:',
                `source=${toPosix(relative(repoRoot, filePath))} (${sourceLayer})`,
                `import=${importPath} -> ${targetLayer}`,
                `allowed=${[...allowedLayerImports[sourceLayer]].join(', ')}`
              ].join(' ')
            )
          }
        }
      }
    }
  }
}

enforceDbEffectSchemaParity()
enforceDbFactoryParity()
enforceDomainDirectoryContracts()

if (errors.length > 0) {
  console.error('Domain invariant check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Domain invariant check passed.')
