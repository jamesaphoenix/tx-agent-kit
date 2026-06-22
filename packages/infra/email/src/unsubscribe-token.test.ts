import { describe, expect, it } from 'vitest'
import { createUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.js'

const SECRET = 'unit-test-secret-minimum-32-characters-long'

describe('unsubscribe token', () => {
  it('round-trips a userId + campaignId', () => {
    const token = createUnsubscribeToken({ userId: 'user-1', campaignId: 'camp-1' }, SECRET)
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ userId: 'user-1', campaignId: 'camp-1' })
  })

  it('round-trips a global (no campaign) unsubscribe', () => {
    const token = createUnsubscribeToken({ userId: 'user-1' }, SECRET)
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ userId: 'user-1', campaignId: undefined })
  })

  it('rejects a token signed with a different secret', () => {
    const token = createUnsubscribeToken({ userId: 'user-1', campaignId: 'camp-1' }, SECRET)
    expect(verifyUnsubscribeToken(token, 'a-different-secret-minimum-32-characters')).toBeNull()
  })

  it('rejects a tampered token', () => {
    const token = createUnsubscribeToken({ userId: 'user-1' }, SECRET)
    expect(verifyUnsubscribeToken(`${token}x`, SECRET)).toBeNull()
    expect(verifyUnsubscribeToken('not-a-token', SECRET)).toBeNull()
  })
})
