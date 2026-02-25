import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDbAuthContext } from './db-auth-context.js'
import { runDeploySmoke } from './deploy-smoke.js'

const apiCwd = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/api')
const deploySmokeApiPort = Number.parseInt(process.env.TESTKIT_DEPLOY_SMOKE_API_PORT ?? '4108', 10)

const dbAuthContext = createDbAuthContext({
  apiCwd,
  host: '127.0.0.1',
  port: deploySmokeApiPort,
  authSecret: 'testkit-deploy-smoke-auth-secret-12345',
  corsOrigin: '*',
  sql: {
    schemaPrefix: 'deploy_smoke'
  }
})

beforeAll(async () => {
  await dbAuthContext.setup()
})

beforeEach(async () => {
  await dbAuthContext.reset()
})

afterAll(async () => {
  await dbAuthContext.teardown()
})

describe.sequential('deploy smoke integration', () => {
  it(
    'executes deploy smoke CLI against live API critical flows',
    () => {
      const { result, output } = runDeploySmoke(dbAuthContext.baseUrl)

      expect(result.exitCode).toBe(0)
      expect(output).toContain('Deploy smoke checks passed')
    },
    150_000
  )
})
