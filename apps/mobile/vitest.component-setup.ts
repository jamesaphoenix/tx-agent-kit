import { vi } from 'vitest'

;(globalThis as Record<string, unknown>).__DEV__ = true

const secureStoreValues: Record<string, string> = {}

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
  getItemAsync: vi.fn((key: string) => Promise.resolve(secureStoreValues[key] ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    secureStoreValues[key] = value
    return Promise.resolve()
  }),
  deleteItemAsync: vi.fn((key: string) => {
    delete secureStoreValues[key]
    return Promise.resolve()
  })
}))

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return {
        extra: {
          API_BASE_URL:
            process.env.MOBILE_INTEGRATION_API_BASE_URL ??
            process.env.EXPO_PUBLIC_API_BASE_URL ??
            'http://localhost:4000',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4320',
          NODE_ENV: 'test'
        }
      }
    }
  }
}))
