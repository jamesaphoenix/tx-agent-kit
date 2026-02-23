import { existsSync, readdirSync, statSync } from 'node:fs'
import { delimiter, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../../..')

const defaultDomainRoots = [
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
let cachedStructureKey = null

const parseDomainRootsOverride = () => {
  const value = process.env.TX_DOMAIN_STRUCTURE_ROOTS
  if (!value) {
    return null
  }

  const entries = value
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  if (entries.length === 0) {
    return null
  }

  return entries.map((entry) => (entry.startsWith('/') ? entry : resolve(repoRoot, entry)))
}

const getDomainRoots = () => parseDomainRootsOverride() ?? defaultDomainRoots

const collectStructureIssues = () => {
  const domainRoots = getDomainRoots()
  const cacheKey = domainRoots.join('|')

  if (cachedStructureIssues && cachedStructureKey === cacheKey) {
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
  cachedStructureKey = cacheKey
  return cachedStructureIssues
}

const reportStructuralIssues = (context, node) => {
  const issues = collectStructureIssues()
  if (issues.length === 0) {
    return
  }

  for (const issue of issues) {
      context.report({ node, message: issue })
  }
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

const isDomainSourceFile = (sourceFilePath) =>
  /\/domains\/[^/]+\/domain\/.*\.(ts|tsx)$/u.test(sourceFilePath)

const createPureDomainNoEffectImportsRule = (context) => {
  const sourceFilePath = toPosix(context.filename)
  if (!isDomainSourceFile(sourceFilePath)) {
    return {}
  }

  return {
    ImportDeclaration(node) {
      const importPath = typeof node.source.value === 'string' ? node.source.value : ''
      if (importPath === 'effect' || importPath.startsWith('effect/')) {
        context.report({
          node,
          message:
            'Domain layer must stay pure. Do not import `effect` in `domain/`; model logic as plain TypeScript.'
        })
      }
    }
  }
}

const INFRA_IMPORT_PATTERNS = [
  /^@tx-agent-kit\/db(?:\/|$)/u,
  /^drizzle-orm(?:\/|$)/u,
  /^@effect\/platform(?:\/|$)/u,
  /^node:(?:fs|fs\/promises|http|https|net|tls|dns|child_process|worker_threads|dgram|readline|stream)(?:\/|$)?/u,
  /^(?:fs|fs\/promises|http|https|net|tls|dns|child_process|worker_threads|dgram|readline|stream)(?:\/|$)/u
]

const isInfraImportPath = (importPath) =>
  INFRA_IMPORT_PATTERNS.some((pattern) => pattern.test(importPath))

const createPureDomainNoInfraImportsRule = (context) => {
  const sourceFilePath = toPosix(context.filename)
  if (!isDomainSourceFile(sourceFilePath)) {
    return {}
  }

  return {
    ImportDeclaration(node) {
      const importPath = typeof node.source.value === 'string' ? node.source.value : ''
      if (!isInfraImportPath(importPath)) {
        return
      }

      context.report({
        node,
        message:
          'Domain layer must not import infrastructure modules (DB/Drizzle/platform or Node I/O APIs).'
      })
    }
  }
}

const createNoThrowTryOutsideAdaptersRule = (context) => {
  const sourceFilePath = toPosix(context.filename)
  const isDomainModule = /\/domains\/[^/]+\//u.test(sourceFilePath)
  const isAdapterOrRuntime = /\/(adapters|runtime)\//u.test(sourceFilePath)
  if (!isDomainModule || isAdapterOrRuntime) {
    return {}
  }

  return {
    ThrowStatement(node) {
      context.report({
        node,
        message:
          'Avoid `throw` in domain modules outside adapters/runtime. Use typed error channels (`Effect.fail` or explicit result types).'
      })
    },
    TryStatement(node) {
      context.report({
        node,
        message:
          'Avoid `try/catch` in domain modules outside adapters/runtime. Keep failures typed and explicit.'
      })
    }
  }
}

const createNoInlineStringUnionEnumsRule = (context) => {
  const sourceFilePath = toPosix(context.filename)

  if (/\/packages\/contracts\/src\/literals\.ts$/u.test(sourceFilePath)) {
    return {}
  }

  return {
    TSUnionType(node) {
      if (node.types.length < 2) {
        return
      }

      const isStringLiteralUnion = node.types.every(
        (member) =>
          member.type === 'TSLiteralType' &&
          member.literal.type === 'Literal' &&
          typeof member.literal.value === 'string'
      )

      if (!isStringLiteralUnion) {
        return
      }

      context.report({
        node,
        message:
          'Inline string-literal union enums are disallowed outside `packages/contracts/src/literals.ts`. Export shared literal tuples/types there and import them.'
      })
    }
  }
}

const createNoRawSchemaLiteralEnumsRule = (context) => {
  const allowedValueIdentifiers = new Set()
  const allowedValueNamespaces = new Set()

  const isAllowedLiteralSource = (importPath) =>
    importPath === '@tx-agent-kit/contracts' ||
    importPath.startsWith('@tx-agent-kit/contracts/') ||
    /(^|\/)literals(?:\.js)?$/u.test(importPath)

  const isAllowedSpreadSource = (argument) => {
    if (argument.type === 'Identifier') {
      return allowedValueIdentifiers.has(argument.name)
    }

    if (
      argument.type === 'MemberExpression' &&
      argument.object.type === 'Identifier' &&
      allowedValueNamespaces.has(argument.object.name)
    ) {
      return true
    }

    return false
  }

  return {
    ImportDeclaration(node) {
      const importPath = typeof node.source.value === 'string' ? node.source.value : ''
      if (!isAllowedLiteralSource(importPath)) {
        return
      }

      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier' && specifier.local.type === 'Identifier') {
          allowedValueIdentifiers.add(specifier.local.name)
        }

        if (specifier.type === 'ImportNamespaceSpecifier' && specifier.local.type === 'Identifier') {
          allowedValueNamespaces.add(specifier.local.name)
        }
      }
    },

    CallExpression(node) {
      if (node.callee.type !== 'MemberExpression') {
        return
      }

      if (
        node.callee.object.type !== 'Identifier' ||
        node.callee.object.name !== 'Schema' ||
        node.callee.property.type !== 'Identifier' ||
        node.callee.property.name !== 'Literal'
      ) {
        return
      }

      const rawStringLiteralArgs = node.arguments.filter(
        (argument) => argument.type === 'Literal' && typeof argument.value === 'string'
      )

      if (rawStringLiteralArgs.length >= 2) {
        context.report({
          node,
          message:
            'Raw multi-value `Schema.Literal(...)` enums are disallowed. Define tuples in `packages/contracts/src/literals.ts` and consume them via spread (`Schema.Literal(...values)`).'
        })
        return
      }

      const spreadArgs = node.arguments.filter((argument) => argument.type === 'SpreadElement')
      if (spreadArgs.length === 0) {
        return
      }

      for (const spreadArg of spreadArgs) {
        if (!isAllowedSpreadSource(spreadArg.argument)) {
          context.report({
            node: spreadArg,
            message:
              'Schema enum tuples must come from shared literal imports (`@tx-agent-kit/contracts` or `./literals.js`), not local ad hoc constants.'
          })
          return
        }
      }
    }
  }
}

const createNoInlinePgEnumArrayRule = (context) => {
  const allowedTupleIdentifiers = new Set()
  const allowedTupleNamespaces = new Set()

  const isAllowedContractsImport = (importPath) =>
    importPath === '@tx-agent-kit/contracts' || importPath.startsWith('@tx-agent-kit/contracts/')

  const isAllowedTupleArgument = (argument) => {
    if (argument.type === 'Identifier') {
      return allowedTupleIdentifiers.has(argument.name)
    }

    if (
      argument.type === 'MemberExpression' &&
      argument.object.type === 'Identifier' &&
      allowedTupleNamespaces.has(argument.object.name)
    ) {
      return true
    }

    return false
  }

  return {
    ImportDeclaration(node) {
      const importPath = typeof node.source.value === 'string' ? node.source.value : ''
      if (!isAllowedContractsImport(importPath)) {
        return
      }

      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier' && specifier.local.type === 'Identifier') {
          allowedTupleIdentifiers.add(specifier.local.name)
        }

        if (specifier.type === 'ImportNamespaceSpecifier' && specifier.local.type === 'Identifier') {
          allowedTupleNamespaces.add(specifier.local.name)
        }
      }
    },

    CallExpression(node) {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'pgEnum') {
        return
      }

      if (node.arguments.length < 2) {
        return
      }

      const secondArgument = node.arguments[1]
      if (!secondArgument) {
        return
      }

      if (secondArgument.type === 'ArrayExpression') {
        context.report({
          node,
          message:
            'Inline `pgEnum(..., [...])` arrays are disallowed. Import shared literal tuples from `@tx-agent-kit/contracts` and pass the tuple variable.'
        })
        return
      }

      if (!isAllowedTupleArgument(secondArgument)) {
        context.report({
          node: secondArgument,
          message:
            '`pgEnum` tuple arguments must come from shared imports in `@tx-agent-kit/contracts`, not local ad hoc constants.'
        })
      }
    }
  }
}

