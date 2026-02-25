import { InvitationEmailPort } from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect, Layer } from 'effect'
import { getApiEnv } from '../config/env.js'

const logger = createLogger('tx-agent-kit-api').child('invitation-email')
const resendEndpoint = 'https://api.resend.com/emails'

const buildAcceptUrl = (token: string, baseUrl: string): string => {
  const url = new URL('/invitations', baseUrl)
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

export const InvitationEmailPortLive = Layer.succeed(InvitationEmailPort, {
  sendInvitationEmail: (input) =>
    Effect.gen(function* () {
      const env = getApiEnv()
      const resendApiKey = env.RESEND_API_KEY
      const resendFromEmail = env.RESEND_FROM_EMAIL

      if (!resendApiKey || !resendFromEmail) {
        logger.warn('Invitation email skipped because Resend is not configured.', {
          recipientEmail: input.recipientEmail
        })
        return
      }

      if (!env.WEB_BASE_URL) {
        logger.warn('Invitation email skipped because WEB_BASE_URL is not configured.', {
          recipientEmail: input.recipientEmail
        })
        return
      }

      const acceptUrl = buildAcceptUrl(input.token, env.WEB_BASE_URL)
      const subject = `You've been invited to join ${input.organizationName}`
      const text = [
        `Hi ${input.recipientName},`,
        '',
        `${input.inviterName} has invited you to join ${input.organizationName} as a${input.role === 'admin' ? 'n admin' : ' member'}.`,
        '',
        `Accept this invitation:`,
        acceptUrl,
        '',
        `If you did not expect this invitation, you can ignore this email.`
      ].join('\n')
      const html = [
        `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">`,
        `<h2 style="margin: 0 0 24px; font-size: 20px; font-weight: 600;">You've been invited</h2>`,
        `<p style="margin: 0 0 16px; color: #374151; line-height: 1.6;">Hi ${escapeHtml(input.recipientName)},</p>`,
        `<p style="margin: 0 0 16px; color: #374151; line-height: 1.6;"><strong>${escapeHtml(input.inviterName)}</strong> has invited you to join <strong>${escapeHtml(input.organizationName)}</strong> as a${input.role === 'admin' ? 'n admin' : ' member'}.</p>`,
        `<div style="margin: 32px 0; text-align: center;">`,
        `<a href="${acceptUrl}" style="display: inline-block; padding: 12px 32px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;">Accept invitation</a>`,
        `</div>`,
        `<p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; line-height: 1.5;">Or copy and paste this URL into your browser:</p>`,
        `<p style="margin: 0 0 24px; color: #6b7280; font-size: 13px; word-break: break-all;"><a href="${acceptUrl}" style="color: #4f46e5;">${acceptUrl}</a></p>`,
        `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />`,
        `<p style="margin: 0; color: #9ca3af; font-size: 12px;">If you did not expect this invitation, you can ignore this email.</p>`,
        `</div>`
      ].join('')

      yield* sendResendEmail({
        apiKey: resendApiKey,
        from: resendFromEmail,
        to: input.recipientEmail,
        subject,
        html,
        text
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            logger.error(
              'Failed to send invitation email.',
              {
                recipientEmail: input.recipientEmail,
                organizationName: input.organizationName
              },
              error instanceof Error ? error : new Error(String(error))
            )
          })
        )
      )
    })
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}
