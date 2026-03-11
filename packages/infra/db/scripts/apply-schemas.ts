#!/usr/bin/env node

import process from 'node:process'
import { Client } from 'pg'
import { applySqlFiles, getSchemaFiles, resolveRepoRoot } from '../src/sql-admin.ts'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/tx_agent_kit'

const write = (message: string): void => {
  process.stdout.write(`${message}\n`)
}

const main = async (): Promise<void> => {
  const repoRoot = resolveRepoRoot()
  const schemaFiles = getSchemaFiles(repoRoot)

  if (schemaFiles.length === 0) {
    write('No schema files found.')
    return
  }

  const client = new Client({ connectionString })
  await client.connect()
  let transactionStarted = false

  try {
    await client.query('BEGIN')
    transactionStarted = true

    await applySqlFiles(client, schemaFiles, (schemaFile) => {
      write(`apply ${schemaFile.name}`)
    })

    await client.query('COMMIT')
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK')
    }
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`)
  process.exit(1)
})
