'use client'

import { useRouter } from 'next/navigation'
import { clientApi } from '../lib/client-api'

export function SignOutButton() {
  const router = useRouter()

  return (
    <button
      className="secondary"
      type="button"
      onClick={() => {
        clientApi.signOut()
        router.push('/sign-in')
        router.refresh()
      }}
    >
      Sign out
    </button>
  )
}
