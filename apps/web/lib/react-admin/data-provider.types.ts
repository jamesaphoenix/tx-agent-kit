'use client'

export interface CursorPaginatedResponse<T> {
  data: T[]
  total: number
  nextCursor: string | null
  prevCursor: string | null
}

export interface CursorPaginationParams {
  page: number
  perPage: number
  sortBy: string
  sortOrder: 'asc' | 'desc'
  filter: Record<string, unknown>
}
