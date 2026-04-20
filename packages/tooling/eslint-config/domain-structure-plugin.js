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
const forbiddenDomainFolders = ['repositories', 'services']
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

/**
 * Cross-domain imports of a domain's events.ts are allowed.
 * events.ts is the public cross-domain fact surface — the ONLY file other
 * domains may import from a sibling domain.
 */
const isDomainEventsImport = (importPath, resolvedTarget) => {
  if (/\/events(\.js|\.ts)?$/u.test(toPosix(importPath))) {
    return true
  }

  if (typeof resolvedTarget === 'string') {
    return /\/domains\/[^/]+\/events(\.ts|\.js)?$/u.test(toPosix(resolvedTarget))
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

      for (const forbiddenFolder of forbiddenDomainFolders) {
        const forbiddenPath = resolve(domainPath, forbiddenFolder)
        if (existsSync(forbiddenPath) && statSync(forbiddenPath).isDirectory()) {
          issues.push(
            `Domain \`${domainLabel}\` must not include \`${forbiddenFolder}/\`. Use \`ports/\` for contracts and \`adapters/\` for implementations.`
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
      !isPublishedDomainSharedImport(importPath, resolvedTarget) &&
      !isDomainEventsImport(importPath, resolvedTarget)
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

// Pure data utilities from Effect that are safe in the domain layer.
// These have no runtime/DI dependencies and are equivalent to plain TS.
const ALLOWED_EFFECT_NAMED_IMPORTS = new Set([
  'Either',
  'Option',
  'pipe',
  'Data',
  'Match'
])

// Deep `effect/*` sub-module imports that are safe in the domain layer.
const ALLOWED_EFFECT_SUBMODULES = new Set([
  'effect/Either',
  'effect/Option',
  'effect/Function',
  'effect/Data',
  'effect/Match'
])

// Runtime/DI imports from Effect that must stay out of the domain layer.
const BLOCKED_EFFECT_NAMED_IMPORTS = new Set([
  'Effect',
  'Layer',
  'Context',
  'Fiber',
  'Runtime',
  'Schedule',
  'Queue',
  'Ref'
])

const createPureDomainNoEffectImportsRule = (context) => {
  const sourceFilePath = toPosix(context.filename)
  if (!isDomainSourceFile(sourceFilePath)) {
    return {}
  }

  return {
    ImportDeclaration(node) {
      const importPath = typeof node.source.value === 'string' ? node.source.value : ''
      if (importPath !== 'effect' && !importPath.startsWith('effect/')) {
        return
      }

      // Type-only imports are always allowed
      if (node.importKind === 'type') {
        return
      }

      // Deep sub-module imports (e.g. `import { pipe } from 'effect/Function'`)
      if (importPath.startsWith('effect/')) {
        if (ALLOWED_EFFECT_SUBMODULES.has(importPath)) {
          return
        }
        context.report({
          node,
          message:
            `Domain layer must stay pure. \`${importPath}\` is not allowed in \`domain/\`. ` +
            'Only pure data utilities (Either, Option, Data, Match, pipe) may be imported from Effect.'
        })
        return
      }

      // Barrel imports from 'effect': check each named specifier
      const specifiers = node.specifiers ?? []
      const blockedSpecifiers = []
      for (const spec of specifiers) {
        if (spec.type !== 'ImportSpecifier') {
          // `import * as Effect from 'effect'` — block namespace imports
          blockedSpecifiers.push(spec)
          continue
        }

        // Type-only individual specifier (import { type Effect } from 'effect')
        if (spec.importKind === 'type') {
          continue
        }

        const imported = spec.imported?.name
        if (imported && !ALLOWED_EFFECT_NAMED_IMPORTS.has(imported)) {
          blockedSpecifiers.push(spec)
        }
      }

      if (blockedSpecifiers.length > 0) {
        const names = blockedSpecifiers
          .map((s) => s.imported?.name ?? s.local?.name ?? '(namespace)')
          .join(', ')
        context.report({
          node,
          message:
            `Domain layer must stay pure. Importing \`{ ${names} }\` from \`effect\` is not allowed in \`domain/\`. ` +
            'Only pure data utilities (Either, Option, Data, Match, pipe) may be imported.'
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

// Type-only imports from @tx-agent-kit/db are allowed in domain files so that
// domain record interfaces can `extends` row shape types (the "domain extends
// row shape" pattern). This keeps compile-time coupling without runtime deps.
const isTypeOnlyDbImport = (node) =>
  node.importKind === 'type' && /^@tx-agent-kit\/db(?:\/|$)/u.test(node.source.value)

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

      if (isTypeOnlyDbImport(node)) {
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

const unwrapExpressionNode = (node) => {
  let current = node

  while (current) {
    if (current.type === 'TSAsExpression' || current.type === 'TSNonNullExpression') {
      current = current.expression
      continue
    }

    if (current.type === 'TSTypeAssertion' || current.type === 'ParenthesizedExpression') {
      current = current.expression
      continue
    }

    if (current.type === 'ChainExpression') {
      current = current.expression
      continue
    }

    return current
  }

  return node
}

const unwrapTypeNode = (node) => {
  let current = node

  while (current && current.type === 'TSParenthesizedType') {
    current = current.typeAnnotation
  }

  return current
}

const getTypeReferenceName = (typeNameNode) => {
  if (!typeNameNode) {
    return null
  }

  if (typeNameNode.type === 'Identifier') {
    return typeNameNode.name
  }

  if (typeNameNode.type === 'TSQualifiedName' && typeNameNode.right.type === 'Identifier') {
    return typeNameNode.right.name
  }

  return null
}

const getWeakJsonTypeReason = (typeNode) => {
  if (!typeNode) {
    return 'missing type argument'
  }

  const normalizedType = unwrapTypeNode(typeNode)
  if (!normalizedType) {
    return 'missing type argument'
  }

  if (normalizedType.type === 'TSAnyKeyword') {
    return '`any`'
  }

  if (normalizedType.type === 'TSUnknownKeyword') {
    return '`unknown`'
  }

  if (normalizedType.type !== 'TSTypeReference') {
    return null
  }

  if (getTypeReferenceName(normalizedType.typeName) !== 'Record') {
    return null
  }

  const typeArgumentsNode = normalizedType.typeArguments ?? normalizedType.typeParameters
  if (!typeArgumentsNode || typeArgumentsNode.type !== 'TSTypeParameterInstantiation') {
    return null
  }

  if (typeArgumentsNode.params.length < 2) {
    return null
  }

  const valueTypeNode = unwrapTypeNode(typeArgumentsNode.params[1])
  if (!valueTypeNode) {
    return null
  }

  if (valueTypeNode.type === 'TSAnyKeyword') {
    return '`Record<string, any>`'
  }

  if (valueTypeNode.type === 'TSUnknownKeyword') {
    return '`Record<string, unknown>`'
  }

  return null
}

const createJsonColumnsRequireExplicitDrizzleTypeRule = (context) => {
  const jsonBuilderIdentifiers = new Set()

  const isDrizzlePgCoreImport = (importPath) =>
    importPath === 'drizzle-orm/pg-core' || importPath.startsWith('drizzle-orm/pg-core/')

  const isFluentChainContinuation = (node) => {
    let current = node
    let parent = node.parent

    while (
      parent &&
      (parent.type === 'TSAsExpression' ||
        parent.type === 'TSNonNullExpression' ||
        parent.type === 'TSTypeAssertion' ||
        parent.type === 'ParenthesizedExpression' ||
        parent.type === 'ChainExpression')
    ) {
      current = parent
      parent = parent.parent
    }

    if (parent?.type === 'MemberExpression' && parent.object === current) {
      return true
    }

    if (parent?.type === 'CallExpression' && parent.callee === current) {
      return true
    }

    return false
  }

  const analyzeFluentChain = (callExpressionNode) => {
    let current = unwrapExpressionNode(callExpressionNode)
    let sawTypeCall = false
    let weakTypeReason = null
    let weakTypeNode = null

    while (
      current?.type === 'CallExpression' &&
      current.callee.type === 'MemberExpression' &&
      current.callee.property.type === 'Identifier'
    ) {
      const methodName = current.callee.property.name
      if (methodName === '$type') {
        sawTypeCall = true

        const typeArgumentsNode = current.typeArguments ?? current.typeParameters
        const firstTypeArgument =
          typeArgumentsNode?.type === 'TSTypeParameterInstantiation'
            ? typeArgumentsNode.params[0]
            : null

        const typeWeakness = getWeakJsonTypeReason(firstTypeArgument)
        if (typeWeakness) {
          weakTypeReason = typeWeakness
          weakTypeNode = firstTypeArgument ?? current
        }
      }

      current = unwrapExpressionNode(current.callee.object)
    }

    return {
      root: current,
      sawTypeCall,
      weakTypeReason,
      weakTypeNode
    }
  }

  return {
    ImportDeclaration(node) {
      const importPath = typeof node.source.value === 'string' ? node.source.value : ''
      if (!isDrizzlePgCoreImport(importPath)) {
        return
      }

      for (const specifier of node.specifiers) {
        if (specifier.type !== 'ImportSpecifier') {
          continue
        }

        if (specifier.imported.type !== 'Identifier' || specifier.local.type !== 'Identifier') {
          continue
        }

        if (specifier.imported.name === 'json' || specifier.imported.name === 'jsonb') {
          jsonBuilderIdentifiers.add(specifier.local.name)
        }
      }
    },

    CallExpression(node) {
      if (isFluentChainContinuation(node)) {
        return
      }

      const { root, sawTypeCall, weakTypeReason, weakTypeNode } = analyzeFluentChain(node)
      if (!root || root.type !== 'CallExpression' || root.callee.type !== 'Identifier') {
        return
      }

      if (!jsonBuilderIdentifiers.has(root.callee.name)) {
        return
      }

      if (!sawTypeCall) {
        context.report({
          node,
          message:
            'JSON/JSONB Drizzle columns must include `.$type<...>()` with an explicit payload type to keep DB and Effect schemas strongly typed.'
        })
        return
      }

      if (weakTypeReason) {
        context.report({
          node: weakTypeNode ?? node,
          message:
            `JSON/JSONB Drizzle columns must use explicit payload types; weak type ${weakTypeReason} is disallowed.`
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
  let hasTypeOnlyDbImport = false
  let hasDbRowMapperImport = false

  return {
    ImportDeclaration(node) {
      if (typeof node.source.value !== 'string') {
        return
      }

      const importPath = node.source.value
      if (importPath === '@tx-agent-kit/db' || importPath.startsWith('@tx-agent-kit/db/')) {
        hasDbImport = true
        // Track type-only imports from @tx-agent-kit/db (extends pattern:
        // domain record extends row shape, adapter uses `as DomainRecord` cast).
        if (node.importKind === 'type') {
          hasTypeOnlyDbImport = true
        }
      }

      if (/(^|\/)adapters\/db-row-mappers(?:\.js)?$/u.test(importPath)) {
        hasDbRowMapperImport = true
      }
    },

    'Program:exit'(node) {
      // Pass if: no db imports, OR uses centralized row mappers, OR uses
      // type-only db import (extends pattern where domain records extend row shapes).
      if (!hasDbImport || hasDbRowMapperImport || hasTypeOnlyDbImport) {
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

// ── INV-BILLING-001/002: Financial audit trail immutability ─────────────────────
// credit_ledger and usage_records are append-only financial audit trails.
// Application code must never call .update() or .delete() on these tables.
// DB triggers enforce this at the database level; this lint catches it at code level.

const FINANCIAL_AUDIT_TABLES = new Set(['creditLedger', 'usageRecords'])

const createEnforceFinancialAuditImmutabilityRule = (context) => {
  const sourceFilePath = toPosix(context.filename)
  if (!sourceFilePath.includes('/repositories/')) {
    return {}
  }

  const importedAuditTables = new Set()

  return {
    ImportDeclaration(node) {
      const importPath = typeof node.source.value === 'string' ? node.source.value : ''
      if (!importPath.includes('schema')) {
        return
      }
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
          if (FINANCIAL_AUDIT_TABLES.has(specifier.imported.name)) {
            importedAuditTables.add(specifier.local?.name ?? specifier.imported.name)
          }
        }
      }
    },

    'CallExpression[callee.type="MemberExpression"]'(node) {
      const methodName = node.callee.property?.name
      if (methodName !== 'update' && methodName !== 'delete') {
        return
      }

      // Check if the first argument is a financial audit table
      const firstArg = node.arguments[0]
      if (firstArg?.type === 'Identifier' && importedAuditTables.has(firstArg.name)) {
        // Allow suppression via: // financial-audit: exempt (metadata-only update)
        const sourceCode = context.sourceCode
        const lineNumber = node.loc?.start?.line
        if (lineNumber) {
          for (let l = Math.max(1, lineNumber - 3); l <= lineNumber; l++) {
            const lineText = sourceCode.getLines?.()[l - 1] ?? sourceCode.lines?.[l - 1] ?? sourceCode.getText().split('\n')[l - 1] ?? ''
            if (lineText.includes('financial-audit: exempt')) {
              return
            }
          }
        }

        context.report({
          node,
          message:
            `[INV-BILLING-001/002] \`${firstArg.name}\` is an immutable financial audit trail. ` +
            'Application code must not call .update() or .delete() on this table. ' +
            'These rows are append-only and protected by DB triggers. ' +
            'If this is a metadata-only update, add `// financial-audit: exempt (reason)` above.'
        })
      }
    }
  }
}

// @spec INV-TEN-004
// ── Enforce tenant scoping on repository queries ───────────────────────────────
// Drizzle queries on tenant-scoped tables must include a .where() with
// eq(table.teamId, ...) or eq(table.organizationId, ...).
// Scoped to: packages/infra/db/src/repositories/

const TENANT_SCOPED_TABLES = new Set([
  'teams', 'teamMembers', 'orgMembers', 'invitations',
  'contentReviewTokens', 'creditLedger', 'usageRecords',
  // Future tables added here as subsystems are implemented
])

const TENANT_SCOPE_COLUMNS = new Set([
  'teamId', 'team_id', 'organizationId', 'organization_id'
])

const DRIZZLE_QUERY_METHODS = new Set(['select', 'update', 'delete'])

const createEnforceTenantScopeRule = (context) => {
  const sourceFilePath = toPosix(context.filename)

  // Only enforce in repository files
  if (!sourceFilePath.includes('/repositories/')) {
    return {}
  }

  // Track imported table identifiers from schema
  const schemaTableIdentifiers = new Set()
  // Track chains that need tenant scope: keyed by the outermost expression statement
  const pendingChecks = []

  // Walk a Drizzle fluent chain (e.g. db.select().from(X).where(...))
  // collecting method names and their arguments
  const walkChain = (node) => {
    const methods = []
    let current = node
    while (current?.type === 'CallExpression' && current.callee?.type === 'MemberExpression') {
      const name = current.callee.property?.name
      if (name) {
        methods.push({ name, args: current.arguments, node: current })
      }
      current = current.callee.object
    }
    return methods
  }

  return {
    ImportDeclaration(node) {
      const importPath = typeof node.source.value === 'string' ? node.source.value : ''
      if (!importPath.includes('schema')) {
        return
      }
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier') {
          if (TENANT_SCOPED_TABLES.has(specifier.imported.name)) {
            schemaTableIdentifiers.add(specifier.local?.name ?? specifier.imported.name)
          }
        }
      }
    },

    // Capture the full chain at the statement level, then analyze
    'ExpressionStatement > CallExpression'(node) {
      pendingChecks.push(node)
    },

    // Also capture chains in variable declarations: const x = db.select()...
    VariableDeclarator(node) {
      if (node.init?.type === 'CallExpression') {
        pendingChecks.push(node.init)
      } else if (node.init?.type === 'AwaitExpression' && node.init.argument?.type === 'CallExpression') {
        pendingChecks.push(node.init.argument)
      }
    },

    // Also capture await expressions: await db.select()...
    AwaitExpression(node) {
      if (node.argument?.type === 'CallExpression') {
        pendingChecks.push(node.argument)
      }
    },

    // Also capture chains in yield expressions: yield* db.select()...
    YieldExpression(node) {
      if (node.argument?.type === 'CallExpression') {
        pendingChecks.push(node.argument)
      }
    },

    // Also capture return statements
    ReturnStatement(node) {
      if (node.argument?.type === 'CallExpression') {
        pendingChecks.push(node.argument)
      }
    },

    'Program:exit'() {
      for (const chainRoot of pendingChecks) {
        const methods = walkChain(chainRoot)
        if (methods.length === 0) continue

        // Find the tenant-scoped table reference
        let tableName = null

        // Check .from(table) calls
        for (const m of methods) {
          if (m.name === 'from' && m.args.length > 0) {
            const arg = m.args[0]
            if (arg.type === 'Identifier' && schemaTableIdentifiers.has(arg.name)) {
              tableName = arg.name
            }
          }
        }

        // Check db.delete(table) and db.update(table) — these are at the end of the chain walk
        // (the innermost call). Check the last call's callee object for .delete/.update
        let inner = chainRoot
        while (inner?.type === 'CallExpression' && inner.callee?.type === 'MemberExpression') {
          const innerCallee = inner.callee.object
          if (innerCallee?.type === 'CallExpression' && innerCallee.callee?.type === 'MemberExpression') {
            inner = innerCallee
          } else {
            break
          }
        }
        // Also check methods collected
        for (const m of methods) {
          if ((m.name === 'delete' || m.name === 'update') && m.args.length > 0) {
            const arg = m.args[0]
            if (arg.type === 'Identifier' && schemaTableIdentifiers.has(arg.name)) {
              tableName = arg.name
            }
          }
        }

        if (!tableName) continue

        // Allow suppression via inline comment: // tenant-scope: service-validated
        // This is for internal methods (getById, findByToken) where tenant
        // validation happens at the service layer, not in the SQL query.
        const sourceCode = context.sourceCode
        const lineNumber = chainRoot.loc?.start?.line
        if (lineNumber) {
          // Check preceding lines (up to 3) for suppression comment
          for (let l = Math.max(1, lineNumber - 3); l <= lineNumber; l++) {
            const lineText = sourceCode.getLines?.()[l - 1] ?? sourceCode.lines?.[l - 1] ?? sourceCode.getText().split('\n')[l - 1] ?? ''
            if (lineText.includes('tenant-scope: service-validated')) {
              tableName = null
              break
            }
          }
        }
        if (!tableName) continue

        // Check if any .where() in the chain references a tenant scope column
        const hasWhere = methods.some(m => m.name === 'where')
        if (!hasWhere) {
          context.report({
            node: chainRoot,
            message:
              `[INV-TEN-004] Query on tenant-scoped table \`${tableName}\` must include a .where() ` +
              `condition on \`teamId\` or \`organizationId\`. Unscoped queries risk cross-tenant data leaks.`
          })
          continue
        }

        // Check if .where() contains a tenant scope column — either directly
        // or via a variable (e.g. baseWhere = eq(table.teamId, ...))
        const whereMethod = methods.find(m => m.name === 'where')
        if (whereMethod) {
          const whereSource = context.sourceCode.getText(whereMethod.node)
          const hasTenantColumn = [...TENANT_SCOPE_COLUMNS].some(col => whereSource.includes(col))

          // Check if .where() passes a variable that was defined with tenant scope
          let hasTenantViaVariable = false
          if (!hasTenantColumn && whereMethod.args.length > 0) {
            for (const arg of whereMethod.args) {
              if (arg.type === 'Identifier') {
                // Look up the variable definition in the current scope
                const scope = context.sourceCode.getScope(arg)
                const variable = scope.references.find(ref => ref.identifier.name === arg.name)
                if (variable?.resolved?.defs?.[0]?.node?.init) {
                  const initSource = context.sourceCode.getText(variable.resolved.defs[0].node.init)
                  if ([...TENANT_SCOPE_COLUMNS].some(col => initSource.includes(col))) {
                    hasTenantViaVariable = true
                  }
                }
              }
              // Also check spread in and()/or() that might contain the variable
              if (arg.type === 'CallExpression') {
                const argSource = context.sourceCode.getText(arg)
                // Check if any argument to and()/or() is a variable defined with tenant scope
                for (const innerArg of arg.arguments) {
                  if (innerArg.type === 'Identifier') {
                    const scope = context.sourceCode.getScope(innerArg)
                    const variable = scope.references.find(ref => ref.identifier.name === innerArg.name)
                    if (variable?.resolved?.defs?.[0]?.node?.init) {
                      const initSource = context.sourceCode.getText(variable.resolved.defs[0].node.init)
                      if ([...TENANT_SCOPE_COLUMNS].some(col => initSource.includes(col))) {
                        hasTenantViaVariable = true
                      }
                    }
                  }
                }
              }
            }
          }

          if (!hasTenantColumn && !hasTenantViaVariable) {
            context.report({
              node: chainRoot,
              message:
                `[INV-TEN-004] Query on tenant-scoped table \`${tableName}\` must include a .where() ` +
                `condition on \`teamId\` or \`organizationId\`. Unscoped queries risk cross-tenant data leaks.`
            })
          }
        }
      }
    }
  }
}

// ── No swallowed errors: catch handlers must reference the original error ──────
// Catches patterns like:
//   Effect.tryPromise({ catch: () => new MyError({ message: 'opaque' }) })
//   .pipe(Effect.mapError(() => unauthorized('opaque')))
// Where the catch/mapError arrow function ignores its error parameter.

const createNoSwallowedErrorsRule = (context) => {
  return {
    CallExpression(node) {
      // Check Effect.tryPromise({ catch: () => ... })
      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'Effect' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'tryPromise' &&
        node.arguments.length > 0
      ) {
        const arg = node.arguments[0]
        if (arg.type === 'ObjectExpression') {
          const catchProp = arg.properties.find(
            (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'catch'
          )
          if (catchProp && catchProp.value.type === 'ArrowFunctionExpression') {
            const catchFn = catchProp.value
            // Check if the catch arrow has no parameters or its parameter is underscore-prefixed (unused)
            if (catchFn.params.length === 0 ||
                (catchFn.params[0].type === 'Identifier' && catchFn.params[0].name.startsWith('_'))) {
              context.report({
                node: catchFn,
                message:
                  'Effect.tryPromise catch handler must accept and use the original error parameter. ' +
                  'Swallowing errors makes debugging impossible — include the error message so it flows to logs/Spotlight. ' +
                  'Example: catch: (error) => new MyError({ message: `Operation failed: ${error instanceof Error ? error.message : String(error)}` })'
              })
            }
          }
        }
      }

      // Check .pipe(Effect.mapError(() => ...)) where the arrow ignores its param
      if (
        node.callee.type === 'MemberExpression' &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'mapError' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'Effect' &&
        node.arguments.length > 0
      ) {
        const mapFn = node.arguments[0]
        if (mapFn.type === 'ArrowFunctionExpression' && (mapFn.params.length === 0 ||
            (mapFn.params[0].type === 'Identifier' && mapFn.params[0].name.startsWith('_')))) {
          context.report({
            node: mapFn,
            message:
              'Effect.mapError handler must accept and use the original error parameter. ' +
              'Swallowing errors makes debugging impossible — include the error message so it flows to logs/Spotlight. ' +
              'Example: Effect.mapError((error) => unauthorized(`Failed: ${error instanceof Error ? error.message : String(error)}`))'
          })
        }
      }
    }
  }
}

// ── enforce-service-naming ─────────────────────────────────────────────────
// Validates Context.Tag class naming: [Entity]Service or [Purpose]Port.
// Tag string must match class name. Files must follow kebab-case conventions.

const SERVICE_SUFFIX = 'Service'
const PORT_SUFFIX = 'Port'
const SERVICE_FILE_PATTERN = /-service\.ts$/
const PORT_FILE_PATTERN = /-ports\.ts$/
const SERVICE_LIVE_SUFFIX = 'ServiceLive'
const PORT_LIVE_SUFFIX = 'PortLive'

const toPascalCase = (kebab) =>
  kebab
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')

const toKebabCase = (pascal) =>
  pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()

// ── enforce-shadcn-button ─────────────────────────────────────────────────
// In apps/web, raw <button> elements must not be used. Use the shadcn
// <Button> component from '@/components/ui/button' for consistent height,
// styling, and accessibility.

const SHADCN_BUTTON_MESSAGE =
  "Use the shadcn <Button> component from '@/components/ui/button' instead of raw <button>. " +
  'This ensures consistent height, styling, and accessibility.'

const createEnforceShadcnButtonRule = (context) => {
  const filePath = toPosix(context.filename)

  // Allow raw <button> in UI primitive files (they define the component itself)
  if (/\/components\/ui\//u.test(filePath)) {
    return {}
  }

  return {
    JSXOpeningElement(node) {
      if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'button') {
        return
      }

      context.report({
        node,
        message: SHADCN_BUTTON_MESSAGE
      })
    }
  }
}

// ── enforce-api-error-message ─────────────────────────────────────────────
// In apps/web catch handlers, error.message (or error_.message, err.message)
// must not be accessed directly. Use getApiErrorMessage(error, 'fallback')
// from @/lib/axios instead, which safely extracts API error messages.

const createEnforceApiErrorMessageRule = (context) => {
  const sourceCode = context.sourceCode ?? context.getSourceCode()
  const errorAwareCallbacks = new WeakMap()
  const errorAwareCatchClauses = new WeakMap()

  /**
   * Extract all binding names from a catch parameter pattern.
   * Handles Identifier, ObjectPattern (destructuring), ArrayPattern, etc.
   */
  const collectBindingNames = (param, names = []) => {
    if (!param) return names
    if (param.type === 'Identifier') {
      names.push(param.name)
    } else if (param.type === 'ObjectPattern') {
      for (const prop of param.properties) {
        collectBindingNames(prop.value ?? prop.argument, names)
      }
    } else if (param.type === 'ArrayPattern') {
      for (const element of param.elements) {
        if (element) collectBindingNames(element, names)
      }
    } else if (param.type === 'AssignmentPattern') {
      collectBindingNames(param.left, names)
    }

    return names
  }

  const registerErrorAwareCallback = (node) => {
    if (
      (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression')
      || node.params.length === 0
    ) {
      return
    }

    const bindingNames = collectBindingNames(node.params[0])
    if (bindingNames.length > 0) {
      errorAwareCallbacks.set(node, bindingNames)
    }
  }

  const getActiveErrorParamNames = (node) => {
    const ancestors = sourceCode.getAncestors(node)
    for (let index = ancestors.length - 1; index >= 0; index--) {
      const ancestor = ancestors[index]

      if (ancestor.type === 'ArrowFunctionExpression' || ancestor.type === 'FunctionExpression') {
        return errorAwareCallbacks.get(ancestor) ?? []
      }

      if (ancestor.type === 'CatchClause') {
        return errorAwareCatchClauses.get(ancestor) ?? []
      }
    }

    return []
  }

  const isNotifyErrorCall = (node) =>
    node.callee.type === 'MemberExpression'
    && !node.callee.computed
    && node.callee.object.type === 'Identifier'
    && node.callee.object.name === 'notify'
    && node.callee.property.type === 'Identifier'
    && node.callee.property.name === 'error'

  const NOTIFY_ERROR_MESSAGE =
    'When an error object is available in apps/web catch/onError handlers, use ' +
    "`notify.apiError(error, 'Fallback message')` instead of `notify.error(...)`. " +
    'This preserves API response messages consistently.'

  const isOnErrorProperty = (node) =>
    node.type === 'Property'
    && !node.computed
    && (
      (node.key.type === 'Identifier' && node.key.name === 'onError')
      || (node.key.type === 'Literal' && node.key.value === 'onError')
    )

  const hasActiveErrorIdentifier = (node) =>
    node.type === 'Identifier' && getActiveErrorParamNames(node).includes(node.name)

  const getMemberExpressionPropertyName = (node) => {
    if (node.computed) {
      return null
    }

    return node.property.type === 'Identifier' ? node.property.name : null
  }

  const ERROR_MESSAGE =
    'Do not access `.message` directly on catch parameters in apps/web. ' +
    'Use `getApiErrorMessage(error, \'Fallback message\')` from `@/lib/axios` instead. ' +
    'This safely extracts API error messages including Axios error responses.'

  return {
    CatchClause(node) {
      const bindingNames = collectBindingNames(node.param)
      if (bindingNames.length > 0) {
        errorAwareCatchClauses.set(node, bindingNames)
      }
    },

    Property(node) {
      if (isOnErrorProperty(node)) {
        registerErrorAwareCallback(node.value)
      }
    },

    'CallExpression[callee.property.name="catch"]'(node) {
      if (
        node.callee.type === 'MemberExpression' &&
        node.arguments.length > 0
      ) {
        registerErrorAwareCallback(node.arguments[0])
      }
    },

    MemberExpression(node) {
      if (getMemberExpressionPropertyName(node) === 'message' && hasActiveErrorIdentifier(node.object)) {
        context.report({ node, message: ERROR_MESSAGE })
      }
    },

    CallExpression(node) {
      if (isNotifyErrorCall(node) && getActiveErrorParamNames(node).length > 0) {
        context.report({ node, message: NOTIFY_ERROR_MESSAGE })
      }
    }
  }
}

const createEnforceServiceNamingRule = (context) => {
  const filename = toPosix(context.filename ?? context.getFilename())
  const inDomains = filename.includes('/domains/')
  if (!inDomains) return {}

  const layer = inferLayerFromPath(filename)

  return {
    // Match: export class FooService extends Context.Tag('FooService')<...>() {}
    ClassDeclaration(node) {
      if (!node.id || !node.superClass) return

      // Check it's Context.Tag('...')
      const superExpr = node.superClass
      if (superExpr.type !== 'CallExpression') return

      let callee = superExpr.callee
      // Handle: Context.Tag('X')<X, T>() — the outer CallExpression
      // The AST for `class X extends Context.Tag('Y')<X, T>() {}` is:
      //   superClass = CallExpression(callee=CallExpression(callee=MemberExpr(Context.Tag), args=['Y']))
      // Actually let me check both patterns

      let tagCallNode = null

      // Pattern 1: class X extends Context.Tag('X')<X, T>() {}
      // superClass is CallExpression whose callee is another CallExpression
      if (callee.type === 'CallExpression') {
        const innerCallee = callee.callee
        if (
          innerCallee.type === 'MemberExpression' &&
          innerCallee.object.type === 'Identifier' &&
          innerCallee.object.name === 'Context' &&
          innerCallee.property.type === 'Identifier' &&
          innerCallee.property.name === 'Tag'
        ) {
          tagCallNode = callee
        }
      }

      // Pattern 2: class X extends Context.Tag('X') {}
      if (
        !tagCallNode &&
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'Context' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'Tag'
      ) {
        tagCallNode = superExpr
      }

      if (!tagCallNode) return

      const className = node.id.name

      // Extract tag string from Context.Tag('...')
      const tagArg = tagCallNode.arguments?.[0]
      const tagString =
        tagArg && tagArg.type === 'Literal' && typeof tagArg.value === 'string'
          ? tagArg.value
          : null

      // Rule 1: Tag string must match class name
      if (tagString && tagString !== className) {
        context.report({
          node: tagArg,
          message: `Context.Tag string '${tagString}' must match class name '${className}'.`
        })
      }

      // Rule 2: Class name must end with Service, Port, or Middleware
      const isService = className.endsWith(SERVICE_SUFFIX) && !className.endsWith(PORT_SUFFIX)
      const isPort = className.endsWith(PORT_SUFFIX)
      const isMiddleware = className.endsWith('Middleware')

      if (!isService && !isPort && !isMiddleware) {
        context.report({
          node: node.id,
          message: `Context.Tag class '${className}' must end with 'Service', 'Port', or 'Middleware'. ` +
            `Use [Entity]Service for application services or [Purpose]Port for port contracts.`
        })
        return
      }

      // Middleware is allowed — skip further file-naming checks
      if (isMiddleware) return

      // Rule 3: Services should be in application/, ports in ports/
      if (isService && layer === 'ports') {
        context.report({
          node: node.id,
          message: `Service '${className}' should be defined in the application/ layer, not ports/.`
        })
      }

      if (isPort && layer === 'application') {
        // Ports defined in application/ is a warning — they should be in ports/
        // But some codebases allow this, so just flag it
        context.report({
          node: node.id,
          message: `Port '${className}' should be defined in the ports/ layer, not application/.`
        })
      }

      // Rule 4: File naming must match — service files end with -service.ts
      if (isService && !SERVICE_FILE_PATTERN.test(filename)) {
        context.report({
          node: node.id,
          message: `Service '${className}' must be in a file ending with '-service.ts'. ` +
            `Current file: ${filename.split('/').pop()}`
        })
      }

      // Rule 5: Port files should end with -ports.ts
      if (isPort && !PORT_FILE_PATTERN.test(filename) && layer === 'ports') {
        context.report({
          node: node.id,
          message: `Port '${className}' should be in a file ending with '-ports.ts'. ` +
            `Current file: ${filename.split('/').pop()}`
        })
      }
    },

    // Match: export const FooServiceLive = Layer.effect(...)
    VariableDeclarator(node) {
      if (!node.id || node.id.type !== 'Identifier') return
      const varName = node.id.name

      const isServiceLive = varName.endsWith(SERVICE_LIVE_SUFFIX)
      const isPortLive = varName.endsWith(PORT_LIVE_SUFFIX)

      if (!isServiceLive && !isPortLive) return

      // The expected service/port name is the var name without 'Live'
      const expectedClassName = varName.slice(0, -4) // remove 'Live'

      // Check the Layer.effect first arg references the correct service/port
      if (
        node.init &&
        node.init.type === 'CallExpression' &&
        node.init.callee.type === 'MemberExpression' &&
        node.init.callee.object.type === 'Identifier' &&
        node.init.callee.object.name === 'Layer' &&
        node.init.arguments.length >= 1
      ) {
        const firstArg = node.init.arguments[0]
        if (firstArg.type === 'Identifier' && firstArg.name !== expectedClassName) {
          context.report({
            node: firstArg,
            message: `Layer implementation '${varName}' should provide '${expectedClassName}', ` +
              `but provides '${firstArg.name}'.`
          })
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rule: enforce-auth-principal-usage
// Flags `yield* requireAuth` in route handlers where the result is discarded
// (not assigned to a variable). Discarding the principal prevents authorization
// checks — the most common security bug pattern in this codebase.
// ---------------------------------------------------------------------------
const createEnforceAuthPrincipalUsageRule = (context) => {
  const filename = context.filename || context.getFilename()
  // Only applies to route handler files
  if (!filename.includes('apps/api/src/routes/')) {
    return {}
  }

  return {
    YieldExpression(node) {
      // Check if the yield argument is `requireAuth`
      const arg = node.argument
      if (!arg || arg.type !== 'Identifier' || arg.name !== 'requireAuth') {
        return
      }

      // If the parent is an ExpressionStatement, the result is discarded
      if (node.parent && node.parent.type === 'ExpressionStatement') {
        context.report({
          node,
          message:
            'requireAuth result must be assigned to a variable ' +
            '(e.g., `const principal = yield* requireAuth`). ' +
            'Discarding the principal prevents authorization checks.'
        })
      }
    }
  }
}

// ── enforce-domain-extends-row-shape ─────────────────────────────────
// Domain files (domains/*/domain/*.ts) must not contain standalone
// exported interfaces or exported object-literal type aliases.
//
// 1. *Record types must import from @tx-agent-kit/db and use extends/alias.
// 2. ALL other exported interfaces without `extends` are flagged, UNLESS
//    their name contains a known DTO suffix (Command, Input, Options,
//    Context, Config, Params, Result, Event, Payload).
// 3. Exported `type X = { ... }` (object literal) is treated the same as
//    an interface. Plain type aliases (`type X = SomeOtherType`) are fine.

const DTO_SUFFIX_PATTERN = /(?:Command|Input|Options|Context|Config|Params|Result|Event|Payload|Summary|Settings|Session|Principal|Aggregate|View|Dashboard)/u
// Utility type prefixes that legitimately need recursive interface definitions
const UTILITY_PREFIX_PATTERN = /^Json/u

const createEnforceDomainExtendsRowShapeRule = (context) => {
  const sourceFilePath = toPosix(context.filename)
  if (!isDomainSourceFile(sourceFilePath)) {
    return {}
  }

  let hasDbTypeImport = false
  const recordDeclarations = []
  const standaloneDeclarations = []

  return {
    ImportDeclaration(node) {
      const importPath = typeof node.source.value === 'string' ? node.source.value : ''
      if (/^@tx-agent-kit\/db(?:\/|$)/u.test(importPath)) {
        hasDbTypeImport = true
      }
    },

    ExportNamedDeclaration(node) {
      if (!node.declaration) {
        return
      }

      const name = node.declaration.id?.name

      // export interface Foo { ... }
      if (node.declaration.type === 'TSInterfaceDeclaration' && name) {
        if (name.endsWith('Record')) {
          recordDeclarations.push(node.declaration)
        } else {
          standaloneDeclarations.push(node.declaration)
        }
        return
      }

      // export type Foo = ...
      if (node.declaration.type === 'TSTypeAliasDeclaration' && name) {
        if (name.endsWith('Record')) {
          recordDeclarations.push(node.declaration)
        } else {
          standaloneDeclarations.push(node.declaration)
        }
      }
    },

    'Program:exit'() {
      // ── Record declarations: must import from @tx-agent-kit/db ──
      if (recordDeclarations.length > 0) {
        if (!hasDbTypeImport) {
          for (const decl of recordDeclarations) {
            context.report({
              node: decl,
              message:
                `Domain record \`${decl.id?.name}\` must extend or alias a row shape from \`@tx-agent-kit/db\`. ` +
                'Import the row shape type and use `extends`, `Omit`, `Pick`, or a type alias.'
            })
          }
        } else {
          // Per-declaration check: each interface *Record must have extends clause
          for (const decl of recordDeclarations) {
            if (decl.type === 'TSInterfaceDeclaration') {
              const hasExtends = decl.extends && decl.extends.length > 0
              if (!hasExtends) {
                context.report({
                  node: decl,
                  message:
                    `Standalone \`interface ${decl.id?.name}\` is not allowed in domain files. ` +
                    'Use `interface ${name} extends Omit<XRowShape, ...>` or `type ${name} = XRowShape` ' +
                    'to inherit DB columns automatically. Standalone interfaces cause field-sync drift.'
                })
              }
            }
            // type aliases (type X = ...) are always ok — they must reference something
          }
        }
      }

      // ── Non-Record declarations: flag standalone interfaces / object-literal types ──
      for (const decl of standaloneDeclarations) {
        const name = decl.id?.name ?? ''

        // Skip known DTO suffixes (Command, Input, Options, etc.)
        if (DTO_SUFFIX_PATTERN.test(name)) {
          continue
        }

        // Skip utility type prefixes (Json*, etc.) that need recursive definitions
        if (UTILITY_PREFIX_PATTERN.test(name)) {
          continue
        }

        if (decl.type === 'TSInterfaceDeclaration') {
          const hasExtends = decl.extends && decl.extends.length > 0
          if (!hasExtends) {
            context.report({
              node: decl,
              message:
                `Standalone \`interface ${name}\` is not allowed in domain files. ` +
                'Either extend a row shape / base type, use a type alias (`type ${name} = SomeType`), ' +
                'or add a DTO suffix (Command, Input, Options, Context, Config, Params, Result, Event, Payload).'
            })
          }
        } else if (decl.type === 'TSTypeAliasDeclaration') {
          // Flag `export type X = { ... }` (object literal), allow `export type X = SomeType`
          const annotation = decl.typeAnnotation
          if (annotation && annotation.type === 'TSTypeLiteral') {
            context.report({
              node: decl,
              message:
                `Standalone object-literal type \`${name}\` is not allowed in domain files. ` +
                'Either alias a row shape / base type, use `Omit`/`Pick`, ' +
                'or add a DTO suffix (Command, Input, Options, Context, Config, Params, Result, Event, Payload).'
            })
          }
        }
      }
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
    'json-columns-require-explicit-drizzle-type': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Requires Drizzle JSON/JSONB columns to call `.$type<...>()` with strong payload typing.'
        },
        schema: []
      },
      create: createJsonColumnsRequireExplicitDrizzleTypeRule
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
    },
    'enforce-domain-extends-row-shape': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Domain record types ending with `Record` should extend or alias row shape types from `@tx-agent-kit/db`.'
        },
        schema: []
      },
      create: createEnforceDomainExtendsRowShapeRule
    },
    'enforce-financial-audit-immutability': {
      meta: {
        type: 'problem',
        docs: {
          description:
            '[INV-BILLING-001/002] Prevents .update() and .delete() calls on financial audit trail tables (credit_ledger, usage_records). These are append-only and protected by DB triggers.'
        },
        schema: []
      },
      create: createEnforceFinancialAuditImmutabilityRule
    },
    'enforce-tenant-scope': {
      meta: {
        type: 'problem',
        docs: {
          description:
            '[INV-TEN-004] Ensures Drizzle queries on tenant-scoped tables include teamId or organizationId in .where() conditions.'
        },
        schema: []
      },
      create: createEnforceTenantScopeRule
    },
    'no-swallowed-errors': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Catch handlers in Effect.tryPromise and Effect.mapError must reference the original error parameter. Swallowing errors makes debugging impossible — original errors must flow through to logs/Spotlight.'
        },
        schema: []
      },
      create: createNoSwallowedErrorsRule
    },
    'enforce-service-naming': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Enforces naming conventions for Effect Context.Tag services and ports. ' +
            'Services must be named [Entity]Service, ports must be named [Purpose]Port. ' +
            'The tag string must match the class name. Files must follow kebab-case naming.'
        },
        schema: []
      },
      create: createEnforceServiceNamingRule
    },
    'enforce-api-error-message': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Catch handlers in apps/web must use getApiErrorMessage() from @/lib/axios instead of accessing .message directly on error objects. ' +
            'This ensures consistent API error extraction including Axios response bodies.'
        },
        schema: []
      },
      create: createEnforceApiErrorMessageRule
    },
    'enforce-shadcn-button': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Disallows raw <button> elements in apps/web. ' +
            'Use the shadcn <Button> component for consistent height, styling, and accessibility.'
        },
        schema: []
      },
      create: createEnforceShadcnButtonRule
    },
    'enforce-auth-principal-usage': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Ensures requireAuth result is assigned to a variable in route handlers. ' +
            'Discarding the principal prevents authorization checks.'
        },
        schema: []
      },
      create: createEnforceAuthPrincipalUsageRule
    },
    'prefer-effect-foreach-in-gen': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Prefer Effect.forEach over for...of loops inside Effect.gen generators. ' +
            'Effect.forEach provides structured concurrency, explicit error handling, ' +
            'and follows the Effect idiom.'
        },
        schema: []
      },
      create(context) {
        return {
          ForOfStatement(node) {
            let parent = node.parent
            while (parent) {
              if (
                parent.type === 'FunctionExpression' &&
                parent.generator === true
              ) {
                const grandparent = parent.parent
                if (
                  grandparent &&
                  grandparent.type === 'CallExpression' &&
                  grandparent.callee &&
                  grandparent.callee.type === 'MemberExpression' &&
                  grandparent.callee.property &&
                  grandparent.callee.property.name === 'gen'
                ) {
                  context.report({
                    node,
                    message:
                      'Use `Effect.forEach(items, (item) => ..., { concurrency: 1 })` instead of `for...of` inside `Effect.gen`. ' +
                      'Effect.forEach provides structured concurrency and follows the Effect idiom.'
                  })
                }
                break
              }
              parent = parent.parent
            }
          }
        }
      }
    },
    'no-api-layer-adapters': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Port adapter layers that import internal infra packages (@tx-agent-kit/db, ' +
            '@tx-agent-kit/storage) must live in packages/core, not in apps/api. ' +
            'External service adapters (Stripe, Google OIDC, email) may remain in apps/api.'
        },
        schema: []
      },
      create(context) {
        const filename = toPosix(context.filename ?? context.getFilename())
        if (!filename.includes('apps/api/src/adapters/')) {
          return {}
        }
        const internalInfraPackages = ['@tx-agent-kit/db', '@tx-agent-kit/storage']
        let importsInternalInfra = false
        return {
          ImportDeclaration(node) {
            if (internalInfraPackages.some((pkg) => node.source.value.startsWith(pkg))) {
              importsInternalInfra = true
            }
          },
          'Program:exit'(node) {
            if (!importsInternalInfra) {
              return
            }
            context.report({
              node,
              message:
                'This adapter imports internal infra packages (@tx-agent-kit/db or @tx-agent-kit/storage). ' +
                'Port adapters wrapping internal infra must be defined in `packages/core/src/domains/*/adapters/`, ' +
                'not in `apps/api/src/adapters/`. Move the Layer to core and export from `@tx-agent-kit/core`.'
            })
          }
        }
      }
    },
    'enforce-core-error-factories': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Forbids `new CoreError(` in application and adapter code. ' +
            'Use factory functions (badRequest, notFound, unauthorized, conflict, internalError) instead.'
        },
        schema: []
      },
      create(context) {
        return {
          NewExpression(node) {
            if (
              node.callee.type === 'Identifier' &&
              node.callee.name === 'CoreError'
            ) {
              context.report({
                node,
                message:
                  'Use error factory functions (badRequest, notFound, unauthorized, conflict, internalError) ' +
                  'instead of `new CoreError(...)`. Factories ensure consistent error codes.'
              })
            }
          }
        }
      }
    },
    'extract-test-fixture-setup': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Flags direct createDbAuthContext calls in integration test files when createTestFixture is not also used. ' +
            'Use createTestFixture from test-helpers.ts to reduce boilerplate.'
        },
        schema: []
      },
      create(context) {
        const filename = toPosix(context.filename ?? context.getFilename())
        if (!filename.includes('.integration.test.')) {
          return {}
        }
        let hasCreateDbAuthContext = false
        let createDbAuthContextNode = null
        let hasCreateTestFixture = false

        return {
          ImportDeclaration(node) {
            if (typeof node.source.value !== 'string') {
              return
            }
            for (const specifier of node.specifiers) {
              if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') {
                continue
              }
              if (specifier.imported.name === 'createDbAuthContext') {
                hasCreateDbAuthContext = true
                createDbAuthContextNode = specifier
              }
              if (specifier.imported.name === 'createTestFixture') {
                hasCreateTestFixture = true
              }
            }
          },
          'Program:exit'() {
            if (hasCreateDbAuthContext && !hasCreateTestFixture && createDbAuthContextNode) {
              context.report({
                node: createDbAuthContextNode,
                message:
                  'Use createTestFixture from test-helpers.ts instead of direct createDbAuthContext setup.'
              })
            }
          }
        }
      }
    },
    'require-auth-middleware-in-routes': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Route files using domain services must import and use auth middleware ' +
            '(requireAuth, TeamAuthMiddleware, or OrgAuthMiddleware).'
        },
        schema: []
      },
      create(context) {
        const filename = toPosix(context.filename ?? context.getFilename())
        if (!filename.includes('apps/api/src/routes/')) {
          return {}
        }
        if (/\.(test|spec)\./u.test(filename) || /\/test-/u.test(filename)) {
          return {}
        }
        // Public routes (webhooks, token-verified unsubscribe) authenticate via
        // HMAC signatures or signed tokens, not user session middleware.
        if (/\/email-webhooks\.ts$/u.test(filename) || /\/email-unsubscribe\.ts$/u.test(filename)) {
          return {}
        }

        const domainServicePattern = /Service$/
        let importsDomainService = false
        let importsAuthMechanism = false

        return {
          ImportDeclaration(node) {
            const importPath = typeof node.source.value === 'string' ? node.source.value : ''

            for (const specifier of node.specifiers) {
              if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') {
                continue
              }
              const name = specifier.imported.name
              if (domainServicePattern.test(name)) {
                importsDomainService = true
              }
              if (
                name === 'TeamAuthMiddleware' ||
                name === 'OrgAuthMiddleware' ||
                name === 'requireAuth' ||
                name === 'requireTeamAuth' ||
                name === 'requireTeamPermission' ||
                name === 'requireOrgAuth'
              ) {
                importsAuthMechanism = true
              }
            }

            if (
              importPath.includes('TeamAuthMiddleware') ||
              importPath.includes('OrgAuthMiddleware') ||
              importPath.includes('team-auth') ||
              importPath.includes('org-auth') ||
              importPath.includes('auth-helpers')
            ) {
              importsAuthMechanism = true
            }
          },

          'Program:exit'(node) {
            if (importsDomainService && !importsAuthMechanism) {
              context.report({
                node,
                message:
                  'Route files using domain services must import and use auth middleware (requireAuth, TeamAuthMiddleware, or OrgAuthMiddleware).'
              })
            }
          }
        }
      }
    },
    'no-hardcoded-test-ports': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Flags hardcoded port numbers (4100-4199) in integration test files. ' +
            'Use the shared integration server via INTEGRATION_API_PORT env var instead.'
        },
        schema: []
      },
      create(context) {
        const filename = toPosix(context.filename ?? context.getFilename())
        if (!filename.includes('.integration.test.')) {
          return {}
        }
        return {
          Literal(node) {
            if (typeof node.value !== 'number') {
              return
            }
            if (node.value >= 4100 && node.value <= 4199) {
              context.report({
                node,
                message:
                  'Use the shared integration server via INTEGRATION_API_PORT env var instead of hardcoded port numbers.'
              })
            }
          }
        }
      }
    },
    'enforce-auth-helper-usage': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Route handlers must use requireTeamAuth/requireOrgAuth helpers ' +
            'instead of accessing TeamAuthMiddleware/OrgAuthMiddleware directly.'
        },
        schema: []
      },
      create(context) {
        const filename = toPosix(context.filename ?? context.getFilename())
        if (!filename.includes('apps/api/src/routes/')) {
          return {}
        }
        if (/\.(test|spec)\./u.test(filename) || /\/test-/u.test(filename)) {
          return {}
        }

        const directMiddlewareNames = new Set(['TeamAuthMiddleware', 'OrgAuthMiddleware'])

        return {
          'YieldExpression > Identifier'(node) {
            if (directMiddlewareNames.has(node.name)) {
              context.report({
                node,
                message:
                  'Use requireTeamAuth/requireOrgAuth from auth-helpers.ts instead of direct middleware access in route handlers.'
              })
            }
          },
          'YieldExpression > MemberExpression'(node) {
            if (
              node.property.type === 'Identifier' &&
              directMiddlewareNames.has(node.property.name)
            ) {
              context.report({
                node,
                message:
                  'Use requireTeamAuth/requireOrgAuth from auth-helpers.ts instead of direct middleware access in route handlers.'
              })
            }
          }
        }
      }
    },

    'no-todo-comments': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallows TODO/FIXME/HACK comments. Fix the underlying issue instead of deferring it.'
        },
        schema: []
      },
      create(context) {
        const terms = ['todo', 'fixme', 'hack']
        const pattern = new RegExp(`\\b(${terms.join('|')})\\b`, 'i')

        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const match = pattern.exec(comment.value)
              if (match) {
                context.report({
                  loc: comment.loc,
                  message:
                    `Found '${match[1].toUpperCase()}' comment. ` +
                    'Do not defer work with TODO/FIXME/HACK comments — fix the root cause now. ' +
                    'If the fix requires a design decision, raise it with the user instead of leaving a placeholder. ' +
                    'If the code is intentionally skipped (e.g. it.skip), explain why in the skip reason, not a TODO.'
                })
              }
            }
          }
        }
      }
    }
  }
}
