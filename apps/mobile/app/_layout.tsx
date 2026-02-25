import { Slot } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { AppProviders } from '../components/providers/AppProviders'
import { NotifyToaster } from '../lib/notify'
import { initializeMobileSentry } from '../lib/sentry'

export default function RootLayout() {
  useEffect(() => {
    void initializeMobileSentry()
  }, [])

  return (
    <SafeAreaProvider>
      <AppProviders>
        <StatusBar style="auto" />
        <Slot />
      </AppProviders>
      <NotifyToaster />
    </SafeAreaProvider>
  )
}
