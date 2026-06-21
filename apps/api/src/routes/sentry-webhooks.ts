import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import {
  type AutoFixEnvironment,
  type AutoFixWorkflowPayload,
  autoFixEnvironments
} from '@tx-agent-kit/contracts'
import { AutoFixRunStorePort, AutoFixTriggerPort } from '@tx-agent-kit/core'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'
import { BadRequest, InternalError, TxAgentApi, Unauthorized } from '../api.js'
import { verifySentryHmac } from '../adapters/sentry-webhook-verification.js'
import { getSentryWebhookConfig } from '../config/env.js'

const logger = createLogger('tx-agent-kit-api').child('sentry-webhooks')

export const SentryWebhooksRouteKind = 'custom' as const

// "issue" webhook resource. Tolerant by design: the payload carries many more
// fields than we need, and optional ones (culprit, permalink, environment,
// fingerprint) can be absent depending on the issue/alert type.
const SentryIssuePayloadSchema = Schema.Struct({
  data: Schema.Struct({
    issue: Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      culprit: Schema.optional(Schema.NullOr(Schema.String)),
      permalink: Schema.optional(Schema.NullOr(Schema.String)),
      level: Schema.optional(Schema.NullOr(Schema.String)),
      environment: Schema.optional(Schema.NullOr(Schema.String)),
      fingerprint: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
      firstSeen: Schema.optional(Schema.NullOr(Schema.String))
    })
  })
})

const isAutoFixEnvironment = (value: string): value is AutoFixEnvironment =>
  (autoFixEnvironments as ReadonlyArray<string>).includes(value)

const decodeSentryIssuePayload = Schema.decodeUnknown(SentryIssuePayloadSchema)

/**
 * Pure decision for whether a webhook's environment tag is acceptable for the
 * deployment serving it. Exported so the rule is unit-testable independent of
 * the HTTP handler / shared API deployment environment.
 *
 * - tagged + unsupported    → reject ('unsupported')
 * - tagged + mismatched     → reject ('mismatch') so a staging issue can never
 *                              load prod credentials (and vice-versa)
 * - tagged + matching       → accept
 * - untagged on production   → reject ('missing-on-production'): production must
 *                              NOT stamp its own env on an untagged issue
 * - untagged on staging      → accept (single-project staging alert rule)
 */
export type WebhookEnvironmentDecision =
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject'; readonly reason: string }

export const evaluateWebhookEnvironment = (
  rawEnvironmentTag: string | null | undefined,
  deploymentEnvironment: AutoFixEnvironment
): WebhookEnvironmentDecision => {
  const normalized = rawEnvironmentTag?.trim().toLowerCase()
  if (normalized && normalized.length > 0) {
    if (!isAutoFixEnvironment(normalized)) {
      return {
        kind: 'reject',
        reason: `Unsupported Sentry environment '${rawEnvironmentTag ?? ''}'`
      }
    }
    if (normalized !== deploymentEnvironment) {
      return {
        kind: 'reject',
        reason: `Environment mismatch: webhook is for '${normalized}', this deployment serves '${deploymentEnvironment}'`
      }
    }
    return { kind: 'accept' }
  }
  if (deploymentEnvironment === 'production') {
    return { kind: 'reject', reason: 'missing environment tag; required on production' }
  }
  return { kind: 'accept' }
}

/**
 * New-issue auto-fix webhook receiver.
 *
 * POST /internal/sentry/new-issue (per-environment alert rule, HMAC-verified).
 * Dedupes on `sentry_issue_id` in the route (INSERT ... ON CONFLICT DO NOTHING)
 * and, ONLY for a genuinely new + undispatched issue, starts the auto-fix
 * Temporal workflow directly via the injected `AutoFixTriggerPort` (the handler
 * never imports `@temporalio/*`). No domain event, no outbox.
 */
