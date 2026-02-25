import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { Client } from 'pg'

export interface ResetTestDbRunResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export const defaultResetTestDatabaseUrl =
  'postgres://postgres:postgres@localhost:5432/tx_agent_kit'

const repoRoot = resolve(import.meta.dirname, '../../..')
const resetTestDbScriptPath = resolve(repoRoot, 'scripts/test/reset-test-db.sh')

export const runResetTestDb = (env: NodeJS.ProcessEnv): ResetTestDbRunResult => {
  const result = spawnSync('bash', [resetTestDbScriptPath], {
    cwd: repoRoot,
    env,
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

export const queryScalarCount = async (
  databaseUrl: string,
  sql: string
): Promise<number> => {
  const client = new Client({
    connectionString: databaseUrl
  })

  await client.connect()
  try {
    const result = await client.query<{ count: string }>(sql)
    const countValue = result.rows[0]?.count ?? '0'
    return Number.parseInt(countValue, 10)
  } finally {
    await client.end()
  }
}

export const insertScratchUser = async (databaseUrl: string, userId: string): Promise<void> => {
  const client = new Client({
    connectionString: databaseUrl
  })

  await client.connect()
  try {
    await client.query(
      `
        INSERT INTO users (id, email, password_hash, name)
        VALUES ($1, $2, 'integration-hash', 'Reset Test User')
      `,
      [userId, `reset-test-${userId}@example.com`]
    )
  } finally {
    await client.end()
  }
}
