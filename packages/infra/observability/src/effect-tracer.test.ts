import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { context, ROOT_CONTEXT, createContextKey } from '@opentelemetry/api'
import type { Tracer } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBuiltContextEntry, withCachedSpanContext, type EnterBuiltContext } from './effect-tracer.js'

const execute = promisify(execFile)

interface ContextRun {
  mode: 'stock' | 'cached'
  operations: number
  withCalls: number
  spans: Record<string, string>
  observed: {
    parentIds: Array<string | null>
    child: string
    afterChild: string
    afterAsync: string
  }
}

// Fresh process per run: the provider and the context manager are process-global.
const runFixture = async (mode: 'stock' | 'cached'): Promise<ContextRun> => {
  const { stdout } = await execute(process.execPath, [
    '--import', 'tsx',
    fileURLToPath(new URL('./test-fixtures/effect-context-manager.ts', import.meta.url)),
    mode
  ])
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as ContextRun
}

describe('Effect tracer under a real context manager', () => {
  it('enters the context manager once per span, not per fiber operation', async () => {
    const [stock, cached] = await Promise.all([runFixture('stock'), runFixture('cached')])

    // The stock layer is the regression being guarded: one fork per operation.
    expect(stock.withCalls).toBeGreaterThanOrEqual(stock.operations)
    expect(cached.withCalls).toBeLessThanOrEqual(8)
  }, 60_000)

  it('keeps the active span the stock tracer gives', async () => {
    const cached = await runFixture('cached')

    expect(cached.observed.parentIds).toEqual([cached.spans['canary.parent']])
    expect(cached.observed.child).toBe(cached.spans['canary.child'])
    expect(cached.observed.afterChild).toBe(cached.spans['canary.parent'])
    expect(cached.observed.afterAsync).toBe(cached.spans['canary.parent'])
  }, 60_000)
})

describe('withCachedSpanContext', () => {
  afterEach(() => {
    setBuiltContextEntry(undefined)
    vi.restoreAllMocks()
  })

  const key = createContextKey('effect-tracer-test')
  const span = { _tag: 'Span' } as unknown as Tracer.AnySpan
  const fiberWith = (currentSpan: Tracer.AnySpan | undefined) =>
    ({ currentSpan }) as unknown as Parameters<Tracer.Tracer['context']>[1]

  const recordEntries = () => {
    const entered: unknown[] = []
    const enter: EnterBuiltContext = (builtContext, execution) => {
      entered.push(builtContext)
      return execution()
    }
    return { enter, entered }
  }

  const makeBase = (inner: ReturnType<typeof ROOT_CONTEXT.setValue>) => {
    const baseContext = vi.fn(<X>(execution: () => X): X => {
      const active = vi.spyOn(context, 'active').mockReturnValue(inner)
      try {
        return execution()
      } finally {
        active.mockRestore()
      }
    })
    const base = { span: vi.fn(), context: baseContext } as unknown as Tracer.Tracer
    return { base, baseContext }
  }

  it('runs the operation directly when no span is current', () => {
    const { base, baseContext } = makeBase(ROOT_CONTEXT)
    const tracer = withCachedSpanContext(base)

    expect(tracer.context(() => 'value', fiberWith(undefined))).toBe('value')
    expect(baseContext).not.toHaveBeenCalled()
  })

  it('builds the context once, then re-enters it from the same outer context', () => {
    const inner = ROOT_CONTEXT.setValue(key, 'inner')
    const { base, baseContext } = makeBase(inner)
    const { enter, entered } = recordEntries()
    setBuiltContextEntry(enter)
    const tracer = withCachedSpanContext(base)

    expect(tracer.context(() => 1, fiberWith(span))).toBe(1)
    expect(tracer.context(() => 2, fiberWith(span))).toBe(2)
    expect(tracer.context(() => 3, fiberWith(span))).toBe(3)

    expect(baseContext).toHaveBeenCalledTimes(1)
    expect(entered).toEqual([inner, inner])
  })

  it('skips entering when the span context is already active', () => {
    const inner = ROOT_CONTEXT.setValue(key, 'inner')
    const { base, baseContext } = makeBase(inner)
    const { enter, entered } = recordEntries()
    setBuiltContextEntry(enter)
    const tracer = withCachedSpanContext(base)
    tracer.context(() => undefined, fiberWith(span))

    vi.spyOn(context, 'active').mockReturnValue(inner)
    expect(tracer.context(() => 'nested', fiberWith(span))).toBe('nested')

    expect(baseContext).toHaveBeenCalledTimes(1)
    expect(entered).toEqual([])
  })

  it('rebuilds when the fiber resumes under a different outer context', () => {
    const { base, baseContext } = makeBase(ROOT_CONTEXT.setValue(key, 'inner'))
    const { enter, entered } = recordEntries()
    setBuiltContextEntry(enter)
    const tracer = withCachedSpanContext(base)
    tracer.context(() => undefined, fiberWith(span))

    vi.spyOn(context, 'active').mockReturnValue(ROOT_CONTEXT.setValue(key, 'another request'))
    tracer.context(() => undefined, fiberWith(span))

    expect(baseContext).toHaveBeenCalledTimes(2)
    expect(entered).toEqual([])
  })
})
