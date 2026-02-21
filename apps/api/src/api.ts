import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'
import * as Schema from 'effect/Schema'

export class BadRequest extends Schema.TaggedError<BadRequest>()('BadRequest', {
  message: Schema.String
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {
  message: Schema.String
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
  message: Schema.String
}) {}

export class Conflict extends Schema.TaggedError<Conflict>()('Conflict', {
  message: Schema.String
}) {}

export class InternalError extends Schema.TaggedError<InternalError>()('InternalError', {
  message: Schema.String
}) {}

export const mapCoreError = (error: unknown): BadRequest | Unauthorized | NotFound | Conflict | InternalError => {
  if (error && typeof error === 'object' && '_tag' in error) {
    const e = error as { _tag: string; code?: string; message?: string }
    const message = e.message ?? 'Internal server error'

    switch (e.code) {
      case 'BAD_REQUEST':
        return new BadRequest({ message })
      case 'UNAUTHORIZED':
        return new Unauthorized({ message })
      case 'NOT_FOUND':
        return new NotFound({ message })
      case 'CONFLICT':
        return new Conflict({ message })
      default:
        return new InternalError({ message: 'Internal server error' })
    }
  }

  return new InternalError({ message: 'Internal server error' })
}

const AuthUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  createdAt: Schema.String
})

const AuthResponse = Schema.Struct({
  token: Schema.String,
  user: AuthUser
})

const PrincipalResponse = Schema.Struct({
  userId: Schema.String,
  email: Schema.String,
  workspaceId: Schema.optional(Schema.String),
  roles: Schema.Array(Schema.String)
})

const DeleteMeResponse = Schema.Struct({
  deleted: Schema.Boolean
})

const SignUpBody = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
  name: Schema.String
})

const SignInBody = Schema.Struct({
  email: Schema.String,
  password: Schema.String
})

const Workspace = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  ownerUserId: Schema.String,
  createdAt: Schema.String
})

const WorkspacesResponse = Schema.Struct({
  workspaces: Schema.Array(Workspace)
})

const CreateWorkspaceBody = Schema.Struct({
  name: Schema.String
})

const Invitation = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  email: Schema.String,
  role: Schema.Literal('admin', 'member'),
  status: Schema.Literal('pending', 'accepted', 'revoked', 'expired'),
  invitedByUserId: Schema.String,
  token: Schema.String,
  expiresAt: Schema.String,
  createdAt: Schema.String
})

const InvitationsResponse = Schema.Struct({
  invitations: Schema.Array(Invitation)
})

const CreateInvitationBody = Schema.Struct({
  workspaceId: Schema.String,
  email: Schema.String,
  role: Schema.Literal('admin', 'member')
})

const AcceptInvitationResponse = Schema.Struct({
  accepted: Schema.Boolean
})

const InvitationTokenParam = HttpApiSchema.param('token', Schema.String)

const Task = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  status: Schema.Literal('todo', 'in_progress', 'done'),
  createdByUserId: Schema.String,
  createdAt: Schema.String
})

const TasksResponse = Schema.Struct({
  tasks: Schema.Array(Task)
})

const CreateTaskBody = Schema.Struct({
  workspaceId: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String)
})

const HealthResponse = Schema.Struct({
  status: Schema.Literal('healthy'),
  timestamp: Schema.String,
  service: Schema.String
})

export const HealthGroup = HttpApiGroup.make('health')
  .add(HttpApiEndpoint.get('health', '/health').addSuccess(HealthResponse))

export const AuthGroup = HttpApiGroup.make('auth')
  .add(HttpApiEndpoint.post('signUp', '/v1/auth/sign-up').setPayload(SignUpBody).addSuccess(AuthResponse, { status: 201 }))
  .add(HttpApiEndpoint.post('signIn', '/v1/auth/sign-in').setPayload(SignInBody).addSuccess(AuthResponse))
  .add(HttpApiEndpoint.get('me', '/v1/auth/me').addSuccess(PrincipalResponse))
  .add(HttpApiEndpoint.del('deleteMe', '/v1/auth/me').addSuccess(DeleteMeResponse))

export const WorkspacesGroup = HttpApiGroup.make('workspaces')
  .add(HttpApiEndpoint.get('listWorkspaces', '/v1/workspaces').addSuccess(WorkspacesResponse))
  .add(HttpApiEndpoint.post('createWorkspace', '/v1/workspaces').setPayload(CreateWorkspaceBody).addSuccess(Workspace, { status: 201 }))
  .add(HttpApiEndpoint.get('listInvitations', '/v1/invitations').addSuccess(InvitationsResponse))
  .add(HttpApiEndpoint.post('createInvitation', '/v1/invitations').setPayload(CreateInvitationBody).addSuccess(Invitation, { status: 201 }))
  .add(HttpApiEndpoint.post('acceptInvitation')`/v1/invitations/${InvitationTokenParam}/accept`.addSuccess(AcceptInvitationResponse))

export const TasksGroup = HttpApiGroup.make('tasks')
  .add(
    HttpApiEndpoint.get('listTasks', '/v1/tasks')
      .setUrlParams(
        Schema.Struct({
          workspaceId: Schema.String
        })
      )
      .addSuccess(TasksResponse)
  )
  .add(HttpApiEndpoint.post('createTask', '/v1/tasks').setPayload(CreateTaskBody).addSuccess(Task, { status: 201 }))

export class TxAgentApi extends HttpApi.make('tx-agent-kit')
  .addError(BadRequest, { status: 400 })
  .addError(Unauthorized, { status: 401 })
  .addError(NotFound, { status: 404 })
  .addError(Conflict, { status: 409 })
  .addError(InternalError, { status: 500 })
  .add(HealthGroup)
  .add(AuthGroup)
  .add(WorkspacesGroup)
  .add(TasksGroup) {}
