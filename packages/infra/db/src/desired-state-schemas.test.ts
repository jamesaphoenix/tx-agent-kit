import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desiredStateSchemaDefinitions } from './desired-state-schemas.js'

describe('desired-state schema definitions', () => {
  it('use unique output paths', () => {
    const uniquePaths = new Set(
      desiredStateSchemaDefinitions.map((definition) => definition.relativePath)
    )

    expect(uniquePaths.size).toBe(desiredStateSchemaDefinitions.length)
  })

  it('match committed generated SQL artifacts', () => {
    const schemaRoot = resolve(import.meta.dirname, '../schemas')

    for (const definition of desiredStateSchemaDefinitions) {
      const committedSql = readFileSync(
        resolve(schemaRoot, definition.relativePath),
        'utf8'
      ).trim()

      expect(committedSql).toBe(definition.renderSql())
    }
  })
})
