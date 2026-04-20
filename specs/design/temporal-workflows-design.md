---
kind: spec
spec_type: design
doc_id: doc-9fdf5ba6d4fb
name: temporal-workflows-design
title: "Temporal Workflows"
status: draft
version: 2
owners:
  - jamesaphoenix
summary: "Temporal workflow organization, task queues, design rules, activity patterns, retry policies, signal handling, and real-time pipeline event feedback via SSE. Covers the Workflows subsystem (#15)."
domain: temporal-workflows
tags:
  - design
  - temporal
  - workflows
  - sse
  - pipelines
depends_on: []
supersedes: []
implements: temporal-workflows-prd
last_reviewed_at: 2026-03-28
---

# Summary

All long-running and side-effect-heavy operations in tx-agent-kit run as Temporal workflows. Two task queues partition workloads by resource profile: `api-tasks` for lightweight I/O-bound work (social posting, OAuth, analytics, campaigns, LLM generation) and `video-rendering` for heavy compute (FFmpeg, video generation). Workflows follow strict determinism rules, use activities for all side effects, and emit real-time progress events via heartbeats consumed by an SSE endpoint.

# Architecture

## Task Queues

| Queue | Worker | Concurrency Model | Workload |
|-------|--------|-------------------|----------|
| `api-tasks` | API Tasks Worker | 1,000 activities, 100 workflows, 500 cached | Social posting, OAuth refresh, analytics, campaigns, LLM generation |
| `video-rendering` | Video Rendering Worker | 5 activities, 10 workflows | Video generation, FFmpeg processing, meme composition |

## Workflows (legacy reference)

> **These workflows are from the old tx-agent-kit-services codebase and will need to be re-written.** The new implementation should use the content pipeline architecture (section 4.6), the agent orchestrator pattern (section 3.4), the SSE event system (section 13.4), and the credit middleware (section 9.2). The table below is preserved for reference only -- it shows what existed, not what should be built.

| Workflow (old) | Queue | Purpose | Key Behaviour |
|----------|-------|---------|--------------|
| `socialPostingWorkflow` | api-tasks | Publish to social platforms | Validate -> refresh token -> publish -> poll status (up to 12h) |
| `analyticsCollectionWorkflow` | api-tasks | Collect post metrics | Polls platform APIs for performance data |
| `tokenRefreshWorkflow` | api-tasks | Refresh OAuth tokens | Background scheduled, exponential backoff |
| `campaignExecutionWorkflow` | api-tasks | Multi-post campaign | Orchestrates concept -> generation -> scheduling |
| `videoGenerationWorkflow` | video-rendering | Render video from slideshow | FFmpeg pipeline, heartbeats for progress |
| `videoProcessingWorkflow` | video-rendering | Process uploaded video | Transcoding, thumbnail extraction |

## Design Rules

- **Deterministic**: No `Date.now()`, `Math.random()`, or direct I/O in workflows
- **Activities for side effects**: All I/O through activity functions
- **Heartbeats**: Required for activities > 30 seconds
- **Retry policy**: 3 max attempts, exponential backoff (1s -> 30s), 16 doublings
- **Credit compensation**: Reserve -> Execute -> Deduct/Release pattern
- **Signals**: `cancelPostingSignal` (cancel before execution), `getPostingStatusQuery` (check status)

## Pipeline Events & Real-Time Feedback

Content pipelines emit events via **Temporal activity heartbeats** at every phase transition and significant step. The frontend consumes these events via **SSE (Server-Sent Events)** to give users real-time visibility into what the agent is doing for each content item.

### Event Flow

