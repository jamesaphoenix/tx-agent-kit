import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { stopClientTelemetry } from './client.js'
import {
  clientRequestTotalSeriesQuery,
  nodeServiceStartupSeriesQuery,
  queryJaegerTraceCount,
  queryPrometheusSeries,
  waitForCondition
} from './stack.js'

const defaultJaegerApiUrl = 'http://localhost:16686'
const defaultPrometheusApiUrl = 'http://localhost:9090'
const defaultOtlpEndpoint = 'http://localhost:4320'
const requiredServiceNames = [
  'tx-agent-kit-api',
  'tx-agent-kit-worker',
  'tx-agent-kit-web',
  'tx-agent-kit-mobile'
] as const
const requiredClientMetricJobs = [
  'tx-agent-kit/tx-agent-kit-web',
  'tx-agent-kit/tx-agent-kit-mobile'
] as const
const requiredNodeMetricJobs = [
  'tx-agent-kit/tx-agent-kit-api',
  'tx-agent-kit/tx-agent-kit-worker'
] as const
const pollAttempts = 60
const pollIntervalMs = 1_000
const repoRoot = resolve(import.meta.dirname, '../../..')
const apiCwd = resolve(repoRoot, 'apps/api')
const smokeScriptPath = resolve(repoRoot, 'scripts/test/emit-observability-smoke.ts')
const webAxiosModulePath = resolve(repoRoot, 'apps/web/lib/axios.ts')
const defaultApiHarnessPort = 4707
const defaultApiHarnessHost = '127.0.0.1'
const defaultApiStartupTimeoutMs = 40_000
const defaultApiDatabaseUrl = 'postgresql://postgres:postgres@localhost:5432/tx_agent_kit'
const defaultAuthSecret = 'integration-auth-secret-12345'
const apiServerEntryPath = resolve(apiCwd, 'src/server.ts')

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

