import { Text, View } from 'react-native'
import { Link } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AuthForm } from '../../components/AuthForm'
import { useSafeNextPath } from '../../lib/url-state'

export default function SignInScreen() {
  const nextPath = useSafeNextPath('/dashboard')

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <View style={{ gap: 16 }}>
          <Text style={{ fontSize: 28, fontWeight: '700' }}>Sign in</Text>
          <Text style={{ fontSize: 16, color: '#6b7280' }}>
            Access your organizations, invitations, and execution dashboard.
          </Text>
          <AuthForm mode="sign-in" nextPath={nextPath} />
          <Text style={{ color: '#6b7280', textAlign: 'center' }}>
            No account yet?{' '}
            <Link href="/sign-up" style={{ color: '#2563eb' }}>
              Create one
            </Link>
          </Text>
        </View>
      </View>
    </SafeAreaView>
  )
}
