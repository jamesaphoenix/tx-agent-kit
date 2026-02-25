import {
  createDbAuthContext,
  type ApiFactoryContext
} from '../../../../packages/testkit/src/index.ts'
import { getTestkitEnv } from '../../../../packages/testkit/src/env.ts'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mobileIntegrationPortStride = 10

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

const supportDir = dirname(fileURLToPath(import.meta.url))
const apiCwd = resolve(supportDir, '../../../api')
const testkitEnv = getTestkitEnv()
const workerSlot = parsePositiveInt(
  testkitEnv.VITEST_WORKER_ID ?? testkitEnv.VITEST_POOL_ID,
  1
)
const integrationBasePort = parsePositiveInt(testkitEnv.MOBILE_INTEGRATION_API_PORT, 4106)
const integrationPort = integrationBasePort + (workerSlot - 1) * mobileIntegrationPortStride
const integrationSchemaPrefix = `mobile_integration_slot_${workerSlot}`

const dbAuthContext = createDbAuthContext({
  apiCwd,
  host: '127.0.0.1',
  port: integrationPort,
  authSecret: 'mobile-integration-auth-secret-12345',
  corsOrigin: '*',
  sql: {
    schemaPrefix: integrationSchemaPrefix
  }
})

export const mobileIntegrationBaseUrl = dbAuthContext.baseUrl

export const setupMobileIntegrationSuite = async (): Promise<void> => {
  await dbAuthContext.setup()
}

export const resetMobileIntegrationCase = async (): Promise<void> => {
  await dbAuthContext.reset()
}

export const teardownMobileIntegrationSuite = async (): Promise<void> => {
  await dbAuthContext.teardown()
}

export const createMobileFactoryContext = (): ApiFactoryContext =>
  dbAuthContext.apiFactoryContext
