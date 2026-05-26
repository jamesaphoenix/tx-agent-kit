/**
 * Shared React Query option presets.
 *
 * Navigation-stable data should not refetch on every page remount. Keep this
 * policy centralized so app chrome, permissions, and organization state stay
 * smooth during route changes while volatile queries can still override it.
 */
export const NAVIGATION_QUERY_OPTIONS = {
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
  refetchOnMount: false
} as const
