import type { Organization } from '@tx-agent-kit/contracts'
import { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { CreateOrganizationForm } from '../../components/CreateOrganizationForm'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

export default function OrganizationsScreen() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      const payload = await clientApi.listOrganizations()
      if (!mountedRef.current) return
      setOrganizations(payload.organizations)
    } catch (err) {
      const handled = await handleUnauthorizedApiError(err, routerRef.current, '/organizations')
      if (handled || !mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load organizations')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const hasSession = await ensureSessionOrRedirect(routerRef.current, '/organizations')
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

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={cardStyle}>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>Organizations</Text>
        <Text style={{ color: '#6b7280' }}>
          Manage team boundaries and operational ownership.
        </Text>
      </View>

      {error && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: '#dc2626' }}>{error}</Text>
          <Pressable onPress={() => void refresh()} accessibilityRole="button" accessibilityLabel="Retry loading organizations">
            <Text style={{ color: '#2563eb' }}>Retry</Text>
          </Pressable>
        </View>
      )}

      <View style={cardStyle}>
        <CreateOrganizationForm onCreated={refresh} />
      </View>

      <View style={cardStyle}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Your organizations</Text>
        {organizations.length === 0 ? (
          <Text style={{ color: '#6b7280', marginTop: 4 }}>
            {loading ? 'Loading organizations...' : 'No organizations yet.'}
          </Text>
        ) : (
          organizations.map((organization) => (
            <View key={organization.id} style={organizationCardStyle}>
              <Text style={{ fontWeight: '600' }}>{organization.name}</Text>
              <Text style={{ color: '#6b7280', fontSize: 12 }}>
                Status: {organization.subscriptionStatus}
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
