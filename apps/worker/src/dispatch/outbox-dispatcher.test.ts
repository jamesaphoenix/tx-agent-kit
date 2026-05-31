import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common'
import type { Client } from '@temporalio/client'
import type { SerializedDomainEvent } from '../activities.js'

const {
  fetchUnprocessedEventsMock,
  markEventsPublishedMock,
  markEventFailedMock,
  loggerErrorMock
} = vi.hoisted(() => ({
  fetchUnprocessedEventsMock: vi.fn(),
  markEventsPublishedMock: vi.fn((_eventIds?: unknown) => Promise.resolve(undefined)),
  markEventFailedMock: vi.fn((_eventId?: unknown, _reason?: string) => Promise.resolve(undefined)),
  loggerErrorMock: vi.fn()
}))

vi.mock('../activities.js', () => ({
  activities: {
    fetchUnprocessedEvents: fetchUnprocessedEventsMock,
    markEventsPublished: markEventsPublishedMock,
    markEventFailed: markEventFailedMock
  }
}))

vi.mock('@tx-agent-kit/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: loggerErrorMock })
}))

const { drainOutboxOnce } = await import('./outbox-dispatcher.js')

const makeEvent = (
  eventType: string,
  payload: Record<string, unknown>,
  id = 'evt-1'
): SerializedDomainEvent => ({
  id,
  eventType,
  aggregateType: 'test',
  aggregateId: 'agg-1',
  payload,
  correlationId: null,
  sequenceNumber: 1,
  status: 'processing',
  occurredAt: '2026-01-01T00:00:00.000Z',
  processingAt: '2026-01-01T00:00:00.000Z',
  publishedAt: null,
  failedAt: null,
  failureReason: null,
  createdAt: '2026-01-01T00:00:00.000Z'
})

const orgCreated = (id = 'evt-1'): SerializedDomainEvent =>
  makeEvent('organization.created', {
    organizationName: 'Acme',
    ownerUserId: 'u1',
    ownerEmail: 'a@b.co'
  }, id)

const makeClient = (start: ReturnType<typeof vi.fn>): Client =>
  ({ workflow: { start } } as unknown as Client)

beforeEach(() => {
  vi.clearAllMocks()
  // mockReset drains the per-test mockResolvedValueOnce queue (clearAllMocks
  // only clears call history, so leftover queued resolves would bleed across
  // tests). Re-establish the awaited-void impls the dispatcher relies on.
  fetchUnprocessedEventsMock.mockReset()
  markEventsPublishedMock.mockReset().mockResolvedValue(undefined)
  markEventFailedMock.mockReset().mockResolvedValue(undefined)
})

describe('drainOutboxOnce', () => {
  it('starts the mapped workflow and marks the batch published', async () => {
    fetchUnprocessedEventsMock.mockResolvedValueOnce([orgCreated()]).mockResolvedValueOnce([])
    const start = vi.fn(() => Promise.resolve(undefined))

    await drainOutboxOnce(makeClient(start), 'default-queue', 50)

    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith('organizationCreatedWorkflow', expect.objectContaining({
      workflowId: 'organization-created-evt-1',
      taskQueue: 'default-queue',
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
      workflowRunTimeout: '5 minutes'
    }))
    expect(markEventsPublishedMock).toHaveBeenCalledTimes(1)
    expect(markEventsPublishedMock.mock.calls[0]?.[0]).toEqual(['evt-1'])
    expect(markEventFailedMock).not.toHaveBeenCalled()
  })

  it('uses the plan task queue when one is pinned (email campaigns)', async () => {
    const event = makeEvent('email_campaigns.enrollment_triggered', {
      campaignId: 'c1', userId: 'u1', userEmail: 'a@b.co', userName: 'A', enrollmentId: 'en1'
    })
    fetchUnprocessedEventsMock.mockResolvedValueOnce([event]).mockResolvedValueOnce([])
    const start = vi.fn(() => Promise.resolve(undefined))

    await drainOutboxOnce(makeClient(start), 'default-queue', 50)

    expect(start).toHaveBeenCalledWith('dripSequenceWorkflow', expect.objectContaining({
      taskQueue: 'email-campaigns'
    }))
  })

  it('permanently fails structurally-invalid events without starting a workflow', async () => {
    fetchUnprocessedEventsMock
      .mockResolvedValueOnce([makeEvent('organization.created', {})])
      .mockResolvedValueOnce([])
    const start = vi.fn(() => Promise.resolve(undefined))

    await drainOutboxOnce(makeClient(start), 'default-queue', 50)

    expect(start).not.toHaveBeenCalled()
    expect(markEventFailedMock).toHaveBeenCalledTimes(1)
    expect(markEventsPublishedMock).not.toHaveBeenCalled()
  })

  it('treats WorkflowExecutionAlreadyStartedError as a successful (idempotent) dispatch', async () => {
    fetchUnprocessedEventsMock.mockResolvedValueOnce([orgCreated()]).mockResolvedValueOnce([])
    const start = vi.fn(() =>
      Promise.reject(new WorkflowExecutionAlreadyStartedError('dup', 'wf', 'organizationCreatedWorkflow'))
    )

    await drainOutboxOnce(makeClient(start), 'default-queue', 50)

    expect(markEventsPublishedMock).toHaveBeenCalledTimes(1)
    expect(markEventsPublishedMock.mock.calls[0]?.[0]).toEqual(['evt-1'])
    expect(markEventFailedMock).not.toHaveBeenCalled()
  })

  it('leaves transient start failures claimed for retry (does NOT terminal-fail)', async () => {
    fetchUnprocessedEventsMock.mockResolvedValueOnce([orgCreated()]).mockResolvedValueOnce([])
    const start = vi.fn(() => Promise.reject(new Error('temporal unreachable')))

    await drainOutboxOnce(makeClient(start), 'default-queue', 50)

    // The row is left in 'processing' for stuck-events-reset to recover — NOT failed.
    expect(markEventFailedMock).not.toHaveBeenCalled()
    expect(markEventsPublishedMock).not.toHaveBeenCalled()
    expect(loggerErrorMock).toHaveBeenCalled()
  })

  it('keeps draining while batches come back full, then stops on a partial batch', async () => {
    fetchUnprocessedEventsMock
      .mockResolvedValueOnce([orgCreated('a'), orgCreated('b')]) // full batch (size 2) → loop again
      .mockResolvedValueOnce([orgCreated('c')])                  // partial → stop after this
    const start = vi.fn(() => Promise.resolve(undefined))

    await drainOutboxOnce(makeClient(start), 'default-queue', 2)

    expect(fetchUnprocessedEventsMock).toHaveBeenCalledTimes(2)
    expect(start).toHaveBeenCalledTimes(3)
  })

  it('stops immediately when the queue is empty', async () => {
    fetchUnprocessedEventsMock.mockResolvedValueOnce([])
    const start = vi.fn(() => Promise.resolve(undefined))

    await drainOutboxOnce(makeClient(start), 'default-queue', 50)

    expect(start).not.toHaveBeenCalled()
    expect(markEventsPublishedMock).not.toHaveBeenCalled()
  })
})
