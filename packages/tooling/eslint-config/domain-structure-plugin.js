import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../../..')

const domainRoots = [
  resolve(repoRoot, 'packages/core/src/domains'),
  resolve(repoRoot, 'apps/api/src/domains')
]

const requiredDomainFolders = ['domain', 'ports', 'application', 'adapters']
const domainLayers = ['domain', 'ports', 'application', 'adapters', 'runtime', 'ui']

const allowedLayerImports = {
  domain: new Set(['domain']),
  ports: new Set(['domain', 'ports']),
  application: new Set(['domain', 'ports', 'application']),
  adapters: new Set(['domain', 'ports', 'adapters']),
  runtime: new Set(domainLayers),
  ui: new Set(domainLayers)
}

const toPosix = (value) => value.split(sep).join('/')

const listFilesRecursively = (rootDir) => {
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    return []
  }

  const files = []
  const entries = readdirSync(rootDir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = resolve(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(fullPath))
      continue
    }

    files.push(fullPath)
  }

  return files
}

const inferLayerFromPath = (pathValue) => {
  const normalized = toPosix(pathValue)
  for (const layer of domainLayers) {
    if (normalized.includes(`/${layer}/`)) {
      return layer
    }
  }
  return null
}

const inferLayerFromImport = (importPath) => {
  for (const layer of domainLayers) {
    const matcher = new RegExp(`(^|/)${layer}(/|$)`, 'u')
    if (matcher.test(importPath)) {
      return layer
    }
  }

  return null
}

