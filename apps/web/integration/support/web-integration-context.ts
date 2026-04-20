import {
  createDbAuthContext,
  type ApiFactoryContext
} from '@tx-agent-kit/testkit'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const supportDir = dirname(fileURLToPath(import.meta.url))
const apiCwd = resolve(supportDir, '../../../api')

// Shared server: no explicit port — createDbAuthContext resolves from WORKTREE_PORT_OFFSET
const dbAuthContext = createDbAuthContext({
  apiCwd,
  authSecret: process.env.INTEGRATION_AUTH_SECRET ?? 'integration-shared-auth-secret-32ch',
  corsOrigin: 'http://localhost:3000',
  sql: {
    schemaPrefix: 'web_integration'
  }
})

// Use localhost instead of 127.0.0.1 for jsdom compatibility (XMLHttpRequest)
const offset = Number.parseInt(process.env.WORKTREE_PORT_OFFSET ?? '0', 10)
export const integrationBaseUrl = `http://localhost:${4100 + offset}`

export const setupWebIntegrationSuite = async (): Promise<void> => {
  await dbAuthContext.setup()
}

export const resetWebIntegrationCase = async (): Promise<void> => {
  await dbAuthContext.reset()
}

export const teardownWebIntegrationSuite = (): void => {
  // No-op: global teardown handles shared server cleanup
}

export const createWebFactoryContext = (): ApiFactoryContext => dbAuthContext.apiFactoryContext

export const getWebIntegrationServerOutput = (): string => dbAuthContext.output.join('')
