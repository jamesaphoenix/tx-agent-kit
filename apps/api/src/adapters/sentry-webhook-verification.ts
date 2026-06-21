import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify an auto-fix webhook's `Sentry-Hook-Signature` HMAC.
 *
 * Sentry (the first incident source) signs the raw request body with HMAC-SHA256
 * keyed by the integration's client secret and sends the lowercase hex digest in
 * the `Sentry-Hook-Signature` header. We recompute the digest over the exact raw
 * body and compare in constant time.
 *
 * Reference: Sentry "Securing Webhooks" -
 *   hmac = hmac_sha256(secret, request_body).hexdigest()
 *
 * Returns false (never throws) for any malformed/mismatched signature so callers
 * can map a verification failure to a clean 401/400.
 */
export const verifySentryHmac = (
  payload: string,
  signature: string,
  secret: string
): boolean => {
  if (signature.length === 0 || secret.length === 0) {
    return false
  }

  const computed = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')

  // Normalise both to hex buffers; a non-hex signature yields a length mismatch.
  const expectedBuffer = Buffer.from(computed, 'hex')
  const receivedBuffer = Buffer.from(signature.trim().toLowerCase(), 'hex')

  if (
    receivedBuffer.length === 0 ||
    expectedBuffer.length !== receivedBuffer.length
  ) {
    return false
  }

  try {
    return timingSafeEqual(expectedBuffer, receivedBuffer)
  } catch {
    return false
  }
}
