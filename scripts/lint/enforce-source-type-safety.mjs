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

      if (normalized.includes('/apps/docs/.source/') || normalized.startsWith('apps/docs/.source/')) {
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

      if (normalized.includes('/apps/docs/.source/') || normalized.startsWith('apps/docs/.source/')) {
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

      if (normalized.includes('/apps/docs/.source/') || normalized.startsWith('apps/docs/.source/')) {
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

const isSourceModule = (normalizedPath) => {
  if (!/\.(ts|tsx|js|mjs)$/u.test(normalizedPath)) {
    return false
  }

  if (normalizedPath.includes('/.next/') || normalizedPath.includes('/dist/') || normalizedPath.includes('/node_modules/')) {
    return false
  }

  if (normalizedPath.includes('/__tests__/') || normalizedPath.endsWith('.test.ts') || normalizedPath.endsWith('.test.tsx')) {
    return false
  }

  if (normalizedPath.includes('/apps/docs/.source/') || normalizedPath.startsWith('apps/docs/.source/')) {
    return false
  }

  if (normalizedPath.includes('/lib/api/generated/')) {
    return false
  }

  return true
}

const enforceNoRawPostgresUniqueCodeChecks = () => {
  const roots = [resolve(repoRoot, 'apps'), resolve(repoRoot, 'packages')]
  const postgresUniqueCodeRegex = /\b23505\b/u
  const allowedFiles = new Set(['packages/infra/db/src/errors.ts'])

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(filePath)
      return isSourceModule(normalized)
    })

    for (const sourceFile of sourceFiles) {
      const relativePath = toPosix(relative(repoRoot, sourceFile))
      if (allowedFiles.has(relativePath)) {
        continue
      }

      const source = readUtf8(sourceFile)
      if (!postgresUniqueCodeRegex.test(source)) {
        continue
      }

      fail(
        `Raw PostgreSQL unique-violation code checks (\`23505\`) are disallowed outside \`packages/infra/db/src/errors.ts\`: \`${relativePath}\`. Use centralized DB error classification helpers.`
      )
    }
  }
}

const enforceNoDirectPostgresErrorExtraction = () => {
  const roots = [resolve(repoRoot, 'apps'), resolve(repoRoot, 'packages')]
  const directExtractorCallRegex = /\bextractPostgresError\s*\(/u
  const allowedFiles = new Set(['packages/infra/db/src/errors.ts'])

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(filePath)
      return isSourceModule(normalized)
    })

    for (const sourceFile of sourceFiles) {
      const relativePath = toPosix(relative(repoRoot, sourceFile))
      if (allowedFiles.has(relativePath)) {
        continue
      }

      const source = readUtf8(sourceFile)
      if (!directExtractorCallRegex.test(source)) {
        continue
      }

      fail(
        `Direct PostgreSQL error extraction is centralized in \`packages/infra/db/src/errors.ts\`: \`${relativePath}\`. Use DB error classification outputs instead of calling \`extractPostgresError(...)\` in source modules.`
      )
    }
  }
}

const enforceNoGenericDbUniqueViolationBranching = () => {
  const roots = [resolve(repoRoot, 'apps'), resolve(repoRoot, 'packages')]
  const genericDbUniqueCodeRegex = /\bDB_UNIQUE_VIOLATION\b/u
  const allowedFiles = new Set(['packages/infra/db/src/errors.ts'])

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(filePath)
      return isSourceModule(normalized)
    })

    for (const sourceFile of sourceFiles) {
      const relativePath = toPosix(relative(repoRoot, sourceFile))
      if (allowedFiles.has(relativePath)) {
        continue
      }

      const source = readUtf8(sourceFile)
      if (!genericDbUniqueCodeRegex.test(source)) {
        continue
      }

      fail(
        `Generic DB unique-violation branching (\`DB_UNIQUE_VIOLATION\`) is disallowed outside \`packages/infra/db/src/errors.ts\`: \`${relativePath}\`. Use constraint-specific DB error codes mapped centrally.`
      )
    }
  }
}

enforceNoAnyTypeAssertions()
enforceNoEmptyCatchBlocks()
enforceNoChainedTypeAssertions()
enforceNoRawPostgresUniqueCodeChecks()
enforceNoDirectPostgresErrorExtraction()
enforceNoGenericDbUniqueViolationBranching()

if (errors.length > 0) {
  console.error('Source type-safety check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Source type-safety check passed.')
