import { useEffect, useRef } from 'react'
import { Stack, useRouter } from 'expo-router'
import { useIsSessionReady, useIsAuthenticated } from '../../hooks/use-session-store'

export default function AuthLayout() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const isReady = useIsSessionReady()
  const isAuthenticated = useIsAuthenticated()

  useEffect(() => {
    if (!isReady) return
    if (isAuthenticated) {
      routerRef.current.replace('/dashboard')
    }
  }, [isReady, isAuthenticated])

  return (
    <Stack
      screenOptions={{
        headerShown: false
      }}
    />
  )
}
