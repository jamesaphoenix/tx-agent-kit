export interface EmailEnv {
  RESEND_API_KEY: string | undefined
  RESEND_FROM_EMAIL: string | undefined
  RESEND_WEBHOOK_SECRET: string | undefined
  WEB_BASE_URL: string | undefined
}

const parseOptionalStringEnv = (value: string | undefined): string | undefined => {
  if (typeof value === 'undefined') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

let _cachedEmailEnv: EmailEnv | null = null

export const resetEmailEnvCache = (): void => {
  _cachedEmailEnv = null
}

export const getEmailEnv = (): EmailEnv => {
  if (_cachedEmailEnv) {
    return _cachedEmailEnv
  }

  const env: EmailEnv = {
    RESEND_API_KEY: parseOptionalStringEnv(process.env.RESEND_API_KEY),
    RESEND_FROM_EMAIL: parseOptionalStringEnv(process.env.RESEND_FROM_EMAIL),
    RESEND_WEBHOOK_SECRET: parseOptionalStringEnv(process.env.RESEND_WEBHOOK_SECRET),
    WEB_BASE_URL: parseOptionalStringEnv(process.env.WEB_BASE_URL)
  }

  _cachedEmailEnv = env
  return _cachedEmailEnv
}
