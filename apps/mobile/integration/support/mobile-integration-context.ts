import {
  createDbAuthContext,
  type ApiFactoryContext
} from '../../../../packages/testkit/src/index.ts'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const integrationPort = parsePositiveInt(process.env.MOBILE_INTEGRATION_API_PORT, 4106)

const dbAuthContext = createDbAuthContext({
  apiCwd,
  host: '127.0.0.1',
  port: integrationPort,
  authSecret: 'mobile-integration-auth-secret-12345',
  corsOrigin: '*',
  sql: {
    schemaPrefix: 'mobile_integration'
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