```
Temporal Worker                    API Server                     Frontend
-----------------                  --------------                 --------
                                                                    |
contentPipelineWorkflow            GET /v1/content/{id}/events      |
  |                                  (SSE endpoint)                 |
  +-- activity: ideate             ----------------------           |
  |     heartbeat({                |                    |           |
  |       phase: "IDEATE",         |  Temporal Query    |           |
  |       event: "phase_started",  |  getPipelineStatus |  SSE -->  | "Generating concept..."
  |       message: "Generating     |        |           |           |
  |         concept..."            |        v           |           |
  |     })                         |  Read heartbeat    |           |
  |                                |  data from         |           |
  +-- activity: render_proposal    |  workflow          |           |
  |     heartbeat({                |        |           |           |
  |       phase: "RENDER_PROPOSAL",|        v           |           |
  |       event: "tool_call",      |  Push to SSE ------------>    | "Creating storyboard..."
  |       tool: "generate_text",   |  stream            |           |
  |       message: "Creating       |                    |           |
  |         storyboard..."         |                    |           |
  |     })                         ----------------------           |
  |                                                                 |
  +-- activity: agentic_render                                      |
  |     heartbeat({                                                 |
  |       phase: "AGENTIC_RENDER",                                  |
  |       event: "tool_call",      ---- SSE ------------------>     | "Generating video (Veo3)..."
  |       tool: "generate_video",                                   |
  |       iteration: 1,                                             |
  |       message: "Generating                                      |
  |         video (Veo3)..."                                        |
  |     })                                                          |
  |     heartbeat({                                                 |
  |       phase: "AGENTIC_RENDER",                                  |
  |       event: "evaluator",      ---- SSE ------------------>     | "Evaluating quality: 6.2/10"
  |       score: 6.2,                                               |
  |       message: "Score below                                     |
  |         threshold, re-rendering"                                |
  |     })                                                          |
  |     heartbeat({                                                 |
  |       phase: "AGENTIC_RENDER",                                  |
  |       event: "tool_call",      ---- SSE ------------------>     | "Re-rendering (iteration 2)..."
  |       tool: "generate_video",                                   |
  |       iteration: 2,                                             |
  |     })                                                          |
  |     heartbeat({                                                 |
  |       event: "evaluator",      ---- SSE ------------------>     | "Quality: 8.1/10"
  |       score: 8.1,                                               |
  |     })                                                          |
  |                                                                 |
  +-- heartbeat({                                                   |
  |     event: "awaiting_approval",---- SSE ------------------>     | "Ready for review"
  |     phase: "APPROVE",                                           |
  |     preview_url: "r2://..."                                     |
  |   })                                                            |
```

### How It Works

1. **Temporal heartbeats** -- each activity in the pipeline calls `Context.current().heartbeat(event)` at every significant step. Heartbeats are fire-and-forget, zero overhead to the workflow.
2. **Temporal queries** -- the API server uses a Temporal query (`getPipelineStatus`) to read the latest heartbeat data from the running workflow.
3. **SSE endpoint** -- the API polls the Temporal query on a short interval (1-2s) and pushes new events to connected SSE clients. Clients reconnect automatically on disconnect.
4. **Fallback** -- if no SSE connection is active, events are still recorded in `agent_messages` (via `pipeline_phase` column) for retrospective viewing.

> **Why SSE, not WebSockets?** SSE is unidirectional (server -> client), which is all we need for status updates. It is simpler to implement, works through HTTP/2, auto-reconnects natively, and does not require a separate connection upgrade. User actions (APPROVE/EDIT/REJECT) go through regular REST endpoints.

## Agentic Asset Search Endpoint

After the media embedding pipeline and the structured-output enrichment pipeline are complete, workflows must expose a dedicated agent-facing asset search endpoint. This endpoint is for tx-agent-kit agents and Temporal activities that need to retrieve relevant team media during IDEATE, RENDER_PROPOSAL, AGENTIC_RENDER, and later optimization workflows.

This is not the same endpoint as the human media-library keyword search. The existing `/teams/:teamId/assets/search` route remains a deterministic keyword/semantic media-library query. The agentic endpoint performs an agent-tool search over enriched assets: it combines keyword matching, pgvector similarity, collection filters, media-type structured metadata, and ranking explanations in a response shape that agents can consume directly.

**Dependency gate:** `POST /teams/:teamId/assets/agent-search` must not be enabled until both of these prerequisites are complete:

1. **Embedding pipeline complete** -- every searchable media asset has current embedding metadata (`embedding_generated_at`, `embedding_model`, and vector storage) or an explicit non-searchable status.
2. **Structured outputs per media type complete** -- image, video, audio, document/text, and generated-content assets have media-type-specific structured metadata persisted in a stable schema (for example detected objects, scene labels, transcript segments, brand-safety flags, platform suitability, dominant colors, duration/aspect details, and reusable creative attributes).

