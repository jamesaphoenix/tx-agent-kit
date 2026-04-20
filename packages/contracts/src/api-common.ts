import * as Schema from 'effect/Schema'

export const healthResponseSchema = Schema.Struct({
  status: Schema.Literal('healthy'),
  timestamp: Schema.String,
  service: Schema.String
})

export type HealthResponse = Schema.Schema.Type<typeof healthResponseSchema>
