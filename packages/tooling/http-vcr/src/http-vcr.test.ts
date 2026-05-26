import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHttpVcrFetch, stableHttpVcrHash } from './http-vcr.js'

describe('http-vcr', () => {
  it('uses a stable structural hash independent of object key order', () => {
    expect(stableHttpVcrHash({ b: 2, a: { y: 1, x: 0 } })).toBe(
      stableHttpVcrHash({ a: { x: 0, y: 1 }, b: 2 })
    )
  })

  it('records sanitized requests and responses, then replays them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tx-http-vcr-'))
    const cassettePath = join(dir, 'provider.json')
    const recordedBodies: string[] = []
    const fetchImpl: typeof fetch = (_input, init) => {
      recordedBodies.push(typeof init?.body === 'string' ? init.body : '')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'live-access-token',
            data: { id: 'resource-1' }
          }),
          {
            status: 201,
            headers: {
              'content-type': 'application/json',
              'set-cookie': 'session=secret'
            }
          }
        )
      )
    }

    const recordFetch = createHttpVcrFetch({
      cassettePath,
      mode: 'record',
      fetchImpl
    })

    const recorded = await recordFetch(
      'https://api.provider.test/v1/resources?access_token=query-secret',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer live-access-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          text: 'hello',
          refresh_token: 'live-refresh-token'
        })
      }
    )

    expect(recorded.status).toBe(201)
    expect(recordedBodies).toHaveLength(1)

    const cassette = await readFile(cassettePath, 'utf8')
    expect(cassette).not.toContain('live-access-token')
    expect(cassette).not.toContain('live-refresh-token')
    expect(cassette).not.toContain('query-secret')
    expect(cassette).toContain('[REDACTED]')

    const replayFetch = createHttpVcrFetch({ cassettePath, mode: 'replay' })
    const replayed = await replayFetch(
      'https://api.provider.test/v1/resources?access_token=different-secret',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer different-access-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          text: 'hello',
          refresh_token: 'different-refresh-token'
        })
      }
    )

    expect(replayed.status).toBe(201)
    expect(await replayed.json()).toEqual({
      access_token: '[REDACTED]',
      data: { id: 'resource-1' }
    })
  })

  it('fails loudly on replay misses', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tx-http-vcr-'))
    const cassettePath = join(dir, 'missing.json')
    const replayFetch = createHttpVcrFetch({ cassettePath, mode: 'replay' })

    await expect(replayFetch('https://api.provider.test/v1/resources')).rejects.toThrow(
      /HTTP VCR cassette miss/
    )
  })
})