Until those prerequisites are met, the endpoint returns a typed `409 dependency_not_ready` response rather than silently falling back to low-quality keyword search. Workflow activities may still call the existing deterministic media-library search route when they only need literal filename/tag lookup.

### Agent Search Contract

```
POST /teams/:teamId/assets/agent-search
Content-Type: application/json

{
  "query": "Find short upbeat product launch clips with blue brand colors",
  "intent": "reuse" | "inspiration" | "similarity" | "compliance_check",
  "mediaTypes": ["image", "video", "audio", "document"],
  "collectionIds": ["collection_id"],
  "platforms": ["linkedin", "instagram"],
  "contentItemId": "optional_content_item_context",
  "campaignId": "optional_campaign_context",
  "limit": 12,
  "includeSignedUrls": true
}
```

Response:

```
{
  "results": [
    {
      "assetId": "asset_id",
      "mediaType": "video",
      "originalFilename": "launch-demo.mp4",
      "aiTitle": "Upbeat SaaS launch product demo",
      "aiDescription": "Short product walkthrough with bright blue UI shots.",
      "aiTags": ["launch", "demo", "blue", "upbeat"],
      "structured": {
        "durationSeconds": 14,
        "aspectRatio": "9:16",
        "dominantColors": ["#2563eb", "#ffffff"],
        "platformSuitability": ["instagram", "tiktok"],
        "brandSafety": "safe"
      },
      "score": 0.91,
      "scoreBreakdown": {
        "semantic": 0.44,
        "structuredMetadata": 0.29,
        "keyword": 0.12,
        "collection": 0.06
      },
      "reasons": [
        "Matches launch/demo intent",
        "Blue dominant color aligns with brand settings",
        "Short vertical video is suitable for Instagram"
      ],
      "signedUrl": "https://..."
    }
  ],
  "queryPlan": {
    "semanticQuery": "short upbeat product launch blue brand clips",
    "structuredFilters": {
      "mediaType": ["video"],
      "maxDurationSeconds": 30,
      "dominantColorFamilies": ["blue"]
    }
  }
}
```

### Workflow Usage

Temporal workflow code must not query this endpoint directly. Agentic workflows invoke an activity such as `searchAgenticAssets`, and that activity calls the API/service boundary. The activity records a pipeline heartbeat with `tool: "agentic_asset_search"` and persists the result summary into the agent thread so the agent's media choices remain auditable.

If the endpoint performs any paid model call to rewrite the query or produce a structured query plan, that call must go through the AI generation `ToolExecutionService` and credit reservation/finalization path. Pure database/vector ranking is free but still team-scoped and permission-checked.

# Data Model

_Temporal workflows are stateless from a database perspective — workflow state lives in Temporal Server. See content-pipeline-design and rendering-architecture-design for the database tables that workflows read/write._

# Interfaces

## Effect Ports & Services

