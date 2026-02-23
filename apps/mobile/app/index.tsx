import { useEffect, useRef } from 'react'
import { useRouter } from 'expo-router'
import { useIsSessionReady, useIsAuthenticated } from '../hooks/use-session-store'

export default function IndexPage() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const isReady = useIsSessionReady()
  const isAuthenticated = useIsAuthenticated()

  useEffect(() => {
    if (!isReady) return
    routerRef.current.replace(isAuthenticated ? '/dashboard' : '/sign-in')
  }, [isReady, isAuthenticated])

  return null
}
