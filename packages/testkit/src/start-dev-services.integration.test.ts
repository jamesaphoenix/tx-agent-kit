import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http'
import { createServer as createNetServer, type Server as NetServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { getTestkitProcessEnv } from './env.js'
import {
  runStartDevServices
} from './start-dev-services.js'

const listenTcpServer = async (): Promise<NetServer> =>
  new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server)
    })
  })

const listenTcpServerAtPort = async (port: number): Promise<NetServer> =>
  new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server)
    })
  })

const listenHttpServer = async (
  onRequest: (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ) => void
): Promise<HttpServer> =>
  new Promise((resolve, reject) => {
    const server = createHttpServer(onRequest)
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server)
    })
  })

const closeServer = async (
  server: HttpServer | NetServer
): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

const getBoundPort = (server: HttpServer | NetServer): number => {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Server did not expose an IPv4/IPv6 bound port')
  }

  return address.port
}

const startGrafanaFallbackFixtures = async (): Promise<{
  readonly grafanaImpostor: HttpServer
  readonly nextPortOccupier: NetServer
  readonly grafanaPort: number
}> => {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const grafanaImpostor = await listenHttpServer((_request, response) => {
      response.statusCode = 503
      response.end('not-grafana')
    })
    const grafanaPort = getBoundPort(grafanaImpostor)

    try {
      const nextPortOccupier = await listenTcpServerAtPort(grafanaPort + 1)
      return {
        grafanaImpostor,
        nextPortOccupier,
        grafanaPort
      }
    } catch {
      await closeServer(grafanaImpostor)
    }
  }

  throw new Error('Unable to allocate consecutive occupied ports for Grafana fallback test')
}

describe('start-dev-services integration', () => {
  it('returns quickly when shared infra is already healthy', () => {
    const warmup = runStartDevServices(getTestkitProcessEnv())
    expect(warmup.exitCode).toBe(0)

    const result = runStartDevServices(getTestkitProcessEnv())

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Infrastructure already healthy')
    expect(result.durationMs).toBeLessThan(15_000)
  })

  it('honors INFRA_READY_TIMEOUT_SECONDS and fails fast when readiness conditions are unmet', () => {
    const timeoutSeconds = 3
    const result = runStartDevServices({
      ...getTestkitProcessEnv(),
      INFRA_READY_TIMEOUT_SECONDS: String(timeoutSeconds),
      OTEL_HEALTH_PORT: '65530'
    })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain(
      `Timed out waiting for infrastructure readiness (${timeoutSeconds}s).`
    )
    expect(result.durationMs).toBeLessThan(20_000)
  }, 30_000)

  it('rejects invalid INFRA_READY_TIMEOUT_SECONDS values', () => {
    const result = runStartDevServices({
      ...getTestkitProcessEnv(),
      INFRA_READY_TIMEOUT_SECONDS: 'not-a-number'
    })

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain(
      'INFRA_READY_TIMEOUT_SECONDS must be a positive integer'
    )
  })

  it(
    'chooses the first truly free fallback port when Grafana default and next port are occupied',
    async () => {
      const fixtures = await startGrafanaFallbackFixtures()
      const expectedFallbackPort = fixtures.grafanaPort + 2

      try {
        const result = runStartDevServices({
          ...getTestkitProcessEnv(),
          INFRA_READY_TIMEOUT_SECONDS: '4',
          OTEL_HEALTH_PORT: '65530',
          GRAFANA_PORT: String(fixtures.grafanaPort)
        })

        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain(
          `Grafana host port ${fixtures.grafanaPort} is in use by another process; using ${expectedFallbackPort}.`
        )
      } finally {
        if (fixtures.grafanaImpostor.listening) {
          await closeServer(fixtures.grafanaImpostor)
        }
        if (fixtures.nextPortOccupier.listening) {
          await closeServer(fixtures.nextPortOccupier)
        }
      }
    },
    60_000
  )

  it(
    'fails fast when critical dependency ports are occupied by non-service processes',
    async () => {
      const otelHealthServer = await listenTcpServer()
      const otelHealthPort = getBoundPort(otelHealthServer)

      try {
        const result = runStartDevServices({
          ...getTestkitProcessEnv(),
          INFRA_READY_TIMEOUT_SECONDS: '6',
          OTEL_HEALTH_PORT: String(otelHealthPort)
        })

        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain(
          `OpenTelemetry Collector health host port ${otelHealthPort} is in use by another process.`
        )
        expect(result.stdout).toContain(
          'Stop the conflicting process (or override the port env var if supported) before running infra startup.'
        )
      } finally {
        if (otelHealthServer.listening) {
          await closeServer(otelHealthServer)
        }
      }
    },
    60_000
  )
})
