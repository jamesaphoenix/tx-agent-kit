import * as Schema from 'effect/Schema'
import {
  autoFixAgentKinds,
  autoFixEnvironments,
  autoFixOutcomes,
  autoFixRunStatuses
} from './literals.js'

// ── Auto-Fix Infrastructure schemas ─────────────────────────────────
//
// Shared effect/Schema contracts for the auto-fix system. The same shapes
// are used by the API webhook handler (to start a Temporal workflow), the
// sanctioned `temporal-control.ts` adapter, and the host worker
// (`apps/auto-fix-runner`) so the workflow input + agent output can't drift.
//
// The literal arrays / derived TS unions (AutoFixAgentKind, AutoFixEnvironment,
// AutoFixRunStatus, AutoFixOutcome) live in `literals.js`; here we wrap them in
// runtime-validating `Schema.Literal`s and compose the two structs.

// ── Agent kind schema ───────────────────────────────────────────────

export const autoFixAgentKindSchema = Schema.Literal(...autoFixAgentKinds)

// ── Environment schema ──────────────────────────────────────────────

export const autoFixEnvironmentSchema = Schema.Literal(...autoFixEnvironments)

// ── Outcome schema ──────────────────────────────────────────────────

export const autoFixOutcomeSchema = Schema.Literal(...autoFixOutcomes)

// ── Run status schema ───────────────────────────────────────────────

export const autoFixRunStatusSchema = Schema.Literal(...autoFixRunStatuses)

// ── Temporal Workflow Input ─────────────────────────────────────────
//
// The args passed to `autoFixRequestedWorkflow` when the API starts it.
// `sentryIssueId` is the opaque, stable dedupe key + workflowId suffix; the
// inbound webhook (today, Sentry) maps its incident id onto it.

export const autoFixWorkflowPayloadSchema = Schema.Struct({
  sentryIssueId: Schema.String,
  environment: autoFixEnvironmentSchema,
  title: Schema.String,
  culprit: Schema.String,
  permalink: Schema.String,
  fingerprint: Schema.String,
  level: Schema.String,
  occurredAt: Schema.String
})

export type AutoFixWorkflowPayload = Schema.Schema.Type<typeof autoFixWorkflowPayloadSchema>

// ── Sentry webhook response ─────────────────────────────────────────
//
// The flat success response returned by the API's
// POST /internal/sentry/new-issue webhook receiver. Mirrors the email
// webhook's `{ processed: boolean }` shape so the gateway response surface
// stays consistent.

export const sentryWebhookResponseSchema = Schema.Struct({
  processed: Schema.Boolean
})

export type SentryWebhookResponse = Schema.Schema.Type<typeof sentryWebhookResponseSchema>

// ── Agent Structured Output ─────────────────────────────────────────
//
// The structured result the coding agent (codex|claude) returns, validated
// against this shape and persisted verbatim into `auto_fix_runs.agent_output`.
//
// `needsManualInput` is the generic "the agent needs a human to supply
// something it cannot infer" flag; the agent sets it and stops (it never opens
// the PR itself — the activity does the deterministic git push + draft PR).

export const autoFixResultSchema = Schema.Struct({
  outcome: autoFixOutcomeSchema,
  summary: Schema.String,
  rootCause: Schema.String,
  prTitle: Schema.String,
  prBody: Schema.String,
  filesChanged: Schema.Array(Schema.String),
  testsRun: Schema.Boolean,
  testsPassed: Schema.Boolean,
  needsManualInput: Schema.Boolean,
  blockers: Schema.Array(Schema.String)
})

export type AutoFixResult = Schema.Schema.Type<typeof autoFixResultSchema>
