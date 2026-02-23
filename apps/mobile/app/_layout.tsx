import { Slot } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { AppProviders } from '../components/providers/AppProviders'
import { NotifyToaster } from '../lib/notify'

export default function RootLayout() {
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