const createCoreAdaptersUseDbRowMappersRule = (context) => {
  const sourceFilePath = toPosix(context.filename)
  const isCoreAdapterFile = /\/packages\/core\/src\/domains\/[^/]+\/adapters\/.*\.(ts|tsx)$/u.test(sourceFilePath)

  if (!isCoreAdapterFile) {
    return {}
  }

  const fileName = sourceFilePath.split('/').pop() ?? ''
  if (fileName === 'index.ts' || fileName === 'index.tsx') {
    return {}
  }

  let hasDbImport = false
  let hasDbRowMapperImport = false

  return {
    ImportDeclaration(node) {
      if (typeof node.source.value !== 'string') {
        return
      }

      const importPath = node.source.value
      if (importPath === '@tx-agent-kit/db' || importPath.startsWith('@tx-agent-kit/db/')) {
        hasDbImport = true
      }

      if (/(^|\/)adapters\/db-row-mappers(?:\.js)?$/u.test(importPath)) {
        hasDbRowMapperImport = true
      }
    },

    'Program:exit'(node) {
      if (!hasDbImport || hasDbRowMapperImport) {
        return
      }

      context.report({
        node,
        message:
          'Core adapters importing `@tx-agent-kit/db` must centralize row->record mapping via `packages/core/src/adapters/db-row-mappers.ts`.'
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
    },
    'pure-domain-no-effect-imports': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Prevents imports from `effect` in domain layer files to keep the domain strictly pure.'
        },
        schema: []
      },
      create: createPureDomainNoEffectImportsRule
    },
    'pure-domain-no-infra-imports': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Prevents domain layer imports from infrastructure modules (DB/Drizzle/platform and Node I/O APIs).'
        },
        schema: []
      },
      create: createPureDomainNoInfraImportsRule
    },
    'no-throw-try-outside-adapters': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Prevents throw and try/catch in domain modules outside adapters/runtime to enforce typed failures.'
        },
        schema: []
      },
      create: createNoThrowTryOutsideAdaptersRule
    },
    'no-inline-string-union-enums': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallows inline string-literal union enums outside shared literals module.'
        },
        schema: []
      },
      create: createNoInlineStringUnionEnumsRule
    },
    'no-raw-schema-literal-enums': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallows raw multi-value Schema.Literal enum definitions.'
        },
        schema: []
      },
      create: createNoRawSchemaLiteralEnumsRule
    },
    'no-inline-pgenum-array': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallows inline pgEnum arrays; requires shared tuple constants.'
        },
        schema: []
      },
      create: createNoInlinePgEnumArrayRule
    },
    'core-adapters-use-db-row-mappers': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Requires core adapters importing db repositories to use centralized db row mappers.'
        },
        schema: []
      },
      create: createCoreAdaptersUseDbRowMappersRule
    }
  }
}
