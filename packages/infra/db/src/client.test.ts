import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

const databaseUrl = 'postgres://test:test@db.example.com:5432/tx_agent_kit'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('@effect/sql-pg/PgClient')
  vi.doUnmock('drizzle-orm/effect-postgres')
  vi.resetModules()
})

describe('provideDB', () => {
  it('uses libpq-compatible SSL semantics for sslmode=require URLs', async () => {
    const { getPgSslConfigForDatabaseUrl, normalizeDatabaseUrlForPgDriver } = await import(
      './client.js'
    )

    expect(
      getPgSslConfigForDatabaseUrl(
        'postgresql://user:pass@db.example.com:5432/app?sslmode=require'
      )
    ).toEqual({ rejectUnauthorized: false })
    expect(
      getPgSslConfigForDatabaseUrl('postgresql://user:pass@db.example.com:5432/app?sslmode=prefer')
    ).toEqual({ rejectUnauthorized: false })
    expect(
      getPgSslConfigForDatabaseUrl(
        'postgresql://user:pass@db.example.com:5432/app?sslmode=disable'
      )
    ).toBe(false)
    expect(
      getPgSslConfigForDatabaseUrl(
        'postgresql://user:pass@db.example.com:5432/app?sslmode=verify-full'
      )
    ).toBeUndefined()

    expect(
      normalizeDatabaseUrlForPgDriver(
        'postgresql://user:pass@db.example.com:5432/app?sslmode=require'
      )
    ).toBe('postgresql://user:pass@db.example.com:5432/app?sslmode=require&uselibpqcompat=true')
    expect(
      normalizeDatabaseUrlForPgDriver(
        'postgresql://user:pass@db.example.com:5432/app?sslmode=require&uselibpqcompat=false'
      )
    ).toBe(
      'postgresql://user:pass@db.example.com:5432/app?sslmode=require&uselibpqcompat=false'
    )
  })

  it('reuses the scoped Effect SQL runtime across sequential DB effects for the same URL', async () => {
    let pgLayerBuilds = 0
    let dbBuilds = 0
    let pgLayerReleases = 0

    vi.stubEnv('DATABASE_URL', databaseUrl)
    vi.stubEnv('NODE_ENV', 'staging')

    vi.doMock('@effect/sql-pg/PgClient', async () => {
      const effect = await import('effect')
      const PgClient = effect.Context.GenericTag<Readonly<{ connectionId: number }>>(
        '@effect/sql-pg/PgClient'
      )

      return {
        PgClient,
        layer: () => {
          pgLayerBuilds += 1
          return effect.Layer.scoped(
            PgClient,
            effect.Effect.acquireRelease(
              effect.Effect.succeed({ connectionId: pgLayerBuilds }),
              () =>
                effect.Effect.sync(() => {
                  pgLayerReleases += 1
                })
            )
          )
        }
      }
    })

    vi.doMock('drizzle-orm/effect-postgres', async () => {
      const effect = await import('effect')

      return {
        makeWithDefaults: () =>
          effect.Effect.sync(() => {
            dbBuilds += 1
            return { dbBuildId: dbBuilds }
          })
      }
    })

    const { DB, provideDB, resetPool } = await import('./client.js')

    const readDbBuildId = provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        return (db as unknown as { readonly dbBuildId: number }).dbBuildId
      })
    )

    await expect(Effect.runPromise(readDbBuildId)).resolves.toBe(1)
    await expect(Effect.runPromise(readDbBuildId)).resolves.toBe(1)
    expect(pgLayerBuilds).toBe(1)
    expect(pgLayerReleases).toBe(0)

    await resetPool()
    expect(pgLayerReleases).toBe(1)
  })
})
