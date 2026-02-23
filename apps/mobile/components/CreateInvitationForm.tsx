import { useState, useEffect } from 'react'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

interface WorkspaceOption {
  id: string
  name: string
}

export function CreateInvitationForm({
  workspaces,
  onCreated
}: {
  workspaces: ReadonlyArray<WorkspaceOption>
  onCreated?: () => void | Promise<void>
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setSelectedIndex(0)
  }, [workspaces])

  const workspaceId = workspaces[selectedIndex]?.id ?? ''

  const onSubmit = async () => {
    if (pending) return
    if (!workspaceId) {
      const message = 'Create a workspace first'
      setError(message)
      notify.error(message)
      return
    }

    setPending(true)
    setError(null)

    try {
      await clientApi.createInvitation({ workspaceId, email, role })
      setEmail('')
      notify.success('Invitation sent')
      await onCreated?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send invitation'
      setError(message)
      notify.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={headingStyle}>Invite teammate</Text>

      <Text style={labelStyle}>Workspace</Text>
      <View style={{ gap: 6 }}>
        {workspaces.map((workspace, index) => (
          <TouchableOpacity
            key={workspace.id}
            onPress={() => setSelectedIndex(index)}
            style={[
              chipStyle,
              index === selectedIndex && { backgroundColor: '#dbeafe', borderColor: '#2563eb' }
            ]}
          >
            <Text>{workspace.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={labelStyle}>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="teammate@company.com"
        keyboardType="email-address"
        autoCapitalize="none"
        style={inputStyle}
      />

      <Text style={labelStyle}>Role</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity
          onPress={() => setRole('member')}
          style={[chipStyle, role === 'member' && { backgroundColor: '#dbeafe', borderColor: '#2563eb' }]}
        >
          <Text>Member</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setRole('admin')}
          style={[chipStyle, role === 'admin' && { backgroundColor: '#dbeafe', borderColor: '#2563eb' }]}
        >
          <Text>Admin</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={{ color: '#dc2626' }}>{error}</Text>}

      <TouchableOpacity
        onPress={() => void onSubmit()}
        disabled={pending || !email}
        style={[buttonStyle, (pending || !email) && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel="Send invitation"
      >
        <Text style={buttonTextStyle}>
          {pending ? 'Sending...' : 'Send invitation'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const headingStyle = {
  fontSize: 18,
  fontWeight: '600' as const
}

const labelStyle = {
  fontSize: 14,
  fontWeight: '500' as const,
  color: '#374151'
}

const inputStyle = {
  borderWidth: 1,
  borderColor: '#d1d5db',
  borderRadius: 8,
  padding: 12,
  fontSize: 16
}

const chipStyle = {
  borderWidth: 1,
  borderColor: '#d1d5db',
  borderRadius: 8,
  paddingVertical: 8,
  paddingHorizontal: 12
}

const buttonStyle = {
  backgroundColor: '#2563eb',
  borderRadius: 8,
  padding: 14,
  alignItems: 'center' as const
}

const buttonTextStyle = {
  color: '#ffffff',
  fontSize: 16,
  fontWeight: '600' as const
}
