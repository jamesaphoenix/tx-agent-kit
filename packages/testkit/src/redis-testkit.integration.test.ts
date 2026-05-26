import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertRedisTestClientHealthy,
  createRedisTestKeyPrefix,
  deleteRedisTestKeysByPrefix,
  withRedisTestClient
} from './redis-testkit.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const hydrateRedisUrlForStandalonePackageRun = (): void => {
  if (process.env.REDIS_URL) {
    return
  }
  try {
    const output = execFileSync(
      'docker',
      ['compose', '-p', process.env.COMPOSE_PROJECT_NAME ?? 'tx-agent-kit', 'port', 'redis', '6379'],
      {
        cwd: projectRoot,
        env: process.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }
    ).trim()
    const port = output.match(/:(\d+)$/u)?.[1]
    if (port) {
      process.env.REDIS_PORT = port
      process.env.REDIS_URL = `redis://127.0.0.1:${port}`
    }
  } catch {
    process.env.REDIS_URL = `redis://127.0.0.1:${process.env.REDIS_PORT ?? '6379'}`
  }
}

describe('redis-testkit integration', () => {
  it('pings Redis and cleans up only keys in the current test namespace', async () => {
    hydrateRedisUrlForStandalonePackageRun()
    const prefix = createRedisTestKeyPrefix('integration')
    const key = `${prefix}probe`

    await assertRedisTestClientHealthy({ keyPrefix: prefix })

    await withRedisTestClient({ keyPrefix: prefix }, async (client) => {
      await client.set('probe', '1')
      await expect(client.get('probe')).resolves.toBe('1')
    })

    await withRedisTestClient({}, async (client) => {
      await expect(client.get(key)).resolves.toBe('1')
      await expect(deleteRedisTestKeysByPrefix(client, prefix)).resolves.toBe(1)
      await expect(client.get(key)).resolves.toBeNull()
    })
  })
})
