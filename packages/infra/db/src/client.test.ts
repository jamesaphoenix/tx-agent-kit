import { Effect } from 'effect'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const databaseUrl = 'postgres://test:test@db.example.com:5432/tx_agent_kit'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('@effect/sql-pg/PgClient')
  vi.doUnmock('drizzle-orm/effect-postgres')
  vi.doUnmock('pg')
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

  it('sizes the request pool via maxConnections sourced from DB_POOL_MAX', async () => {
    // Regression guard: PgClient.layer previously omitted maxConnections, so the
    // underlying pg.Pool silently capped max at 10. The documented DB_POOL_MAX knob
    // must flow into the Effect request pool, not only the separate admin pool.
    let capturedOptions: { readonly maxConnections?: number } | undefined

    vi.stubEnv('DATABASE_URL', databaseUrl)
    vi.stubEnv('NODE_ENV', 'staging')
    vi.stubEnv('DB_POOL_MAX', '150')

    vi.doMock('@effect/sql-pg/PgClient', async () => {
      const effect = await import('effect')
      const PgClient = effect.Context.GenericTag<Readonly<{ connectionId: number }>>(
        '@effect/sql-pg/PgClient'
      )

      return {
        PgClient,
        layer: (options: { readonly maxConnections?: number }) => {
          capturedOptions = options
          return effect.Layer.scoped(PgClient, effect.Effect.succeed({ connectionId: 1 }))
        }
      }
    })

    vi.doMock('drizzle-orm/effect-postgres', async () => {
      const effect = await import('effect')
      return {
        makeWithDefaults: () => effect.Effect.sync(() => ({ dbBuildId: 1 }))
      }
    })

    const { DB, provideDB } = await import('./client.js')

    await Effect.runPromise(
      provideDB(
        Effect.gen(function* () {
          yield* DB
          return null
        })
      )
    )

    expect(capturedOptions?.maxConnections).toBe(150)
  })
})

describe('getPool', () => {
  it('handles idle pool connection errors without raising an uncaught exception', async () => {
    const pools: EventEmitter[] = []

    vi.stubEnv('DATABASE_URL', databaseUrl)
    vi.stubEnv('NODE_ENV', 'staging')

    vi.doMock('pg', () => ({
      Pool: class MockPool extends EventEmitter {
        readonly totalCount = 0
        readonly idleCount = 0
        readonly waitingCount = 0
        readonly options: unknown

        constructor(options: unknown) {
          super()
          this.options = options
          pools.push(this)
        }

        end = vi.fn(() => Promise.resolve())
      },
      types: {
        getTypeParser: vi.fn(() => (value: unknown) => value)
      }
    }))

    const { getPool, resetPool, setPoolErrorReporter } = await import('./client.js')

    const reporter = vi.fn()
    setPoolErrorReporter(reporter)

    getPool()
    const pool = pools[0]
    if (!pool) {
      throw new Error('Expected getPool to create a pool')
    }
    expect(pool.listenerCount('error')).toBe(1)

    const idleError = new Error('connection to database closed')
    // Consumed (no uncaught exception) AND forwarded to the injected reporter
    // so the failure is still sent to Sentry instead of silently swallowed.
    expect(() => pool.emit('error', idleError)).not.toThrow()
    expect(reporter).toHaveBeenCalledWith(idleError)

    setPoolErrorReporter(() => {})
    await resetPool()
  })
})

