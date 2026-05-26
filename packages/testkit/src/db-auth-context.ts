import {
  createInvitation as createInvitationFactory,
  createOrganization as createOrganizationFactory,
  createUser as createUserFactory,
  createUserWithOrg as createUserWithOrgFactory,
  createUserWithOrgAndInvitation as createUserWithOrgAndInvitationFactory,
  deleteUser as deleteUserFactory,
  loginUser as loginUserFactory,
  type ApiFactoryContext,
  type CreateInvitationOptions,
  type CreateOrganizationOptions,
  type CreateUserOptions,
  type CreatedInvitation,
  type CreatedOrganization,
  type CreatedUserSession,
  type FactoryAuthResponse,
  type LoginUserOptions
} from './api-factories.js'
import {
  createApiServerHarness,
  type CreateApiServerHarnessOptions
} from './api-server-harness.js'
import { getTestkitEnv } from './env.js'
import { parseLogOutput, type LogCapture } from './log-capture.js'
import { createSqlTestContext, type CreateSqlTestContextOptions, type SqlTestContext } from './sql-context.js'

export interface CreateDbAuthContextOptions {
  apiCwd: string
  host?: string
  port?: number
  authSecret?: string
  corsOrigin?: string
  startupTimeoutMs?: number
  sql?: CreateSqlTestContextOptions
  api?: Pick<
    CreateApiServerHarnessOptions,
    'reuseHealthyServer' | 'detached' | 'persistent' | 'pidFilePath'
  >
}

export interface DbAuthContext {
  readonly baseUrl: string
  readonly testContext: SqlTestContext
  readonly apiFactoryContext: ApiFactoryContext
  readonly output: ReadonlyArray<string>
  readonly logs: LogCapture
  readonly resetStrategy: 'per-test' | 'deferred'
  setup: () => Promise<void>
  reset: () => Promise<void>
  flushReset: () => Promise<void>
  teardown: () => Promise<void>
  createUser: (options?: CreateUserOptions) => Promise<CreatedUserSession>
  loginUser: (options: LoginUserOptions) => Promise<FactoryAuthResponse>
  deleteUser: (token: string) => Promise<{ deleted: boolean }>
  createOrganization: (options: CreateOrganizationOptions) => Promise<CreatedOrganization>
  createInvitation: (options: CreateInvitationOptions) => Promise<CreatedInvitation>
  createUserWithOrg: (options?: {
    user?: CreateUserOptions
    organization?: { name?: string }
  }) => Promise<{ user: CreatedUserSession; org: CreatedOrganization; token: string }>
  createUserWithOrgAndInvitation: (options?: {
    owner?: CreateUserOptions
    invitee?: CreateUserOptions
    organization?: { name?: string }
    invitation?: { role?: 'admin' | 'member' }
  }) => Promise<{
    owner: CreatedUserSession
    invitee: CreatedUserSession
    org: CreatedOrganization
    invitation: CreatedInvitation
    ownerToken: string
    inviteeToken: string
  }>
}

/**
 * Uses the shared integration API only after the root workspace global setup
 * has started or reused it and exported the base URL. Direct package-level
 * vitest runs fall back to the per-context harness instead of silently
 * talking to any stale process that happens to be healthy on port 4100.
 */
const resolveSharedServer = (): { baseUrl: string; authSecret: string } | undefined => {
  const env = getTestkitEnv()
  if (!env.INTEGRATION_API_BASE_URL) {
    return undefined
  }

  const authSecret = env.INTEGRATION_AUTH_SECRET ?? 'integration-shared-auth-secret-32ch'
  return { baseUrl: env.INTEGRATION_API_BASE_URL, authSecret }
}

