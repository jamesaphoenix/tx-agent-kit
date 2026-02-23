import { useState } from 'react'
import { Text, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { clientApi } from '../lib/client-api'
import { log } from '../lib/log'
import { notify } from '../lib/notify'
import { sessionStoreActions } from '../stores/session-store'

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <TouchableOpacity
      disabled={pending}
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      onPress={() => {
        void (async () => {
          setPending(true)
          try {
            await clientApi.signOut()
            notify.info('Signed out')
          } catch (err) {
            log.error('Sign out failed', err)
            notify.error('Sign out failed')
          } finally {
            sessionStoreActions.clear()
            setPending(false)
            router.replace('/sign-in')
          }
        })()
      }}
      style={[buttonStyle, pending && { opacity: 0.6 }]}
    >
      <Text style={buttonTextStyle}>
        {pending ? 'Signing out...' : 'Sign out'}
      </Text>
    </TouchableOpacity>
  )
}

const buttonStyle = {
  backgroundColor: '#6b7280',
  borderRadius: 8,
  padding: 10,
  alignItems: 'center' as const
}

const buttonTextStyle = {
  color: '#ffffff',
  fontSize: 14,
  fontWeight: '500' as const
}
