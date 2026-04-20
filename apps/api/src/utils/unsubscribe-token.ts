import { createHmac, timingSafeEqual } from 'node:crypto'

export interface UnsubscribeTokenPayload {
  readonly userId: string
  readonly campaignId?: string
}

const TOKEN_VERSION = 1
const TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60 // 7 days

const sign = (payload: string, secret: string): string => {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export const createUnsubscribeToken = (
  payload: UnsubscribeTokenPayload,
  secret: string
): string => {
  const data = {
    v: TOKEN_VERSION,
    uid: payload.userId,
    cid: payload.campaignId ?? null,
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS
  }

  const encoded = Buffer.from(JSON.stringify(data)).toString('base64url')
  const signature = sign(encoded, secret)
  return `${encoded}.${signature}`
}

export const verifyUnsubscribeToken = (
  token: string,
  secret: string
): UnsubscribeTokenPayload | null => {
  const parts = token.split('.')
  if (parts.length !== 2) {
    return null
  }

  const encoded = parts[0]
  const signature = parts[1]

  if (!encoded || !signature) {
    return null
  }

  const expectedSignature = sign(encoded, secret)

  const expectedBuffer = Buffer.from(expectedSignature)
  const receivedBuffer = Buffer.from(signature)

  if (expectedBuffer.length !== receivedBuffer.length) {
    return null
  }

  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return null
  }

  try {
    const raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      v?: number
      uid?: string
      cid?: string | null
      exp?: number
    }

    if (raw.v !== TOKEN_VERSION) {
      return null
    }

    if (typeof raw.uid !== 'string') {
      return null
    }

    if (typeof raw.exp !== 'number') {
      return null
    }

    const now = Math.floor(Date.now() / 1000)
    if (raw.exp < now) {
      return null
    }

    return {
      userId: raw.uid,
      campaignId: typeof raw.cid === 'string' ? raw.cid : undefined
    }
  } catch {
    return null
  }
}
