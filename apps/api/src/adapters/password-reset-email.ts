import { PasswordResetEmailPort } from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect, Layer } from 'effect'
import { getApiEnv } from '../config/env.js'

const logger = createLogger('tx-agent-kit-api').child('password-reset-email')
const resendEndpoint = 'https://api.resend.com/emails'

const buildResetUrl = (token: string, baseUrl: string): string => {
  const url = new URL('/reset-password', baseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

const sendResendEmail = (input: {
  apiKey: string
  from: string
  to: string
  subject: string
  html: string
  text: string
}): Effect.Effect<void, unknown> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(resendEndpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          from: input.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text
        })
      })

      if (!response.ok) {
        const payload = await response.text()
        throw new Error(`Resend request failed (${response.status}): ${payload}`)
      }
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error)))
  })

export const PasswordResetEmailPortLive = Layer.succeed(PasswordResetEmailPort, {
  sendPasswordResetEmail: (input: { email: string; name: string; token: string }) =>
    Effect.gen(function* () {
      const env = getApiEnv()
      const resendApiKey = env.RESEND_API_KEY
      const resendFromEmail = env.RESEND_FROM_EMAIL

      if (!resendApiKey || !resendFromEmail) {
        logger.warn('Password reset email skipped because Resend is not configured.', {
          recipientEmail: input.email
        })
        return
      }

      if (!env.WEB_BASE_URL) {
        return yield* Effect.fail(new Error('WEB_BASE_URL is required to send password reset emails'))
      }

      const webBaseUrl = env.WEB_BASE_URL
      const resetUrl = buildResetUrl(input.token, webBaseUrl)
      const subject = 'Reset your password'
      const text = `Reset your password using this link:\n${resetUrl}\n\nIf you did not request this change, you can ignore this email.`
      const html = [
        '<p>Reset your password using this link:</p>',
        `<p><a href="${resetUrl}">${resetUrl}</a></p>`,
        '<p>If you did not request this change, you can ignore this email.</p>'
      ].join('')

      yield* sendResendEmail({
        apiKey: resendApiKey,
        from: resendFromEmail,
        to: input.email,
        subject,
        html,
        text
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            logger.error(
              'Failed to send password reset email.',
              {
                recipientEmail: input.email
              },
              error instanceof Error ? error : new Error(String(error))
            )
          })
        )
      )
    })
})
