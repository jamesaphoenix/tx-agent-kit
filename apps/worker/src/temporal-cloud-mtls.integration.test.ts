import { describe, expect, it } from 'vitest'
import { NativeConnection } from '@temporalio/worker'
import {
  type WorkerEnv,
  getWorkerEnv,
  resolveWorkerTemporalConnectionOptions
} from './config/env.js'

const resolveShouldRunCloudMtlsIntegration = (): boolean => {
  try {
    const env = getWorkerEnv()
    return (
      env.TEMPORAL_RUNTIME_MODE === 'cloud' &&
      env.TEMPORAL_TLS_ENABLED &&
      Boolean(env.TEMPORAL_TLS_CLIENT_CERT_PEM && env.TEMPORAL_TLS_CLIENT_KEY_PEM)
    )
  } catch {
    return false
  }
}

const shouldRunCloudMtlsIntegration = resolveShouldRunCloudMtlsIntegration()

const requireCloudMtlsEnv = (env: WorkerEnv): WorkerEnv => {
  if (env.TEMPORAL_RUNTIME_MODE !== 'cloud') {
    throw new Error('RUN_TEMPORAL_MTLS_INTEGRATION requires TEMPORAL_RUNTIME_MODE=cloud')
  }

  if (!env.TEMPORAL_TLS_ENABLED) {
    throw new Error('RUN_TEMPORAL_MTLS_INTEGRATION requires TEMPORAL_TLS_ENABLED=true')
  }

  if (!env.TEMPORAL_TLS_CA_CERT_PEM) {
    throw new Error(
      'RUN_TEMPORAL_MTLS_INTEGRATION requires TEMPORAL_TLS_CA_CERT_PEM'
    )
  }

  if (!env.TEMPORAL_TLS_CLIENT_CERT_PEM || !env.TEMPORAL_TLS_CLIENT_KEY_PEM) {
    throw new Error(
      'RUN_TEMPORAL_MTLS_INTEGRATION requires TEMPORAL_TLS_CLIENT_CERT_PEM and TEMPORAL_TLS_CLIENT_KEY_PEM'
    )
  }

  return env
}

const tlsFailurePattern = /certificate|tls|x509|handshake|pem|hostname/i
const namespaceFailurePattern = /not found|permission|denied|unauthorized|unauthenticated/i
const authFailurePattern = /permission|denied|unauthorized|unauthenticated|forbidden|api key/i

describe.sequential('worker temporal cloud mTLS integration', () => {
  it.skipIf(!shouldRunCloudMtlsIntegration)(
    'connects with namespace-specific mTLS material',
    async () => {
      const env = requireCloudMtlsEnv(getWorkerEnv())
      const connection = await NativeConnection.connect(
        resolveWorkerTemporalConnectionOptions(env)
      )
      const systemInfo = await connection.workflowService.getSystemInfo({})
      const namespace = await connection.workflowService.describeNamespace({
        namespace: env.TEMPORAL_NAMESPACE
      })
      await connection.close()
      expect(systemInfo).toBeDefined()
      expect(namespace.namespaceInfo?.name).toBe(env.TEMPORAL_NAMESPACE)
    },
    90_000
  )

  it.skipIf(!shouldRunCloudMtlsIntegration)(
    'rejects access to an invalid namespace with otherwise valid mTLS credentials',
    async () => {
      const env = requireCloudMtlsEnv(getWorkerEnv())
      const connection = await NativeConnection.connect(
        resolveWorkerTemporalConnectionOptions(env)
      )
      try {
        const invalidNamespace = `${env.TEMPORAL_NAMESPACE}-invalid`
        await expect(
          connection.workflowService.describeNamespace({ namespace: invalidNamespace })
        ).rejects.toThrow(namespaceFailurePattern)
      } finally {
        await connection.close()
      }
    },
    90_000
  )

  it.skipIf(!shouldRunCloudMtlsIntegration)(
    'fails TLS handshake when server name override is invalid',
    async () => {
      const env = requireCloudMtlsEnv(getWorkerEnv())
      const invalidTlsEnv: WorkerEnv = {
        ...env,
        TEMPORAL_TLS_SERVER_NAME: 'invalid-temporal-hostname.local'
      }

      await expect(
        NativeConnection.connect(resolveWorkerTemporalConnectionOptions(invalidTlsEnv))
      ).rejects.toThrow(tlsFailurePattern)
    },
    90_000
  )

  it.skipIf(!shouldRunCloudMtlsIntegration)(
    'fails when client certificate material is invalid',
    async () => {
      const env = requireCloudMtlsEnv(getWorkerEnv())
      const invalidCertEnv: WorkerEnv = {
        ...env,
        TEMPORAL_TLS_CLIENT_CERT_PEM: '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----'
      }

      await expect(
        NativeConnection.connect(resolveWorkerTemporalConnectionOptions(invalidCertEnv))
      ).rejects.toThrow(tlsFailurePattern)
    },
    90_000
  )

  it.skipIf(!shouldRunCloudMtlsIntegration)(
    'fails auth when API key is invalid',
    async () => {
      const env = requireCloudMtlsEnv(getWorkerEnv())
      const invalidApiKeyEnv: WorkerEnv = {
        ...env,
        TEMPORAL_API_KEY: 'invalid-temporal-api-key'
      }

      let connection: NativeConnection | null = null
      try {
        connection = await NativeConnection.connect(
          resolveWorkerTemporalConnectionOptions(invalidApiKeyEnv)
        )
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(String(error)).toMatch(authFailurePattern)
        return
      }

      try {
        await expect(
          connection.workflowService.getSystemInfo({})
        ).rejects.toThrow(authFailurePattern)
      } finally {
        await connection.close()
      }
    },
    90_000
  )
})
