export interface TestkitEnv {
  DATABASE_URL: string | undefined
  TESTKIT_COMMAND_TIMEOUT_MS: string | undefined
  INFRA_READY_TIMEOUT_SECONDS: string | undefined
  TESTKIT_INFRA_TIMEOUT_HEADROOM_SECONDS: string | undefined
  TESTKIT_ALLOW_UNSAFE_DATABASE_URL: string | undefined
  VITEST_WORKER_ID: string | undefined
  VITEST_POOL_ID: string | undefined
  MOBILE_INTEGRATION_API_PORT: string | undefined
}

export const getTestkitEnv = (): TestkitEnv => {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    TESTKIT_COMMAND_TIMEOUT_MS: process.env.TESTKIT_COMMAND_TIMEOUT_MS,
    INFRA_READY_TIMEOUT_SECONDS: process.env.INFRA_READY_TIMEOUT_SECONDS,
    TESTKIT_INFRA_TIMEOUT_HEADROOM_SECONDS:
      process.env.TESTKIT_INFRA_TIMEOUT_HEADROOM_SECONDS,
    TESTKIT_ALLOW_UNSAFE_DATABASE_URL: process.env.TESTKIT_ALLOW_UNSAFE_DATABASE_URL,
    VITEST_WORKER_ID: process.env.VITEST_WORKER_ID,
    VITEST_POOL_ID: process.env.VITEST_POOL_ID,
    MOBILE_INTEGRATION_API_PORT: process.env.MOBILE_INTEGRATION_API_PORT
  }
}

export const getTestkitProcessEnv = (): NodeJS.ProcessEnv => {
  return { ...process.env }
}
