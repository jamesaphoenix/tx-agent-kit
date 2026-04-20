import { existsSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import {
  listFilesRecursively,
  readUtf8,
  repoRoot,
  toPosix
} from './utils.mjs'

export const enforceWebApiGenerationContracts = (errors) => {
  const requiredFiles = [
    resolve(repoRoot, 'apps/web/orval.config.ts'),
    resolve(repoRoot, 'apps/web/lib/api/orval-mutator.ts'),
    resolve(repoRoot, 'apps/api/openapi.json')
  ]

  for (const filePath of requiredFiles) {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      errors.push(`Missing required API client generation artifact: \`${toPosix(relative(repoRoot, filePath))}\`.`)
    }
  }

  const generatedRoot = resolve(repoRoot, 'apps/web/lib/api/generated')
  if (!existsSync(generatedRoot) || !statSync(generatedRoot).isDirectory()) {
    errors.push('Missing `apps/web/lib/api/generated` directory. Run `pnpm api:client:generate`.')
  } else {
    const generatedFiles = listFilesRecursively(generatedRoot).filter((filePath) =>
      /\.(ts|tsx)$/u.test(filePath)
    )

    if (generatedFiles.length === 0) {
      errors.push('Generated API client directory is empty. Run `pnpm api:client:generate`.')
    }
  }

  const rootPackageJsonPath = resolve(repoRoot, 'package.json')
  if (!existsSync(rootPackageJsonPath) || !statSync(rootPackageJsonPath).isFile()) {
    errors.push('Missing repository `package.json` for API client generation command checks.')
    return
  }

  const rootPackageJson = JSON.parse(readUtf8(rootPackageJsonPath))
  const scripts = rootPackageJson.scripts
  if (!scripts || typeof scripts !== 'object') {
    errors.push('Root `package.json` is missing `scripts` for API client generation checks.')
    return
  }

  if (typeof scripts['api:client:generate'] !== 'string') {
    errors.push('Missing root script `api:client:generate`. Add command to regenerate OpenAPI + web API client.')
  }

  const webPackageJsonPath = resolve(repoRoot, 'apps/web/package.json')
  if (!existsSync(webPackageJsonPath) || !statSync(webPackageJsonPath).isFile()) {
    errors.push('Missing `apps/web/package.json` for API generation checks.')
    return
  }

  const webPackageJson = JSON.parse(readUtf8(webPackageJsonPath))
  const webScripts = webPackageJson.scripts
  if (!webScripts || typeof webScripts !== 'object' || typeof webScripts['generate:api'] !== 'string') {
    errors.push('Missing `apps/web` script `generate:api` for Orval generation.')
  }
}
