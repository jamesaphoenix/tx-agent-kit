import * as Schema from 'effect/Schema'

export type JsonPrimitiveShape = string | number | boolean | null
export type JsonValueShape = JsonPrimitiveShape | JsonObjectShape | ReadonlyArray<JsonValueShape>
export interface JsonObjectShape {
  readonly [key: string]: JsonValueShape
}

export const jsonValueSchema: Schema.Schema<JsonValueShape> = Schema.suspend(() =>
  Schema.Union(
    Schema.Null,
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Array(jsonValueSchema),
    Schema.Record({ key: Schema.String, value: jsonValueSchema })
  )
)

export const jsonObjectSchema: Schema.Schema<JsonObjectShape> = Schema.Record({
  key: Schema.String,
  value: jsonValueSchema
})
