import { useState } from 'react'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

export function AcceptInvitationForm({
  onAccepted
}: {
  onAccepted?: () => void | Promise<void>
}) {
  const [token, setToken] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    setMessage(null)

    try {
      await clientApi.acceptInvitation(token)
      setToken('')
      setMessage('Invitation accepted successfully')
      notify.success('Invitation accepted')
      await onAccepted?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to accept invitation'
      setError(message)
      notify.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={headingStyle}>Accept invitation</Text>

      <TextInput
        value={token}
        onChangeText={setToken}
        placeholder="Paste invitation token"
        style={inputStyle}
      />

      {error && <Text style={{ color: '#dc2626' }}>{error}</Text>}
      {message && <Text style={{ color: '#16a34a' }}>{message}</Text>}

      <TouchableOpacity
        onPress={() => void onSubmit()}
        disabled={pending || !token}
        style={[buttonStyle, (pending || !token) && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel="Accept invitation"
      >
        <Text style={buttonTextStyle}>
          {pending ? 'Accepting...' : 'Accept invitation'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const headingStyle = {
  fontSize: 18,
  fontWeight: '600' as const
}

const inputStyle = {
  borderWidth: 1,
  borderColor: '#d1d5db',
  borderRadius: 8,
  padding: 12,
  fontSize: 16
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
