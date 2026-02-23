import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'
import {
  invitationAssignableRoles,
  invitationStatuses,
  sortOrders,
  taskStatuses
} from '@tx-agent-kit/contracts'
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

const paginatedResponseSchema = <A, I, R>(itemSchema: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    data: Schema.Array(itemSchema),
    total: Schema.Number,
    nextCursor: Schema.NullOr(Schema.String),
    prevCursor: Schema.NullOr(Schema.String)
  })

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

const WorkspacesResponse = paginatedResponseSchema(Workspace)

const WorkspacesListParams = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.String),
  sortBy: Schema.optional(Schema.String),
  sortOrder: Schema.optional(Schema.Literal(...sortOrders))
})

const CreateWorkspaceBody = Schema.Struct({
  name: Schema.String
})

const UpdateWorkspaceBody = Schema.Struct({
  name: Schema.optional(Schema.String)
})

const Invitation = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  email: Schema.String,
  role: Schema.Literal(...invitationAssignableRoles),
  status: Schema.Literal(...invitationStatuses),
  invitedByUserId: Schema.String,
  token: Schema.String,
  expiresAt: Schema.String,
  createdAt: Schema.String
})

const InvitationsResponse = paginatedResponseSchema(Invitation)

const InvitationsListParams = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.String),
  sortBy: Schema.optional(Schema.String),
  sortOrder: Schema.optional(Schema.Literal(...sortOrders)),
  'filter[status]': Schema.optional(Schema.String),
  'filter[role]': Schema.optional(Schema.String)
})

const CreateInvitationBody = Schema.Struct({
  workspaceId: Schema.String,
  email: Schema.String,
  role: Schema.Literal(...invitationAssignableRoles)
})

const UpdateInvitationBody = Schema.Struct({
  role: Schema.optional(Schema.Literal(...invitationAssignableRoles)),
  status: Schema.optional(Schema.Literal(...invitationStatuses))
})

const AcceptInvitationResponse = Schema.Struct({
  accepted: Schema.Boolean
})

const InvitationTokenParam = HttpApiSchema.param('token', Schema.String)
const InvitationIdParam = HttpApiSchema.param('invitationId', Schema.String)
const WorkspaceIdParam = HttpApiSchema.param('workspaceId', Schema.String)
const TaskIdParam = HttpApiSchema.param('taskId', Schema.String)

const Task = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  status: Schema.Literal(...taskStatuses),
  createdByUserId: Schema.String,
  createdAt: Schema.String
})

const IdsBody = Schema.Struct({
  ids: Schema.Array(Schema.UUID)
})

const WorkspacesManyResponse = Schema.Struct({
  data: Schema.Array(Workspace)
})

const InvitationsManyResponse = Schema.Struct({
  data: Schema.Array(Invitation)
})

const TasksManyResponse = Schema.Struct({
  data: Schema.Array(Task)
})

const TasksResponse = paginatedResponseSchema(Task)

const TasksListParams = Schema.Struct({
  workspaceId: Schema.String,
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.String),
  sortBy: Schema.optional(Schema.String),
  sortOrder: Schema.optional(Schema.Literal(...sortOrders)),
  'filter[status]': Schema.optional(Schema.String),
  'filter[createdByUserId]': Schema.optional(Schema.String)
})

const CreateTaskBody = Schema.Struct({
  workspaceId: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String)
})

const UpdateTaskBody = Schema.Struct({
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.Literal(...taskStatuses))
})

const HealthResponse = Schema.Struct({
  status: Schema.Literal('healthy'),
  timestamp: Schema.String,
  service: Schema.String
})

const DeletedResponse = Schema.Struct({
  deleted: Schema.Boolean
})

export const HealthGroup = HttpApiGroup.make('health')
  .add(HttpApiEndpoint.get('health', '/health').addSuccess(HealthResponse))

