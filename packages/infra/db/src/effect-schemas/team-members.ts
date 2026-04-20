import * as Schema from 'effect/Schema'
import { memberRoles } from '@tx-agent-kit/contracts'

export const teamMemberRowSchema = Schema.Struct({
  id: Schema.UUID,
  teamId: Schema.UUID,
  userId: Schema.UUID,
  roleId: Schema.NullOr(Schema.UUID),
  role: Schema.Literal(...memberRoles),
  disabledAt: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf
})

export type TeamMemberRowShape = Schema.Schema.Type<typeof teamMemberRowSchema>
