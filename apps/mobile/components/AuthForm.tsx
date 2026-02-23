import { useState } from 'react'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { clearAuthToken } from '../lib/auth-token'
import { clientApi, ApiClientError } from '../lib/client-api'
import { notify } from '../lib/notify'
import { sessionStoreActions } from '../stores/session-store'

export function AuthForm({ mode, nextPath }: { mode: 'sign-in' | 'sign-up'; nextPath: string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async () => {
    if (pending) return
    setPending(true)
    setError(null)

    try {
      if (mode === 'sign-up') {
        await clientApi.signUp({ email, password, name })
      } else {
        await clientApi.signIn({ email, password })
      }

      const principal = await clientApi.me()
      sessionStoreActions.setPrincipal(principal)
      notify.success(mode === 'sign-up' ? 'Account created successfully' : 'Signed in successfully')
      router.replace(nextPath)
    } catch (err) {
      const isAuthRejection =
        err instanceof ApiClientError && (err.status === 401 || err.status === 403)

      if (isAuthRejection) {
        await clearAuthToken()
        sessionStoreActions.clear()
      }

      const message = err instanceof Error ? err.message : 'Authentication failed'
      setError(message)
      notify.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <View style={{ gap: 12 }}>
      {mode === 'sign-up' && (
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Jane Founder"
          autoCapitalize="words"
          style={inputStyle}
        />
      )}

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@company.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        style={inputStyle}
      />

      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
        style={inputStyle}
      />

      {error && <Text style={{ color: '#dc2626' }}>{error}</Text>}

      <TouchableOpacity
        onPress={() => void onSubmit()}
        disabled={pending}
        style={[buttonStyle, pending && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={mode === 'sign-up' ? 'Create account' : 'Sign in'}
      >
        <Text style={buttonTextStyle}>
          {pending ? 'Working...' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
        </Text>
      </TouchableOpacity>
    </View>
  )
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