export const createDbAuthContext = (options: CreateDbAuthContextOptions): DbAuthContext => {
  const env = getTestkitEnv()
  const workspaceSharedApiReady = env.TX_INTEGRATION_SHARED_API_READY === '1'
  // Shared API reuse is opt-in unless the root Vitest workspace global setup
  // started the shared API for this run. Tests that need an isolated API
  // process should pass an explicit port and use the per-context harness.
  const sharedServer =
    options.port === undefined &&
    (options.api?.reuseHealthyServer === true || workspaceSharedApiReady)
      ? resolveSharedServer()
      : undefined

  const testContext = createSqlTestContext(options.sql)

  // Shared server path: no API harness, just point HTTP traffic at the
  // already-running server from vitest-global-setup.
  if (sharedServer) {
    const { baseUrl } = sharedServer
    const output: string[] = []

    const getFactoryContext = (): ApiFactoryContext => ({
      baseUrl,
      testContext
    })

    return {
      baseUrl,
      testContext,
      get apiFactoryContext() {
        return getFactoryContext()
      },
      output,
      get logs() {
        return parseLogOutput(output)
      },
      get resetStrategy() {
        return testContext.resetStrategy
      },
      setup: async () => {
        // Verify the shared server is healthy
        const healthUrl = `${baseUrl}/health`
        const response = await fetch(healthUrl).catch(() => undefined)
        if (!response?.ok) {
          throw new Error(
            `Shared integration API server is not healthy at ${healthUrl}. ` +
            'Ensure vitest-global-setup.ts started the shared server before tests run.'
          )
        }
      },
      reset: async () => {
        // No-op: data isolation is per-user
      },
      flushReset: async () => {
        // No-op in shared server mode
      },
      teardown: async () => {
        // No-op: global teardown handles cleanup
      },
      createUser: async (createUserOptions?: CreateUserOptions) =>
        createUserFactory(getFactoryContext(), createUserOptions),
      loginUser: async (loginUserOptions: LoginUserOptions) =>
        loginUserFactory(getFactoryContext(), loginUserOptions),
      deleteUser: async (token: string) => deleteUserFactory(getFactoryContext(), token),
      createOrganization: async (createOrganizationOptions: CreateOrganizationOptions) =>
        createOrganizationFactory(getFactoryContext(), createOrganizationOptions),
      createInvitation: async (invitationOptions: CreateInvitationOptions) =>
        createInvitationFactory(getFactoryContext(), invitationOptions),
      createUserWithOrg: async (userWithOrgOptions) =>
        createUserWithOrgFactory(getFactoryContext(), userWithOrgOptions),
      createUserWithOrgAndInvitation: async (userWithOrgAndInvitationOptions) =>
        createUserWithOrgAndInvitationFactory(getFactoryContext(), userWithOrgAndInvitationOptions)
    }
  }

  // Fallback: no shared server — spawn a per-context API server via the harness.
  const apiHarness = createApiServerHarness({
    cwd: options.apiCwd,
    host: options.host,
    port: options.port,
    authSecret: options.authSecret,
    corsOrigin: options.corsOrigin,
    startupTimeoutMs: options.startupTimeoutMs,
    testContext,
    ...(options.api ?? {})
  })

  const getFactoryContext = (): ApiFactoryContext => ({
    baseUrl: apiHarness.baseUrl,
    testContext
  })

  return {
    baseUrl: apiHarness.baseUrl,
    testContext,
    get apiFactoryContext() {
      return getFactoryContext()
    },
    output: apiHarness.output,
    get logs() {
      return parseLogOutput(apiHarness.output)
    },
    get resetStrategy() {
      return testContext.resetStrategy
    },
    setup: async () => {
      await apiHarness.setup()
      await apiHarness.start()
    },
    reset: async () => {
      await apiHarness.reset()
    },
    flushReset: async () => {
      await testContext.flushReset()
    },
    teardown: async () => {
      await apiHarness.teardown()
    },
    createUser: async (createUserOptions?: CreateUserOptions) =>
      createUserFactory(getFactoryContext(), createUserOptions),
    loginUser: async (loginUserOptions: LoginUserOptions) =>
      loginUserFactory(getFactoryContext(), loginUserOptions),
    deleteUser: async (token: string) => deleteUserFactory(getFactoryContext(), token),
    createOrganization: async (createOrganizationOptions: CreateOrganizationOptions) =>
      createOrganizationFactory(getFactoryContext(), createOrganizationOptions),
    createInvitation: async (invitationOptions: CreateInvitationOptions) =>
      createInvitationFactory(getFactoryContext(), invitationOptions),
    createUserWithOrg: async (userWithOrgOptions) =>
      createUserWithOrgFactory(getFactoryContext(), userWithOrgOptions),
    createUserWithOrgAndInvitation: async (userWithOrgAndInvitationOptions) =>
      createUserWithOrgAndInvitationFactory(getFactoryContext(), userWithOrgAndInvitationOptions)
  }
}
