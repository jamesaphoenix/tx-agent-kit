import { Context, Data, Effect, Layer } from 'effect'
import { getEmailEnv } from './env.js'
import { getResendClient } from './client.js'

export class EmailDeliveryError extends Data.TaggedError('EmailDeliveryError')<{
  readonly to: string
  readonly reason: string
  readonly statusCode?: number
}> {}

export interface SendInput {
  readonly to: string
  readonly subject: string
  readonly htmlBody: string
  readonly textBody?: string
  readonly replyTo?: string
  readonly tags?: ReadonlyArray<{ readonly name: string; readonly value: string }>
  readonly headers?: Record<string, string>
}

export interface SendResult {
  readonly messageId: string
}

export interface BatchSendInput {
  readonly to: string
  readonly subject: string
  readonly htmlBody: string
  readonly textBody?: string
  readonly tags?: ReadonlyArray<{ readonly name: string; readonly value: string }>
  readonly headers?: Record<string, string>
}

export class EmailDeliveryPort extends Context.Tag('EmailDeliveryPort')<
  EmailDeliveryPort,
  {
    readonly send: (input: SendInput) => Effect.Effect<SendResult, EmailDeliveryError>

    readonly sendBatch: (
      inputs: ReadonlyArray<BatchSendInput>
    ) => Effect.Effect<ReadonlyArray<SendResult>, EmailDeliveryError>
  }
>() {}

export const EmailDeliveryPortLive: Layer.Layer<EmailDeliveryPort> = Layer.succeed(
  EmailDeliveryPort,
  {
    send: (input: SendInput): Effect.Effect<SendResult, EmailDeliveryError> =>
      Effect.gen(function* () {
        const env = getEmailEnv()
        const client = getResendClient()

        if (!client) {
          return yield* new EmailDeliveryError({
            to: input.to,
            reason: 'Resend client is not configured (missing RESEND_API_KEY)'
          })
        }

        if (!env.RESEND_FROM_EMAIL) {
          return yield* new EmailDeliveryError({
            to: input.to,
            reason: 'RESEND_FROM_EMAIL is not configured'
          })
        }

        const result = yield* Effect.tryPromise({
          try: () =>
            client.emails.send({
              from: env.RESEND_FROM_EMAIL ?? '',
              to: [input.to],
              subject: input.subject,
              html: input.htmlBody,
              text: input.textBody,
              replyTo: input.replyTo,
              tags: input.tags
                ? input.tags.map((t) => ({ name: t.name, value: t.value }))
                : undefined,
              headers: input.headers
            }),
          catch: (error) =>
            new EmailDeliveryError({
              to: input.to,
              reason: error instanceof Error ? error.message : String(error)
            })
        })

        if (result.error) {
          return yield* new EmailDeliveryError({
            to: input.to,
            reason: result.error.message,
            statusCode: 'statusCode' in result.error ? (result.error.statusCode as number) : undefined
          })
        }

        return { messageId: result.data.id }
      }),

    sendBatch: (
      inputs: ReadonlyArray<BatchSendInput>
    ): Effect.Effect<ReadonlyArray<SendResult>, EmailDeliveryError> =>
      Effect.gen(function* () {
        const env = getEmailEnv()
        const client = getResendClient()

        if (!client) {
          return yield* new EmailDeliveryError({
            to: inputs[0]?.to ?? 'unknown',
            reason: 'Resend client is not configured (missing RESEND_API_KEY)'
          })
        }

        if (!env.RESEND_FROM_EMAIL) {
          return yield* new EmailDeliveryError({
            to: inputs[0]?.to ?? 'unknown',
            reason: 'RESEND_FROM_EMAIL is not configured'
          })
        }

        const fromEmail = env.RESEND_FROM_EMAIL

        const result = yield* Effect.tryPromise({
          try: () =>
            client.batch.send(
              inputs.map((input) => ({
                from: fromEmail,
                to: [input.to],
                subject: input.subject,
                html: input.htmlBody,
                text: input.textBody,
                tags: input.tags
                  ? input.tags.map((t) => ({ name: t.name, value: t.value }))
                  : undefined,
                headers: input.headers
              }))
            ),
          catch: (error) =>
            new EmailDeliveryError({
              to: inputs[0]?.to ?? 'unknown',
              reason: error instanceof Error ? error.message : String(error)
            })
        })

        if (result.error) {
          return yield* new EmailDeliveryError({
            to: inputs[0]?.to ?? 'unknown',
            reason: result.error.message,
            statusCode:
              'statusCode' in result.error ? (result.error.statusCode as number) : undefined
          })
        }

        return result.data.data.map((item) => ({
          messageId: item.id
        }))
      })
  }
)
