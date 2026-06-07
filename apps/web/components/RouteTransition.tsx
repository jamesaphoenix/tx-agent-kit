'use client'

import { useRouter } from 'next/navigation'
import { createContext, useContext, useMemo, useTransition, type ReactNode } from 'react'

interface RouteTransitionValue {
  /** True while a navigation started via {@link RouteTransitionValue.navigate} is rendering. */
  readonly isNavigating: boolean
  /** Push a route inside a React transition so the current page stays interactive. */
  readonly navigate: (href: string) => void
}

const RouteTransitionContext = createContext<RouteTransitionValue | null>(null)

/**
 * Access the ambient route transition. Returns `null` when no provider is
 * mounted (e.g. a component rendered standalone in tests), so callers should
 * fall back to a plain `router.push`.
 */
export const useRouteTransition = (): RouteTransitionValue | null =>
  useContext(RouteTransitionContext)

/**
 * Wraps client-side navigations in {@link useTransition}. While the destination
 * route renders (and its data resolves), `isNavigating` is true and React keeps
 * the current page visible and interactive instead of blanking it - paired with
 * the persistent shell, navigation feels instant rather than flashing.
 */
export function RouteTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [isNavigating, startTransition] = useTransition()

  const value = useMemo<RouteTransitionValue>(
    () => ({
      isNavigating,
      navigate: (href: string) => {
        startTransition(() => {
          router.push(href)
        })
      }
    }),
    [isNavigating, router]
  )

  return (
    <RouteTransitionContext.Provider value={value}>{children}</RouteTransitionContext.Provider>
  )
}

/**
 * Thin indeterminate progress bar pinned to the top of the content area while a
 * route transition is in flight. Renders nothing when idle.
 */
export function RouteProgressBar() {
  const transition = useRouteTransition()

  if (!transition?.isNavigating) {
    return null
  }

  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      aria-busy="true"
      className="absolute inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-primary"
    />
  )
}
