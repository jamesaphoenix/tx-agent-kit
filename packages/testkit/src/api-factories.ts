import {
  createOrganizationFactory,
  createTeamFactory,
  createUserFactory,
  generateUniqueValue
} from '@tx-agent-kit/db'
import {
  authResponseSchema,
  invitationSchema,
  organizationSchema,
  type MembershipType
} from '@tx-agent-kit/contracts'
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
  refreshToken: string
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

export interface CreateOrganizationOptions {
  token: string
  name?: string
}

export interface CreatedOrganization {
  id: string
  name: string
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

const requireRefreshToken = (
  response: { refreshToken?: string },
  context: string
): string => {
  if (typeof response.refreshToken !== 'string' || response.refreshToken.length === 0) {
    throw new Error(`${context} response did not include a refresh token`)
  }

  return response.refreshToken
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

  const decoded = decodeWithSchema(authResponseSchema, body, 'createUser')

  return {
    ...decoded,
    refreshToken: requireRefreshToken(decoded, 'createUser'),
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

  const decoded = decodeWithSchema(authResponseSchema, body, 'loginUser')

  return {
    ...decoded,
    refreshToken: requireRefreshToken(decoded, 'loginUser')
  }
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

export const createOrganization = async (
  context: ApiFactoryContext,
  options: CreateOrganizationOptions
): Promise<CreatedOrganization> => {
  const response = await fetch(toUrl(context, '/v1/organizations'), {
    method: 'POST',
    headers: withJsonHeaders(context, 'create-organization', {
      authorization: `Bearer ${options.token}`
    }),
    body: JSON.stringify({
      name: options.name ?? generateUniqueValue('Organization')
    })
  })

  const body = await parseJsonOrThrow(response)
  if (response.status !== 201) {
    throw new Error(`createOrganization failed (${response.status}): ${JSON.stringify(body)}`)
  }

  return decodeWithSchema(organizationSchema, body, 'createOrganization')
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

    const teamSeed = createTeamFactory({
      organizationId: organization.id,
      name: options.teamName
    })

    const teamResult = await client.query<{
      id: string
      name: string
      organizationId: string | null
      createdAt: Date
    }>(
      `
        INSERT INTO teams (id, name, organization_id, created_at)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, organization_id AS "organizationId", created_at AS "createdAt"
      `,
      [teamSeed.id, teamSeed.name, teamSeed.organizationId, teamSeed.createdAt]
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

export interface CreateInvitationOptions {
  token: string
  organizationId: string
  email: string
  role?: 'admin' | 'member'
  membershipType?: MembershipType
}

export interface CreatedInvitation {
  id: string
  organizationId: string
  email: string
  role: string
  status: string
  invitedByUserId: string
  token: string
  expiresAt: string
  teamId: string | null
  membershipType: MembershipType
  createdAt: string
}

export const createInvitation = async (
  context: ApiFactoryContext,
  options: CreateInvitationOptions
): Promise<CreatedInvitation> => {
  const response = await fetch(toUrl(context, '/v1/invitations'), {
    method: 'POST',
    headers: withJsonHeaders(context, 'create-invitation', {
      authorization: `Bearer ${options.token}`
    }),
    body: JSON.stringify({
          organizationId: options.organizationId,
          email: options.email,
          role: options.role ?? 'member',
          ...(options.membershipType ? { membershipType: options.membershipType } : {})
        })
  })

  const body = await parseJsonOrThrow(response)
  if (response.status !== 201) {
    throw new Error(`createInvitation failed (${response.status}): ${JSON.stringify(body)}`)
  }

  return decodeWithSchema(invitationSchema, body, 'createInvitation')
}

export const createUserWithOrg = async (
  context: ApiFactoryContext,
  options?: {
    user?: CreateUserOptions
    organization?: { name?: string }
  }
): Promise<{ user: CreatedUserSession; org: CreatedOrganization; token: string }> => {
  const user = await createUser(context, options?.user)
  const org = await createOrganization(context, {
    token: user.token,
    name: options?.organization?.name
  })

  return { user, org, token: user.token }
}

export const createUserWithOrgAndInvitation = async (
  context: ApiFactoryContext,
  options?: {
    owner?: CreateUserOptions
    invitee?: CreateUserOptions
    organization?: { name?: string }
    invitation?: { role?: 'admin' | 'member' }
  }
): Promise<{
  owner: CreatedUserSession
  invitee: CreatedUserSession
  org: CreatedOrganization
  invitation: CreatedInvitation
  ownerToken: string
  inviteeToken: string
}> => {
  const owner = await createUser(context, options?.owner)
  const org = await createOrganization(context, {
    token: owner.token,
    name: options?.organization?.name
  })

  const invitee = await createUser(context, options?.invitee)

  const invitation = await createInvitation(context, {
    token: owner.token,
    organizationId: org.id,
    email: invitee.credentials.email,
    role: options?.invitation?.role
  })

  return {
    owner,
    invitee,
    org,
    invitation,
    ownerToken: owner.token,
    inviteeToken: invitee.token
  }
}

// ---------------------------------------------------------------------------
// Team with members factory
// ---------------------------------------------------------------------------

export const defaultTestBrandSettings = {
  colors: { primary: '#6366F1', secondary: '#8B5CF6', accent: '#F59E0B', background: '#FFFFFF', text: '#1A1A2E' },
  brandGuidelines: 'Test brand guidelines',
  industry: 'technology',
  targetAudience: 'Test audience'
}

export interface CreateTeamWithMembersOptions {
  token: string
  organizationId: string
  teamName?: string
  brandSettings?: {
    colors: { primary: string; secondary: string; accent: string; background: string; text: string }
    brandGuidelines: string
    industry: string
    targetAudience: string
  }
  members?: Array<{
    userId: string
  }>
}

export interface CreatedTeamWithMembers {
  team: { id: string; name: string; organizationId: string }
  members: Array<{ userId: string; teamId: string }>
}

export const createTeamWithMembers = async (
  context: ApiFactoryContext,
  options: CreateTeamWithMembersOptions
): Promise<CreatedTeamWithMembers> => {
  const teamName = options.teamName ?? `Team ${generateUniqueValue('team')}`

  const teamRes = await fetch(`${context.baseUrl}/v1/teams`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.token}`,
      ...context.testContext.headersForCase(`create-team-${teamName}`)
    },
    body: JSON.stringify({
      organizationId: options.organizationId,
      name: teamName,
      brandSettings: options.brandSettings ?? defaultTestBrandSettings
    })
  })

  if (!teamRes.ok) {
    const body = await teamRes.text()
    throw new Error(`createTeamWithMembers: team creation failed (${teamRes.status}): ${body}`)
  }

  const team = (await teamRes.json()) as { id: string; name: string; organizationId: string }
  const addedMembers: Array<{ userId: string; teamId: string }> = []

  if (options.members) {
    for (const member of options.members) {
      // Try API first (POST /v1/teams/:teamId/members)
      const addRes = await fetch(`${context.baseUrl}/v1/teams/${team.id}/members`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.token}`,
          ...context.testContext.headersForCase(`add-member-${member.userId}`)
        },
        body: JSON.stringify({ userId: member.userId })
      })

      if (addRes.ok) {
        addedMembers.push({ userId: member.userId, teamId: team.id })
      } else {
        // Fallback to raw SQL
        await context.testContext.withSchemaClient(async (client) => {
          await client.query(
            'INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [team.id, member.userId]
          )
        })
        addedMembers.push({ userId: member.userId, teamId: team.id })
      }
    }
  }

