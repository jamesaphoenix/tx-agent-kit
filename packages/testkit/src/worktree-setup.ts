import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTestkitProcessEnv } from './env.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const worktreeSetupScriptPath = resolve(repoRoot, 'scripts/worktree/setup.sh')

export const defaultWorktreeSetupDatabaseUrl =
  'postgresql://postgres:postgres@localhost:5432/tx_agent_kit'

export interface WorktreeSetupResult {
  readonly path: string
  readonly envValues: Readonly<Record<string, string>>
}

export const parseEnvValues = (contents: string): Record<string, string> => {
  const values: Record<string, string> = {}

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }

    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) {
      continue
    }

    const key = line.slice(0, equalsIndex).trim()
    const value = line.slice(equalsIndex + 1).trim()
    values[key] = value
  }

  return values
}

export const runWorktreeSetup = (
  worktreeName: string,
  tempRootPath: string,
  databaseUrl: string
): WorktreeSetupResult => {
  const worktreePath = resolve(tempRootPath, worktreeName)
  mkdirSync(worktreePath, { recursive: true })

  execFileSync('bash', [worktreeSetupScriptPath, worktreePath], {
    cwd: repoRoot,
    env: {
      ...getTestkitProcessEnv(),
      DATABASE_URL: databaseUrl
    },
    stdio: 'pipe'
  })

  const envContents = readFileSync(resolve(worktreePath, '.env'), 'utf8')
  return {
    path: worktreePath,
    envValues: parseEnvValues(envContents)
  }
}
