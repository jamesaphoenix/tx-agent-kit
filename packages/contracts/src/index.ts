import * as Schema from 'effect/Schema'

const Email = Schema.String.pipe(
  Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
)

export const apiErrorSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
  requestId: Schema.String
})

export const userSchema = Schema.Struct({
  id: Schema.UUID,
  email: Email,
  name: Schema.String.pipe(Schema.minLength(1)),
  createdAt: Schema.String
})

export const authPrincipalSchema = Schema.Struct({
  userId: Schema.UUID,
  email: Email,
  workspaceId: Schema.optional(Schema.UUID),
  roles: Schema.Array(Schema.String)
})

export const signUpRequestSchema = Schema.Struct({
  email: Email,
  password: Schema.String.pipe(Schema.minLength(8)),
  name: Schema.String.pipe(Schema.minLength(1))
})

export const signInRequestSchema = Schema.Struct({
  email: Email,
  password: Schema.String.pipe(Schema.minLength(8))
})

export const authResponseSchema = Schema.Struct({
  token: Schema.String,
  user: userSchema
})

export const workspaceSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  ownerUserId: Schema.UUID,
  createdAt: Schema.String
})

export const createWorkspaceRequestSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64))
})

export const invitationStatusSchema = Schema.Literal('pending', 'accepted', 'revoked', 'expired')
export const invitationRoleSchema = Schema.Literal('admin', 'member')

export const invitationSchema = Schema.Struct({
  id: Schema.UUID,
  workspaceId: Schema.UUID,
  email: Email,
  role: invitationRoleSchema,
  status: invitationStatusSchema,
  invitedByUserId: Schema.UUID,
  token: Schema.String,
  expiresAt: Schema.String,
  createdAt: Schema.String
})

export const createInvitationRequestSchema = Schema.Struct({
  workspaceId: Schema.UUID,
  email: Email,
  role: invitationRoleSchema
})

export const taskStatusSchema = Schema.Literal('todo', 'in_progress', 'done')

export const taskSchema = Schema.Struct({
  id: Schema.UUID,
  workspaceId: Schema.UUID,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  status: taskStatusSchema,
  createdByUserId: Schema.UUID,
  createdAt: Schema.String
})

export const createTaskRequestSchema = Schema.Struct({
  workspaceId: Schema.UUID,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  description: Schema.optional(Schema.String.pipe(Schema.maxLength(2000)))
})

export const listTasksResponseSchema = Schema.Struct({
  tasks: Schema.Array(taskSchema)
})

export const listWorkspacesResponseSchema = Schema.Struct({
  workspaces: Schema.Array(workspaceSchema)
})

export const listInvitationsResponseSchema = Schema.Struct({
  invitations: Schema.Array(invitationSchema)
})

export type ApiError = Schema.Schema.Type<typeof apiErrorSchema>
export type User = Schema.Schema.Type<typeof userSchema>
export type AuthPrincipal = Schema.Schema.Type<typeof authPrincipalSchema>
export type SignUpRequest = Schema.Schema.Type<typeof signUpRequestSchema>
export type SignInRequest = Schema.Schema.Type<typeof signInRequestSchema>
export type AuthResponse = Schema.Schema.Type<typeof authResponseSchema>
export type Workspace = Schema.Schema.Type<typeof workspaceSchema>
export type CreateWorkspaceRequest = Schema.Schema.Type<typeof createWorkspaceRequestSchema>
export type Invitation = Schema.Schema.Type<typeof invitationSchema>
export type CreateInvitationRequest = Schema.Schema.Type<typeof createInvitationRequestSchema>
export type Task = Schema.Schema.Type<typeof taskSchema>
export type CreateTaskRequest = Schema.Schema.Type<typeof createTaskRequestSchema>
