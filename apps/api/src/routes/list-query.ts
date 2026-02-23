import {
  DEFAULT_LIMIT,
  DEFAULT_SORT_ORDER,
  MAX_LIMIT,
  type ListParams
} from '@tx-agent-kit/core'

export const ListQueryRouteKind = 'custom' as const

export interface ParseListQueryOptions {
  readonly defaultSortBy: string
  readonly allowedSortBy: ReadonlyArray<string>
  readonly allowedFilterKeys: ReadonlyArray<string>
}

export type ParseListQueryResult =
  | { readonly ok: true; readonly value: ListParams }
  | { readonly ok: false; readonly message: string }

const normalizeLimit = (rawLimit: string | undefined): number | null => {
  if (rawLimit === undefined || rawLimit === '') {
    return DEFAULT_LIMIT
  }

  const parsed = Number.parseInt(rawLimit, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null
  }

  return Math.min(parsed, MAX_LIMIT)
}

const normalizeSortOrder = (rawSortOrder: string | undefined): 'asc' | 'desc' | null => {
  if (rawSortOrder === undefined || rawSortOrder === '') {
    return DEFAULT_SORT_ORDER
  }

  if (rawSortOrder === 'asc' || rawSortOrder === 'desc') {
    return rawSortOrder
  }

  return null
}

const normalizeSortBy = (
  rawSortBy: string | undefined,
  options: ParseListQueryOptions
): string | null => {
  const fallback = options.defaultSortBy
  const sortBy = rawSortBy && rawSortBy !== '' ? rawSortBy : fallback

  if (!options.allowedSortBy.includes(sortBy)) {
    return null
  }

  return sortBy
}

export const parseListQuery = (
  urlParams: Record<string, string | undefined>,
  options: ParseListQueryOptions
): ParseListQueryResult => {
  const limit = normalizeLimit(urlParams.limit)
  if (limit === null) {
    return { ok: false, message: 'Invalid limit parameter' }
  }

  const sortOrder = normalizeSortOrder(urlParams.sortOrder)
  if (sortOrder === null) {
    return { ok: false, message: 'Invalid sortOrder parameter' }
  }

  const sortBy = normalizeSortBy(urlParams.sortBy, options)
  if (sortBy === null) {
    return {
      ok: false,
      message: `Invalid sortBy parameter. Allowed values: ${options.allowedSortBy.join(', ')}`
    }
  }

  const filter: Record<string, string> = {}

  for (const key of options.allowedFilterKeys) {
    const value = urlParams[`filter[${key}]`]
    if (value !== undefined && value !== '') {
      filter[key] = value
    }
  }

  for (const key of Object.keys(urlParams)) {
    if (!key.startsWith('filter[') || !key.endsWith(']')) {
      continue
    }

    const filterKey = key.slice('filter['.length, -1)
    if (!options.allowedFilterKeys.includes(filterKey)) {
      return {
        ok: false,
        message: `Invalid filter key: ${filterKey}`
      }
    }
  }

  const cursor = urlParams.cursor && urlParams.cursor !== '' ? urlParams.cursor : undefined

  return {
    ok: true,
    value: {
      cursor,
      limit,
      sortBy,
      sortOrder,
      filter
    }
  }
}
