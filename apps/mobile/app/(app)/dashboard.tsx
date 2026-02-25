import type { AuthPrincipal, Organization } from '@tx-agent-kit/contracts'
import { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { SignOutButton } from '../../components/SignOutButton'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

interface DashboardState {
  principal: AuthPrincipal | null
  organizations: Organization[]
}

const emptyState: DashboardState = {
  principal: null,
  organizations: []
}

export default function DashboardScreen() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const [state, setState] = useState<DashboardState>(emptyState)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      const principal = await clientApi.me()
      const organizationPayload = await clientApi.listOrganizations()

      if (!mountedRef.current) return

      setState({
        principal,
        organizations: organizationPayload.organizations
      })
    } catch (err) {
      const handled = await handleUnauthorizedApiError(err, routerRef.current, '/dashboard')
      if (handled || !mountedRef.current) return

      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const hasSession = await ensureSessionOrRedirect(routerRef.current, '/dashboard')
    if (!hasSession) {
      if (mountedRef.current) setLoading(false)
      return
    }

    if (!mountedRef.current) return

    setLoading(true)
    setError(null)
    await fetchData()
  }, [fetchData])

  const refresh = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return
    setError(null)
    await fetchData()
  }, [fetchData])

  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true
      void load()
      return () => { mountedRef.current = false }
    }, [load])
  )

  const firstOrganization = state.organizations[0]

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={cardStyle}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontWeight: '700' }}>Dashboard</Text>
            <Text style={{ color: '#6b7280', marginTop: 4 }}>
              {state.principal ? `Signed in as ${state.principal.email}` : 'Loading profile...'}
            </Text>
          </View>
          <SignOutButton />
        </View>
      </View>

      {error && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: '#dc2626' }}>{error}</Text>
          <Pressable onPress={() => void refresh()} accessibilityRole="button" accessibilityLabel="Retry loading dashboard">
            <Text style={{ color: '#2563eb' }}>Retry</Text>
          </Pressable>
        </View>
      )}

      <View style={cardStyle}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Current organization</Text>
        {firstOrganization ? (
          <Text style={{ marginTop: 4 }}>{firstOrganization.name}</Text>
        ) : loading ? (
          <Text style={{ color: '#6b7280' }}>Loading organizations...</Text>
        ) : (
          <Text style={{ color: '#6b7280' }}>Create an organization to get started.</Text>
        )}
      </View>

      <View style={cardStyle}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Organizations</Text>
        {state.organizations.length === 0 ? (
          <Text style={{ color: '#6b7280', marginTop: 4 }}>
            {loading ? 'Loading organizations...' : 'No organizations yet.'}
          </Text>
        ) : (
          state.organizations.map((org) => (
            <View key={org.id} style={organizationCardStyle}>
              <Text style={{ fontWeight: '600' }}>{org.name}</Text>
              <Text style={{ color: '#6b7280', fontSize: 12 }}>
                Status: {org.subscriptionStatus}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  )
}

const cardStyle = {
  backgroundColor: '#f9fafb',
  borderRadius: 12,
  padding: 16,
  gap: 4
}

const organizationCardStyle = {
  backgroundColor: '#f3f4f6',
  borderRadius: 8,
  padding: 12,
  marginTop: 8
}
