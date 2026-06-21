import * as Schema from 'effect/Schema'
import { autoFixAgentKinds, autoFixEnvironments, autoFixRunStatuses } from '@tx-agent-kit/contracts'
import { jsonObjectSchema } from '../json-schema.js'

export const autoFixRunRowSchema = Schema.Struct({
  id: Schema.UUID,
  sentryIssueId: Schema.String,
  environment: Schema.Literal(...autoFixEnvironments),
  fingerprint: Schema.NullOr(Schema.String),
  title: Schema.String,
  permalink: Schema.NullOr(Schema.String),
  status: Schema.Literal(...autoFixRunStatuses),
  branch: Schema.NullOr(Schema.String),
  agent: Schema.NullOr(Schema.Literal(...autoFixAgentKinds)),
  agentOutput: Schema.NullOr(jsonObjectSchema),
  agentJsonlOutput: Schema.NullOr(Schema.String),
  prUrl: Schema.NullOr(Schema.String),
  agentError: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.DateFromSelf),
  completedAt: Schema.NullOr(Schema.DateFromSelf),
  createdAt: Schema.DateFromSelf
})

export type AutoFixRunRowShape = Schema.Schema.Type<typeof autoFixRunRowSchema>
