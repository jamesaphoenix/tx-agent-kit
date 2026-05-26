import {
  closeRedisClient,
  createRedisClient,
  createRedisQuotaLimiter,
  type RedisClient,
  type RedisQuotaLimiter
} from '@tx-agent-kit/redis'
import {
  getTestkitRedisUrl,
  getTestkitRedisWorktreeNamespace
} from './env.js'

export interface RedisTestkitOptions {
  readonly redisUrl?: string
  readonly keyPrefix?: string
}

export interface RedisQuotaTestkitOptions extends RedisTestkitOptions {
  readonly points: number
  readonly durationSeconds: number
}

export interface RedisQuotaTestkit {
  readonly client: RedisClient
  readonly limiter: RedisQuotaLimiter
  readonly close: () => Promise<void>
}

export const getRedisTestUrl = (): string =>
  getTestkitRedisUrl()

export const normalizeRedisKeyPrefix = (prefix: string): string =>
  prefix.endsWith(':') ? prefix : `${prefix}:`

const sanitizeRedisPrefixPart = (value: string): string => {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
  if (sanitized.length === 0) {
    throw new Error('Redis test prefix parts must contain at least one alphanumeric character')
  }
  return sanitized
}

export const getRedisWorktreeNamespace = (): string => {
  return getTestkitRedisWorktreeNamespace()
    .split(':')
    .map((part) => sanitizeRedisPrefixPart(part))
    .join(':')
}

export const createRedisTestKeyPrefix = (namespace: string): string => {
  const sanitizedNamespace = sanitizeRedisPrefixPart(namespace)
  return normalizeRedisKeyPrefix(`test:${getRedisWorktreeNamespace()}:${sanitizedNamespace}`)
}

export const createRedisTestClient = (options: RedisTestkitOptions = {}): RedisClient =>
  createRedisClient({
    url: options.redisUrl ?? getRedisTestUrl(),
    keyPrefix: options.keyPrefix
  })

export const closeRedisTestClient = async (client: RedisClient): Promise<void> => {
  await closeRedisClient(client)
}

export const pingRedisTestClient = async (client: RedisClient): Promise<void> => {
  await client.ping()
}

export const assertRedisTestClientHealthy = async (
  options: RedisTestkitOptions = {}
): Promise<void> => {
  const client = createRedisTestClient(options)
  try {
    await pingRedisTestClient(client)
  } finally {
    await closeRedisTestClient(client)
  }
}

export const scanRedisTestKeys = async (
  client: RedisClient,
  prefix: string
): Promise<string[]> => {
  const keys: string[] = []
  const pattern = `${normalizeRedisKeyPrefix(prefix)}*`
  let cursor = '0'

  do {
    const [nextCursor, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = nextCursor
    keys.push(...batch)
  } while (cursor !== '0')

  return keys
}

export const deleteRedisTestKeysByPrefix = async (
  client: RedisClient,
  prefix: string
): Promise<number> => {
  const keys = await scanRedisTestKeys(client, prefix)
  if (keys.length === 0) {
    return 0
  }
  return await client.del(...keys)
}

export const withRedisTestClient = async <T>(
  options: RedisTestkitOptions,
  run: (client: RedisClient) => Promise<T>
): Promise<T> => {
  const client = createRedisTestClient(options)
  try {
    return await run(client)
  } finally {
    await closeRedisTestClient(client)
  }
}

export const createRedisQuotaTestLimiter = (
  options: RedisQuotaTestkitOptions
): RedisQuotaTestkit => {
  const client = createRedisTestClient(options)
  const limiter = createRedisQuotaLimiter({
    client,
    keyPrefix: options.keyPrefix ?? createRedisTestKeyPrefix('quota'),
    points: options.points,
    durationSeconds: options.durationSeconds
  })
  return {
    client,
    limiter,
    close: () => closeRedisTestClient(client)
  }
}
