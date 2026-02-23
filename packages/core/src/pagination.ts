export interface ListParams {
  readonly cursor?: string
  readonly limit: number
  readonly sortBy: string
  readonly sortOrder: 'asc' | 'desc'
  readonly filter: Readonly<Record<string, string>>
}

export interface PaginatedResult<T> {
  readonly data: ReadonlyArray<T>
  readonly total: number
  readonly nextCursor: string | null
  readonly prevCursor: string | null
}

export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 100
export const DEFAULT_SORT_ORDER = 'desc' as const