```typescript
import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import type { CoreError } from '../../../errors.js'

// ---------------------------------------------------------------------------
// Workflow I/O Schemas (effect/Schema)
// ---------------------------------------------------------------------------

/** Phases shared across pipeline workflows. */
export const PipelinePhase = Schema.Literal(
  'IDEATE', 'RENDER_PROPOSAL', 'AGENTIC_RENDER', 'EVALUATE',
  'APPROVE', 'PUBLISH', 'COMPLETED', 'FAILED', 'SUSPENDED'
)
export type PipelinePhase = typeof PipelinePhase.Type

/** Input/output for the content pipeline workflow. */
export class ContentPipelineInput extends Schema.Class<ContentPipelineInput>('ContentPipelineInput')({
  contentItemId: Schema.String,
  organizationId: Schema.String,
  assetId: Schema.String,
  campaignId: Schema.NullOr(Schema.String),
  templateId: Schema.NullOr(Schema.String),
  brief: Schema.String,
  targetPlatforms: Schema.Array(Schema.String),
  maxRenderIterations: Schema.optional(Schema.Number, { default: () => 3 }),
  qualityThreshold: Schema.optional(Schema.Number, { default: () => 7.0 }),
  reservationId: Schema.String,              // credit reservation reference
}) {}

export class ContentPipelineOutput extends Schema.Class<ContentPipelineOutput>('ContentPipelineOutput')({
  contentItemId: Schema.String,
  assetId: Schema.String,
  phase: PipelinePhase,
  renderUrl: Schema.NullOr(Schema.String),
  qualityScore: Schema.NullOr(Schema.Number),
  totalCreditsUsedDecimillicents: Schema.Number,
  iterations: Schema.Number,
}) {}

/** Input/output for the social posting workflow. */
export class SocialPostingInput extends Schema.Class<SocialPostingInput>('SocialPostingInput')({
  scheduledPostId: Schema.String,
  organizationId: Schema.String,
  socialAccountId: Schema.String,
  platform: Schema.String,
  content: Schema.String,
  mediaUrls: Schema.Array(Schema.String),
  scheduledAt: Schema.Date,
  idempotencyKey: Schema.String,
}) {}

export class SocialPostingOutput extends Schema.Class<SocialPostingOutput>('SocialPostingOutput')({
  scheduledPostId: Schema.String,
  platformPostId: Schema.NullOr(Schema.String),
  platformUrl: Schema.NullOr(Schema.String),
  status: Schema.Literal('published', 'failed', 'cancelled'),
  failureReason: Schema.NullOr(Schema.String),
}) {}

/** Input/output for the video rendering workflow (video-rendering queue). */
export class VideoRenderingInput extends Schema.Class<VideoRenderingInput>('VideoRenderingInput')({
  assetId: Schema.String,
  organizationId: Schema.String,
  templateId: Schema.String,
  props: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  outputFormat: Schema.Literal('mp4', 'webm', 'gif'),
  durationSeconds: Schema.optional(Schema.Number),
  reservationId: Schema.String,
}) {}

export class VideoRenderingOutput extends Schema.Class<VideoRenderingOutput>('VideoRenderingOutput')({
  assetId: Schema.String,
  renderUrl: Schema.String,
  thumbnailUrl: Schema.NullOr(Schema.String),
  durationSeconds: Schema.Number,
  fileSizeBytes: Schema.Number,
  totalCreditsUsedDecimillicents: Schema.Number,
}) {}

// ---------------------------------------------------------------------------
// Activity Interfaces (one per domain, implemented in apps/worker)
// ---------------------------------------------------------------------------

/** Content pipeline activities -- api-tasks queue. */
export class ContentPipelineActivities extends Context.Tag('ContentPipelineActivities')<
  ContentPipelineActivities,
  {
    ideate: (input: { contentItemId: string; brief: string }) =>
      Effect.Effect<{ concept: string; storyboard: string }, unknown>
    renderProposal: (input: { contentItemId: string; concept: string; templateId: string | null }) =>
      Effect.Effect<{ proposalUrl: string; mediaType: string }, unknown>
    agenticRender: (input: {
      contentItemId: string
      assetId: string
      concept: string
      templateId: string | null
      iteration: number
      maxIterations: number
      qualityThreshold: number
    }) => Effect.Effect<{ renderUrl: string; qualityScore: number; creditsUsed: number }, unknown>
    evaluateMedia: (input: { renderUrl: string; brief: string }) =>
      Effect.Effect<{ score: number; feedback: string }, unknown>
    searchAgenticAssets: (input: {
      teamId: string
      query: string
      intent: 'reuse' | 'inspiration' | 'similarity' | 'compliance_check'
      mediaTypes: ReadonlyArray<'image' | 'video' | 'audio' | 'document'>
      collectionIds: ReadonlyArray<string>
      platforms: ReadonlyArray<string>
      contentItemId: string | null
      campaignId: string | null
      limit: number
      includeSignedUrls: boolean
    }) => Effect.Effect<{
      results: ReadonlyArray<{
        assetId: string
        mediaType: string
        score: number
        reasons: ReadonlyArray<string>
        signedUrl: string | null
      }>
      queryPlan: Record<string, unknown>
    }, unknown>
    publishToR2: (input: { assetId: string; renderUrl: string }) =>
      Effect.Effect<{ finalUrl: string; fileSizeBytes: number }, unknown>
  }
>() {}

/** Social posting activities -- api-tasks queue. */
export class SocialPostingActivities extends Context.Tag('SocialPostingActivities')<
  SocialPostingActivities,
  {
    validatePost: (input: { scheduledPostId: string; platform: string }) =>
      Effect.Effect<{ valid: boolean; reason?: string }, unknown>
    refreshToken: (socialAccountId: string) =>
      Effect.Effect<{ accessToken: string; expiresAt: Date }, unknown>
    publishToplatform: (input: {
      platform: string
      accessToken: string
      content: string
      mediaUrls: ReadonlyArray<string>
      idempotencyKey: string
    }) => Effect.Effect<{ platformPostId: string; platformUrl: string }, unknown>
    pollPostStatus: (input: {
      platform: string
      platformPostId: string
      accessToken: string
    }) => Effect.Effect<{ status: 'live' | 'processing' | 'failed'; reason?: string }, unknown>
  }
>() {}

/** Video rendering activities -- video-rendering queue. */
export class VideoRenderingActivities extends Context.Tag('VideoRenderingActivities')<
  VideoRenderingActivities,
  {
    renderVideo: (input: {
      assetId: string
      templateId: string
      props: Record<string, unknown>
      outputFormat: 'mp4' | 'webm' | 'gif'
    }) => Effect.Effect<{ renderUrl: string; durationSeconds: number; fileSizeBytes: number }, unknown>
    extractThumbnail: (input: { renderUrl: string; timestampSeconds: number }) =>
      Effect.Effect<{ thumbnailUrl: string }, unknown>
    transcodeVideo: (input: { sourceUrl: string; targetFormat: string }) =>
      Effect.Effect<{ transcodedUrl: string; fileSizeBytes: number }, unknown>
  }
>() {}

/** Retention / cleanup activities -- api-tasks queue. */
export class RetentionActivities extends Context.Tag('RetentionActivities')<
  RetentionActivities,
  {
    findExpiredAssets: (input: { retentionPolicy: string; cutoffDate: Date }) =>
      Effect.Effect<ReadonlyArray<{ assetId: string; blobKey: string }>, unknown>
    deleteBlob: (blobKey: string) => Effect.Effect<void, unknown>
    updateAssetStatus: (assetId: string, status: 'deleted') => Effect.Effect<void, unknown>
    archiveFinancialRecords: (organizationId: string) => Effect.Effect<{ archivedCount: number }, unknown>
  }
>() {}

/** OAuth token refresh activities -- api-tasks queue (scheduled). */
export class TokenRefreshActivities extends Context.Tag('TokenRefreshActivities')<
  TokenRefreshActivities,
  {
    findExpiringTokens: (expiresWithinMinutes: number) =>
      Effect.Effect<ReadonlyArray<{ socialAccountId: string; platform: string }>, unknown>
    refreshOAuthToken: (socialAccountId: string) =>
      Effect.Effect<{ accessToken: string; expiresAt: Date }, unknown>
    markTokenRefreshFailed: (socialAccountId: string, reason: string) =>
      Effect.Effect<void, unknown>
  }
>() {}

// ---------------------------------------------------------------------------
// Pipeline Event Emitter (used by activities to push heartbeat events)
// ---------------------------------------------------------------------------

/** Emits pipeline events via Temporal activity heartbeats. */
export class PipelineEventEmitterPort extends Context.Tag('PipelineEventEmitterPort')<
  PipelineEventEmitterPort,
  {
    emit: (event: {
      assetId: string
      contentItemId: string
      phase: PipelinePhase
      event: 'phase_started' | 'phase_completed' | 'tool_call' | 'tool_result'
           | 'evaluator' | 'awaiting_approval' | 'error' | 'suspended' | 'completed'
      tool?: string
      model?: string
      iteration?: number
      score?: number
      message: string
      previewUrl?: string
      creditsUsed?: number
    }) => Effect.Effect<void, never>
  }
>() {}

// ---------------------------------------------------------------------------
// SSE Service (API layer -- polls Temporal queries, pushes to SSE clients)
// ---------------------------------------------------------------------------

/** Server-Sent Events service for real-time pipeline progress.
 *  Lives in apps/api -- connects Temporal queries to HTTP SSE streams. */
export class PipelineSSEService extends Context.Tag('PipelineSSEService')<
  PipelineSSEService,
  {
    /** Open an SSE stream for a content item's pipeline events.
     *  Returns a ReadableStream of SSE-formatted events. */
    streamEvents: (input: {
      contentItemId: string
      lastEventId?: string           // for reconnection via Last-Event-ID
    }) => Effect.Effect<ReadableStream<Uint8Array>, CoreError>
  }
>() {}

// ---------------------------------------------------------------------------
// Temporal Client Port (API boundary -- apps/api must NOT import @temporalio/*)
// ---------------------------------------------------------------------------

/** Thin port so apps/api can start/query/cancel workflows without importing
 *  @temporalio/client directly (INV boundary: apps/api must not import @temporalio/*). */
export class TemporalClientPort extends Context.Tag('TemporalClientPort')<
  TemporalClientPort,
  {
    startContentPipeline: (input: ContentPipelineInput) =>
      Effect.Effect<{ workflowId: string; runId: string }, CoreError>
    startSocialPosting: (input: SocialPostingInput) =>
      Effect.Effect<{ workflowId: string; runId: string }, CoreError>
    startVideoRendering: (input: VideoRenderingInput) =>
      Effect.Effect<{ workflowId: string; runId: string }, CoreError>
    queryPipelineStatus: (workflowId: string) =>
      Effect.Effect<{
        phase: PipelinePhase
        latestEvent: string
        message: string
        creditsUsed: number
      } | null, CoreError>
    cancelWorkflow: (workflowId: string, reason: string) =>
      Effect.Effect<void, CoreError>
    signalWorkflow: (workflowId: string, signalName: string, payload: unknown) =>
      Effect.Effect<void, CoreError>
  }
>() {}

// ---------------------------------------------------------------------------
// Worker Config Types
// ---------------------------------------------------------------------------

export interface WorkerConfig {
  readonly taskQueue: 'api-tasks' | 'video-rendering'
  readonly maxConcurrentActivities: number
  readonly maxConcurrentWorkflows: number
  readonly maxCachedWorkflows: number
  readonly stickyQueueScheduleToStartTimeout: string  // e.g. '10s'
}

export const API_TASKS_WORKER_CONFIG: WorkerConfig = {
  taskQueue: 'api-tasks',
  maxConcurrentActivities: 1000,
  maxConcurrentWorkflows: 100,
  maxCachedWorkflows: 500,
  stickyQueueScheduleToStartTimeout: '10s',
}

export const VIDEO_RENDERING_WORKER_CONFIG: WorkerConfig = {
  taskQueue: 'video-rendering',
  maxConcurrentActivities: 5,
  maxConcurrentWorkflows: 10,
  maxCachedWorkflows: 10,
  stickyQueueScheduleToStartTimeout: '30s',
}
```

