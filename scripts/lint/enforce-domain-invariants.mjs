#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
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
  const schemaRoot = resolve(repoRoot, 'packages/db/src')
  if (!existsSync(schemaRoot) || !statSync(schemaRoot).isDirectory()) {
    fail('Missing `packages/db/src` directory.')
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
    fail('No `pgTable(...)` declarations were found in `packages/db/src`.')
  }

  return sortedNames
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
  const repositoriesDir = resolve(repoRoot, 'packages/db/src/repositories')
  if (!existsSync(repositoriesDir) || !statSync(repositoriesDir).isDirectory()) {
    fail('Missing `packages/db/src/repositories` directory.')
    return
  }

  const repositoryFiles = readdirSync(repositoriesDir)
    .filter((fileName) => fileName.endsWith('.ts'))
    .map((fileName) => resolve(repositoriesDir, fileName))

  for (const filePath of repositoryFiles) {
    const source = readUtf8(filePath)
    const relativePath = toPosix(relative(repoRoot, filePath))

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

const enforceNoAnyTypeAssertions = () => {
  const roots = [resolve(repoRoot, 'apps'), resolve(repoRoot, 'packages')]
  const anyAssertionRegex = /(?:\bas\s+any\b|<\s*any\s*>)/u

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(filePath)
      if (!/\.(ts|tsx)$/u.test(normalized)) {
        return false
      }

      if (normalized.includes('/.next/') || normalized.includes('/dist/') || normalized.includes('/node_modules/')) {
        return false
      }

      if (normalized.includes('/__tests__/') || normalized.endsWith('.test.ts') || normalized.endsWith('.test.tsx')) {
        return false
      }

      if (normalized.includes('/lib/api/generated/')) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const source = readUtf8(sourceFile)
      if (!anyAssertionRegex.test(source)) {
        continue
      }

      fail(
        `Type assertion \`as any\` is disallowed in source modules: \`${toPosix(relative(repoRoot, sourceFile))}\`. Replace with precise types or decode unknowns via schema.`
      )
    }
  }
}

const enforceNoEmptyCatchBlocks = () => {
  const roots = [resolve(repoRoot, 'apps'), resolve(repoRoot, 'packages')]
  const emptyCatchRegex = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:(?:\/\/[^\n]*\n)|(?:\/\*[\s\S]*?\*\/\s*))*\}/u

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

      if (normalized.includes('/lib/api/generated/')) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const source = readUtf8(sourceFile)
      if (!emptyCatchRegex.test(source)) {
        continue
      }

      fail(
        `Empty catch blocks are disallowed in source modules: \`${toPosix(relative(repoRoot, sourceFile))}\`. Handle, classify, or rethrow errors explicitly.`
      )
    }
  }
}

