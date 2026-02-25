import {
  createTeam as createTeamFactory,
  createUser as createUserFactory,
  deleteUser as deleteUserFactory,
  loginUser as loginUserFactory,
  type ApiFactoryContext,
  type CreateOrganizationOptions,
  type CreateUserOptions,
  type CreatedOrganization,
  type CreatedUserSession,
  type FactoryAuthResponse,
  type LoginUserOptions
} from './api-factories.js'
import {
  createApiServerHarness,
  type CreateApiServerHarnessOptions
} from './api-server-harness.js'
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
  setup: () => Promise<void>
  reset: () => Promise<void>
  teardown: () => Promise<void>
  createUser: (options?: CreateUserOptions) => Promise<CreatedUserSession>
  loginUser: (options: LoginUserOptions) => Promise<FactoryAuthResponse>
  deleteUser: (token: string) => Promise<{ deleted: boolean }>
  createTeam: (options: CreateOrganizationOptions) => Promise<CreatedOrganization>
}

export const createDbAuthContext = (options: CreateDbAuthContextOptions): DbAuthContext => {
  const testContext = createSqlTestContext(options.sql)

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
    setup: async () => {
      await apiHarness.setup()
      await apiHarness.start()
    },
    reset: async () => {
      await apiHarness.reset()
    },
    teardown: async () => {
      await apiHarness.teardown()
    },
    createUser: async (createUserOptions?: CreateUserOptions) =>
      createUserFactory(getFactoryContext(), createUserOptions),
    loginUser: async (loginUserOptions: LoginUserOptions) =>
      loginUserFactory(getFactoryContext(), loginUserOptions),
    deleteUser: async (token: string) => deleteUserFactory(getFactoryContext(), token),
    createTeam: async (createOrganizationOptions: CreateOrganizationOptions) =>
      createTeamFactory(getFactoryContext(), createOrganizationOptions)
  }
}
