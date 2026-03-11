import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createSqlTestContext } from './sql-context.js'

const firstSqlContext = createSqlTestContext({
  schemaPrefix: 'parallel-a'
})

const secondSqlContext = createSqlTestContext({
  schemaPrefix: 'parallel-b'
})

afterAll(async () => {
  await Promise.allSettled([
    firstSqlContext.teardown(),
    secondSqlContext.teardown()
  ])
})

describe('sql test context integration', () => {
  it('sets up isolated schemas in parallel without cross-schema interference', async () => {
    await Promise.all([
      firstSqlContext.setup(),
      secondSqlContext.setup()
    ])

    const firstEmail = `parallel-a-${randomUUID()}@example.com`
    const secondEmail = `parallel-b-${randomUUID()}@example.com`

    const [firstMigrationCount, secondMigrationCount] = await Promise.all([
      firstSqlContext.withSchemaClient(async (client) => {
        const migrations = await client.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM __tx_agent_migrations'
        )

        await client.query(
          `
            INSERT INTO users (email, password_hash, name)
            VALUES ($1, 'hash', 'Parallel A')
          `,
          [firstEmail]
        )

        const users = await client.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM users'
        )

        expect(users.rows[0]?.count).toBe('1')
        return migrations.rows[0]?.count ?? '0'
      }),
      secondSqlContext.withSchemaClient(async (client) => {
        const migrations = await client.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM __tx_agent_migrations'
        )

        await client.query(
          `
            INSERT INTO users (email, password_hash, name)
            VALUES ($1, 'hash', 'Parallel B')
          `,
          [secondEmail]
        )

        const users = await client.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM users'
        )

        expect(users.rows[0]?.count).toBe('1')
        return migrations.rows[0]?.count ?? '0'
      })
    ])

    expect(Number.parseInt(firstMigrationCount, 10)).toBeGreaterThan(0)
    expect(secondMigrationCount).toBe(firstMigrationCount)

    const [firstVisibleEmails, secondVisibleEmails] = await Promise.all([
      firstSqlContext.withSchemaClient(async (client) => {
        const result = await client.query<{ email: string }>(
          'SELECT email FROM users ORDER BY email ASC'
        )
        return result.rows.map((row) => row.email)
      }),
      secondSqlContext.withSchemaClient(async (client) => {
        const result = await client.query<{ email: string }>(
          'SELECT email FROM users ORDER BY email ASC'
        )
        return result.rows.map((row) => row.email)
      })
    ])

    expect(firstVisibleEmails).toContain(firstEmail)
    expect(firstVisibleEmails).not.toContain(secondEmail)
    expect(secondVisibleEmails).toContain(secondEmail)
    expect(secondVisibleEmails).not.toContain(firstEmail)
  }, 120_000)
})
