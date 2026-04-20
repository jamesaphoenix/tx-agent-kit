import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import {
  importRegex,
  listFilesRecursively,
  readUtf8,
  repoRoot,
  toPosix
} from './utils.mjs'

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

const isPublishedDomainSharedImport = (importPath, resolvedImportTarget) =>
  /(^|\/)(domain-shared|domains\/shared)(\/|$)/.test(importPath) ||
  /\/domains\/(?:shared|[^/]+\/domain-shared)\//.test(toPosix(resolvedImportTarget))

const isDomainEventsImport = (importPath, resolvedImportTarget) =>
  /\/events(\.js|\.ts)?$/.test(toPosix(importPath)) ||
  /\/domains\/[^/]+\/events(\.ts|\.js)?$/.test(toPosix(resolvedImportTarget))

export const enforceDomainDirectoryContracts = (errors) => {
  const domainRoots = [
    resolve(repoRoot, 'packages/core/src/domains'),
    resolve(repoRoot, 'apps/api/src/domains')
  ]

  const existingDomainRoots = []
  let discoveredDomains = 0

  for (const domainRoot of domainRoots) {
    if (!existsSync(domainRoot) || !statSync(domainRoot).isDirectory()) {
      errors.push(`Missing required domain root: \`${toPosix(relative(repoRoot, domainRoot))}\`.`)
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
          errors.push(
            `Domain \`${toPosix(relative(repoRoot, domainPath))}\` is missing required folder \`${requiredFolder}/\`.`
          )
        }
      }

      for (const forbiddenFolder of forbiddenDomainFolders) {
        const forbiddenPath = join(domainPath, forbiddenFolder)
        if (existsSync(forbiddenPath) && statSync(forbiddenPath).isDirectory()) {
          errors.push(
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
        errors.push(
          `Domain \`${toPosix(relative(repoRoot, domainPath))}\` must define at least one domain artifact in \`domain/\`.`
        )
      }

      const portFiles = listFilesRecursively(join(domainPath, 'ports')).filter(
        (filePath) =>
          (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) &&
          !filePath.endsWith('.gitkeep')
      )
      if (portFiles.length === 0) {
        errors.push(
          `Domain \`${toPosix(relative(repoRoot, domainPath))}\` must define at least one port contract in \`ports/\`.`
        )
      }

      for (const filePath of portFiles) {
        const source = readUtf8(filePath)
        if (!/Effect\.Effect\s*</.test(source)) {
          errors.push(
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
        errors.push(
          `Domain \`${toPosix(relative(repoRoot, domainPath))}\` must define at least one application use-case module in \`application/\`.`
        )
      }

      const concreteUseCaseFiles = applicationFiles.filter((filePath) => {
        const fileName = filePath.split(sep).pop() ?? ''
        return fileName !== 'index.ts' && fileName !== 'index.tsx'
      })
      if (concreteUseCaseFiles.length === 0) {
        errors.push(
          `Domain \`${toPosix(relative(repoRoot, domainPath))}\` must define at least one use-case file in \`application/\` (non-index file).`
        )
      }

      const adapterFiles = listFilesRecursively(join(domainPath, 'adapters')).filter(
        (filePath) =>
          (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) &&
          !filePath.endsWith('.gitkeep')
      )
      if (adapterFiles.length === 0) {
        errors.push(
          `Domain \`${toPosix(relative(repoRoot, domainPath))}\` must define at least one adapter implementation in \`adapters/\`.`
        )
      }

      for (const filePath of adapterFiles) {
        const source = readUtf8(filePath)
        if (!/from\s+['"][^'"]*ports\//.test(source)) {
          errors.push(
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
          errors.push(
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
            !isPublishedDomainSharedImport(importPath, resolvedImportTarget) &&
            !isDomainEventsImport(importPath, resolvedImportTarget)
          ) {
            errors.push(
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
            errors.push(
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
    errors.push('No domain roots found. Expected at least one of `packages/core/src/domains` or `apps/api/src/domains`.')
  }

  if (discoveredDomains === 0) {
    errors.push('No domain modules found under domain roots. Add at least one domain with `domain/ports/application/adapters` implementation.')
  }
}

export const enforceNoRootServiceBypass = (errors) => {
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
        errors.push(`Service implementation outside domain layer is disallowed: \`${relativePath}\`.`)
      }
    }
  }
}

export const enforceNoPromisePorts = (errors) => {
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
        errors.push(
          `Port contracts must return Effect, not Promise: \`${toPosix(relative(repoRoot, filePath))}\`.`
        )
      }
    }
  }
}

export const enforceNoDefaultExportsInDdd = (errors) => {
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

      if (normalized.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/u.test(normalized) || /\/test-[^/]+\.tsx?$/u.test(normalized)) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const source = readUtf8(sourceFile)
      if (!/\bexport\s+default\b/u.test(source)) {
        continue
      }

      errors.push(
        `Default exports are forbidden in DDD/route layers: \`${toPosix(relative(repoRoot, sourceFile))}\`.`
      )
    }
  }
}
