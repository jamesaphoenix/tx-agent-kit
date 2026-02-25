#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
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
    const fullPath = resolve(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(fullPath))
      continue
    }

    files.push(fullPath)
  }

  return files
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

      if (normalized.includes('/apps/docs/.source/') || normalized.startsWith('apps/docs/.source/')) {
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

    if (normalized.includes('/apps/docs/.source/') || normalized.startsWith('apps/docs/.source/')) {
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

enforceWebClientOnlyContracts()

if (errors.length > 0) {
  console.error('Web client contract check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Web client contract check passed.')
