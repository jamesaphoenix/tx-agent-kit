import {
  createDbAuthContext,
  type ApiFactoryContext
} from '@tx-agent-kit/testkit'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveWebIntegrationPidFilePath,
  resolveWebIntegrationPort,
  resolveWebIntegrationSchemaPrefix,
  resolveWebIntegrationTestRunId
} from './web-integration-harness'
import { resolveVitestWorkerSlot } from './vitest-worker'

const supportDir = dirname(fileURLToPath(import.meta.url))
const apiCwd = resolve(supportDir, '../../../api')
const workerSlot = resolveVitestWorkerSlot()
const integrationPort = resolveWebIntegrationPort(workerSlot)
const schemaPrefix = resolveWebIntegrationSchemaPrefix(workerSlot)
const testRunId = resolveWebIntegrationTestRunId(workerSlot)
const pidFilePath = resolveWebIntegrationPidFilePath(workerSlot)

const dbAuthContext = createDbAuthContext({
  apiCwd,
  host: '127.0.0.1',
  port: integrationPort,
  authSecret: 'web-integration-auth-secret-12345',
  corsOrigin: '*',
  sql: {
    testRunId,
    schemaPrefix
  },
  api: {
    reuseHealthyServer: true,
    detached: true,
    persistent: true,
    pidFilePath
  }
})

export const integrationBaseUrl = dbAuthContext.baseUrl

export const setupWebIntegrationSuite = async (): Promise<void> => {
  await dbAuthContext.setup()
}

export const resetWebIntegrationCase = async (): Promise<void> => {
  await dbAuthContext.reset()
}

export const teardownWebIntegrationSuite = async (): Promise<void> => {
  // Worker-slot API/DB harnesses are shared across files and cleaned up
  // centrally in vitest global teardown.
  return Promise.resolve()
}

export const createWebFactoryContext = (): ApiFactoryContext => dbAuthContext.apiFactoryContext

export const getWebIntegrationServerOutput = (): string => dbAuthContext.output.join('')
