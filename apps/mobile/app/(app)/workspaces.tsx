import type { Workspace } from '@tx-agent-kit/contracts'
import { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { CreateWorkspaceForm } from '../../components/CreateWorkspaceForm'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

export default function WorkspacesScreen() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      const payload = await clientApi.listWorkspaces()
      if (!mountedRef.current) return
      setWorkspaces(payload.workspaces)
    } catch (err) {
      const handled = await handleUnauthorizedApiError(err, routerRef.current, '/workspaces')
      if (handled || !mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load workspaces')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const hasSession = await ensureSessionOrRedirect(routerRef.current, '/workspaces')
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
        <Text style={{ fontSize: 22, fontWeight: '700' }}>Workspaces</Text>
        <Text style={{ color: '#6b7280' }}>
          Manage team boundaries and operational ownership.
        </Text>
      </View>

      {error && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: '#dc2626' }}>{error}</Text>
          <Pressable onPress={() => void refresh()} accessibilityRole="button" accessibilityLabel="Retry loading workspaces">
            <Text style={{ color: '#2563eb' }}>Retry</Text>
          </Pressable>
        </View>
      )}

      <View style={cardStyle}>
        <CreateWorkspaceForm onCreated={refresh} />
      </View>

      <View style={cardStyle}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Your workspaces</Text>
        {workspaces.length === 0 ? (
          <Text style={{ color: '#6b7280', marginTop: 4 }}>
            {loading ? 'Loading workspaces...' : 'No workspaces yet.'}
          </Text>
        ) : (
          workspaces.map((workspace) => (
            <View key={workspace.id} style={workspaceCardStyle}>
              <Text style={{ fontWeight: '600' }}>{workspace.name}</Text>
              <Text style={{ color: '#6b7280', fontSize: 12 }}>
                Owner: {workspace.ownerUserId}
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

const workspaceCardStyle = {
  backgroundColor: '#f3f4f6',
  borderRadius: 8,
  padding: 12,
  marginTop: 8
}
