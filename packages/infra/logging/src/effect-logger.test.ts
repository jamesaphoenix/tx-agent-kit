import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect, Logger, LogLevel } from 'effect'

// Pin LOG_LEVEL so createLogger's threshold passes debug (it reads this live).
process.env.LOG_LEVEL = 'debug'

import { makeEffectLoggerLayer } from './effect-logger.js'
import type { StructuredLogEntry } from './index.js'

// Capture stdout so we can assert the bridge produces the SAME StructuredLogEntry
// JSON as createLogger (proving Effect.log* is unified, not Effect's default fmt).
const captureStdout = () => {
  const entries: StructuredLogEntry[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    const line = String(chunk).trim()
    if (line.startsWith('{')) {
      try {
        entries.push(JSON.parse(line) as StructuredLogEntry)
      } catch {
        /* ignore non-JSON lines */
      }
    }
    return true
  })
  return { entries, restore: () => spy.mockRestore() }
}

const run = (effect: Effect.Effect<void>, service = 'test-svc') =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(makeEffectLoggerLayer(service)),
      // Observe debug-level mapping deterministically under the test runner
      // (the layer sets this in real runtimes; pin it here too).
      Logger.withMinimumLogLevel(LogLevel.All)
    )
  )

afterEach(() => vi.restoreAllMocks())

describe('makeEffectLoggerLayer (Effect.log* → structured createLogger)', () => {
  it('maps Effect log levels to structured levels', async () => {
    const cap = captureStdout()
    await run(
      Effect.gen(function* () {
        yield* Effect.logError('an error')
        yield* Effect.logWarning('a warning')
        yield* Effect.logInfo('some info')
        yield* Effect.logDebug('a debug')
      })
    )
    cap.restore()
    const byMessage = Object.fromEntries(cap.entries.map((e) => [e.message, e.level]))
    expect(byMessage['an error']).toBe('error')
    expect(byMessage['a warning']).toBe('warn')
    expect(byMessage['some info']).toBe('info')
    expect(byMessage['a debug']).toBe('debug')
  })

  it('emits the structured schema (service + lowercase level), not Effect default', async () => {
    const cap = captureStdout()
    await run(Effect.logError('boom'), 'tx-agent-kit-worker')
    cap.restore()
    const entry = cap.entries.find((e) => e.message === 'boom')
    expect(entry).toBeDefined()
    expect(entry?.service).toBe('tx-agent-kit-worker')
    expect(entry?.level).toBe('error') // lowercase — NOT Effect's "ERROR"
    expect(entry?.timestamp).toBeTypeOf('string')
    // Effect default fields must be absent from our schema:
    const raw = entry as unknown as Record<string, unknown>
    expect(raw).not.toHaveProperty('fiberId')
    expect(raw).not.toHaveProperty('logLevel')
  })

  it('folds object message-parts into structured context', async () => {
    const cap = captureStdout()
    await run(Effect.logWarning('rate-limit failed; failing open', { path: '/v1/auth/sign-in', attempt: 2 }))
    cap.restore()
    const entry = cap.entries.find((e) => e.message === 'rate-limit failed; failing open')
    expect(entry?.context).toMatchObject({ path: '/v1/auth/sign-in', attempt: 2 })
  })

  it('preserves Effect.annotateLogs as context', async () => {
    const cap = captureStdout()
    await run(Effect.logInfo('annotated').pipe(Effect.annotateLogs({ orgId: 'org_123', op: 'publish' })))
    cap.restore()
    const entry = cap.entries.find((e) => e.message === 'annotated')
    expect(entry?.context).toMatchObject({ orgId: 'org_123', op: 'publish' })
  })

  it('promotes an Error message-part to the structured error field', async () => {
    const cap = captureStdout()
    await run(Effect.logError('decrypt failed', new Error('bad key')))
    cap.restore()
    const entry = cap.entries.find((e) => e.message === 'decrypt failed')
    expect(entry?.error?.message).toBe('bad key')
    expect(entry?.error?.name).toBe('Error')
  })
})