describe('default DATABASE_URL capture', () => {
  // The pool singleton froze DATABASE_URL at first getPool() call while
  // getDBRuntime() re-read env on every call. A mid-process env mutation
  // (e.g. a test stub leaking under isolate:false) then split the two onto
  // different URLs/schemas - raw-SQL reads and Effect-repo reads silently
  // targeting different schemas. Found via trace-learn's billing suite; see
  // that repo's issue #40. The default URL must be captured ONCE, shared by
  // both paths, and released only by resetPool().
  const urlA = 'postgres://test:test@db.example.com:5432/tx_agent_kit?options=-c%20search_path%3Dschema_a,public'
  const urlB = 'postgres://test:test@db.example.com:5432/tx_agent_kit?options=-c%20search_path%3Dschema_b,public'

  const mockLayers = (): { readonly layerUrls: string[]; readonly poolConfigs: Array<{ readonly connectionString?: string }> } => {
    const layerUrls: string[] = []
    const poolConfigs: Array<{ readonly connectionString?: string }> = []

    vi.doMock('@effect/sql-pg/PgClient', async () => {
      const effect = await import('effect')
      const PgClient = effect.Context.GenericTag<Readonly<{ connectionId: number }>>(
        '@effect/sql-pg/PgClient'
      )

      return {
        PgClient,
        layer: (options: { readonly url: unknown }) => {
          layerUrls.push(effect.Redacted.value(options.url as ReturnType<typeof effect.Redacted.make<string>>))
          return effect.Layer.scoped(
            PgClient,
            effect.Effect.acquireRelease(
              effect.Effect.succeed({ connectionId: layerUrls.length }),
              () => effect.Effect.void
            )
          )
        }
      }
    })

    vi.doMock('drizzle-orm/effect-postgres', async () => {
      const effect = await import('effect')
      return { makeWithDefaults: () => effect.Effect.sync(() => ({ db: true })) }
    })

    vi.doMock('pg', () => {
      class FakePool extends EventEmitter {
        readonly options: { readonly connectionString?: string }
        constructor(config: { readonly connectionString?: string }) {
          super()
          this.options = config
          poolConfigs.push(config)
        }
        end(): Promise<void> {
          return Promise.resolve()
        }
      }
      return { Pool: FakePool, types: { getTypeParser: () => (value: unknown) => value } }
    })

    return { layerUrls, poolConfigs }
  }

  it('pins the Effect runtime to the URL captured by the first getPool(), ignoring later env mutation', async () => {
    vi.stubEnv('DATABASE_URL', urlA)
    vi.stubEnv('NODE_ENV', 'staging')
    const { layerUrls } = mockLayers()

    const { DB, getPool, provideDB } = await import('./client.js')

    getPool()
    vi.stubEnv('DATABASE_URL', urlB)

    await Effect.runPromise(provideDB(Effect.gen(function* () {
      yield* DB
      return true
    })))

    expect(layerUrls).toHaveLength(1)
    expect(layerUrls[0]).toContain('schema_a')
    expect(layerUrls[0]).not.toContain('schema_b')
  })

  it('pins getPool() to the URL captured by the first Effect runtime, ignoring later env mutation', async () => {
    vi.stubEnv('DATABASE_URL', urlA)
    vi.stubEnv('NODE_ENV', 'staging')
    const { poolConfigs } = mockLayers()

    const { DB, getPool, provideDB } = await import('./client.js')

    await Effect.runPromise(provideDB(Effect.gen(function* () {
      yield* DB
      return true
    })))
    vi.stubEnv('DATABASE_URL', urlB)

    getPool()

    expect(poolConfigs).toHaveLength(1)
    expect(poolConfigs[0]?.connectionString).toContain('schema_a')
    expect(poolConfigs[0]?.connectionString).not.toContain('schema_b')
  })

  it('resetPool() releases the captured URL so a deliberate repoint takes effect', async () => {
    vi.stubEnv('DATABASE_URL', urlA)
    vi.stubEnv('NODE_ENV', 'staging')
    const { layerUrls, poolConfigs } = mockLayers()

    const { DB, getPool, provideDB, resetPool } = await import('./client.js')

    getPool()
    await resetPool()
    vi.stubEnv('DATABASE_URL', urlB)

    getPool()
    await Effect.runPromise(provideDB(Effect.gen(function* () {
      yield* DB
      return true
    })))

    expect(poolConfigs[1]?.connectionString).toContain('schema_b')
    expect(layerUrls[0]).toContain('schema_b')
  })
})
