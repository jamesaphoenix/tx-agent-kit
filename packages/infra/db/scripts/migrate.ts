#!/usr/bin/env node

import process from 'node:process'
import { Client } from 'pg'
import {
  applySqlMigration,
  ensureMigrationTable,
  getMigrationFiles,
  resolveRepoRoot
} from '../src/sql-admin.ts'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/tx_agent_kit'

const write = (message: string): void => {
  process.stdout.write(`${message}\n`)
}

const main = async (): Promise<void> => {
  const repoRoot = resolveRepoRoot()
  const migrationFiles = getMigrationFiles(repoRoot)

  if (migrationFiles.length === 0) {
    write('No migration files found.')
    return
  }

  const client = new Client({ connectionString })
  await client.connect()

  try {
    await ensureMigrationTable(client)

    const appliedResult = await client.query<{ name: string }>('SELECT name FROM __tx_agent_migrations')
    const applied = new Set(appliedResult.rows.map((row) => row.name))

    for (const migration of migrationFiles) {
      if (applied.has(migration.name)) {
        write(`skip ${migration.name}`)
        continue
      }

      write(`apply ${migration.name}`)
      await applySqlMigration(client, migration)
    }
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`)
  process.exit(1)
})
