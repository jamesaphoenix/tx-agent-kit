import { keepPreviousData } from '@tanstack/react-query'

/**
 * Shared React Query option presets.
 *
 * Navigation-stable data should not refetch on every page remount. Keep this
 * policy centralized so app chrome, permissions, and organization state stay
 * smooth during route changes while volatile queries can still override it.
 */

/**
 * For data that backs the persistent app chrome and changes infrequently
 * (org list/detail, subscription status, permissions). Cached fresh for
 * 5 minutes, kept for 30, and never refetched simply because a component
 * remounted during navigation.
 */
export const NAVIGATION_QUERY_OPTIONS = {
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
  refetchOnMount: false
} as const

/**
 * Explicit version of the app-wide query default for page-level reads. Use this
 * instead of `query: {}` when a page wants the default client-side SPA behavior.
 */
export const APP_PAGE_QUERY_OPTIONS = {
  staleTime: 60_000
} as const

/**
 * For route list/grid/calendar surfaces where filter, pagination, or URL state
 * changes should not collapse existing content while the next query resolves.
 */
export const LIST_PAGE_QUERY_OPTIONS = {
  ...APP_PAGE_QUERY_OPTIONS,
  placeholderData: keepPreviousData
} as const

export const PRESERVE_PREVIOUS_DATA = keepPreviousData
