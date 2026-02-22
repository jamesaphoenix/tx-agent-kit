import {
  createOrganizationFactory,
  createUserFactory,
  createWorkspaceFactory,
  generateUniqueValue
} from '@tx-agent-kit/db'
import { authResponseSchema, workspaceSchema } from '@tx-agent-kit/contracts'
import * as Schema from 'effect/Schema'
import { createTestCaseId } from './test-run.js'
import type { SqlTestContext } from './sql-context.js'

export interface ApiFactoryContext {
  baseUrl: string
  testContext: SqlTestContext
}

export interface FactoryUser {
  id: string
  email: string
  name: string
  createdAt: string
}

export interface FactoryAuthResponse {
  token: string
  user: FactoryUser
}

export interface CreateUserOptions {
  email?: string
  password?: string
  name?: string
}

export interface CreatedUserSession extends FactoryAuthResponse {
  credentials: {
    email: string
    password: string
    name: string
  }
}

export interface LoginUserOptions {
  email: string
  password: string
}

export interface CreateTeamOptions {
  token: string
  name?: string
}

export interface CreatedTeam {
  id: string
  name: string
  ownerUserId: string
  createdAt: string
}

export interface CreateOrganizationAndTeamOptions {
  ownerUserId: string
  organizationName?: string
  teamName?: string
}

export interface CreatedOrganizationAndTeam {
  organization: {
    id: string
    name: string
    createdAt: Date
  }
  team: {
    id: string
    name: string
    ownerUserId: string
    organizationId: string | null
    createdAt: Date
  }
}

const toUrl = (context: ApiFactoryContext, path: string): string => `${context.baseUrl}${path}`

const parseJsonOrThrow = async (response: Response): Promise<unknown> => {
  const bodyText = await response.text()
  if (!bodyText) {
    throw new Error(`Expected JSON response but received empty body with status ${response.status}`)
  }

  try {
    return JSON.parse(bodyText) as unknown
  } catch {
    throw new Error(`Expected JSON response but received: ${bodyText}`)
  }
}

const decodeWithSchema = <A, I>(schema: Schema.Schema<A, I>, value: unknown, context: string): A => {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    throw new Error(`${context} response shape mismatch: ${String(error)}`)
  }
}

const deleteUserResponseSchema = Schema.Struct({
  deleted: Schema.Boolean
})

const withJsonHeaders = (
  context: ApiFactoryContext,
  caseName: string,
  headers?: HeadersInit
): HeadersInit => {
  const testHeaders = context.testContext.headersForCase(caseName, headers)
  return {
    'content-type': 'application/json',
    ...testHeaders
  }
}

export const createUser = async (
  context: ApiFactoryContext,
  options: CreateUserOptions = {}
): Promise<CreatedUserSession> => {
  const seed = createUserFactory({
    email: options.email,
    name: options.name
  })

  const payload = {
    email: seed.email,
    password: options.password ?? 'factory-pass-12345',
    name: seed.name
  }

  const response = await fetch(toUrl(context, '/v1/auth/sign-up'), {
    method: 'POST',
    headers: withJsonHeaders(context, 'create-user'),
    body: JSON.stringify(payload)
  })

  const body = await parseJsonOrThrow(response)
  if (response.status !== 201) {
    throw new Error(`createUser failed (${response.status}): ${JSON.stringify(body)}`)
  }

  return {
    ...decodeWithSchema(authResponseSchema, body, 'createUser'),
    credentials: payload
  }
}

export const loginUser = async (
  context: ApiFactoryContext,
  options: LoginUserOptions
): Promise<FactoryAuthResponse> => {
  const response = await fetch(toUrl(context, '/v1/auth/sign-in'), {
    method: 'POST',
    headers: withJsonHeaders(context, 'login-user'),
    body: JSON.stringify(options)
  })

  const body = await parseJsonOrThrow(response)
  if (response.status !== 200) {
    throw new Error(`loginUser failed (${response.status}): ${JSON.stringify(body)}`)
  }

  return decodeWithSchema(authResponseSchema, body, 'loginUser')
}

export const deleteUser = async (
  context: ApiFactoryContext,
  token: string
): Promise<{ deleted: boolean }> => {
  const response = await fetch(toUrl(context, '/v1/auth/me'), {
    method: 'DELETE',
    headers: withJsonHeaders(context, 'delete-user', {
      authorization: `Bearer ${token}`
    })
  })

  const body = await parseJsonOrThrow(response)
  if (response.status !== 200) {
    throw new Error(`deleteUser failed (${response.status}): ${JSON.stringify(body)}`)
  }

  return decodeWithSchema(deleteUserResponseSchema, body, 'deleteUser')
}

export const createTeam = async (
  context: ApiFactoryContext,
  options: CreateTeamOptions
): Promise<CreatedTeam> => {
  const response = await fetch(toUrl(context, '/v1/workspaces'), {
    method: 'POST',
    headers: withJsonHeaders(context, 'create-team', {
      authorization: `Bearer ${options.token}`
    }),
    body: JSON.stringify({
      name: options.name ?? generateUniqueValue('Team')
    })
  })

  const body = await parseJsonOrThrow(response)
  if (response.status !== 201) {
    throw new Error(`createTeam failed (${response.status}): ${JSON.stringify(body)}`)
  }

  return decodeWithSchema(workspaceSchema, body, 'createTeam')
}

export const createOrganizationAndTeam = async (
  context: ApiFactoryContext,
  options: CreateOrganizationAndTeamOptions
): Promise<CreatedOrganizationAndTeam> => {
  return context.testContext.withSchemaClient(async (client) => {
    const organizationSeed = createOrganizationFactory({ name: options.organizationName })

    const organizationResult = await client.query<{
      id: string
      name: string
      createdAt: Date
    }>(
      `
        INSERT INTO organizations (id, name, created_at)
        VALUES ($1, $2, $3)
        RETURNING id, name, created_at AS "createdAt"
      `,
      [organizationSeed.id, organizationSeed.name, organizationSeed.createdAt]
    )

    const organization = organizationResult.rows[0]
    if (!organization) {
      throw new Error('Failed to create organization record')
    }

    const teamSeed = createWorkspaceFactory({
      ownerUserId: options.ownerUserId,
      organizationId: organization.id,
      name: options.teamName
    })

    const teamResult = await client.query<{
      id: string
      name: string
      ownerUserId: string
      organizationId: string | null
      createdAt: Date
    }>(
      `
        INSERT INTO workspaces (id, name, owner_user_id, organization_id, created_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, owner_user_id AS "ownerUserId", organization_id AS "organizationId", created_at AS "createdAt"
      `,
      [teamSeed.id, teamSeed.name, teamSeed.ownerUserId, teamSeed.organizationId, teamSeed.createdAt]
    )

    const team = teamResult.rows[0]
    if (!team) {
      throw new Error('Failed to create team record')
    }

    return {
      organization,
      team
    }
  })
}

export const withTestHeaders = (
  context: ApiFactoryContext,
  caseName: string,
  headers?: HeadersInit
): Record<string, string> => context.testContext.headersForCase(caseName, headers)

export const getTestCaseId = (context: ApiFactoryContext, caseName: string): string =>
  createTestCaseId(context.testContext.testRunId, caseName)
