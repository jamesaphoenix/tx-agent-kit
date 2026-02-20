import * as Schema from 'effect/Schema'

export const workspaceSchema = Schema.Struct({
  id: Schema.UUID,
  name: Schema.String,
  ownerUserId: Schema.UUID,
  createdAt: Schema.String
})

export const createWorkspaceRequestSchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(2), Schema.maxLength(64))
})

export const listWorkspacesResponseSchema = Schema.Struct({
  workspaces: Schema.Array(workspaceSchema)
})

export type Workspace = Schema.Schema.Type<typeof workspaceSchema>
export type CreateWorkspaceRequest = Schema.Schema.Type<typeof createWorkspaceRequestSchema>