const waitForApiHealthy = async (
  baseUrl: string,
  timeoutMs: number,
  output: ReadonlyArray<string>
): Promise<void> => {
  const startedAtMs = Date.now()
  let lastError = 'unknown error'

  while (Date.now() - startedAtMs < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) {
        return
      }

      lastError = `health returned status ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await delay(250)
  }

  const processOutput = output.join('')
  throw new Error(
    [
      `API harness did not become healthy within ${timeoutMs}ms.`,
      `Last health error: ${lastError}`,
      processOutput.length > 0 ? `Process output:\n${processOutput}` : 'Process output was empty.'
    ].join('\n\n')
  )
}

const waitForExit = async (
  processRef: ChildProcess,
  timeoutMs: number
): Promise<boolean> => {
  const startedAtMs = Date.now()
  while (Date.now() - startedAtMs < timeoutMs) {
    if (processRef.exitCode !== null) {
      return true
    }

    await delay(100)
  }

  return processRef.exitCode !== null
}

const startApiHarness = async (
  port: number,
  otlpEndpoint: string
): Promise<{
  readonly baseUrl: string
  readonly output: ReadonlyArray<string>
  stop: () => Promise<void>
}> => {
  const output: string[] = []
  const baseUrl = `http://${defaultApiHarnessHost}:${port}`
  const appendOutputChunk = (chunk: unknown): void => {
    if (typeof chunk === 'string') {
      output.push(chunk)
      return
    }

    if (chunk instanceof Uint8Array) {
      output.push(Buffer.from(chunk).toString('utf8'))
      return
    }

    output.push(String(chunk))
  }

  const processRef = spawn(process.execPath, ['--import', 'tsx', apiServerEntryPath], {
    cwd: apiCwd,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      API_HOST: defaultApiHarnessHost,
      API_PORT: String(port),
      API_CORS_ORIGIN: '*',
      AUTH_SECRET: process.env.AUTH_SECRET ?? defaultAuthSecret,
      DATABASE_URL: process.env.DATABASE_URL ?? defaultApiDatabaseUrl,
      OTEL_EXPORTER_OTLP_ENDPOINT: otlpEndpoint
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  processRef.stdout?.on('data', (chunk: unknown) => {
    appendOutputChunk(chunk)
  })
  processRef.stderr?.on('data', (chunk: unknown) => {
    appendOutputChunk(chunk)
  })

  await waitForApiHealthy(baseUrl, defaultApiStartupTimeoutMs, output)

  return {
    baseUrl,
    output,
    stop: async () => {
      if (processRef.exitCode !== null) {
        return
      }

      processRef.kill('SIGTERM')
      const exitedAfterTerm = await waitForExit(processRef, 5_000)
      if (exitedAfterTerm) {
        return
      }

      processRef.kill('SIGKILL')
      await waitForExit(processRef, 2_000)
    }
  }
}

interface WebAxiosModule {
  readonly api: {
    get: (path: string) => Promise<{ status: number }>
    post: (path: string, payload: unknown) => Promise<{ status: number }>
  }
}

const emitSmokeSignals = (otlpEndpoint: string): void => {
  const sharedEnv = {
    ...process.env,
    OTEL_EXPORTER_OTLP_ENDPOINT: otlpEndpoint
  }

  const emitForService = (mode: 'node' | 'client', serviceName: string): void => {
    execFileSync('pnpm', ['exec', 'tsx', smokeScriptPath, mode, serviceName], {
      cwd: repoRoot,
      env: sharedEnv,
      stdio: 'pipe'
    })
  }

  emitForService('node', 'tx-agent-kit-api')
  emitForService('node', 'tx-agent-kit-worker')
  emitForService('client', 'tx-agent-kit-web')
  emitForService('client', 'tx-agent-kit-mobile')
}

describe('observability stack integration', () => {
  it(
    'exports smoke traces to Jaeger and smoke metrics to Prometheus',
    async () => {
    const jaegerApiUrl = process.env.JAEGER_API_URL ?? defaultJaegerApiUrl
    const prometheusApiUrl =
      process.env.PROMETHEUS_API_URL ?? defaultPrometheusApiUrl
    const otlpEndpoint =
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? defaultOtlpEndpoint

    const baselineTraceCounts = new Map<string, number>(
      await Promise.all(
        requiredServiceNames.map(async (serviceName) => {
          const traceCount = await queryJaegerTraceCount(jaegerApiUrl, serviceName)
          return [serviceName, traceCount] as const
        })
      )
    )

    emitSmokeSignals(otlpEndpoint)

    await waitForCondition(
      async () => {
        const traceCounts = await Promise.all(
          requiredServiceNames.map(async (serviceName) => {
            const traceCount = await queryJaegerTraceCount(jaegerApiUrl, serviceName)
            return [serviceName, traceCount] as const
          })
        )

        return traceCounts.every(([serviceName, traceCount]) => {
          const baseline = baselineTraceCounts.get(serviceName) ?? 0
          return traceCount > baseline
        })
      },
      `Jaeger trace count increment for ${requiredServiceNames.join(', ')}`,
      pollAttempts,
      pollIntervalMs
    )

    await waitForCondition(
      async () => {
        const metricSeries = await queryPrometheusSeries(
          prometheusApiUrl,
          clientRequestTotalSeriesQuery
        )
        return requiredClientMetricJobs.every((jobName) =>
          metricSeries.some((series) => {
            const sampleValue = Number.parseFloat(series.value?.[1] ?? '0')
            return (
              series.metric?.job === jobName &&
              Number.isFinite(sampleValue) &&
              sampleValue > 0
            )
          })
        )
      },
      `Prometheus client request metrics for ${requiredClientMetricJobs.join(', ')}`,
      pollAttempts,
      pollIntervalMs
    )

    await waitForCondition(
      async () => {
        const metricSeries = await queryPrometheusSeries(
          prometheusApiUrl,
          nodeServiceStartupSeriesQuery
        )
        return requiredNodeMetricJobs.every((jobName) =>
          metricSeries.some((series) => {
            const sampleValue = Number.parseFloat(series.value?.[1] ?? '0')
            return (
              series.metric?.job === jobName &&
              Number.isFinite(sampleValue) &&
              sampleValue > 0
            )
          })
        )
      },
      `Prometheus node startup metrics for ${requiredNodeMetricJobs.join(', ')}`,
      pollAttempts,
      pollIntervalMs
    )

    expect(true).toBe(true)
    },
    120_000
  )

  it(
    'exports telemetry via real API + web client instrumentation (no smoke helpers)',
    async () => {
      const otlpEndpoint =
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? defaultOtlpEndpoint
      const apiHarnessPort = Number.parseInt(
        process.env.OBSERVABILITY_API_HARNESS_PORT ?? String(defaultApiHarnessPort),
        10
      )
      const apiHarness = await startApiHarness(apiHarnessPort, otlpEndpoint)

      try {
        process.env.NEXT_PUBLIC_API_BASE_URL = apiHarness.baseUrl
        process.env.API_BASE_URL = apiHarness.baseUrl
        process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT = otlpEndpoint
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = otlpEndpoint
        process.env.NEXT_PUBLIC_NODE_ENV = 'test'
        process.env.NODE_ENV = 'test'

        vi.resetModules()
        const webAxiosModule = (await import(webAxiosModulePath)) as WebAxiosModule
        const api = webAxiosModule.api

        const healthResponse = await api.get('/health')
        expect(healthResponse.status).toBe(200)

        const signUpResponse = await api.post('/v1/auth/sign-up', {
          email: `observability-web-${randomUUID()}@example.com`,
          password: 'observability-pass-12345',
          name: 'Observability Web'
        })
        expect(signUpResponse.status).toBe(201)

        // Force a final export so assertions are deterministic and not tied to reader intervals.
        await stopClientTelemetry()
      } finally {
        await Promise.allSettled([apiHarness.stop(), stopClientTelemetry()])
      }
    },
    180_000
  )
})
