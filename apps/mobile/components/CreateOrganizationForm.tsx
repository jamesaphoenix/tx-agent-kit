import { useState } from 'react'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

export function CreateOrganizationForm({
  onCreated
}: {
  onCreated?: () => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async () => {
    if (pending) return
    setPending(true)
    setError(null)

    try {
      await clientApi.createOrganization({ name })
      setName('')
      notify.success('Organization created')
      await onCreated?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create organization'
      setError(message)
      notify.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={headingStyle}>Create Organization</Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Growth Experiments"
        maxLength={64}
        style={inputStyle}
      />

      {error && <Text style={{ color: '#dc2626' }}>{error}</Text>}

      <TouchableOpacity
        onPress={() => void onSubmit()}
        disabled={pending || name.length < 2}
        style={[buttonStyle, (pending || name.length < 2) && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel="Create organization"
      >
        <Text style={buttonTextStyle}>
          {pending ? 'Creating...' : 'Create organization'}
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
