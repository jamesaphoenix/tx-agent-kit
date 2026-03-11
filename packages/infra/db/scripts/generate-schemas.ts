#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desiredStateSchemaDefinitions } from '../src/desired-state-schemas.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const schemaRoot = resolve(scriptDir, '..', 'schemas')

for (const schemaDefinition of desiredStateSchemaDefinitions) {
  const outputPath = resolve(schemaRoot, schemaDefinition.relativePath)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${schemaDefinition.renderSql()}\n`, 'utf8')
  process.stdout.write(`Generated ${outputPath}\n`)
}
