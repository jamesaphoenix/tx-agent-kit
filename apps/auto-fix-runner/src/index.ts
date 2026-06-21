import { NativeConnection, Worker } from '@temporalio/worker'
import type { NativeConnectionOptions } from '@temporalio/worker'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUTO_FIX_TASK_QUEUE } from '@tx-agent-kit/contracts'
import { createLogger } from '@tx-agent-kit/logging'
import { autoFixActivities } from './activities.js'
import { getAutoFixRunnerEnv } from './config/env.js'

const logger = createLogger('auto-fix-runner')
const currentDir = dirname(fileURLToPath(import.meta.url))

const resolveConnectionOptions = (env: ReturnType<typeof getAutoFixRunnerEnv>): NativeConnectionOptions => {
  const base: NativeConnectionOptions = { address: env.TEMPORAL_ADDRESS }
  if (env.TEMPORAL_API_KEY) {
    return {
      ...base,
      apiKey: env.TEMPORAL_API_KEY,
      ...(env.TEMPORAL_TLS_ENABLED ? { tls: true } : {})
    }
  }
  if (env.TEMPORAL_TLS_ENABLED) {
    return { ...base, tls: true }
  }
  return base
}

/**
 * Host auto-fix Temporal worker entrypoint.
 *
 * Serves ONLY the `auto-fix` task queue with `maxConcurrentActivityTaskExecutions: 1`
 * — that is the single-flight guarantee (no lock file). Runs as a plain Node
 * process on a single host (via launchd), NOT inside a container, because the
 * activity spawns the codex/claude CLI + git/gh.
 */
async function main(): Promise<void> {
  const env = getAutoFixRunnerEnv()

  const connection = await NativeConnection.connect(resolveConnectionOptions(env))

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: AUTO_FIX_TASK_QUEUE,
    workflowsPath: resolve(currentDir, './workflows.js'),
    activities: autoFixActivities,
    // CRITICAL: exactly one auto-fix agent runs at a time, queue-wide.
    maxConcurrentActivityTaskExecutions: 1,
    shutdownGraceTime: '30s'
  })

  logger.info('Auto-fix Temporal worker started', {
    taskQueue: AUTO_FIX_TASK_QUEUE,
    namespace: env.TEMPORAL_NAMESPACE,
    agent: env.AUTO_FIX_AGENT,
    enabled: env.AUTO_FIX_ENABLED,
    baseBranch: env.AUTO_FIX_BASE_BRANCH,
    maxConcurrentActivityTaskExecutions: 1
  })

  const shutdown = (signal: string): void => {
    logger.info('Shutdown signal received', { signal })
    worker.shutdown()
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  try {
    await worker.run()
  } finally {
    await connection.close()
    logger.info('Auto-fix Temporal worker stopped')
  }
}

main().catch((error: unknown) => {
  logger.error(
    'Auto-fix worker failed to start',
    {},
    error instanceof Error ? error : new Error(String(error))
  )
  process.exitCode = 1
})