## Pipeline Event Schema

```typescript
interface PipelineEvent {
  asset_id: string;
  content_item_id: string;
  phase: PipelinePhase;
  event: "phase_started" | "phase_completed" | "tool_call" | "tool_result"
       | "evaluator" | "awaiting_approval" | "error" | "suspended" | "completed";
  tool?: string;            // which tool (generate_video, evaluate_media, etc.)
  model?: string;           // which model was used
  iteration?: number;       // evaluator loop iteration
  score?: number;           // evaluator score (0-10)
  message: string;          // human-readable status for UI display
  preview_url?: string;     // R2 presigned URL for rendered output
  credits_used?: number;    // running cost total
  timestamp: string;        // ISO 8601
}
```

## SSE Endpoint

```
GET /v1/content/{content_item_id}/events
Accept: text/event-stream

data: {"phase":"IDEATE","event":"phase_started","message":"Generating concept...","timestamp":"..."}
data: {"phase":"RENDER_PROPOSAL","event":"tool_call","tool":"generate_text","message":"Creating storyboard..."}
data: {"phase":"AGENTIC_RENDER","event":"tool_call","tool":"generate_video","iteration":1,"message":"Generating video (Veo3)..."}
data: {"phase":"AGENTIC_RENDER","event":"evaluator","score":6.2,"message":"Score below threshold, re-rendering"}
data: {"phase":"AGENTIC_RENDER","event":"evaluator","score":8.1,"message":"Quality: 8.1/10"}
data: {"phase":"APPROVE","event":"awaiting_approval","preview_url":"https://...","message":"Ready for review"}
```

