import { PasswordResetEmailPort } from '@tx-agent-kit/core'
import { getTestkitEnv } from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { PasswordResetEmailPortLive } from './password-reset-email.js'

/**
 * LIVE Resend integration — guarded behind `RUN_LIVE_INTEGRATION=1` (the umbrella
 * switch for real external-service tests; see testkit env). Off by default so the
 * standard suite stays hermetic and never hits a third party. Exercises the real
 * Resend wiring end-to-end: API key, verified `from` address, endpoint, payload.
 *
 * Sends to Resend's simulation inbox `delivered@resend.dev`, which returns a real
 * 2xx without delivering to a human — so the assertion is deterministic while
 * still proving the live HTTP path works.
 *
 *   RUN_LIVE_INTEGRATION=1 \
 *   RESEND_API_KEY=$(op read 'op://octospark-services/dev/RESEND_API_KEY') \
 *   RESEND_FROM_EMAIL=<verified-domain-address> WEB_BASE_URL=https://octospark.ai \
 *   pnpm --filter @tx-agent-kit/api test:integration password-reset-email.live
 */

const hasResendKey =
  typeof process.env.RESEND_API_KEY === 'string' && process.env.RESEND_API_KEY.length > 0
const shouldRunLive = getTestkitEnv().RUN_LIVE_INTEGRATION === '1' && hasResendKey

describe('PasswordResetEmailPortLive (live Resend)', () => {
  it.skipIf(!shouldRunLive)(
    'accepts a password reset email via the real Resend API',
    async () => {
      const program = PasswordResetEmailPort.pipe(
        Effect.flatMap((port) =>
          port.sendPasswordResetEmail({
            // ALLOW_HARDCODED_TEST_EMAIL: Resend's deterministic simulation inbox
            email: 'delivered@resend.dev',
            name: 'Live Integration',
            token: 'live-integration-token'
          })
        ),
        Effect.provide(PasswordResetEmailPortLive)
      )

      // Resolves on a 2xx from Resend; rejects (surfacing the real provider error)
      // if the live wiring is broken — exactly what this guarded test is here to catch.
      await expect(Effect.runPromise(program)).resolves.toBeUndefined()
    }
  )
})
