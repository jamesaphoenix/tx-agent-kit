import type { Invitation, Workspace } from '@tx-agent-kit/contracts'
import { useCallback, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { AcceptInvitationForm } from '../../components/AcceptInvitationForm'
import { CreateInvitationForm } from '../../components/CreateInvitationForm'
import { ensureSessionOrRedirect, handleUnauthorizedApiError } from '../../lib/client-auth'
import { clientApi } from '../../lib/client-api'

interface InvitationState {
  invitations: Invitation[]
  workspaces: Workspace[]
}

const emptyState: InvitationState = {
  invitations: [],
  workspaces: []
}

export default function InvitationsScreen() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const [state, setState] = useState<InvitationState>(emptyState)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      const [invitationsPayload, workspacesPayload] = await Promise.all([
        clientApi.listInvitations(),
        clientApi.listWorkspaces()
      ])

      if (!mountedRef.current) return

      setState({
        invitations: invitationsPayload.invitations,
        workspaces: workspacesPayload.workspaces
      })
    } catch (err) {
      const handled = await handleUnauthorizedApiError(err, routerRef.current, '/invitations')
      if (handled || !mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load invitations')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const hasSession = await ensureSessionOrRedirect(routerRef.current, '/invitations')
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
        <Text style={{ fontSize: 22, fontWeight: '700' }}>Team Invitations</Text>
        <Text style={{ color: '#6b7280' }}>
          Invite collaborators and accept invites across workspaces.
        </Text>
      </View>

      {error && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: '#dc2626' }}>{error}</Text>
          <Pressable onPress={() => void refresh()} accessibilityRole="button" accessibilityLabel="Retry loading invitations">
            <Text style={{ color: '#2563eb' }}>Retry</Text>
          </Pressable>
        </View>
      )}

      <View style={cardStyle}>
        <CreateInvitationForm workspaces={state.workspaces} onCreated={refresh} />
      </View>

      <View style={cardStyle}>
        <AcceptInvitationForm onAccepted={refresh} />
      </View>

      <View style={cardStyle}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Invitation activity</Text>
        {state.invitations.length === 0 ? (
          <Text style={{ color: '#6b7280', marginTop: 4 }}>
            {loading ? 'Loading invitations...' : 'No invitations yet.'}
          </Text>
        ) : (
          state.invitations.map((invitation) => (
            <View key={invitation.id} style={invitationCardStyle}>
              <Text style={{ fontWeight: '600' }}>{invitation.email}</Text>
              <Text style={{ color: '#6b7280', fontSize: 12 }}>Role: {invitation.role}</Text>
              <Text style={{ color: '#6b7280', fontSize: 12 }}>Status: {invitation.status}</Text>
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

const invitationCardStyle = {
  backgroundColor: '#f3f4f6',
  borderRadius: 8,
  padding: 12,
  marginTop: 8
}
