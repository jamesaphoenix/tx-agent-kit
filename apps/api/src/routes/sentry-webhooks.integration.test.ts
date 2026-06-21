import { generateId } from '@tx-agent-kit/db'
import { getTestkitEnv } from '@tx-agent-kit/testkit'
import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestFixture } from './test-helpers.js'

// Raw secret the shared API was spawned with (vitest-global-setup). The API
// runs with AUTO_FIX_TRIGGER_MODE=stub + SENTRY_DEPLOYMENT_ENVIRONMENT=staging.
const rawWebhookSecret = getTestkitEnv().INTEGRATION_TEST_SENTRY_WEBHOOK_SECRET_RAW
if (!rawWebhookSecret) {
  throw new Error('INTEGRATION_TEST_SENTRY_WEBHOOK_SECRET_RAW must be set by vitest-global-setup')
}
const secret = rawWebhookSecret

const { dbAuthContext, hooks } = createTestFixture({
  schemaPrefix: 'sentry_whook',
  autoRegisterHooks: false
})

const ENDPOINT = '/internal/sentry/new-issue'

// The source signs the raw body with HMAC-SHA256 (hex digest) keyed by the secret.
const signPayload = (payload: string): string =>
  createHmac('sha256', secret).update(payload, 'utf8').digest('hex')

interface IssueOverrides {
  id?: string
  environment?: string | null
  title?: string
  culprit?: string | null
  permalink?: string | null
  level?: string | null
  fingerprint?: ReadonlyArray<string> | null
}

const buildIssuePayload = (overrides?: IssueOverrides): string =>
  JSON.stringify({
    action: 'created',
    data: {
      issue: {
        id: overrides?.id ?? `sentry-issue-${generateId()}`,
        title: overrides?.title ?? 'TypeError: cannot read property of undefined',
        culprit: overrides?.culprit ?? 'apps/api/src/handlers/foo.ts',
        permalink: overrides?.permalink ?? 'https://example.test/issues/123/',
        level: overrides?.level ?? 'error',
        environment: overrides?.environment ?? 'staging',
        fingerprint: overrides?.fingerprint ?? ['fp-abc'],
        firstSeen: '2026-06-06T00:00:00.000Z'
      }
    }
  })

