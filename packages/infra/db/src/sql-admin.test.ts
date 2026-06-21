import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
