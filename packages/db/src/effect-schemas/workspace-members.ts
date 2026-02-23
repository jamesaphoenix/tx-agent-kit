import * as Schema from 'effect/Schema'
import { workspaceMemberRoles } from '@tx-agent-kit/contracts'

export const membershipRoleSchema = Schema.Literal(...workspaceMemberRoles)

export const workspaceMemberRowSchema = Schema.Struct({
  id: Schema.UUID,
  workspaceId: Schema.UUID,
  userId: Schema.UUID,
  role: membershipRoleSchema,
  createdAt: Schema.DateFromSelf
})

export type WorkspaceMemberRowShape = Schema.Schema.Type<typeof workspaceMemberRowSchema>
