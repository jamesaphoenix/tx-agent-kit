import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { getTestkitProcessEnv } from './env.js'

export interface IntegrationLockCommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const repoRoot = resolve(import.meta.dirname, '../../..')
const lockScriptPath = resolve(repoRoot, 'scripts/lib/lock.sh')

const shellQuote = (value: string): string => {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

export const runIntegrationLockBash = (
  scriptBody: string,
  envOverrides: Readonly<NodeJS.ProcessEnv> = {}
): IntegrationLockCommandResult => {
  const script = [
    'set -euo pipefail',
    `source ${shellQuote(lockScriptPath)}`,
    scriptBody
  ].join('\n')

  const result = spawnSync('bash', ['-c', script], {
    cwd: repoRoot,
    env: { ...getTestkitProcessEnv(), ...envOverrides },
    encoding: 'utf8'
  })

  if (result.error) {
    throw result.error
  }

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}
