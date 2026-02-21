import {
  createOrganizationFactory,
  createUserFactory,
  createWorkspaceFactory,
  createWorkspaceMemberFactory,
  db,
  generateUniqueValue,
  organizations,
  workspaceMembers,
  workspaces
} from '@tx-agent-kit/db'

export interface ApiFactoryContext {
  baseUrl: string
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

const withJsonHeaders = (headers?: HeadersInit): HeadersInit => ({
  'content-type': 'application/json',
  ...(headers ?? {})
})

const toUrl = (context: ApiFactoryContext, path: string): string => `${context.baseUrl}${path}`

const parseJsonOrThrow = async <T>(response: Response): Promise<T> => {
  const bodyText = await response.text()
  if (!bodyText) {
    throw new Error(`Expected JSON response but received empty body with status ${response.status}`)
  }

  try {
    return JSON.parse(bodyText) as T
  } catch {
    throw new Error(`Expected JSON response but received: ${bodyText}`)
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
    headers: withJsonHeaders(),
    body: JSON.stringify(payload)
  })

  const body = await parseJsonOrThrow<FactoryAuthResponse | { message: string }>(response)
  if (response.status !== 201) {
    throw new Error(`createUser failed (${response.status}): ${JSON.stringify(body)}`)
  }

  return {
    ...(body as FactoryAuthResponse),
    credentials: payload
  }
}

export const loginUser = async (
  context: ApiFactoryContext,
  options: LoginUserOptions
): Promise<FactoryAuthResponse> => {
  const response = await fetch(toUrl(context, '/v1/auth/sign-in'), {
    method: 'POST',
    headers: withJsonHeaders(),
    body: JSON.stringify(options)
  })

  const body = await parseJsonOrThrow<FactoryAuthResponse | { message: string }>(response)
  if (response.status !== 200) {
    throw new Error(`loginUser failed (${response.status}): ${JSON.stringify(body)}`)
  }

  return body as FactoryAuthResponse
}

export const deleteUser = async (
  context: ApiFactoryContext,
  token: string
): Promise<{ deleted: boolean }> => {
  const response = await fetch(toUrl(context, '/v1/auth/me'), {
    method: 'DELETE',
    headers: withJsonHeaders({
      authorization: `Bearer ${token}`
    })
  })

  const body = await parseJsonOrThrow<{ deleted: boolean } | { message: string }>(response)
  if (response.status !== 200) {
    throw new Error(`deleteUser failed (${response.status}): ${JSON.stringify(body)}`)
  }

  return body as { deleted: boolean }
}

export const createTeam = async (
  context: ApiFactoryContext,
  options: CreateTeamOptions
): Promise<CreatedTeam> => {
  const response = await fetch(toUrl(context, '/v1/workspaces'), {
    method: 'POST',
    headers: withJsonHeaders({
      authorization: `Bearer ${options.token}`
    }),
    body: JSON.stringify({
      name: options.name ?? generateUniqueValue('Team')
    })
  })

  const body = await parseJsonOrThrow<CreatedTeam | { message: string }>(response)
  if (response.status !== 201) {
    throw new Error(`createTeam failed (${response.status}): ${JSON.stringify(body)}`)
  }

  return body as CreatedTeam
}

export const createOrganizationAndTeam = async (
  options: CreateOrganizationAndTeamOptions
): Promise<CreatedOrganizationAndTeam> => {
  const [organization] = await db.insert(organizations).values(
    createOrganizationFactory({ name: options.organizationName })
  ).returning()

  if (!organization) {
    throw new Error('Failed to create organization record')
  }

  const [team] = await db.insert(workspaces).values(
    createWorkspaceFactory({
      ownerUserId: options.ownerUserId,
      organizationId: organization.id,
      name: options.teamName
    })
  ).returning()

  if (!team) {
    throw new Error('Failed to create team record')
  }

  await db.insert(workspaceMembers).values(
    createWorkspaceMemberFactory({
      workspaceId: team.id,
      userId: options.ownerUserId,
      role: 'owner'
    })
  )

  return {
    organization,
    team
  }
}
