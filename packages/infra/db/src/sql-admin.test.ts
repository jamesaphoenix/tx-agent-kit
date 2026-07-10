import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Client } from 'pg'
import {
  assertUniqueMigrationPrefixes,
  findDuplicateMigrationPrefixes,
  getMigrationFiles
} from './sql-admin.js'

describe('findDuplicateMigrationPrefixes', () => {
  it('returns no collisions for unique sequential prefixes', () => {
    expect(
      findDuplicateMigrationPrefixes(['0001_a.sql', '0002_b.sql', '0003_c.sql'])
    ).toEqual([])
  })

  it('detects a single two-way collision', () => {
    expect(
      findDuplicateMigrationPrefixes(['0001_a.sql', '0050_beta.sql', '0050_alpha.sql'])
    ).toEqual([{ prefix: '0050', files: ['0050_alpha.sql', '0050_beta.sql'] }])
  })

  it('detects a three-way collision', () => {
    expect(
      findDuplicateMigrationPrefixes(['0050_a.sql', '0050_b.sql', '0050_c.sql'])
    ).toEqual([{ prefix: '0050', files: ['0050_a.sql', '0050_b.sql', '0050_c.sql'] }])
  })

  it('detects multiple independent collisions in deterministic order', () => {
    expect(
      findDuplicateMigrationPrefixes([
        '0051_two.sql',
        '0050_two.sql',
        '0050_one.sql',
        '0051_one.sql',
        '0052_unique.sql'
      ])
    ).toEqual([
      { prefix: '0050', files: ['0050_one.sql', '0050_two.sql'] },
      { prefix: '0051', files: ['0051_one.sql', '0051_two.sql'] }
    ])
  })
})

describe('assertUniqueMigrationPrefixes', () => {
  it('does not throw when every prefix is unique', () => {
    expect(() =>
      assertUniqueMigrationPrefixes(['0001_a.sql', '0002_b.sql'])
    ).not.toThrow()
  })

  it('throws naming the colliding number and both files', () => {
    expect(() =>
      assertUniqueMigrationPrefixes(['0050_alpha.sql', '0050_beta.sql'])
    ).toThrow(/0050.*0050_alpha\.sql.*0050_beta\.sql/su)
  })
})

describe('getMigrationFiles', () => {
  let migrationDir: string

  beforeEach(() => {
    migrationDir = mkdtempSync(resolve(tmpdir(), 'tx-migrations-'))
  })

  afterEach(() => {
    rmSync(migrationDir, { recursive: true, force: true })
  })

  const writeMigration = (name: string): void => {
    writeFileSync(resolve(migrationDir, name), 'SELECT 1;')
  }

  it('reads unique migrations in sorted order', () => {
    writeMigration('0002_second.sql')
    writeMigration('0001_first.sql')

    expect(getMigrationFiles(migrationDir, '.').map((file) => file.name)).toEqual([
      '0001_first.sql',
      '0002_second.sql'
    ])
  })

  it('throws instead of silently applying both files when numbers collide', () => {
    writeMigration('0050_alpha.sql')
    writeMigration('0050_beta.sql')

    expect(() => getMigrationFiles(migrationDir, '.')).toThrow(
      /Duplicate migration numbers detected.*0050_alpha\.sql.*0050_beta\.sql/su
    )
  })
})

// Concurrent suites creating __tx_agent_migrations in the SAME schema race on
// the pg_type/pg_class catalog: CREATE TABLE IF NOT EXISTS checks existence
// before inserting the catalog rows, so two simultaneous creators can both
// pass the check and one loses with unique_violation (23505) on
// pg_type_typname_nsp_index (or duplicate_table 42P07). Hit twice on the
// shared Studio Postgres within 12h once three repos' CI shared the host.
// The loser must treat "someone else created it" as success, not an error.
const catalogRaceError = (code: string): Error & { code: string } =>
  Object.assign(
    new Error('duplicate key value violates unique constraint "pg_type_typname_nsp_index"'),
    { code }
  )

const clientFailingOnce = (
  code: string
): { client: Pick<Client, 'query'>; calls: () => number } => {
  let attempts = 0
  // pg's Client['query'] carries many overloads; the fake implements the one
  // shape ensureMigrationTable uses (single SQL string), asserted to the
  // overloaded type since a structural fake cannot express every overload.
  const query = ((_sql: string) => {
    attempts += 1
    if (attempts === 1) {
      return Promise.reject(catalogRaceError(code))
    }
    return Promise.resolve({ rows: [] })
  }) as unknown as Client['query']
  return {
    client: { query },
    calls: () => attempts
  }
}

describe('ensureMigrationTable', () => {
  it('retries once when losing the pg_type catalog race (23505) and succeeds', async () => {
    const { client, calls } = clientFailingOnce('23505')
    const { ensureMigrationTable } = await import('./sql-admin.js')
    await expect(ensureMigrationTable(client)).resolves.toBeUndefined()
    expect(calls()).toBe(2)
  })

  it('retries once on duplicate_table (42P07) and succeeds', async () => {
    const { client, calls } = clientFailingOnce('42P07')
    const { ensureMigrationTable } = await import('./sql-admin.js')
    await expect(ensureMigrationTable(client)).resolves.toBeUndefined()
    expect(calls()).toBe(2)
  })

  it('rethrows non-catalog-race errors without retrying', async () => {
    const { client, calls } = clientFailingOnce('42501')
    const { ensureMigrationTable } = await import('./sql-admin.js')
    await expect(ensureMigrationTable(client)).rejects.toThrow('duplicate key value')
    expect(calls()).toBe(1)
  })
})