## Agentic Search Endpoint

```
POST /v1/teams/{team_id}/assets/agent-search
Authorization: Bearer <agent-or-user-session-token>
```

The endpoint is team-scoped, requires the same tenancy and `view_assets` permission checks as media-library search, and may only return assets visible to the requesting team context. It is intended for agent tool use from Temporal activities and server-side orchestrators; browser UI search should continue using the media-library route unless it explicitly needs agent ranking explanations.

# Invariants

```yaml
invariants:
  - id: INV-TEMPORAL-001
    statement: "Workflows must be deterministic -- no Date.now(), Math.random(), or non-deterministic I/O in workflow code. All side effects must go through activity functions."
    severity: critical
    verified_by:
      - REQ-TEMPORAL-001
      - REQ-TEMPORAL-002

  - id: INV-TEMPORAL-002
    statement: "Activities running longer than 30 seconds must have heartbeat timeouts configured. Long-running activities must call Context.current().heartbeat() periodically."
    severity: critical
    verified_by:
      - REQ-TEMPORAL-003

  - id: INV-TEMPORAL-003
    statement: "All workflows must be idempotent -- safe to retry from any point without causing duplicate side effects (double-posting, double-charging credits, duplicate API calls)."
    severity: critical
    verified_by:
      - REQ-TEMPORAL-004

  - id: INV-TEMPORAL-004
    statement: "Pipeline events must be emitted (via heartbeat) for every phase transition in content pipeline workflows. Events must conform to the PipelineEvent schema."
    severity: high
    verified_by:
      - REQ-TEMPORAL-005

  - id: INV-TEMPORAL-005
    statement: "SSE endpoint must support auto-reconnect via the EventSource protocol -- include event IDs so clients can resume from last-seen event on reconnection."
    severity: high
    verified_by:
      - REQ-TEMPORAL-006

  - id: INV-TEMPORAL-006
    statement: "Credit compensation must follow the Reserve -> Execute -> Deduct/Release pattern. Credits must be reserved before expensive activities and released on failure."
    severity: critical
    verified_by:
      - REQ-TEMPORAL-007

  - id: INV-TEMPORAL-007
    statement: "Retry policy for activities: 3 max attempts, exponential backoff starting at 1s with max 30s interval, 16 doublings."
    severity: medium
    verified_by:
      - REQ-TEMPORAL-008

  - id: INV-TEMPORAL-008
    statement: >
      Agentic asset search must be exposed through a team-scoped `POST /v1/teams/{team_id}/assets/agent-search`
      endpoint only after the media embedding pipeline and media-type structured-output enrichment pipeline are
      complete. Workflow code must access it only through an activity boundary, not direct workflow I/O. The endpoint
      must return typed ranked results with reasons and must fail with `409 dependency_not_ready` when embeddings or
      structured metadata are unavailable.
    severity: high
    verified_by:
      - REQ-TEMPORAL-009
```

