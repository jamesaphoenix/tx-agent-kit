#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const errors = []

const toPosix = (value) => value.split(sep).join('/')
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
    organizations: 'organization'
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

enforceRouteRepositoryKindContracts()

if (errors.length > 0) {
  console.error('Route/repository kind contract check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Route/repository kind contract check passed.')
