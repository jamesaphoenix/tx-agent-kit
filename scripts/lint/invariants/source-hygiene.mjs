import { existsSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

import {
  listFilesRecursively,
  readUtf8,
  repoRoot,
  toPosix
} from './utils.mjs'

export const enforceNoSuppressionDirectives = (errors) => {
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

      if (normalized.includes('/__tests__/') || /\.(integration\.)?test\.tsx?$/.test(normalized) || /\/test-[^/]+\.tsx?$/.test(normalized)) {
        return false
      }

      if (normalized.includes('/apps/docs/.source/') || normalized.startsWith('apps/docs/.source/')) {
        return false
      }

      if (normalized.includes('/lib/api/generated/')) {
        return false
      }

      if (normalized.includes('/tooling/eslint-config/')) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const source = readUtf8(sourceFile)
      if (!suppressionRegex.test(source)) {
        continue
      }

      errors.push(
        `Suppression directives are disallowed in source modules: \`${toPosix(relative(repoRoot, sourceFile))}\`. Fix root types/rules instead of suppressing.`
      )
    }
  }
}

export const enforceNoSourcePlaceholderComments = (errors) => {
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

      if (normalized.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/u.test(normalized) || /\/test-[^/]+\.tsx?$/u.test(normalized)) {
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
      if (!placeholderRegex.test(source)) {
        continue
      }

      errors.push(
        `Source placeholders (TODO/FIXME/HACK comments) are forbidden: \`${toPosix(relative(repoRoot, sourceFile))}\`.`
      )
    }
  }
}

export const enforceNoBuildArtifactsInSource = (errors) => {
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
      errors.push(
        [
          'Build artifacts are forbidden under source trees.',
          `Remove generated file: \`${toPosix(relative(repoRoot, generatedFile))}\`.`,
          'Use package `dist/` outputs for emitted JS/declarations.'
        ].join(' ')
      )
    }
  }
}

export const enforceNoDirectProcessEnvInSource = (errors) => {
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
    'packages/infra/auth/src/env.ts',
    'packages/infra/db/src/env.ts',
    'packages/infra/logging/src/env.ts',
    'packages/infra/observability/src/env.ts',
    'packages/infra/ai/src/env.ts',
    'packages/infra/email/src/env.ts',
    'packages/infra/storage/src/env.ts',
    'packages/testkit/src/env.ts',
    'packages/infra/db/src/seeds/seed-onboarding-drip.ts'
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

      if (normalized.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/u.test(normalized) || /\/test-[^/]+\.tsx?$/u.test(normalized)) {
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

      errors.push(
        [
          'Direct process.env access is forbidden in source modules.',
          `Move env reads into an allowed env module: \`${toPosix(relative(repoRoot, sourceFile))}\`.`
        ].join(' ')
      )
    }
  }
}

export const enforceSingleRootEnvFilePolicy = (errors) => {
  const allowedRootEnvFiles = new Set(['.env', '.env.example'])

  const rootEnvFiles = readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith('.env'))
    .map((entry) => entry.name)
    .sort()

  for (const fileName of rootEnvFiles) {
    if (!allowedRootEnvFiles.has(fileName)) {
      errors.push(
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
      errors.push(
        `Environment files must live only at repository root: found \`${toPosix(relative(repoRoot, filePath))}\`.`
      )
    }
  }
}
