import { randomUUID } from 'node:crypto'
import { orgMemberRoles, permissionActions } from '@tx-agent-kit/contracts'
import { defaultRetentionSettings } from '@tx-agent-kit/db'
import { describe, expect, it } from 'vitest'
import { getTestkitEnv, getTestkitProcessEnv } from './env.js'
import {
  defaultResetTestDatabaseUrl,
  insertScratchUser,
  queryScalarCount,
  queryRows,
  queryScalarText,
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
      const systemSettingsAfterFirstReset = await queryScalarCount(
        databaseUrl,
        'SELECT COUNT(*)::text AS count FROM system_settings'
      )
      const retentionSettingsAfterFirstReset = await queryScalarText(
        databaseUrl,
        "SELECT value::text AS value FROM system_settings WHERE key = 'retention_settings'"
      )

      expect(usersAfterFirstReset).toBe(0)
      expect(rolesAfterFirstReset).toBe(orgMemberRoles.length)
      expect(permissionsAfterFirstReset).toBe(permissionActions.length)
      expect(systemSettingsAfterFirstReset).toBe(1)
      expect(JSON.parse(retentionSettingsAfterFirstReset ?? '{}')).toEqual(defaultRetentionSettings)

      await insertScratchUser(databaseUrl, randomUUID())
      const mutatedRetentionSettings = { auth_login_sessions: { enabled: false, retention_days: 1 } }
      await queryRows(
        databaseUrl,
        `
          UPDATE system_settings
          SET value = $1::jsonb
          WHERE key = 'retention_settings'
        `,
        [JSON.stringify(mutatedRetentionSettings)]
      )

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
      const systemSettingsAfterSecondReset = await queryScalarCount(
        databaseUrl,
        'SELECT COUNT(*)::text AS count FROM system_settings'
      )
      const retentionSettingsAfterSecondReset = await queryScalarText(
        databaseUrl,
        "SELECT value::text AS value FROM system_settings WHERE key = 'retention_settings'"
      )

      expect(usersAfterSecondReset).toBe(0)
      expect(rolesAfterSecondReset).toBe(rolesAfterFirstReset)
      expect(permissionsAfterSecondReset).toBe(permissionsAfterFirstReset)
      expect(systemSettingsAfterSecondReset).toBe(systemSettingsAfterFirstReset)
      expect(JSON.parse(retentionSettingsAfterSecondReset ?? '{}')).toEqual(defaultRetentionSettings)
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