const enforceNoChainedTypeAssertions = () => {
  const roots = [resolve(repoRoot, 'apps'), resolve(repoRoot, 'packages')]
  const chainedAssertionRegex = /\bas\s+unknown\s+as\b/u

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(filePath)
      if (!/\.(ts|tsx)$/u.test(normalized)) {
        return false
      }

      if (normalized.includes('/.next/') || normalized.includes('/dist/') || normalized.includes('/node_modules/')) {
        return false
      }

      if (normalized.includes('/__tests__/') || normalized.endsWith('.test.ts') || normalized.endsWith('.test.tsx')) {
        return false
      }

      if (normalized.includes('/lib/api/generated/')) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const source = readUtf8(sourceFile)
      if (!chainedAssertionRegex.test(source)) {
        continue
      }

      fail(
        `Chained type assertion \`as unknown as ...\` is disallowed in source modules: \`${toPosix(relative(repoRoot, sourceFile))}\`. Model boundary types explicitly instead.`
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
      '/v1/workspaces',
      '/v1/tasks',
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

    if (!/health-endpoint/u.test(source) || !/toBeLessThan\(1500\)/u.test(source)) {
      fail(
        'Critical API flow coverage missing: health endpoint readiness/performance assertion was not detected in API integration suite.'
      )
    }
  }

  const requiredWebIntegrationSuites = [
    'apps/web/app/dashboard/page.integration.test.tsx',
    'apps/web/app/invitations/page.integration.test.tsx',
    'apps/web/app/workspaces/page.integration.test.tsx',
    'apps/web/components/AuthForm.integration.test.tsx',
    'apps/web/components/CreateWorkspaceForm.integration.test.tsx',
    'apps/web/components/CreateTaskForm.integration.test.tsx',
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

  const workspacesPageSuitePath = resolve(repoRoot, 'apps/web/app/workspaces/page.integration.test.tsx')
  if (existsSync(workspacesPageSuitePath) && statSync(workspacesPageSuitePath).isFile()) {
    const workspacesSource = readUtf8(workspacesPageSuitePath)
    if (!workspacesSource.includes('/sign-in?next=%2Fworkspaces')) {
      fail(
        'Workspaces page integration suite must assert unauthenticated redirect behavior (`/sign-in?next=%2Fworkspaces`).'
      )
    }

    if (!/auth token is invalid/u.test(workspacesSource)) {
      fail(
        'Workspaces page integration suite must cover invalid-token redirect behavior.'
      )
    }

    if (!/\bcreateUser\s*\(/u.test(workspacesSource) || !/\bcreateTeam\s*\(/u.test(workspacesSource)) {
      fail(
        'Workspaces page integration suite must cover authenticated data flow setup via `createUser(...)` and `createTeam(...)`.'
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

    if (!/\bseedTask\s*=\s*async/u.test(workerActivitiesSource)) {
      fail(
        'Worker activities integration suite must seed task/workspace/user fixtures via helper (`seedTask(...)`).'
      )
    }

    if (/\bTRUNCATE\s+TABLE\b/u.test(workerActivitiesSource) || /\bresetPublicTables\s*\(/u.test(workerActivitiesSource)) {
      fail(
        'Worker activities integration suite must not truncate shared tables; rely on unique fixtures to avoid cross-project clobbering.'
      )
    }

    if (!/\bactivities\.processTask\s*\(/u.test(workerActivitiesSource)) {
      fail(
        'Worker activities integration suite must execute `activities.processTask(...)`.'
      )
    }

    if (!/alreadyProcessed:\s*true/u.test(workerActivitiesSource)) {
      fail(
        'Worker activities integration suite must assert idempotency (`alreadyProcessed: true`) on duplicate operations.'
      )
    }

    if (!/alreadyProcessed:\s*false/u.test(workerActivitiesSource)) {
      fail(
        'Worker activities integration suite must assert first-time processing (`alreadyProcessed: false`).'
      )
    }
  }

  const observabilitySuitePath = resolve(repoRoot, 'packages/observability/src/stack.integration.test.ts')
  if (!existsSync(observabilitySuitePath) || !statSync(observabilitySuitePath).isFile()) {
    fail('Critical observability integration coverage missing: `packages/observability/src/stack.integration.test.ts`.')
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
          `Critical observability flow coverage missing in \`packages/observability/src/stack.integration.test.ts\`: expected marker \`${marker}\`.`
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
  const migrationsDir = resolve(repoRoot, 'packages/db/drizzle/migrations')
  const pgtapDir = resolve(repoRoot, 'packages/db/pgtap')

  if (!existsSync(migrationsDir) || !statSync(migrationsDir).isDirectory()) {
    fail('Missing migrations directory: `packages/db/drizzle/migrations`.')
    return
  }

  if (!existsSync(pgtapDir) || !statSync(pgtapDir).isDirectory()) {
    fail('Missing pgTAP directory: `packages/db/pgtap`.')
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
    fail('No pgTAP SQL suites found in `packages/db/pgtap`.')
    return
  }

  const pgtapSource = pgtapFiles.map((filePath) => readUtf8(filePath)).join('\n')

  for (const triggerName of triggerNames) {
    const triggerReferenceRegex = new RegExp(`\\b${triggerName}\\b`, 'u')
    if (!triggerReferenceRegex.test(pgtapSource)) {
      fail(
        `Missing pgTAP coverage marker for trigger \`${triggerName}\`. Reference this trigger in \`packages/db/pgtap/*.sql\`.`
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
    'packages/auth/src/env.ts',
    'packages/db/src/env.ts',
    'packages/logging/src/env.ts',
    'packages/observability/src/env.ts',
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

const getFirstMeaningfulLine = (source) => {
  const withoutBom = source.replace(/^\uFEFF/u, '')
  const withoutBlockComments = withoutBom.replace(/\/\*[\s\S]*?\*\//gu, (match) => {
    const newlineCount = match.split('\n').length - 1
    return newlineCount > 0 ? '\n'.repeat(newlineCount) : ''
  })
  const lines = withoutBlockComments.split(/\r?\n/u)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//')) {
      continue
    }

    return trimmed
  }

  return ''
}

const enforceWebClientOnlyContracts = () => {
  const disallowedApiDir = resolve(repoRoot, 'apps/web/app/api')
  if (existsSync(disallowedApiDir)) {
    fail('`apps/web/app/api` is forbidden. Next.js web must stay client-only and call `apps/api` directly.')
  }

  const disallowedWebRuntimeFiles = [
    resolve(repoRoot, 'apps/web/proxy.ts'),
    resolve(repoRoot, 'apps/web/middleware.ts')
  ]

  for (const disallowedFile of disallowedWebRuntimeFiles) {
    if (existsSync(disallowedFile) && statSync(disallowedFile).isFile()) {
      fail(
        `Server-side web runtime file is forbidden for client-only mode: \`${toPosix(relative(repoRoot, disallowedFile))}\`.`
      )
    }
  }

  const webAppRoot = resolve(repoRoot, 'apps/web/app')
  if (existsSync(webAppRoot) && statSync(webAppRoot).isDirectory()) {
    const routeFiles = listFilesRecursively(webAppRoot).filter(
      (filePath) => filePath.endsWith('/route.ts') || filePath.endsWith('/route.tsx')
    )

    for (const routeFile of routeFiles) {
      fail(
        `Next route handlers are forbidden in web app client-only mode: \`${toPosix(relative(repoRoot, routeFile))}\`.`
      )
    }
  }

  const clientOnlyRoots = [
    resolve(repoRoot, 'apps/web/app'),
    resolve(repoRoot, 'apps/web/components')
  ]

  for (const root of clientOnlyRoots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(filePath)
      if (!normalized.endsWith('.tsx')) {
        return false
      }

      if (normalized.includes('/__tests__/') || normalized.endsWith('.test.tsx')) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const source = readUtf8(sourceFile)
      const firstMeaningfulLine = getFirstMeaningfulLine(source)
      const isClientDirective = /^['"]use client['"];?$/u.test(firstMeaningfulLine)

      if (!isClientDirective) {
        fail(
          `Client-only web source must start with \`'use client'\`: \`${toPosix(relative(repoRoot, sourceFile))}\`.`
        )
      }
    }
  }

  const webLibRoot = resolve(repoRoot, 'apps/web/lib')
  if (existsSync(webLibRoot) && statSync(webLibRoot).isDirectory()) {
    const sourceFiles = listFilesRecursively(webLibRoot).filter((filePath) => {
      const normalized = toPosix(filePath)
      if (!/\.(ts|tsx)$/u.test(normalized)) {
        return false
      }

      if (normalized.includes('/lib/api/generated/')) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const source = readUtf8(sourceFile)
      if (/(?:['"`])\/api\//u.test(source)) {
        fail(
          [
            'Web client source must not use Next API proxy paths (`/api/*`).',
            `Use API base URL from apps/web/lib/env.ts instead: \`${toPosix(relative(repoRoot, sourceFile))}\`.`
          ].join(' ')
        )
      }
    }
  }

  const webSourceFiles = listFilesRecursively(resolve(repoRoot, 'apps/web')).filter((filePath) => {
    const normalized = toPosix(filePath)
    if (!/\.(ts|tsx)$/u.test(normalized)) {
      return false
    }

    if (normalized.includes('/.next/') || normalized.includes('/dist/') || normalized.includes('/node_modules/')) {
      return false
    }

    if (normalized.includes('/lib/api/generated/')) {
      return false
    }

    return true
  })

  for (const sourceFile of webSourceFiles) {
    const relativePath = toPosix(relative(repoRoot, sourceFile))
    const source = readUtf8(sourceFile)

    if (/\bwindow\.location\b/u.test(source)) {
      fail(
        `Do not read \`window.location\` directly in web source: \`${relativePath}\`. Use url-state wrappers instead.`
      )
    }

    const isNotifyWrapper = relativePath === 'apps/web/lib/notify.tsx'
    if (!isNotifyWrapper && /from\s+['"]sonner(?:\/[^'"]*)?['"]/u.test(source)) {
      fail(
        `Direct sonner imports are forbidden outside \`apps/web/lib/notify.tsx\`: \`${relativePath}\`.`
      )
    }

    const isUrlStateWrapper = relativePath === 'apps/web/lib/url-state.tsx'
    if (!isUrlStateWrapper && /from\s+['"]nuqs(?:\/[^'"]*)?['"]/u.test(source)) {
      fail(
        `Direct nuqs imports are forbidden outside \`apps/web/lib/url-state.tsx\`: \`${relativePath}\`.`
      )
    }
  }

  const webAxiosPath = resolve(repoRoot, 'apps/web/lib/axios.ts')
  if (existsSync(webAxiosPath) && statSync(webAxiosPath).isFile()) {
    const axiosSource = readUtf8(webAxiosPath)
    if (!/baseURL:\s*webEnv\.API_BASE_URL/u.test(axiosSource)) {
      fail(
        'Web axios client must use `webEnv.API_BASE_URL` as baseURL in `apps/web/lib/axios.ts`.'
      )
    }
  }
}

const crudMethodNames = ['list', 'getById', 'create', 'update', 'remove']
const crudRouteVerbMatchers = {
  list: /^list([A-Z]|$)/,
  getById: /^get(ById)?([A-Z]|$)/,
  create: /^create([A-Z]|$)/,
  update: /^update([A-Z]|$)/,
  remove: /^(remove|delete)([A-Z]|$)/
}

const hasCrudMethodSurface = (source) =>
  crudMethodNames.every((methodName) => new RegExp(`\\b${methodName}\\s*:`).test(source))

const hasCrudHandlerSurface = (handlerIds) =>
  Object.values(crudRouteVerbMatchers).every((matcher) => handlerIds.some((handlerId) => matcher.test(handlerId)))

const getKindsFromSource = (source, kindSuffix) => {
  const regex = new RegExp(`export const [A-Za-z0-9_]+${kindSuffix}\\s*=\\s*'(crud|custom)'\\s+as const`, 'g')
  return [...source.matchAll(regex)].map((match) => match[1])
}

const getHandlerIdsFromSource = (source) =>
  [...source.matchAll(/\.handle\(\s*'([^']+)'/g)].map((match) => match[1])

const collectCoreRepositoryKinds = () => {
  const root = resolve(repoRoot, 'packages/core/src/domains')
  const records = []

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    fail('Missing `packages/core/src/domains` directory required for route/repository kind checks.')
    return records
  }

  const domainDirs = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  for (const domainDir of domainDirs) {
    const domainName = domainDir.name
    const portsDir = join(root, domainName, 'ports')
    if (!existsSync(portsDir) || !statSync(portsDir).isDirectory()) {
      fail(`Domain \`packages/core/src/domains/${domainName}\` is missing a \`ports/\` folder for kind checks.`)
      continue
    }

    const portFiles = listFilesRecursively(portsDir).filter(
      (filePath) =>
        (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) &&
        !filePath.endsWith('/index.ts') &&
        !filePath.endsWith('/index.tsx')
    )

    for (const filePath of portFiles) {
      const source = readUtf8(filePath)
      const relativePath = toPosix(relative(repoRoot, filePath))
      const kinds = getKindsFromSource(source, 'RepositoryKind')

      if (kinds.length === 0) {
        fail(
          `Port file \`${relativePath}\` must declare \`export const <Name>RepositoryKind = 'crud' | 'custom' as const\`.`
        )
        continue
      }

      if (kinds.length > 1) {
        fail(`Port file \`${relativePath}\` declares multiple repository kind markers; keep exactly one.`)
        continue
      }

      const kind = kinds[0]
      const hasCrudShape = hasCrudMethodSurface(source)

      if (kind === 'crud' && !hasCrudShape) {
        fail(
          `Repository kind marker says \`crud\` but full CRUD method surface is missing in \`${relativePath}\` (list/getById/create/update/remove).`
        )
      }

      if (kind === 'custom' && hasCrudShape) {
        fail(
          `Repository in \`${relativePath}\` exposes full CRUD but is marked \`custom\`. Mark it \`crud\` or remove unused CRUD methods.`
        )
      }

      records.push({
        domain: domainName,
        kind,
        file: relativePath
      })
    }
  }

  return records
}

const collectApiRouteKinds = (rootRelativePath, expectsHandlers, requiredPathToken = null) => {
  const root = resolve(repoRoot, rootRelativePath)
  const records = []

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return records
  }

  const routeFiles = listFilesRecursively(root).filter((filePath) => {
    const normalized = toPosix(filePath)
    if (!normalized.endsWith('.ts') && !normalized.endsWith('.tsx')) {
      return false
    }

    if (normalized.endsWith('.test.ts') || normalized.endsWith('.test.tsx')) {
      return false
    }

    if (requiredPathToken && !normalized.includes(requiredPathToken)) {
      return false
    }

    return !normalized.endsWith('/index.ts') && !normalized.endsWith('/index.tsx')
  })

  for (const filePath of routeFiles) {
    const source = readUtf8(filePath)
    const relativePath = toPosix(relative(repoRoot, filePath))
    const kinds = getKindsFromSource(source, 'RouteKind')

    if (kinds.length === 0) {
      fail(`Route file \`${relativePath}\` must declare \`export const <Name>RouteKind = 'crud' | 'custom' as const\`.`)
      continue
    }

    if (kinds.length > 1) {
      fail(`Route file \`${relativePath}\` declares multiple route kind markers; keep exactly one.`)
      continue
    }

    const kind = kinds[0]
    let hasCrudSurface = hasCrudMethodSurface(source)

    if (expectsHandlers) {
      const handlerIds = getHandlerIdsFromSource(source)
      hasCrudSurface = hasCrudHandlerSurface(handlerIds)
    }

    if (kind === 'crud' && !hasCrudSurface) {
      fail(
        `Route kind marker says \`crud\` but full CRUD surface is missing in \`${relativePath}\` (list/get/create/update/remove).`
      )
    }

    if (kind === 'custom' && hasCrudSurface) {
      fail(
        `Route in \`${relativePath}\` exposes full CRUD but is marked \`custom\`. Mark it \`crud\` or remove unused CRUD handlers.`
      )
    }

    records.push({
      rootRelativePath,
      file: relativePath,
      baseName: toPosix(relative(root, filePath)).replace(/\.(ts|tsx)$/u, ''),
      kind
    })
  }

  return records
}

const enforceRouteRepositoryKindContracts = () => {
  const repositoryRecords = collectCoreRepositoryKinds()
  const appRouteRecords = collectApiRouteKinds('apps/api/src/routes', true)
  const domainRouteRecords = collectApiRouteKinds('apps/api/src/domains', false, '/routes/')

  if (repositoryRecords.length === 0) {
    fail('No repository kind markers were discovered in `packages/core/src/domains/*/ports`.')
  }

  if (appRouteRecords.length === 0) {
    fail('No route kind markers were discovered in `apps/api/src/routes`.')
  }

  const routeToDomain = {
    auth: 'auth',
    tasks: 'task',
    workspaces: 'workspace'
  }

  for (const [routeName, domainName] of Object.entries(routeToDomain)) {
    const routeRecord = appRouteRecords.find((record) => record.baseName === routeName)
    if (!routeRecord) {
      fail(`Expected route kind marker file for \`apps/api/src/routes/${routeName}.ts\`.`)
      continue
    }

    const domainKinds = new Set(
      repositoryRecords.filter((record) => record.domain === domainName).map((record) => record.kind)
    )

    if (domainKinds.size === 0) {
      fail(`No repository kind marker found for mapped domain \`${domainName}\`.`)
      continue
    }

    if (domainKinds.size > 1) {
      fail(
        `Mapped domain \`${domainName}\` mixes \`crud\` and \`custom\` repository kinds. Split route ownership or make kind intent explicit per route/domain.`
      )
      continue
    }

    const [domainKind] = [...domainKinds]
    if (domainKind !== routeRecord.kind) {
      fail(
        `Kind mismatch for \`${routeRecord.file}\`: route=${routeRecord.kind}, mapped repositories(${domainName})=${domainKind}.`
      )
    }
  }

  for (const record of domainRouteRecords) {
    const domainMatch = record.file.match(/apps\/api\/src\/domains\/([^/]+)\//)
    if (!domainMatch) {
      continue
    }

    const domainName = domainMatch[1]
    const domainKinds = new Set(
      repositoryRecords.filter((repositoryRecord) => repositoryRecord.domain === domainName).map((repositoryRecord) => repositoryRecord.kind)
    )

    if (domainKinds.size === 0) {
      continue
    }

    if (domainKinds.size > 1) {
      fail(
        `Domain route \`${record.file}\` belongs to \`${domainName}\` which mixes repository kinds. Keep domain kind consistent for scaffolded route slices.`
      )
      continue
    }

    const [domainKind] = [...domainKinds]
    if (domainKind !== record.kind) {
      fail(`Kind mismatch for scaffolded route \`${record.file}\`: route=${record.kind}, domain=${domainKind}.`)
    }
  }
}

enforceDbEffectSchemaParity()
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
enforceWebClientOnlyContracts()
enforceRouteRepositoryKindContracts()
enforceNoAnyTypeAssertions()
enforceNoEmptyCatchBlocks()
enforceNoChainedTypeAssertions()

if (errors.length > 0) {
  console.error('Domain invariant check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Domain invariant check passed.')
