'use client'

import { buildSignInPath } from '@tx-agent-kit/contracts'
import { useRouter } from 'next/navigation'
import { Suspense, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { clientApi } from '@/lib/client-api'
import { consumeGoogleAuthNextPath } from '@/lib/google-auth'
import { notify } from '@/lib/notify'
import { useStringQueryParam } from '@/lib/url-state'
import { sessionStoreActions } from '@/stores/session-store'
import { PageLoadingSpinner } from '@/components/PageLoadingSpinner'

function GoogleAuthCallbackContent() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const code = useStringQueryParam('code')
  const state = useStringQueryParam('state')
  const issuer = useStringQueryParam('iss')
  const errorParam = useStringQueryParam('error')
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) {
      return
    }
    handled.current = true

    // Consume the parked destination first so it is always cleared, even on the
    // error paths. It still flows into the sign-in retry link so an invitation
    // token survives a failed Google attempt.
    const nextPath = consumeGoogleAuthNextPath('/dashboard')

    if (errorParam || !code || !state) {
      notify.error('Google sign-in was cancelled or did not complete. Please try again.')
      router.replace(buildSignInPath(nextPath))
      return
    }

    const complete = async () => {
      try {
        const session = await clientApi.googleCallback(code, state, issuer ?? undefined)
        const principal = session.principal ?? (await clientApi.me())
        queryClient.clear()
        sessionStoreActions.setPrincipal(principal)
        notify.success('Signed in successfully')
        router.replace(nextPath)
      } catch (error) {
        notify.apiError(error, 'Google sign-in failed')
        router.replace(buildSignInPath(nextPath))
      }
    }

    void complete()
  }, [code, errorParam, issuer, queryClient, router, state])

  return (
    <PageLoadingSpinner
      label="Completing Google sign-in"
      className="min-h-dvh"
    />
  )
}

export default function GoogleAuthCallbackPage() {
  return (
    <Suspense
      fallback={<PageLoadingSpinner label="Completing Google sign-in" className="min-h-dvh" />}
    >
      <GoogleAuthCallbackContent />
    </Suspense>
  )
}