  return { team, members: addedMembers }
}

export interface CreateUserWithOrgAndTeamOptions {
  orgName?: string
  teamName?: string
}

export interface CreatedUserWithOrgAndTeam {
  user: CreatedUserSession
  org: { id: string; name: string }
  team: { id: string; name: string; organizationId: string }
  token: string
}

export const createUserWithOrgAndTeam = async (
  context: ApiFactoryContext,
  options?: CreateUserWithOrgAndTeamOptions
): Promise<CreatedUserWithOrgAndTeam> => {
  const { user, org, token } = await createUserWithOrg(context, {
    organization: { name: options?.orgName }
  })

  const { team } = await createTeamWithMembers(context, {
    token,
    organizationId: org.id,
    teamName: options?.teamName
  })

  return { user, org, team, token }
}

export const withTestHeaders = (
  context: ApiFactoryContext,
  caseName: string,
  headers?: HeadersInit
): Record<string, string> => context.testContext.headersForCase(caseName, headers)

export const getTestCaseId = (context: ApiFactoryContext, caseName: string): string =>
  createTestCaseId(context.testContext.testRunId, caseName)

/** Seed an organization's credit balance directly in the DB (for billing integration tests). */
export const seedOrgCredits = async (
  context: ApiFactoryContext,
  orgId: string,
  creditsBalanceDecimillicents: number
): Promise<void> => {
  await context.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations SET credits_balance = $1, updated_at = now() WHERE id = $2`,
      [creditsBalanceDecimillicents, orgId]
    )
  })
}

/** Seed an organization's usage cap directly in the DB (for billing integration tests). */
export const seedOrgUsageCap = async (
  context: ApiFactoryContext,
  orgId: string,
  usageCapDecimillicents: number
): Promise<void> => {
  await context.testContext.withSchemaClient(async (client) => {
    await client.query(
      `UPDATE organizations SET usage_cap = $1, updated_at = now() WHERE id = $2`,
      [usageCapDecimillicents, orgId]
    )
  })
}

/**
 * Activate a Pro subscription on an organization (direct DB update).
 * Used by tests that need upload/storage features which require a subscription.
 */
export const activateSubscription = async (
  organizationId: string
): Promise<void> => {
  const { Client } = await import('pg')
  const { getTestkitEnv } = await import('./env.js')
  const client = new Client({ connectionString: getTestkitEnv().DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      `UPDATE organizations SET is_subscribed = true, subscription_status = 'active', subscription_plan = 'pro' WHERE id = $1`,
      [organizationId]
    )
  } finally {
    await client.end()
  }
}
