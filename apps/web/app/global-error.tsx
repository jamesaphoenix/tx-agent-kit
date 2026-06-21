'use client'

import { useEffect } from 'react'

/**
 * Self-contained global error boundary.
 *
 * `global-error` REPLACES the root layout when an uncaught error escapes it, so
 * it must render its own `<html>` / `<body>` and must NOT depend on the app
 * provider tree. Providing this explicit, dependency-free boundary also lets
 * `next build` prerender the built-in `/_global-error` page cleanly — the Next
 * default pulled in the shared SPA chunk and hit `Cannot read properties of
 * null (reading 'use')` during static export.
 */
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // React swallows errors caught by this boundary, so Sentry's global
    // handlers never see them, so report explicitly. Dynamic import keeps the
    // prerendered boundary chunk free of the shared SPA bundle (see above).
    void (async () => {
      try {
        const { reportWebError } = await import('@/lib/sentry')
        await reportWebError(error)
      } catch {
        // Reporting must never break the error screen.
      }
    })()
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: '1.5rem'
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: '#666', marginTop: '0.5rem' }}>
            An unexpected error occurred. Please try again.
          </p>
          {error.digest ? (
            <p style={{ color: '#999', fontSize: '0.75rem', marginTop: '0.5rem' }}>
              Reference: {error.digest}
            </p>
          ) : null}
          {/* Raw <button> is intentional here: global-error must not import the
              app <Button> (the provider/theme tree is unavailable in this
              boundary). It renders before any provider is mounted. */}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.375rem',
              border: '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer'
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