export const AuthGroup = HttpApiGroup.make('auth')
  .add(HttpApiEndpoint.post('signUp', '/v1/auth/sign-up').setPayload(SignUpBody).addSuccess(AuthResponse, { status: 201 }))
  .add(HttpApiEndpoint.post('signIn', '/v1/auth/sign-in').setPayload(SignInBody).addSuccess(AuthResponse))
  .add(HttpApiEndpoint.get('me', '/v1/auth/me').addSuccess(PrincipalResponse))
  .add(HttpApiEndpoint.del('deleteMe', '/v1/auth/me').addSuccess(DeleteMeResponse))

export const WorkspacesGroup = HttpApiGroup.make('workspaces')
  .add(
    HttpApiEndpoint.get('listWorkspaces', '/v1/workspaces')
      .setUrlParams(WorkspacesListParams)
      .addSuccess(WorkspacesResponse)
  )
  .add(HttpApiEndpoint.post('createWorkspace', '/v1/workspaces').setPayload(CreateWorkspaceBody).addSuccess(Workspace, { status: 201 }))
  .add(
    HttpApiEndpoint.get('getWorkspace')`/v1/workspaces/${WorkspaceIdParam}`
      .addSuccess(Workspace)
  )
  .add(
    HttpApiEndpoint.post('getManyWorkspaces', '/v1/workspaces/batch/get-many')
      .setPayload(IdsBody)
      .addSuccess(WorkspacesManyResponse)
  )
  .add(
    HttpApiEndpoint.patch('updateWorkspace')`/v1/workspaces/${WorkspaceIdParam}`
      .setPayload(UpdateWorkspaceBody)
      .addSuccess(Workspace)
  )
  .add(
    HttpApiEndpoint.del('removeWorkspace')`/v1/workspaces/${WorkspaceIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(
    HttpApiEndpoint.get('listInvitations', '/v1/invitations')
      .setUrlParams(InvitationsListParams)
      .addSuccess(InvitationsResponse)
  )
  .add(
    HttpApiEndpoint.get('getInvitation')`/v1/invitations/${InvitationIdParam}`
      .addSuccess(Invitation)
  )
  .add(
    HttpApiEndpoint.post('getManyInvitations', '/v1/invitations/batch/get-many')
      .setPayload(IdsBody)
      .addSuccess(InvitationsManyResponse)
  )
  .add(HttpApiEndpoint.post('createInvitation', '/v1/invitations').setPayload(CreateInvitationBody).addSuccess(Invitation, { status: 201 }))
  .add(
    HttpApiEndpoint.patch('updateInvitation')`/v1/invitations/${InvitationIdParam}`
      .setPayload(UpdateInvitationBody)
      .addSuccess(Invitation)
  )
  .add(
    HttpApiEndpoint.del('removeInvitation')`/v1/invitations/${InvitationIdParam}`
      .addSuccess(DeletedResponse)
  )
  .add(HttpApiEndpoint.post('acceptInvitation')`/v1/invitations/${InvitationTokenParam}/accept`.addSuccess(AcceptInvitationResponse))

export const TasksGroup = HttpApiGroup.make('tasks')
  .add(
    HttpApiEndpoint.get('listTasks', '/v1/tasks')
      .setUrlParams(TasksListParams)
      .addSuccess(TasksResponse)
  )
  .add(HttpApiEndpoint.post('createTask', '/v1/tasks').setPayload(CreateTaskBody).addSuccess(Task, { status: 201 }))
  .add(
    HttpApiEndpoint.get('getTask')`/v1/tasks/${TaskIdParam}`
      .addSuccess(Task)
  )
  .add(
    HttpApiEndpoint.post('getManyTasks', '/v1/tasks/batch/get-many')
      .setPayload(IdsBody)
      .addSuccess(TasksManyResponse)
  )
  .add(
    HttpApiEndpoint.patch('updateTask')`/v1/tasks/${TaskIdParam}`
      .setPayload(UpdateTaskBody)
      .addSuccess(Task)
  )
  .add(
    HttpApiEndpoint.del('removeTask')`/v1/tasks/${TaskIdParam}`
      .addSuccess(DeletedResponse)
  )

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
