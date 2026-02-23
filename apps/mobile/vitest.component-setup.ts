import { vi } from 'vitest'

;(globalThis as Record<string, unknown>).__DEV__ = true

vi.mock('react-native-toast-message', () => {
  const MockToast = () => 'Toast'
  return {
    default: Object.assign(MockToast, {
      show: vi.fn(),
      hide: vi.fn()
    })
  }
})

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: Record<string, unknown>) =>
    require('react').createElement('SafeAreaView', props, children),
  SafeAreaProvider: ({ children }: Record<string, unknown>) =>
    require('react').createElement('SafeAreaProvider', {}, children),
  useSafeAreaInsets: vi.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 }))
}))

vi.mock('expo-router', () => ({
  useRouter: vi.fn(() => ({
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn()
  })),
  useLocalSearchParams: vi.fn(() => ({})),
  useFocusEffect: vi.fn(),
  Slot: 'Slot',
  Link: 'Link'
}))

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn()
}))

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        API_BASE_URL: 'http://localhost:4000'
      }
    }
  }
}))
