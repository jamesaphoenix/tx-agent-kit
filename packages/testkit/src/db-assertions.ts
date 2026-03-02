import { expect } from 'vitest'
import type { Client } from 'pg'
import type { SqlTestContext } from './sql-context.js'

export type WhereClause = Record<string, string | number | boolean | null>

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`

const buildWhereFragment = (
  where: WhereClause,
  startIndex: number
): { text: string; values: ReadonlyArray<string | number | boolean> } => {
  const entries = Object.entries(where)
  if (entries.length === 0) {
    return { text: '', values: [] }
  }

  const conditions: string[] = []
  const values: Array<string | number | boolean> = []
  let paramIndex = startIndex

  for (const [key, value] of entries) {
    if (value === null) {
      conditions.push(`${quoteIdentifier(key)} IS NULL`)
    } else {
      paramIndex += 1
      conditions.push(`${quoteIdentifier(key)} = $${paramIndex}`)
      values.push(value)
    }
  }

  return { text: ` WHERE ${conditions.join(' AND ')}`, values }
}

// ---------------------------------------------------------------------------
// WithClient variants — for use inside existing withSchemaClient callbacks
// ---------------------------------------------------------------------------

export const queryRowCountWithClient = async (
  client: Client,
  table: string,
  where?: WhereClause
): Promise<number> => {
  const fragment = where ? buildWhereFragment(where, 0) : { text: '', values: [] }
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)}${fragment.text}`,
    fragment.values as Array<string | number | boolean>
  )
  return Number.parseInt(result.rows[0]?.count ?? '0', 10)
}

export const queryRowsWithClient = async <T extends Record<string, unknown>>(
  client: Client,
  table: string,
  where?: WhereClause
): Promise<T[]> => {
  const fragment = where ? buildWhereFragment(where, 0) : { text: '', values: [] }
  const result = await client.query<T>(
    `SELECT * FROM ${quoteIdentifier(table)}${fragment.text}`,
    fragment.values as Array<string | number | boolean>
  )
  return result.rows
}

export const queryFirstRowWithClient = async <T extends Record<string, unknown>>(
  client: Client,
  table: string,
  where?: WhereClause
): Promise<T | null> => {
  const fragment = where ? buildWhereFragment(where, 0) : { text: '', values: [] }
  const result = await client.query<T>(
    `SELECT * FROM ${quoteIdentifier(table)}${fragment.text} LIMIT 1`,
    fragment.values as Array<string | number | boolean>
  )
  return result.rows[0] ?? null
}

export const expectRowCountWithClient = async (
  client: Client,
  table: string,
  where: WhereClause,
  expected: number
): Promise<void> => {
  const count = await queryRowCountWithClient(client, table, where)
  expect(count, `Expected ${expected} row(s) in ${table} matching ${JSON.stringify(where)}, got ${count}`).toBe(expected)
}

export const expectRowExistsWithClient = async (
  client: Client,
  table: string,
  where: WhereClause
): Promise<void> => {
  const count = await queryRowCountWithClient(client, table, where)
  expect(count, `Expected at least 1 row in ${table} matching ${JSON.stringify(where)}, got 0`).toBeGreaterThanOrEqual(1)
}

export const expectRowNotExistsWithClient = async (
  client: Client,
  table: string,
  where: WhereClause
): Promise<void> => {
  const count = await queryRowCountWithClient(client, table, where)
  expect(count, `Expected 0 rows in ${table} matching ${JSON.stringify(where)}, got ${count}`).toBe(0)
}

// ---------------------------------------------------------------------------
// Context variants — wrap withSchemaClient for convenience
// ---------------------------------------------------------------------------

export const queryRowCount = async (
  ctx: SqlTestContext,
  table: string,
  where?: WhereClause
): Promise<number> =>
  ctx.withSchemaClient((client) => queryRowCountWithClient(client, table, where))

export const queryRows = async <T extends Record<string, unknown>>(
  ctx: SqlTestContext,
  table: string,
  where?: WhereClause
): Promise<T[]> =>
  ctx.withSchemaClient((client) => queryRowsWithClient<T>(client, table, where))

export const queryFirstRow = async <T extends Record<string, unknown>>(
  ctx: SqlTestContext,
  table: string,
  where?: WhereClause
): Promise<T | null> =>
  ctx.withSchemaClient((client) => queryFirstRowWithClient<T>(client, table, where))

export const expectRowCount = async (
  ctx: SqlTestContext,
  table: string,
  where: WhereClause,
  expected: number
): Promise<void> =>
  ctx.withSchemaClient((client) => expectRowCountWithClient(client, table, where, expected))

export const expectRowExists = async (
  ctx: SqlTestContext,
  table: string,
  where: WhereClause
): Promise<void> =>
  ctx.withSchemaClient((client) => expectRowExistsWithClient(client, table, where))

export const expectRowNotExists = async (
  ctx: SqlTestContext,
  table: string,
  where: WhereClause
): Promise<void> =>
  ctx.withSchemaClient((client) => expectRowNotExistsWithClient(client, table, where))
