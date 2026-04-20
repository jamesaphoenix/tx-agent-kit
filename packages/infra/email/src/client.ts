import { Resend } from 'resend'
import { getEmailEnv } from './env.js'

let _cachedClient: Resend | null = null

export const getResendClient = (): Resend | null => {
  if (_cachedClient) {
    return _cachedClient
  }

  const env = getEmailEnv()

  if (!env.RESEND_API_KEY) {
    return null
  }

  _cachedClient = new Resend(env.RESEND_API_KEY)
  return _cachedClient
}

export const resetResendClientCache = (): void => {
  _cachedClient = null
}