const inferDomainFromPath = (pathValue) => {
  const match = toPosix(pathValue).match(/\/domains\/([^/]+)\//u)
  return match?.[1] ?? null
}

const resolveImportTarget = (sourceFilePath, importPath) => {
  if (!importPath.startsWith('.')) {
    return importPath
  }

  return resolve(dirname(sourceFilePath), importPath)
}

const isPublishedDomainSharedImport = (importPath, resolvedTarget) => {
  const normalizedImport = toPosix(importPath)
  if (/(^|\/)(domain-shared|domains\/shared)(\/|$)/u.test(normalizedImport)) {
    return true
  }

  if (typeof resolvedTarget === 'string') {
    const normalizedTarget = toPosix(resolvedTarget)
    if (normalizedTarget.startsWith(toPosix(repoRoot))) {
      return /\/domains\/(?:shared|[^/]+\/domain-shared)\//u.test(normalizedTarget)
    }
  }

  return false
}

const formatRepoRelative = (absolutePath) => {
  if (!absolutePath.startsWith(repoRoot)) {
    return toPosix(absolutePath)
  }

  return toPosix(relative(repoRoot, absolutePath))
}

let cachedStructureIssues = null
let structureIssuesReported = false

const collectStructureIssues = () => {
  if (cachedStructureIssues) {
    return cachedStructureIssues
  }

  const issues = []
  let existingDomainRoots = 0
  let discoveredDomains = 0

  for (const domainRoot of domainRoots) {
    if (!existsSync(domainRoot) || !statSync(domainRoot).isDirectory()) {
      continue
    }

    existingDomainRoots += 1

    const domainNames = readdirSync(domainRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    discoveredDomains += domainNames.length

    for (const domainName of domainNames) {
      const domainPath = resolve(domainRoot, domainName)
      const domainLabel = formatRepoRelative(domainPath)

      for (const requiredFolder of requiredDomainFolders) {
        const requiredPath = resolve(domainPath, requiredFolder)
        if (!existsSync(requiredPath) || !statSync(requiredPath).isDirectory()) {
          issues.push(
            `Domain \`${domainLabel}\` is missing required folder \`${requiredFolder}/\`.`
          )
        }
      }

      const applicationPath = resolve(domainPath, 'application')
      if (existsSync(applicationPath) && statSync(applicationPath).isDirectory()) {
        const applicationFiles = listFilesRecursively(applicationPath).filter((filePath) => {
          const normalized = toPosix(filePath)
          if (!/\.(ts|tsx)$/u.test(normalized)) {
            return false
          }

          const fileName = normalized.split('/').pop() ?? ''
          return fileName !== '.gitkeep' && fileName !== 'index.ts' && fileName !== 'index.tsx'
        })

        if (applicationFiles.length === 0) {
          issues.push(
            `Domain \`${domainLabel}\` must define at least one use-case module in \`application/\` (non-index .ts/.tsx file).`
          )
        }
      }
    }
  }

  if (existingDomainRoots === 0) {
    issues.push(
      'No domain roots found. Expected at least one of `packages/core/src/domains` or `apps/api/src/domains`.'
    )
  }

  if (discoveredDomains === 0) {
    issues.push(
      'No domain modules found under domain roots. Add at least one domain with `domain/ports/application/adapters` folders.'
    )
  }

  cachedStructureIssues = issues
  return cachedStructureIssues
}

const reportStructuralIssues = (context, node) => {
  if (structureIssuesReported) {
    return
  }

  const issues = collectStructureIssues()
  if (issues.length === 0) {
    structureIssuesReported = true
    return
  }

  for (const issue of issues) {
    context.report({ node, message: issue })
  }

  structureIssuesReported = true
}

const createLayerBoundaryRule = (context) => {
  const sourceFilePath = toPosix(context.filename)
  const sourceDomain = inferDomainFromPath(sourceFilePath)
  const sourceLayer = inferLayerFromPath(sourceFilePath)

  if (!sourceDomain || !sourceLayer) {
    return {}
  }

  const validateImport = (node, importPath) => {
    if (typeof importPath !== 'string' || importPath.length === 0) {
      return
    }

    const resolvedTarget = resolveImportTarget(sourceFilePath, importPath)
    const importedDomain = inferDomainFromPath(resolvedTarget) ?? inferDomainFromPath(importPath)

    if (
      importedDomain &&
      importedDomain !== sourceDomain &&
      !isPublishedDomainSharedImport(importPath, resolvedTarget)
    ) {
      context.report({
        node,
        message: [
          'Cross-domain import detected.',
          `source=${formatRepoRelative(sourceFilePath)}`,
          `import=${importPath}`,
          `expected-domain=${sourceDomain}`,
          `actual-domain=${importedDomain}`
        ].join(' ')
      })
      return
    }

    const shouldCheckLayer = importPath.startsWith('.') || importedDomain === sourceDomain
    if (!shouldCheckLayer) {
      return
    }

    const targetLayer = importPath.startsWith('.')
      ? inferLayerFromPath(resolvedTarget)
      : inferLayerFromImport(importPath)

    if (!targetLayer) {
      return
    }

    const allowedTargets = allowedLayerImports[sourceLayer] ?? new Set()
    if (!allowedTargets.has(targetLayer)) {
      context.report({
        node,
        message: [
          'Invalid domain-layer dependency.',
          `source=${formatRepoRelative(sourceFilePath)} (${sourceLayer})`,
          `import=${importPath} -> ${targetLayer}`,
          `allowed=${[...allowedTargets].join(', ')}`
        ].join(' ')
      })
    }
  }

  return {
    ImportDeclaration(node) {
      validateImport(node, node.source.value)
    },

    ExportNamedDeclaration(node) {
      if (node.source) {
        validateImport(node, node.source.value)
      }
    },

    ExportAllDeclaration(node) {
      if (node.source) {
        validateImport(node, node.source.value)
      }
    }
  }
}

const createNoLayerProvidersInPortsRule = (context) => {
  const sourceFilePath = toPosix(context.filename)
  if (!sourceFilePath.includes('/ports/')) {
    return {}
  }

  const layerIdentifiers = new Set(['Layer'])

  return {
    ImportDeclaration(node) {
      if (typeof node.source.value !== 'string' || !node.source.value.startsWith('effect')) {
        return
      }

      for (const specifier of node.specifiers) {
        if (
          specifier.type === 'ImportSpecifier' &&
          specifier.imported.type === 'Identifier' &&
          specifier.imported.name === 'Layer' &&
          specifier.local.type === 'Identifier'
        ) {
          layerIdentifiers.add(specifier.local.name)
        }
      }
    },

    CallExpression(node) {
      if (node.callee.type !== 'MemberExpression') {
        return
      }

      if (node.callee.object.type !== 'Identifier' || node.callee.property.type !== 'Identifier') {
        return
      }

      if (!layerIdentifiers.has(node.callee.object.name)) {
        return
      }

      if (node.callee.property.name !== 'succeed' && node.callee.property.name !== 'effect') {
        return
      }

      context.report({
        node,
        message:
          'Ports must stay declarative contracts only. Move `Layer.succeed`/`Layer.effect` implementations into adapters/.'
      })
    }
  }
}

const createAdaptersReferencePortRule = (context) => {
  const sourceFilePath = toPosix(context.filename)
  if (!sourceFilePath.includes('/adapters/')) {
    return {}
  }

  const fileName = sourceFilePath.split('/').pop() ?? ''
  if (fileName === 'index.ts' || fileName === 'index.tsx') {
    return {}
  }

  let hasPortImport = false

  const importReferencesPort = (node) => {
    const importPath = typeof node.source.value === 'string' ? node.source.value : ''

    if (/(^|\/)ports(\/|$)/u.test(importPath)) {
      return true
    }

    for (const specifier of node.specifiers) {
      if (specifier.type !== 'ImportSpecifier') {
        continue
      }

      const importedName = specifier.imported.type === 'Identifier' ? specifier.imported.name : ''
      const localName = specifier.local.type === 'Identifier' ? specifier.local.name : ''
      if (/Port(?:s)?$/u.test(importedName) || /Port(?:s)?$/u.test(localName)) {
        return true
      }
    }

    return false
  }

  return {
    ImportDeclaration(node) {
      if (importReferencesPort(node)) {
        hasPortImport = true
      }
    },

    'Program:exit'(node) {
      if (hasPortImport) {
        return
      }

      context.report({
        node,
        message:
          'Adapter modules must import at least one domain port contract (path containing `ports/` or `*Port` symbol).'
      })
    }
  }
}

export const domainStructurePlugin = {
  meta: {
    name: '@tx-agent-kit/domain-structure-plugin',
    version: '0.1.0'
  },
  rules: {
    'require-domain-structure': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Ensures each domain module contains domain/ports/application/adapters and at least one application use-case file.'
        },
        schema: []
      },
      create(context) {
        return {
          Program(node) {
            reportStructuralIssues(context, node)
          }
        }
      }
    },
    'enforce-layer-boundaries': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Enforces domain layer dependency direction and blocks cross-domain imports except published shared modules.'
        },
        schema: []
      },
      create: createLayerBoundaryRule
    },
    'ports-no-layer-providers': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Prevents Layer implementations from being defined in ports modules.'
        },
        schema: []
      },
      create: createNoLayerProvidersInPortsRule
    },
    'adapters-must-import-port': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Requires adapters to import at least one port contract.'
        },
        schema: []
      },
      create: createAdaptersReferencePortRule
    }
  }
}
