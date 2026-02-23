import { useLocalSearchParams } from 'expo-router'

const sanitizeInternalPath = (value: string | string[] | undefined, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback
  }

  return value.startsWith('/') && !value.startsWith('//') ? value : fallback
}

export const useSafeNextPath = (fallback = '/dashboard'): string => {
  const params = useLocalSearchParams<{ next?: string }>()
  return sanitizeInternalPath(params.next, fallback)
}
