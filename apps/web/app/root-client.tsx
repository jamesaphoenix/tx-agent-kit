'use client'

import type { ReactNode } from 'react'
import { AppProviders } from '../components/providers/AppProviders'
import { ApiResourceHints } from '@/lib/api-resource-hints'

/**
 * Client half of the root layout. Holds the provider tree (React Query, URL
 * state, auth bootstrap, devtools) and the API resource hints. The `<html>` /
 * `<body>` shell + the route segment config (`dynamic = 'force-dynamic'`) live
 * in the SERVER component `app/layout.tsx` so the build can opt the whole SPA
 * out of static prerendering. These pages are client-rendered authenticated
 * routes that read browser-only context (`useSearchParams`, auth/session) which
 * is null during SSG — forcing dynamic rendering is the correct posture for
 * this app and is what makes `next build` succeed for the E2E prod target.
 */
export function RootClient({ children }: { children: ReactNode }) {
  return (
    <>
      <ApiResourceHints />
      <AppProviders>
        <main>{children}</main>
      </AppProviders>
    </>
  )
}
