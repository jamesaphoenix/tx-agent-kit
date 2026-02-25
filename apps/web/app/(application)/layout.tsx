'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readAuthToken } from '../../lib/auth-token'

export default function ApplicationLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = readAuthToken()
    if (!token) {
      router.replace('/sign-in')
      return
    }
    setReady(true)
  }, [router])

  if (!ready) {
    return null
  }

  return <>{children}</>
}