const postWebhook = async (
  payload: string,
  caseName: string,
  signature?: string
): Promise<Response> =>
  fetch(`${dbAuthContext.baseUrl}${ENDPOINT}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature === undefined ? {} : { 'sentry-hook-signature': signature }),
      ...dbAuthContext.testContext.headersForCase(caseName)
    },
    body: payload
  })

interface RunRow {
  status: string
  environment: string
  title: string
  fingerprint: string | null
  permalink: string | null
  agent_jsonl_output: string | null
}

const readRun = async (sentryIssueId: string): Promise<RunRow | undefined> =>
  dbAuthContext.testContext.withSchemaClient(async (client) => {
    const result = await client.query<RunRow>(
      `SELECT status, environment, title, fingerprint, permalink, agent_jsonl_output
       FROM auto_fix_runs WHERE sentry_issue_id = $1`,
      [sentryIssueId]
    )
    return result.rows[0]
  })

const countRuns = async (sentryIssueId: string): Promise<number> =>
  dbAuthContext.testContext.withSchemaClient(async (client) => {
    const result = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM auto_fix_runs WHERE sentry_issue_id = $1',
      [sentryIssueId]
    )
    return Number.parseInt(result.rows[0]?.count ?? '0', 10)
  })

// Seed a pre-existing `pending` row (simulating a prior webhook whose workflow
// start crashed mid-flight before it could mark the row dispatched).
const insertPendingRun = async (sentryIssueId: string): Promise<void> =>
  dbAuthContext.testContext.withSchemaClient(async (client) => {
    await client.query(
      `INSERT INTO auto_fix_runs (sentry_issue_id, environment, title, status)
       VALUES ($1, 'staging', 'pre-existing pending issue', 'pending')`,
      [sentryIssueId]
    )
  })

beforeAll(async () => {
  await hooks.beforeAll()
})

beforeEach(async () => {
  await hooks.beforeEach()
})

afterAll(async () => {
  await hooks.afterAll()
})

describe('POST /internal/sentry/new-issue', () => {
  it('inserts one dispatched auto_fix_runs row and starts the workflow once for a signed new issue', async () => {
    const sentryIssueId = `sentry-issue-${generateId()}`
    const payload = buildIssuePayload({ id: sentryIssueId })

    const response = await postWebhook(payload, 'new-issue', signPayload(payload))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { processed: boolean }
    expect(body.processed).toBe(true)

    expect(await countRuns(sentryIssueId)).toBe(1)
    const row = await readRun(sentryIssueId)
    expect(row?.status).toBe('dispatched')
    expect(row?.environment).toBe('staging')
    expect(row?.title).toBe('TypeError: cannot read property of undefined')
    expect(row?.fingerprint).toBe('fp-abc')
    // Stub records exactly one start call (one 'X' marker).
    expect(row?.agent_jsonl_output).toBe('X')
  })

  it('does not insert a duplicate row or start a second workflow on an identical repeat POST', async () => {
    const sentryIssueId = `sentry-issue-${generateId()}`
    const payload = buildIssuePayload({ id: sentryIssueId })
    const signature = signPayload(payload)

    const first = await postWebhook(payload, 'dupe-first', signature)
    expect(first.status).toBe(200)
    expect(await countRuns(sentryIssueId)).toBe(1)
    expect((await readRun(sentryIssueId))?.agent_jsonl_output).toBe('X')

    const second = await postWebhook(payload, 'dupe-second', signature)
    expect(second.status).toBe(200)

    // No new row, and NO second start call (still exactly one 'X').
    expect(await countRuns(sentryIssueId)).toBe(1)
    const row = await readRun(sentryIssueId)
    expect(row?.status).toBe('dispatched')
    expect(row?.agent_jsonl_output).toBe('X')
  })

  it('retries the start for a pre-existing pending row and dispatches it exactly once (self-healing)', async () => {
    const sentryIssueId = `sentry-issue-${generateId()}`

    // (a) A prior webhook inserted the row but crashed before dispatching it.
    await insertPendingRun(sentryIssueId)
    expect(await countRuns(sentryIssueId)).toBe(1)
    expect((await readRun(sentryIssueId))?.status).toBe('pending')

    // (b) A valid signed webhook arrives for the SAME issue id.
    const payload = buildIssuePayload({ id: sentryIssueId })
    const response = await postWebhook(payload, 'pending-retry', signPayload(payload))

    // (c) 200, row becomes dispatched, and exactly ONE start call was recorded.
    expect(response.status).toBe(200)
    expect(await countRuns(sentryIssueId)).toBe(1)
    const row = await readRun(sentryIssueId)
    expect(row?.status).toBe('dispatched')
    expect(row?.agent_jsonl_output).toBe('X')
  })

  it('rejects an invalid HMAC signature with 401 and inserts nothing', async () => {
    const sentryIssueId = `sentry-issue-${generateId()}`
    const payload = buildIssuePayload({ id: sentryIssueId })

    const response = await postWebhook(payload, 'bad-signature', 'deadbeef')

    // An invalid signature is an AUTH failure, surfaced as 401 (Unauthorized).
    expect(response.status).toBe(401)
    expect(await countRuns(sentryIssueId)).toBe(0)
  })

  it('rejects a missing signature header with 401 and inserts nothing', async () => {
    const sentryIssueId = `sentry-issue-${generateId()}`
    const payload = buildIssuePayload({ id: sentryIssueId })

    const response = await postWebhook(payload, 'no-signature', undefined)

    // A missing signature header is an AUTH failure, surfaced as 401.
    expect(response.status).toBe(401)
    expect(await countRuns(sentryIssueId)).toBe(0)
  })

  it('rejects an environment mismatch with 400 and inserts nothing', async () => {
    const sentryIssueId = `sentry-issue-${generateId()}`
    // This deployment serves 'staging'; a 'production' issue must be rejected.
    const payload = buildIssuePayload({ id: sentryIssueId, environment: 'production' })

    const response = await postWebhook(payload, 'env-mismatch', signPayload(payload))

    expect(response.status).toBe(400)
    expect(await countRuns(sentryIssueId)).toBe(0)
  })

  it('returns 5xx and leaves the row pending when the trigger reports a transient error (source retries)', async () => {
    // The stub injects a Transient error for ids starting with 'transient-'.
    const sentryIssueId = `transient-${generateId()}`
    const payload = buildIssuePayload({ id: sentryIssueId })

    const response = await postWebhook(payload, 'transient', signPayload(payload))

    expect(response.status).toBeGreaterThanOrEqual(500)

    // Row was inserted (phase 1) but never dispatched — a retry can re-attempt.
    expect(await countRuns(sentryIssueId)).toBe(1)
    const row = await readRun(sentryIssueId)
    expect(row?.status).toBe('pending')
    // No start call recorded (stub failed before recording).
    expect(row?.agent_jsonl_output).toBeNull()
  })
})
