import { Effect } from 'effect'
import { randomUUID } from 'node:crypto'

export interface RecordedSend {
  to: string
  subject: string
  htmlBody: string
  textBody?: string
  tags?: ReadonlyArray<{ name: string; value: string }>
  headers?: Record<string, string>
  messageId: string
}

export const createTestEmailDelivery = () => {
  const sends: RecordedSend[] = []

  const port = {
    send: (input: Omit<RecordedSend, 'messageId'>) =>
      Effect.sync(() => {
        const messageId = `test-${randomUUID()}`
        sends.push({ ...input, messageId })
        return { messageId }
      }),
    sendBatch: (inputs: ReadonlyArray<Omit<RecordedSend, 'messageId'>>) =>
      Effect.sync(() =>
        inputs.map((input) => {
          const messageId = `test-${randomUUID()}`
          sends.push({ ...input, messageId })
          return { messageId }
        })
      ),
  }

  return { port, sends }
}
