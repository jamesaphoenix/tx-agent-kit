import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export interface TestkitEnv {
  DATABASE_URL: string | undefined
  DATABASE_SCHEMA: string | undefined
  REDIS_URL: string | undefined
  REDIS_PORT: string | undefined
  TESTKIT_REDIS_NAMESPACE: string | undefined
  TESTKIT_COMMAND_TIMEOUT_MS: string | undefined
  INFRA_READY_TIMEOUT_SECONDS: string | undefined
  TESTKIT_INFRA_TIMEOUT_HEADROOM_SECONDS: string | undefined
  TESTKIT_ALLOW_UNSAFE_DATABASE_URL: string | undefined
  VITEST_WORKER_ID: string | undefined
  VITEST_POOL_ID: string | undefined
  MOBILE_INTEGRATION_API_PORT: string | undefined
  RUN_LIVE_K3S_STAGING_INTEGRATION: string | undefined
  LIVE_K3S_STAGING_ARTIFACT_FILE: string | undefined
  RUN_TUNNEL_CHECK_SOFT_FAIL: string | undefined
  RUN_LIVE_TUNNEL_INTEGRATION: string | undefined
  RUN_LIVE_TUNNEL_NEGATIVE_INTEGRATION: string | undefined
  LIVE_TUNNEL_MODE: string | undefined
  RUN_COMPOSE_E2E: string | undefined
  WORKTREE_PORT_OFFSET: string | undefined
  INTEGRATION_API_BASE_URL: string | undefined
  TX_INTEGRATION_SHARED_API_READY: string | undefined
  INTEGRATION_AUTH_SECRET: string | undefined
}

export const getTestkitEnv = (): TestkitEnv => {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SCHEMA: process.env.DATABASE_SCHEMA,
    REDIS_URL: process.env.REDIS_URL,
    REDIS_PORT: process.env.REDIS_PORT,
    TESTKIT_REDIS_NAMESPACE: process.env.TESTKIT_REDIS_NAMESPACE,
    TESTKIT_COMMAND_TIMEOUT_MS: process.env.TESTKIT_COMMAND_TIMEOUT_MS,
    INFRA_READY_TIMEOUT_SECONDS: process.env.INFRA_READY_TIMEOUT_SECONDS,
    TESTKIT_INFRA_TIMEOUT_HEADROOM_SECONDS:
      process.env.TESTKIT_INFRA_TIMEOUT_HEADROOM_SECONDS,
    TESTKIT_ALLOW_UNSAFE_DATABASE_URL: process.env.TESTKIT_ALLOW_UNSAFE_DATABASE_URL,
    VITEST_WORKER_ID: process.env.VITEST_WORKER_ID,
    VITEST_POOL_ID: process.env.VITEST_POOL_ID,
    MOBILE_INTEGRATION_API_PORT: process.env.MOBILE_INTEGRATION_API_PORT,
    RUN_LIVE_K3S_STAGING_INTEGRATION: process.env.RUN_LIVE_K3S_STAGING_INTEGRATION,
    LIVE_K3S_STAGING_ARTIFACT_FILE: process.env.LIVE_K3S_STAGING_ARTIFACT_FILE,
    RUN_TUNNEL_CHECK_SOFT_FAIL: process.env.RUN_TUNNEL_CHECK_SOFT_FAIL,
    RUN_LIVE_TUNNEL_INTEGRATION: process.env.RUN_LIVE_TUNNEL_INTEGRATION,
    RUN_LIVE_TUNNEL_NEGATIVE_INTEGRATION:
      process.env.RUN_LIVE_TUNNEL_NEGATIVE_INTEGRATION,
    LIVE_TUNNEL_MODE: process.env.LIVE_TUNNEL_MODE,
    RUN_COMPOSE_E2E: process.env.RUN_COMPOSE_E2E,
    WORKTREE_PORT_OFFSET: process.env.WORKTREE_PORT_OFFSET,
    INTEGRATION_API_BASE_URL: process.env.INTEGRATION_API_BASE_URL,
    TX_INTEGRATION_SHARED_API_READY: process.env.TX_INTEGRATION_SHARED_API_READY,
    INTEGRATION_AUTH_SECRET: process.env.INTEGRATION_AUTH_SECRET
  }
}

export const getTestkitProcessEnv = (): NodeJS.ProcessEnv => {
  return { ...process.env }
}

export const getTestkitRedisUrl = (): string =>
  getTestkitEnv().REDIS_URL ?? `redis://127.0.0.1:${getTestkitEnv().REDIS_PORT ?? '6379'}`

const findWorkspaceRoot = (startDir: string): string => {
  let current = resolve(startDir)
  for (;;) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      return resolve(startDir)
    }
    current = parent
  }
}

const getDefaultRedisNamespacePart = (): string =>
  `repo-${createHash('sha1').update(findWorkspaceRoot(process.cwd())).digest('hex').slice(0, 8)}`

export const getTestkitRedisWorktreeNamespace = (): string => {
  const env = getTestkitEnv()
  const repoPart = env.TESTKIT_REDIS_NAMESPACE && env.TESTKIT_REDIS_NAMESPACE.trim().length > 0
    ? env.TESTKIT_REDIS_NAMESPACE
    : getDefaultRedisNamespacePart()
  const worktreePart = env.WORKTREE_PORT_OFFSET
    ? `worktree-${env.WORKTREE_PORT_OFFSET}`
    : 'worktree-root'
  const schemaPart = env.DATABASE_SCHEMA
    ? `schema-${env.DATABASE_SCHEMA}`
    : 'schema-public'
  return `${repoPart}:${worktreePart}:${schemaPart}`
}
