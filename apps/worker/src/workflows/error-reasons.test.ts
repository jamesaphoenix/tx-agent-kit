import { describe, expect, it } from 'vitest'
import { formatWorkflowFailureReason } from './error-reasons.js'

describe('formatWorkflowFailureReason', () => {
  it('includes nested activity causes instead of only the generic wrapper', () => {
    const error = new Error('Activity task failed', {
      cause: new Error('provider request failed: upstream rejected the request')
    })

    expect(formatWorkflowFailureReason(error)).toBe(
      'Activity task failed caused by: provider request failed: upstream rejected the request'
    )
  })

  it('falls back to string values for non-Error failures', () => {
    expect(formatWorkflowFailureReason('plain failure')).toBe('plain failure')
  })
})