# Failure Modes

```yaml
failure_modes:
  - condition: "Temporal Cloud is unreachable (network partition, outage, DNS failure)."
    impact: "No new workflows can be started. Running workflows continue executing cached activities but cannot record completions. API returns errors for all workflow-dependent operations."
    handling: "API server returns 503 with retry-after header for workflow-dependent endpoints. Health check endpoint monitors Temporal connectivity. Queued operations (social posting, content generation) are delayed, not lost -- Temporal will process them when connectivity resumes. Alert ops team for manual intervention if outage exceeds 15 minutes."

  - condition: "A workflow exceeds its execution timeout (e.g., video rendering takes longer than the configured workflow execution timeout)."
    impact: "Workflow is terminated by Temporal. Any in-progress activities are cancelled. Partially-rendered assets may be orphaned in R2."
    handling: "Set generous execution timeouts for known long workflows (video-rendering: 4h, content pipeline: 2h). Activities with heartbeats will be detected as failed quickly. Orphaned asset cleanup runs as a scheduled workflow. Terminated workflows emit a 'failed' pipeline event so the UI can show the failure."

  - condition: "Activity heartbeat fails because the worker process crashes (OOM, segfault, host failure)."
    impact: "Activity appears stuck until heartbeat timeout expires. Then Temporal marks it as failed and retries on another worker."
    handling: "Heartbeat timeout set to 60s for most activities, 5m for video rendering. Temporal automatically retries the activity on a healthy worker (up to max attempts). Worker health monitoring detects crash and triggers container restart."

  - condition: "SSE connection drops (client network change, browser tab backgrounded, proxy timeout)."
    impact: "User temporarily loses real-time progress visibility for in-flight content pipelines."
    handling: "EventSource protocol auto-reconnects. Last-Event-ID header allows resuming from last seen event. Fallback: pipeline events are persisted in agent_messages table for retrospective viewing. UI shows 'reconnecting...' indicator."

  - condition: "Worker queue backlog grows (more workflows scheduled than workers can process)."
    impact: "Increased latency for content generation, social posting, and analytics collection. Users experience slow pipelines."
    handling: "Monitor queue depth per task queue. Auto-scale video-rendering workers based on queue depth. api-tasks workers scale based on activity poller utilization. Alert when queue depth exceeds threshold (api-tasks: 1000, video-rendering: 50)."

  - condition: "Agentic asset search is called before embeddings or media-type structured outputs are available."
    impact: "Agents could make poor media selections if the system silently falls back to keyword-only search."
    handling: "Return `409 dependency_not_ready` with missing prerequisite details. Workflows record a pipeline heartbeat with `tool: agentic_asset_search` and `event: error`, then either retry after enrichment completes or use the deterministic media-library search route only when literal filename/tag lookup is sufficient."
```

