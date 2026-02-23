import * as Schema from 'effect/Schema'

export const emailSchema = Schema.String.pipe(
  Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
)

export const sortOrderSchema = Schema.Literal('asc', 'desc')

export const listQueryParamsSchema = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  sortBy: Schema.optional(Schema.String),
  sortOrder: Schema.optional(sortOrderSchema),
  filter: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String }))
})

export const paginatedResponseSchema = <A, I, R>(itemSchema: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    data: Schema.Array(itemSchema),
    total: Schema.Number,
    nextCursor: Schema.NullOr(Schema.String),
    prevCursor: Schema.NullOr(Schema.String)
  })

export interface CursorPayload {
  readonly v: 1
  readonly sortBy: string
  readonly sortOrder: 'asc' | 'desc'
  readonly sortValue: string
  readonly id: string
}

const encodeBase64Url = (value: string): string => {
  const maybeBtoa = (globalThis as { btoa?: (input: string) => string }).btoa

  if (maybeBtoa) {
    return maybeBtoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  const maybeBuffer = (globalThis as { Buffer?: { from: (input: string, encoding?: string) => { toString: (encoding: string) => string } } }).Buffer
  if (maybeBuffer) {
    return maybeBuffer.from(value, 'utf8').toString('base64url')
  }

  throw new Error('No base64 encoder available')
}

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const maybeAtob = (globalThis as { atob?: (input: string) => string }).atob

  if (maybeAtob) {
    return maybeAtob(padded)
  }

  const maybeBuffer = (globalThis as { Buffer?: { from: (input: string, encoding?: string) => { toString: (encoding: string) => string } } }).Buffer
  if (maybeBuffer) {
    return maybeBuffer.from(padded, 'base64').toString('utf8')
  }

  throw new Error('No base64 decoder available')
}

export const encodeCursor = (payload: CursorPayload): string =>
  encodeBase64Url(JSON.stringify(payload))

export const decodeCursor = (cursor: string): CursorPayload | null => {
  try {
    const raw = JSON.parse(decodeBase64Url(cursor)) as Partial<CursorPayload>

    if (
      raw.v !== 1 ||
      typeof raw.sortBy !== 'string' ||
      (raw.sortOrder !== 'asc' && raw.sortOrder !== 'desc') ||
      typeof raw.sortValue !== 'string' ||
      typeof raw.id !== 'string'
    ) {
      return null
    }

    return {
      v: 1,
      sortBy: raw.sortBy,
      sortOrder: raw.sortOrder,
      sortValue: raw.sortValue,
      id: raw.id
    }
  } catch {
    return null
  }
}

export const apiErrorSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
  requestId: Schema.String
})

export type ApiError = Schema.Schema.Type<typeof apiErrorSchema>
