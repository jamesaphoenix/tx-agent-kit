'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'
import { sessionStoreActions } from '../stores/session-store'

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <button
      className="secondary"
      type="button"
      disabled={pending}
      onClick={() => {
        void (async () => {
          setPending(true)
          try {
            await clientApi.signOut()
            notify.info('Signed out')
          } catch {
            notify.error('Sign out failed')
          } finally {
            sessionStoreActions.clear()
            setPending(false)
            router.replace('/sign-in')
          }
        })()
      }}
    >
      {pending ? 'Signing out...' : 'Sign out'}
    </button>
  )
}
