import { useState } from 'react'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

export function CreateTaskForm({
  workspaceId,
  onCreated
}: {
  workspaceId: string
  onCreated?: () => void | Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async () => {
    if (pending) return
    setPending(true)
    setError(null)

    try {
      await clientApi.createTask({
        workspaceId,
        title,
        description: description || undefined
      })

      setTitle('')
      setDescription('')
      notify.success('Task created')
      await onCreated?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create task'
      setError(message)
      notify.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={headingStyle}>Create Task</Text>

      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Ship invitation acceptance flow"
        style={inputStyle}
      />

      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Optional context"
        multiline
        numberOfLines={4}
        style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]}
      />

      {error && <Text style={{ color: '#dc2626' }}>{error}</Text>}

      <TouchableOpacity
        onPress={() => void onSubmit()}
        disabled={pending || !title}
        style={[buttonStyle, (pending || !title) && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel="Create task"
      >
        <Text style={buttonTextStyle}>
          {pending ? 'Creating...' : 'Create task'}
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
