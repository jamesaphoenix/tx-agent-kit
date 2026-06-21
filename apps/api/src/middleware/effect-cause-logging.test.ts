import { HttpApp } from '@effect/platform'
import { metrics } from '@opentelemetry/api'
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type ResourceMetrics
} from '@opentelemetry/sdk-metrics'
import {
  _resetValidationMetricsRegistryForTest,
  apiRequestValidationRejectedMetricName
} from '@tx-agent-kit/observability'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Spy on the Sentry bindings so we can assert WHICH capture path each cause takes
// without standing up a real reporter.
const { captureApiClientContractViolation, captureApiMappedError } = vi.hoisted(() => ({
  captureApiClientContractViolation: vi.fn(),
  captureApiMappedError: vi.fn()
}))
vi.mock('../observability/sentry.js', () => ({
  captureApiClientContractViolation,
  captureApiMappedError
}))

const { effectCauseLoggingMiddleware } = await import('./effect-cause-logging.js')
const { runWithApiRequestContext, setApiRequestAuthUserId } = await import(
  '../observability/request-context.js'
)

let exporter: InMemoryMetricExporter
let reader: PeriodicExportingMetricReader
let meterProvider: MeterProvider

interface DataPoint {
  readonly attributes: Record<string, unknown>
  readonly value: unknown
}

const validationPoints = (resourceMetrics: ResourceMetrics[]): DataPoint[] =>
  resourceMetrics
    .flatMap((rm) => rm.scopeMetrics)
    .flatMap((sm) => sm.metrics)
    .filter((m) => m.descriptor.name === apiRequestValidationRejectedMetricName)
    .flatMap((m) => m.dataPoints as DataPoint[])

const collect = async (): Promise<ResourceMetrics[]> => {
  await meterProvider.forceFlush()
  return exporter.getMetrics()
}

const makeDecodeError = (message: string): Error => {
  const error = new Error(message) as Error & { _tag?: string }
  error.name = 'HttpApiDecodeError'
  error._tag = 'HttpApiDecodeError'
  return error
}

const decodeMessage =
  '{ readonly organizationId: UUID }\n└─ ["organizationId"]\n   └─ Expected a Universally Unique Identifier, actual ""'

// Run a failing app through the boundary middleware inside a request context,
// optionally with a stamped authenticated user id. The app fails via a defect so
// its type stays `HttpApp.Default` (E = never) — which mirrors production, where
// the framework surfaces a request-decode failure as a CAUSE on an otherwise
// error-free app, exactly what the boundary's `tapErrorCause` receives.
const runFailing = async (error: Error, opts?: { readonly userId?: string }): Promise<void> => {
  const app: HttpApp.Default = Effect.die(error)
  const handler = HttpApp.toWebHandler(app, effectCauseLoggingMiddleware)
  await runWithApiRequestContext(
    { method: 'GET', path: '/v1/teams', operationId: 'teamsListTeams', routePattern: '/v1/teams' },
    () => {
      if (opts?.userId !== undefined) {
        setApiRequestAuthUserId(opts.userId)
      }
      return handler(new Request('http://api/v1/teams?organizationId=', { method: 'GET' }))
    }
  )
}

beforeEach(() => {
  exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })
  meterProvider = new MeterProvider({ readers: [reader] })
  metrics.disable()
  metrics.setGlobalMeterProvider(meterProvider)
  _resetValidationMetricsRegistryForTest()
  captureApiClientContractViolation.mockClear()
  captureApiMappedError.mockClear()
})

afterEach(async () => {
  await reader.shutdown()
  metrics.disable()
})

describe('effectCauseLoggingMiddleware request-validation classification', () => {
  it('meters an anonymous decode rejection without reporting it to Sentry', async () => {
    await runFailing(makeDecodeError(decodeMessage))

    const points = validationPoints(await collect())
    const point = points.find((p) => p.attributes.field === 'organizationId')
    expect(point?.value).toBe(1)
    expect(point?.attributes.authenticated).toBe('false')
    expect(point?.attributes.operation_id).toBe('teamsListTeams')

    expect(captureApiClientContractViolation).not.toHaveBeenCalled()
    expect(captureApiMappedError).not.toHaveBeenCalled()
  })

  it('reports an authenticated decode rejection as a client contract violation', async () => {
    await runFailing(makeDecodeError(decodeMessage), { userId: 'user_123' })

    const point = validationPoints(await collect()).find(
      (p) => p.attributes.field === 'organizationId'
    )
    expect(point?.attributes.authenticated).toBe('true')

    expect(captureApiClientContractViolation).toHaveBeenCalledTimes(1)
    expect(captureApiClientContractViolation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        field: 'organizationId',
        operationId: 'teamsListTeams',
        userId: 'user_123'
      })
    )
    // A client 4xx is never the generic server-fault path.
    expect(captureApiMappedError).not.toHaveBeenCalled()
  })

  it('leaves genuine server faults on the existing report path (not metered as validation)', async () => {
    const fault = new Error('boom') as Error & { _tag?: string }
    fault.name = 'InternalError'
    fault._tag = 'InternalError'

    await runFailing(fault)

    expect(validationPoints(await collect())).toHaveLength(0)
    expect(captureApiClientContractViolation).not.toHaveBeenCalled()
    expect(captureApiMappedError).toHaveBeenCalledTimes(1)
  })
})
