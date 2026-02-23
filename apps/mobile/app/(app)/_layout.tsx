import { useEffect, useRef } from 'react'
import { Tabs, useRouter } from 'expo-router'
import { Text } from 'react-native'
import { useIsSessionReady, useIsAuthenticated } from '../../hooks/use-session-store'

export default function AppTabLayout() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const isReady = useIsSessionReady()
  const isAuthenticated = useIsAuthenticated()

  useEffect(() => {
    if (!isReady) return
    if (!isAuthenticated) {
      routerRef.current.replace('/sign-in')
    }
  }, [isReady, isAuthenticated])

  if (!isReady || !isAuthenticated) return null

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: '#2563eb'
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }} accessibilityLabel="Dashboard">D</Text>
        }}
      />
      <Tabs.Screen
        name="workspaces"
        options={{
          title: 'Workspaces',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }} accessibilityLabel="Workspaces">W</Text>
        }}
      />
      <Tabs.Screen
        name="invitations"
        options={{
          title: 'Invitations',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }} accessibilityLabel="Invitations">I</Text>
        }}
      />
    </Tabs>
  )
}
