import { logger } from './shared.js'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

// Conservative cap on outbound Resend requests from this worker process. Resend's
// default paid limit is ~10 req/s; staying under it keeps a drip sweep burst (up
// to batchSize sequential sends) from tripping 429s. Sends are serialized through
// one gate so the rate holds even if the drip sweep and a broadcast run on the
// same worker at once. This is per-process; a multi-replica email worker would
// need a shared (Redis) limiter, but the drip sweep runs single-flight (SKIP
// overlap), so one worker owns the bulk send.
const MAX_REQUESTS_PER_SECOND = 8
const MIN_INTERVAL_MS = Math.ceil(1000 / MAX_REQUESTS_PER_SECOND)

let gate: Promise<void> = Promise.resolve()
let nextAllowedAt = 0

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Serialize slot acquisition and space slots by at least MIN_INTERVAL_MS, so the
// start rate of Resend requests never exceeds MAX_REQUESTS_PER_SECOND. Each call
// chains behind the previous one via a fresh gate promise it releases once its
// spacing wait elapses (before the caller's fetch), so the next slot waits only
// for the inter-request interval, not the in-flight request.
const acquireSlot = (): Promise<void> => {
  const previous = gate
  let release: () => void = () => undefined
  gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return (async (): Promise<void> => {
    try {
      await previous
      const wait = nextAllowedAt - Date.now()
      if (wait > 0) {
        await sleep(wait)
      }
      nextAllowedAt = Date.now() + MIN_INTERVAL_MS
    } finally {
      release()
    }
  })()
}

/** Parse a `Retry-After` header (delta-seconds or an HTTP date) to milliseconds. */
export const parseRetryAfterMs = (header: string | null): number | null => {
  if (header === null) {
    return null
  }
  // A numeric header is delta-seconds (a negative value is invalid -> null).
  // Only fall back to HTTP-date parsing for non-numeric strings.
  const seconds = Number(header)
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? Math.round(seconds * 1000) : null
  }
  const date = Date.parse(header)
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now())
  }
  return null
}

/** Resend returned 429. Distinct so callers can classify it as a retryable
 * rate-limit failure (the drip sweep lets Temporal retry the activity). */
export class ResendRateLimitedError extends Error {
  readonly retryAfterMs: number | null
  constructor(retryAfterMs: number | null) {
    super(`Resend rate limited${retryAfterMs === null ? '' : ` (retry after ${retryAfterMs}ms)`}`)
    this.name = 'ResendRateLimitedError'
    this.retryAfterMs = retryAfterMs
  }
}

export interface SendViaResendInput {
  readonly apiKey: string
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly html: string
  readonly text: string
  readonly idempotencyKey: string
  /** Custom MIME email headers (e.g. List-Unsubscribe), passed to Resend's API. */
  readonly headers?: Record<string, string>
}

/**
 * Rate-limited single-email send via Resend. Acquires a throttle slot first, then
 * POSTs with the caller's idempotency key. On 429 it backs the shared gate off by
 * the server's Retry-After and throws ResendRateLimitedError; on any other non-2xx
 * it throws a plain Error. Returns the Resend message id on success.
 */
export const sendViaResend = async (input: SendViaResendInput): Promise<string> => {
  await acquireSlot()

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
      'idempotency-key': input.idempotencyKey
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.headers === undefined ? {} : { headers: input.headers })
    })
  })

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
    // Pause the whole worker's sends, not just this one, until the window clears.
    if (retryAfterMs !== null) {
      nextAllowedAt = Date.now() + retryAfterMs
    }
    logger.warn('Resend rate limited; backing off.', { retryAfterMs })
    throw new ResendRateLimitedError(retryAfterMs)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Resend request failed (${response.status}): ${body}`)
  }

  const result = (await response.json()) as { id?: string }
  return result.id ?? 'unknown'
}
