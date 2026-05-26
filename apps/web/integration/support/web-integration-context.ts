import {
  createDbAuthContext,
  type ApiFactoryContext
} from '@tx-agent-kit/testkit'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVitestWorkerSlot, resolveVitestWorkerSlot } from './vitest-worker'

const supportDir = dirname(fileURLToPath(import.meta.url))
const apiCwd = resolve(supportDir, '../../../api')
const offset = Number.parseInt(process.env.WORKTREE_PORT_OFFSET ?? '0', 10)
const workerSlot = resolveVitestWorkerSlot()
const webIntegrationPortStride = 10

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

const integrationBasePort = parsePositiveInt(
  process.env.WEB_INTEGRATION_API_PORT,
  4401 + offset
)
const fallbackIntegrationPort = integrationBasePort + (workerSlot - 1) * webIntegrationPortStride
const sharedWebIntegrationTestRunId = process.env.WEB_INTEGRATION_TEST_RUN_ID
const hasProvidedIntegrationApi = Boolean(
  process.env.INTEGRATION_API_BASE_URL && sharedWebIntegrationTestRunId
)

const dbAuthContext = createDbAuthContext({
  apiCwd,
  ...(hasProvidedIntegrationApi
    ? { api: { reuseHealthyServer: true } }
    : { host: '127.0.0.1', port: fallbackIntegrationPort }),
  authSecret: process.env.INTEGRATION_AUTH_SECRET ?? 'integration-shared-auth-secret-32ch',
  corsOrigin: 'http://localhost:3000',
  sql: {
    schemaPrefix: hasProvidedIntegrationApi
      ? 'web_integration'
      : `web_integration_slot_${workerSlot}`,
    ...(sharedWebIntegrationTestRunId ? { testRunId: sharedWebIntegrationTestRunId } : {})
  }
})

export const integrationBaseUrl = dbAuthContext.baseUrl.replace('127.0.0.1', 'localhost')

export const setupWebIntegrationSuite = async (): Promise<void> => {
  await dbAuthContext.setup()
}

export const resetWebIntegrationCase = async (): Promise<void> => {
  if (sharedWebIntegrationTestRunId) {
    await dbAuthContext.testContext.reset()
    return
  }

  await dbAuthContext.reset()
}

export const teardownWebIntegrationSuite = async (): Promise<void> => {
  await dbAuthContext.teardown()
  releaseVitestWorkerSlot()
}

export const createWebFactoryContext = (): ApiFactoryContext => dbAuthContext.apiFactoryContext

export const getWebIntegrationServerOutput = (): string => dbAuthContext.output.join('')