# Verification

```yaml
verification:
  - requirement_id: REQ-TEMPORAL-001
    test_type: unit
    target: "Verify workflow code contains no non-deterministic calls (Date.now, Math.random, direct I/O). Use AST analysis or lint rule to scan all workflow files."

  - requirement_id: REQ-TEMPORAL-002
    test_type: integration
    target: "Record a workflow execution history, then replay it on a fresh worker -- verify the workflow completes with identical state transitions."

  - requirement_id: REQ-TEMPORAL-003
    test_type: integration
    target: "Run a long-running activity (mock video render) and verify heartbeat events are emitted at the configured interval. Simulate heartbeat timeout and verify Temporal marks the activity as failed."

  - requirement_id: REQ-TEMPORAL-004
    test_type: integration
    target: "Start a socialPostingWorkflow, kill the worker mid-activity, restart the worker -- verify the workflow retries the activity and does not double-post (idempotency key prevents duplicate)."

  - requirement_id: REQ-TEMPORAL-005
    test_type: integration
    target: "Run a contentPipelineWorkflow end-to-end and collect all heartbeat events -- verify every phase transition emits the required PipelineEvent fields (phase, event, message, timestamp)."

  - requirement_id: REQ-TEMPORAL-006
    test_type: integration
    target: "Connect to SSE endpoint, receive events, disconnect, reconnect with Last-Event-ID -- verify missed events are replayed in order."

  - requirement_id: REQ-TEMPORAL-007
    test_type: integration
    target: "Start a workflow that reserves credits, then force-fail the expensive activity -- verify credits are released back to the user's balance."

  - requirement_id: REQ-TEMPORAL-008
    test_type: unit
    target: "Verify the shared retry policy configuration matches the specification: maxAttempts=3, initialInterval=1s, maximumInterval=30s, backoffCoefficient=2, maximumAttempts=16 doublings."

  - requirement_id: REQ-TEMPORAL-009
    test_type: integration
    target: "After embeddings and media-type structured metadata are present, call POST /v1/teams/{team_id}/assets/agent-search from the searchAgenticAssets activity and verify team scoping, ranked results with reasons, queryPlan output, optional signed URLs, heartbeat emission, and 409 dependency_not_ready when either enrichment prerequisite is missing."
```
