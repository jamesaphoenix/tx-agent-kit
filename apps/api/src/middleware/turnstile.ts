import type { HttpServerRequest } from '@effect/platform'
import { turnstileResponseHeaderName } from '@tx-agent-kit/contracts'
import { recordTurnstileVerification } from '@tx-agent-kit/observability'
import { Effect } from 'effect'
import { BadRequest, Forbidden } from '../api.js'
import { getTurnstileConfig } from '../config/env.js'
import { hasValidRateLimitBypass, toClientIpAddress } from './auth-rate-limit.js'

// Standard Cloudflare form-field / header name carrying the widget token.
export const TURNSTILE_RESPONSE_HEADER = turnstileResponseHeaderName

export interface TurnstileVerifyParams {
  readonly secretKey: string
  readonly token: string
  readonly verifyUrl: string
  readonly remoteIp?: string
}

export interface TurnstileVerifyResult {
  readonly success: boolean
  readonly errorCodes: readonly string[]
}

const parseSiteverifyResponse = (payload: unknown): TurnstileVerifyResult => {
  if (typeof payload !== 'object' || payload === null) {
    return { success: false, errorCodes: ['invalid-response'] }
  }

  const success = (payload as { success?: unknown }).success === true
  const rawCodes = (payload as { 'error-codes'?: unknown })['error-codes']
  const errorCodes = Array.isArray(rawCodes)
    ? rawCodes.filter((code): code is string => typeof code === 'string')
    : []

  return { success, errorCodes }
}

/**
 * Verifies a Turnstile token against Cloudflare siteverify. Resolves with
 * `{ success: false }` on an explicit verification failure. Throws only on
 * a transport/parse error so the caller can decide how to degrade.
 */
export const verifyTurnstileToken = async (
  params: TurnstileVerifyParams
): Promise<TurnstileVerifyResult> => {
  const body = new URLSearchParams({
    secret: params.secretKey,
    response: params.token
  })
  if (params.remoteIp && params.remoteIp.length > 0) {
    body.set('remoteip', params.remoteIp)
  }

  const response = await fetch(params.verifyUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })

  if (!response.ok) {
    throw new Error(`turnstile siteverify returned HTTP ${response.status}`)
  }

  return parseSiteverifyResponse(await response.json())
}

/**
 * Gates an auth request behind Cloudflare Turnstile.
 *
 * - No secret configured: no-op (dev without a key, and the test suite).
 * - Trusted deploy bypass: no-op.
 * - Missing token: 400 BadRequest.
 * - Explicit verification failure: 403 Forbidden.
 * - siteverify transport error: fail OPEN (allow) and log, so a Cloudflare
 *   hiccup can't take sign-up offline. The rate limiter remains the backstop.
 */
export const enforceTurnstile = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<void, BadRequest | Forbidden> =>
  Effect.gen(function* () {
    const config = getTurnstileConfig()
    if (config === null) {
      return
    }

    if (hasValidRateLimitBypass(request)) {
      return
    }

    const token = request.headers[TURNSTILE_RESPONSE_HEADER]
    if (typeof token !== 'string' || token.trim().length === 0) {
      return yield* Effect.fail(
        new BadRequest({ message: 'Captcha verification is required.' })
      )
    }

    // `reachable: false` marks the fail-open branch so it is recorded as
    // `unreachable` rather than being mistaken for a genuine `success`.
    const outcome = yield* Effect.tryPromise({
      try: () =>
        verifyTurnstileToken({
          secretKey: config.secretKey,
          token: token.trim(),
          verifyUrl: config.verifyUrl,
          remoteIp: toClientIpAddress(request)
        }),
      catch: (cause) => cause
    }).pipe(
      Effect.map((result): { readonly reachable: boolean; readonly result: TurnstileVerifyResult } => ({
        reachable: true,
        result
      })),
      Effect.catchAll((cause) =>
        // Fail open: an infra error must not take sign-up offline.
        Effect.logWarning('turnstile siteverify unreachable, failing open').pipe(
          Effect.annotateLogs('error', String(cause)),
          Effect.as({ reachable: false, result: { success: true, errorCodes: [] } })
        )
      )
    )

    if (!outcome.reachable) {
      // siteverify transport error / unreachable: fail OPEN but record it.
      yield* Effect.sync(() => recordTurnstileVerification('unreachable'))
      return
    }

    if (!outcome.result.success) {
      // Explicit siteverify verification failure: 403 Forbidden.
      yield* Effect.sync(() => recordTurnstileVerification('failed'))
      return yield* Effect.fail(
        new Forbidden({ message: 'Captcha verification failed. Please try again.' })
      )
    }

    // Explicit siteverify success.
    yield* Effect.sync(() => recordTurnstileVerification('success'))
  })
