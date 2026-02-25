import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getTestkitEnv, getTestkitProcessEnv } from './env.js'
import {
  defaultResetTestDatabaseUrl,
  insertScratchUser,
  queryScalarCount,
  runResetTestDb
} from './reset-test-db.js'

describe('reset-test-db integration', () => {
  it(
    'resets mutable tables and preserves baseline seed data idempotently',
    async () => {
      const databaseUrl =
        getTestkitEnv().DATABASE_URL ?? defaultResetTestDatabaseUrl

      await insertScratchUser(databaseUrl, randomUUID())
      const firstReset = runResetTestDb({
        ...getTestkitProcessEnv(),
        DATABASE_URL: databaseUrl
      })

      expect(firstReset.exitCode).toBe(0)
      expect(firstReset.stdout).toContain('Database reset complete.')

      const usersAfterFirstReset = await queryScalarCount(
        databaseUrl,
        'SELECT COUNT(*)::text AS count FROM users'
      )
      const rolesAfterFirstReset = await queryScalarCount(
        databaseUrl,
        'SELECT COUNT(*)::text AS count FROM roles'
      )
      const permissionsAfterFirstReset = await queryScalarCount(
        databaseUrl,
        'SELECT COUNT(*)::text AS count FROM permissions'
      )

      expect(usersAfterFirstReset).toBe(0)
      expect(rolesAfterFirstReset).toBeGreaterThanOrEqual(3)
      expect(permissionsAfterFirstReset).toBeGreaterThanOrEqual(4)

      await insertScratchUser(databaseUrl, randomUUID())
      const secondReset = runResetTestDb({
        ...getTestkitProcessEnv(),
        DATABASE_URL: databaseUrl
      })

      expect(secondReset.exitCode).toBe(0)
      expect(secondReset.stdout).toContain('Database reset complete.')

      const usersAfterSecondReset = await queryScalarCount(
        databaseUrl,
        'SELECT COUNT(*)::text AS count FROM users'
      )
      const rolesAfterSecondReset = await queryScalarCount(
        databaseUrl,
        'SELECT COUNT(*)::text AS count FROM roles'
      )
      const permissionsAfterSecondReset = await queryScalarCount(
        databaseUrl,
        'SELECT COUNT(*)::text AS count FROM permissions'
      )

      expect(usersAfterSecondReset).toBe(0)
      expect(rolesAfterSecondReset).toBe(rolesAfterFirstReset)
      expect(permissionsAfterSecondReset).toBe(permissionsAfterFirstReset)
    },
    180_000
  )

  it('refuses non-local database hosts', () => {
    const result = runResetTestDb({
      ...getTestkitProcessEnv(),
      TX_AGENT_SKIP_INFRA_ENSURE: '1',
      DATABASE_URL: 'postgres://postgres:postgres@db.internal:5432/tx_agent_kit'
    })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("Refusing to reset non-local DATABASE_URL host 'db.internal'.")
  })
})
