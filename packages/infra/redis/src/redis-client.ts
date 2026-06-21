import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes
} from '@opentelemetry/api'
import { Redis } from 'ioredis'
import type { Redis as IORedisClient } from 'ioredis'

export type RedisClient = IORedisClient

export interface RedisClientOptions {
  readonly url: string
  readonly keyPrefix?: string
}

const redisClients = new Map<string, RedisClient>()
const instrumentedRedisClients = new WeakSet<RedisClient>()
const redisTracer = trace.getTracer('tx-agent-kit.redis')

type RedisErrorReporter = (error: unknown) => void
let redisErrorReporter: RedisErrorReporter = () => {}

/**
 * Register a handler for ioredis `'error'` events (connection drops/timeouts on
 * the long-lived, cached sockets). Backend processes inject their Sentry capture
 * at boot (e.g. `setRedisErrorReporter(captureWorkerException)`), so these are
 * reported instead of silently swallowed.
 *
 * Kept as an injected hook so this package stays free of any Sentry/logging
 * dependency. The default no-op still guarantees the no-crash invariant: ioredis
 * is an EventEmitter, and an `'error'` with no listener is escalated by Node to
 * an uncaught exception that crashes the process.
 */
export const setRedisErrorReporter = (reporter: RedisErrorReporter): void => {
  redisErrorReporter = reporter
}

type RedisSendCommand = RedisClient['sendCommand']
type RedisCommand = Parameters<RedisSendCommand>[0]
type RedisCommandStream = Parameters<RedisSendCommand>[1]

const redisClientKey = (options: RedisClientOptions): string =>
  `${options.keyPrefix ?? ''}\u0000${options.url}`

const getCommandName = (command: RedisCommand): string => {
  const name = (command as { readonly name?: unknown }).name
  if (typeof name !== 'string' || name.trim().length === 0) {
    return 'UNKNOWN'
  }

  return name.toUpperCase()
}

const getRedisConnectionAttributes = (
  options: RedisClientOptions
): Attributes => {
  try {
    const parsed = new URL(options.url)
    const attributes: Attributes = {
      'server.address': parsed.hostname
    }

    if (parsed.port.length > 0) {
      attributes['server.port'] = Number.parseInt(parsed.port, 10)
    }

    if (options.keyPrefix && options.keyPrefix.length > 0) {
      attributes['redis.key_prefix.enabled'] = true
    }

    return attributes
  } catch {
    return options.keyPrefix && options.keyPrefix.length > 0
      ? { 'redis.key_prefix.enabled': true }
      : {}
  }
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof (value as { readonly then?: unknown }).then === 'function'

const recordRedisCommandError = (
  span: ReturnType<typeof redisTracer.startSpan>,
  error: unknown
): void => {
  const normalizedError = toError(error)
  span.recordException(normalizedError)
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: normalizedError.message
  })
}

export const runWithRedisCommandSpan = <A>(
  commandName: string,
  connectionAttributes: Attributes,
  run: () => A
): A => {
  const span = redisTracer.startSpan(`redis.${commandName.toLowerCase()}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      'db.system.name': 'redis',
      'db.operation.name': commandName,
      ...connectionAttributes
    }
  })

  return context.with(trace.setSpan(context.active(), span), () => {
    try {
      const result = run()
      if (!isPromiseLike(result)) {
        span.end()
        return result
      }

      return finishRedisCommandPromise(result, span) as A
    } catch (error: unknown) {
      recordRedisCommandError(span, error)
      span.end()
      throw error
    }
  })
}

const finishRedisCommandPromise = async (
  result: PromiseLike<unknown>,
  span: ReturnType<typeof redisTracer.startSpan>
): Promise<unknown> => {
  try {
    const value = await result
    span.end()
    return value
  } catch (error: unknown) {
    recordRedisCommandError(span, error)
    span.end()
    throw error
  }
}

const instrumentRedisClient = (
  client: RedisClient,
  options: RedisClientOptions
): RedisClient => {
  if (instrumentedRedisClients.has(client)) {
    return client
  }

  instrumentedRedisClients.add(client)

  // ioredis sockets are long-lived and cached (getOrCreateRedisClient). They
  // emit 'error' on connection drops/timeouts; without a listener Node escalates
  // it to an uncaught exception and crashes the process. Consume it here (ioredis
  // reconnects on its own) AND forward to the injected reporter so it still
  // reaches Sentry instead of being silently swallowed.
  client.on('error', (error: unknown) => {
    redisErrorReporter(error)
  })

  const originalSendCommand = client.sendCommand.bind(client)
  const connectionAttributes = getRedisConnectionAttributes(options)

  const instrumentedSendCommand: RedisSendCommand = (
    command: RedisCommand,
    stream?: RedisCommandStream
  ): unknown => {
    const commandName = getCommandName(command)
    return runWithRedisCommandSpan(commandName, connectionAttributes, () =>
      originalSendCommand(command, stream)
    )
  }

  client.sendCommand = instrumentedSendCommand
  return client
}

export const createRedisClient = (options: RedisClientOptions): RedisClient =>
  instrumentRedisClient(
    new Redis(options.url, {
      keyPrefix: options.keyPrefix,
      lazyConnect: false,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 500,
      commandTimeout: 1000
    }),
    options
  )

export const getOrCreateRedisClient = (options: RedisClientOptions): RedisClient => {
  const key = redisClientKey(options)
  const existing = redisClients.get(key)
  if (existing) {
    return existing
  }

  const created = createRedisClient(options)
  redisClients.set(key, created)
  return created
}

export const closeRedisClient = (client: RedisClient): Promise<void> => {
  client.disconnect(false)
  return Promise.resolve()
}

export const closeRedisClients = async (): Promise<void> => {
  const clients = [...redisClients.values()]
  redisClients.clear()
  await Promise.all(clients.map(closeRedisClient))
}
