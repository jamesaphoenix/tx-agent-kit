'use client'

import { useEffect, useRef } from 'react'

const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script'

interface TurnstileRenderOptions {
  readonly sitekey: string
  readonly callback: (token: string) => void
  readonly 'error-callback'?: () => void
  readonly 'expired-callback'?: () => void
  readonly theme?: 'auto' | 'light' | 'dark'
}

interface TurnstileApi {
  readonly render: (element: HTMLElement, options: TurnstileRenderOptions) => string
  readonly remove: (widgetId: string) => void
  readonly reset: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
    onloadTurnstileCallback?: () => void
  }
}

const loadTurnstileScript = (): Promise<void> =>
  new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      resolve()
      return
    }
    if (window.turnstile) {
      resolve()
      return
    }

    const existing = document.getElementById(TURNSTILE_SCRIPT_ID)
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('turnstile script failed')), {
        once: true
      })
      return
    }

    const script = document.createElement('script')
    script.id = TURNSTILE_SCRIPT_ID
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('turnstile script failed')), {
      once: true
    })
    document.head.append(script)
  })

export interface TurnstileWidgetProps {
  readonly siteKey: string
  /** Called with a fresh token on success, or null when it expires/errors. */
  readonly onToken: (token: string | null) => void
}

/**
 * Renders a Cloudflare Turnstile widget and reports its token. The widget
 * auto-clears the token on expiry/error so the parent can re-gate submit.
 */
export function TurnstileWidget({ siteKey, onToken }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let widgetId: string | null = null
    let cancelled = false

    const mount = async (): Promise<void> => {
      try {
        await loadTurnstileScript()
        if (cancelled || !containerRef.current || !window.turnstile) {
          return
        }
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null)
        })
      } catch {
        // Script blocked/unreachable — leave token null; the parent keeps
        // submit disabled and the server-side check is the real gate anyway.
        onToken(null)
      }
    }

    void mount()

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId)
      }
    }
  }, [siteKey, onToken])

  return <div ref={containerRef} data-testid="turnstile-widget" className="flex justify-center" />
}
