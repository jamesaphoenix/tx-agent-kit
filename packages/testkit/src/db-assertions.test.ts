import { describe, expect, it } from 'vitest'

/**
 * These tests verify the internal helpers used by db-assertions.
 * Since quoteIdentifier and buildWhereFragment are not exported,
 * we test them indirectly by importing the module and checking
 * the behavior of the public functions with mock clients.
 */

// We test the WHERE clause building logic via the query functions
// by providing a mock pg Client that captures the query text and params.

interface CapturedQuery {
  text: string
  values: ReadonlyArray<unknown>
}

const createMockClient = (rows: ReadonlyArray<Record<string, unknown>> = []) => {
  const queries: CapturedQuery[] = []

  return {
    queries,
    query: (text: string, values?: ReadonlyArray<unknown>) => {
      queries.push({ text, values: values ?? [] })
      return { rows: [...rows] }
    }
  }
}

// Dynamically import to test the WithClient variants directly
const importModule = async () => import('./db-assertions.js')

describe('db-assertions', () => {
  describe('queryRowCountWithClient', () => {
    it('builds a simple COUNT query without WHERE when no clause provided', async () => {
      const { queryRowCountWithClient } = await importModule()
      const mockClient = createMockClient([{ count: '5' }])

      const result = await queryRowCountWithClient(mockClient as never, 'users')

      expect(result).toBe(5)
      expect(mockClient.queries[0]?.text).toBe('SELECT COUNT(*)::text AS count FROM "users"')
      expect(mockClient.queries[0]?.values).toEqual([])
    })

    it('builds parameterized WHERE clause for non-null values', async () => {
      const { queryRowCountWithClient } = await importModule()
      const mockClient = createMockClient([{ count: '2' }])

      const result = await queryRowCountWithClient(mockClient as never, 'auth_login_identities', {
        user_id: 'abc-123',
        provider: 'google'
      })

      expect(result).toBe(2)
      expect(mockClient.queries[0]?.text).toBe(
        'SELECT COUNT(*)::text AS count FROM "auth_login_identities" WHERE "user_id" = $1 AND "provider" = $2'
      )
      expect(mockClient.queries[0]?.values).toEqual(['abc-123', 'google'])
    })

    it('uses IS NULL for null values in WHERE clause', async () => {
      const { queryRowCountWithClient } = await importModule()
      const mockClient = createMockClient([{ count: '0' }])

      await queryRowCountWithClient(mockClient as never, 'users', {
        deleted_at: null,
        status: 'active'
      })

      expect(mockClient.queries[0]?.text).toBe(
        'SELECT COUNT(*)::text AS count FROM "users" WHERE "deleted_at" IS NULL AND "status" = $1'
      )
      expect(mockClient.queries[0]?.values).toEqual(['active'])
    })

    it('handles boolean and number values', async () => {
      const { queryRowCountWithClient } = await importModule()
      const mockClient = createMockClient([{ count: '1' }])

      await queryRowCountWithClient(mockClient as never, 'settings', {
        is_active: true,
        retry_count: 3
      })

      expect(mockClient.queries[0]?.values).toEqual([true, 3])
    })

    it('escapes double quotes in identifiers', async () => {
      const { queryRowCountWithClient } = await importModule()
      const mockClient = createMockClient([{ count: '0' }])

      await queryRowCountWithClient(mockClient as never, 'table"name', {
        'col"umn': 'value'
      })

      expect(mockClient.queries[0]?.text).toBe(
        'SELECT COUNT(*)::text AS count FROM "table""name" WHERE "col""umn" = $1'
      )
    })

    it('returns 0 when result row is missing count', async () => {
      const { queryRowCountWithClient } = await importModule()
      const mockClient = createMockClient([])

      const result = await queryRowCountWithClient(mockClient as never, 'users')

      expect(result).toBe(0)
    })
  })

  describe('queryRowsWithClient', () => {
    it('returns all matching rows', async () => {
      const { queryRowsWithClient } = await importModule()
      const rows = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' }
      ]
      const mockClient = createMockClient(rows)

      const result = await queryRowsWithClient(mockClient as never, 'users')

      expect(result).toEqual(rows)
      expect(mockClient.queries[0]?.text).toBe('SELECT * FROM "users"')
    })

    it('applies WHERE clause', async () => {
      const { queryRowsWithClient } = await importModule()
      const mockClient = createMockClient([{ id: '1', status: 'active' }])

      await queryRowsWithClient(mockClient as never, 'users', { status: 'active' })

      expect(mockClient.queries[0]?.text).toBe(
        'SELECT * FROM "users" WHERE "status" = $1'
      )
    })
  })

  describe('queryFirstRowWithClient', () => {
    it('returns first row when present', async () => {
      const { queryFirstRowWithClient } = await importModule()
      const mockClient = createMockClient([{ id: '1', name: 'Alice' }])

      const result = await queryFirstRowWithClient(mockClient as never, 'users')

      expect(result).toEqual({ id: '1', name: 'Alice' })
      expect(mockClient.queries[0]?.text).toBe('SELECT * FROM "users" LIMIT 1')
    })

    it('returns null when no rows match', async () => {
      const { queryFirstRowWithClient } = await importModule()
      const mockClient = createMockClient([])

      const result = await queryFirstRowWithClient(mockClient as never, 'users')

      expect(result).toBeNull()
    })
  })

  describe('expectRowCountWithClient', () => {
    it('passes when count matches expected', async () => {
      const { expectRowCountWithClient } = await importModule()
      const mockClient = createMockClient([{ count: '3' }])

      await expect(
        expectRowCountWithClient(mockClient as never, 'users', { status: 'active' }, 3)
      ).resolves.toBeUndefined()
    })

    it('fails when count does not match', async () => {
      const { expectRowCountWithClient } = await importModule()
      const mockClient = createMockClient([{ count: '5' }])

      await expect(
        expectRowCountWithClient(mockClient as never, 'users', { status: 'active' }, 3)
      ).rejects.toThrow()
    })
  })

  describe('expectRowExistsWithClient', () => {
    it('passes when at least one row exists', async () => {
      const { expectRowExistsWithClient } = await importModule()
      const mockClient = createMockClient([{ count: '1' }])

      await expect(
        expectRowExistsWithClient(mockClient as never, 'users', { id: 'abc' })
      ).resolves.toBeUndefined()
    })

    it('fails when no rows exist', async () => {
      const { expectRowExistsWithClient } = await importModule()
      const mockClient = createMockClient([{ count: '0' }])

      await expect(
        expectRowExistsWithClient(mockClient as never, 'users', { id: 'abc' })
      ).rejects.toThrow()
    })
  })

  describe('expectRowNotExistsWithClient', () => {
    it('passes when no rows exist', async () => {
      const { expectRowNotExistsWithClient } = await importModule()
      const mockClient = createMockClient([{ count: '0' }])

      await expect(
        expectRowNotExistsWithClient(mockClient as never, 'users', { id: 'abc' })
      ).resolves.toBeUndefined()
    })

    it('fails when rows exist', async () => {
      const { expectRowNotExistsWithClient } = await importModule()
      const mockClient = createMockClient([{ count: '2' }])

      await expect(
        expectRowNotExistsWithClient(mockClient as never, 'users', { id: 'abc' })
      ).rejects.toThrow()
    })
  })
})
