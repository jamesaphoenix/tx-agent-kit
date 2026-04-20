import { existsSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import {
  readUtf8,
  repoRoot,
  toPosix
} from './utils.mjs'

export const enforceDbRepositoryDecodeContracts = (errors) => {
  const repositoriesDir = resolve(repoRoot, 'packages/infra/db/src/repositories')
  if (!existsSync(repositoriesDir) || !statSync(repositoriesDir).isDirectory()) {
    errors.push('Missing `packages/infra/db/src/repositories` directory.')
    return
  }

  const repositoryFiles = readdirSync(repositoriesDir)
    .filter((fileName) => fileName.endsWith('.ts'))
    .map((fileName) => resolve(repositoriesDir, fileName))

  for (const filePath of repositoryFiles) {
    const source = readUtf8(filePath)
    const relativePath = toPosix(relative(repoRoot, filePath))
    const isRepositoryImplementation = /export const [A-Za-z0-9_]+Repository\s*=/.test(source)

    if (!isRepositoryImplementation) {
      continue
    }

    if (!/from\s+['"]\.\.\/effect-schemas\//.test(source)) {
      errors.push(`DB repository must import matching Effect schema decoder(s): \`${relativePath}\`.`)
    }

    if (!/(Schema\.decodeUnknown|decode[A-Za-z0-9_]+)/.test(source)) {
      errors.push(`DB repository must decode DB row results via Effect schema: \`${relativePath}\`.`)
    }

    if (!/provideDB\(/.test(source) && !/withDb\(/.test(source)) {
      errors.push(`DB repository must execute queries through Effect DB provider: \`${relativePath}\`.`)
    }

    if (/\.then\(/.test(source)) {
      errors.push(`DB repository should use Effect workflow instead of Promise chaining: \`${relativePath}\`.`)
    }
  }
}