export const SentryWebhooksLive = HttpApiBuilder.group(
  TxAgentApi,
  'sentryWebhooks',
  (handlers) =>
    handlers.handle('sentryNewIssueWebhook', () =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest

        const signature = request.headers['sentry-hook-signature']
        if (!signature) {
          // A missing signature header is an AUTH failure, not a malformed
          // request — surface 401 so a forged/unsigned webhook is rejected.
          return yield* Effect.fail(
            new Unauthorized({ message: 'Missing Sentry-Hook-Signature header' })
          )
        }

        const rawBody = yield* request.text.pipe(
          Effect.mapError(
            (cause) =>
              new BadRequest({
                message: `Failed to read webhook body: ${cause instanceof Error ? cause.message : String(cause)}`
              })
          )
        )

        // Wrap the synchronous config read in Effect.try so any future throw
        // (e.g. an invalid SENTRY_DEPLOYMENT_ENVIRONMENT) stays in the Effect
        // error channel as a 500 rather than crashing the handler fiber.
        const config = yield* Effect.try({
          try: () => getSentryWebhookConfig(),
          catch: (cause) =>
            new InternalError({
              message: `Failed to read webhook config: ${cause instanceof Error ? cause.message : String(cause)}`
            })
        })
        if (!config) {
          logger.error('SENTRY_WEBHOOK_SECRET not configured — cannot verify webhook')
          return yield* Effect.fail(
            new InternalError({ message: 'Auto-fix webhook verification not configured' })
          )
        }

        if (!verifySentryHmac(rawBody, signature, config.secret)) {
          // An invalid signature is an AUTH failure — surface 401.
          return yield* Effect.fail(
            new Unauthorized({ message: 'Invalid webhook signature' })
          )
        }

        const parsed: unknown = yield* Effect.try({
          try: () => JSON.parse(rawBody) as unknown,
          catch: (cause) =>
            new BadRequest({
              message: `Webhook body is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`
            })
        })

        const payload = yield* decodeSentryIssuePayload(parsed).pipe(
          Effect.mapError(
            (error) =>
              new BadRequest({
                message: `Invalid webhook payload: ${error instanceof Error ? error.message : String(error)}`
              })
          )
        )

        const issue = payload.data.issue

        // Environment cross-check: see `evaluateWebhookEnvironment` for the
        // full rule. A mismatched/unsupported tag is rejected so a staging
        // issue can never load prod credentials, and an UNTAGGED issue is
        // rejected on production (accepted on staging).
        const envDecision = evaluateWebhookEnvironment(
          issue.environment,
          config.deploymentEnvironment
        )
        if (envDecision.kind === 'reject') {
          return yield* Effect.fail(new BadRequest({ message: envDecision.reason }))
        }

        const fingerprint = issue.fingerprint?.[0] ?? null
        const permalink = issue.permalink ?? null

        const workflowPayload: AutoFixWorkflowPayload = {
          sentryIssueId: issue.id,
          environment: config.deploymentEnvironment,
          title: issue.title,
          culprit: issue.culprit ?? 'unknown',
          permalink: permalink ?? '',
          fingerprint: fingerprint ?? 'unknown',
          level: issue.level ?? 'error',
          occurredAt: issue.firstSeen ?? new Date().toISOString()
        }

        const store = yield* AutoFixRunStorePort
        const trigger = yield* AutoFixTriggerPort

        const toStoreError = (error: unknown): InternalError =>
          new InternalError({
            message: `Auto-fix run store error: ${error instanceof Error ? error.message : String(error)}`
          })

        // Surface a trigger failure as 500 so the source retries; the row stays
        // `pending` and a later webhook re-attempts the start (idempotent via
        // the fixed `auto-fix-<sentryIssueId>` workflowId).
        const startWorkflow = trigger.startAutoFixWorkflow(workflowPayload).pipe(
          Effect.mapError(
            (error) =>
              new InternalError({
                message: `Failed to start auto-fix workflow: ${error._tag === 'Transient' ? error.reason : error.message}`
              })
          )
        )

        // Phase 1: dedupe insert. true => freshly inserted (new issue);
        // false => the row already existed (duplicate webhook).
        const inserted = yield* store
          .insertPendingIfAbsent({
            sentryIssueId: workflowPayload.sentryIssueId,
            environment: workflowPayload.environment,
            title: workflowPayload.title,
            fingerprint,
            permalink
          })
          .pipe(Effect.mapError(toStoreError))

        if (inserted) {
          // Genuinely new issue: start the workflow then mark dispatched.
          // We intentionally do NOT branch on `started`: `started === false`
          // means the trigger fired REJECT_DUPLICATE — the workflow is already
          // in-flight under the fixed `auto-fix-<id>` workflowId — and we still
          // mark dispatched regardless to settle the row.
          const { started: _started } = yield* startWorkflow
          yield* store
            .markDispatched(workflowPayload.sentryIssueId)
            .pipe(Effect.mapError(toStoreError))
          return { processed: true }
        }

        // Row already exists. Re-attempt the start only when it never reached
        // `dispatched` (a prior start crashed mid-flight). An already-dispatched
        // row is a no-op.
        const existingStatus = yield* store
          .getStatusBySentryIssueId(workflowPayload.sentryIssueId)
          .pipe(Effect.mapError(toStoreError))

        if (existingStatus === 'pending') {
          // Re-attempt the start. As above, `started === false` means
          // REJECT_DUPLICATE fired (workflow already in-flight); we mark
          // dispatched regardless to settle the row.
          const { started: _started } = yield* startWorkflow
          yield* store
            .markDispatched(workflowPayload.sentryIssueId)
            .pipe(Effect.mapError(toStoreError))
        }

        return { processed: true }
      })
    )
)
