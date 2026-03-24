import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const defaultSpotlightUrl = 'http://localhost:8969'

const probeSpotlight = async (): Promise<boolean> => {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const response = await fetch(defaultSpotlightUrl, {
      signal: controller.signal
    })
    clearTimeout(timeout)
    return response.ok || response.status < 500
  } catch {
    return false
  }
}

const spotlightReachable = await probeSpotlight()

const buildSentryEnvelope = (errorMessage: string): string => {
  const eventId = randomUUID().replaceAll('-', '')
  const header = JSON.stringify({
    event_id: eventId,
    sent_at: new Date().toISOString(),
    sdk: { name: 'sentry.javascript.node', version: '10.0.0' }
  })
  const itemHeader = JSON.stringify({
    type: 'event',
    length: 0
  })
  const payload = JSON.stringify({
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    environment: 'test',
    exception: {
      values: [
        {
          type: 'Error',
          value: errorMessage,
          mechanism: { type: 'generic', handled: true }
        }
      ]
    }
  })

  return `${header}\n${itemHeader}\n${payload}`
}

describe('spotlight sidecar integration', () => {
  it.skipIf(!spotlightReachable)(
    'sidecar responds to HTTP requests on port 8969',
    async () => {
      const response = await fetch(defaultSpotlightUrl)
      expect(response.status).toBeLessThan(500)
    }
  )

  it.skipIf(!spotlightReachable)(
    'sidecar accepts raw Sentry envelopes via POST /stream',
    async () => {
      const marker = `spotlight-integration-${randomUUID()}`
      const envelope = buildSentryEnvelope(marker)

      const response = await fetch(`${defaultSpotlightUrl}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        body: envelope
      })

      expect(response.ok).toBe(true)
    }
  )

  it.skipIf(!spotlightReachable)(
    'sidecar accepts multiple envelopes in sequence',
    async () => {
      const results = await Promise.all(
        Array.from({ length: 3 }, (_, i) => {
          const envelope = buildSentryEnvelope(`spotlight-batch-${i}-${randomUUID()}`)
          return fetch(`${defaultSpotlightUrl}/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-sentry-envelope' },
            body: envelope
          })
        })
      )

      for (const response of results) {
        expect(response.ok).toBe(true)
      }
    }
  )
})
