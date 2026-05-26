---
kind: spec
spec_type: design
doc_id: doc-78941f4d0a6f
name: overview-design
title: "System Overview"
status: draft
version: 2
owners:
  - jamesaphoenix
summary: "Cross-cutting system architecture, infrastructure, observability, security, and design principles for tx-agent-kit."
domain: system
tags:
  - design
  - overview
  - architecture
depends_on: []
supersedes:
  - system-architecture-design
  - observability-design
  - security-design
  - deployment-and-infrastructure-design
  - architectural-principles-design
  - database-enums-complete-reference-design
  - key-relationships-design
  - resolved-design-decisions-design
  - open-technical-questions-design
  - performance-design
  - rate-limits-design
  - subsystems-design
implements: null
last_reviewed_at: 2026-04-16
---

# Summary

Cross-cutting system overview consolidating architecture, subsystem map, infrastructure,
observability, security, and design principles for tx-agent-kit. This is the single reference
for everything that spans multiple subsystems.

# Architecture

## 1. System Architecture

### 1.1 High-Level Overview

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  Next.js SPA │────→│  Effect HttpApi  │────→│    Supabase (EU)     │
│  (Vercel)    │     │ (Hetzner VM)     │     │    (PostgreSQL)      │
│  Port: 3000  │     │   Port: 8080     │     └──────────────────────┘
└─────────────┘     └──────┬───────────┘
                           │
                    ┌──────┼───────────────┐
                    │      │               │
              ┌─────▼─────┐│ ┌─────▼──────────┐
              │  Temporal  ││ │  Cloudflare R2  │
              │  Cloud     ││ │  (blob storage) │
              │  ($100/mo) ││ └────────────────┘
              └─────┬──────┘│
                    │  ┌────▼─────────┐
           ┌────────┴──┤   Redis      │
           │           │  (Hetzner VM)│
           │           │  256MB LRU   │
    ┌──────▼──────┐    │  Port: 6379  │
    │ API Tasks   │    └──────────────┘
    │ Worker      │        │
    │ (I/O-bound) │   ┌────▼────────┐
    │ 1K activs   │   │  Rendering  │
    │ 100 wkflows │   │  Worker     │
    └─────────────┘   │ (Remotion + │
                      │  AI APIs)   │
                      │ (Hetzner VM)│
                      └─────────────┘

Redis caches: platform_caps:{social_account_id} (24h TTL),
rate limit counters, session data, Temporal activity heartbeats.
```

### 1.2 Component Inventory

| Component | Technology | Port | Deployment |
|-----------|-----------|------|------------|
| Frontend | Next.js (client-only SPA, no SSR) | 3000 | Vercel |
| API Gateway | Effect HttpApi | 8080 | Hetzner VM (EU) via Docker Compose |
| App Database | Supabase (PostgreSQL via Drizzle ORM) | 54322 (dev) | Supabase managed (EU region) |
| Object Storage | Cloudflare R2 (all envs) | -- | S3-compatible, zero egress. Separate buckets per env. |
| Workflow Engine | Temporal | 7233 (gRPC) | Temporal Cloud ($100/mo) |
| Cache | Redis 7.2 | 6379 | Hetzner VM (same as API), 256MB LRU |
| AI Routing | OpenRouter + fal.ai + ElevenLabs + Gemini Music | -- | External APIs, orchestrated via Temporal activities |
| Experiments | Python FastAPI (contextual bandit) | 8090 | Hetzner VM (same as API), Docker Compose. Design: `specs/design/experiments-design.md` |

### 1.3 Monorepo Structure

```
tx-agent-kit/
├── apps/
│   ├── api/                 # Effect HttpApi server
│   ├── web/                 # Client-only Next.js SPA (no SSR, no app/api)
│   ├── worker/              # Temporal worker + workflows
│   ├── mobile/              # Expo React Native
│   └── docs/                # Fumadocs documentation site
├── packages/
│   ├── core/                # DDD domain logic (Effect services)
│   ├── contracts/           # Shared schemas + event types + permissions
│   ├── temporal-client/     # Temporal workflow types + event schemas
│   ├── infra/
│   │   ├── db/              # Drizzle ORM, schema, migrations
│   │   ├── auth/            # JWT, refresh tokens, OAuth (custom, not Supabase Auth)
│   │   ├── logging/         # Structured logging
│   │   ├── observability/   # OTEL, Sentry
│   │   ├── storage/         # R2/S3 storage operations
│   │   └── ai/              # AI model integration, OpenRouter client
│   ├── testkit/             # Test utilities + integration harness
│   └── tooling/             # ESLint configs, scaffold CLI, tsconfig, vitest configs
├── specs/                   # System design, requirements, use cases
└── .vendor/                 # Competitor reference apps (gitignored)
```

> **Old codebase** (`tx-agent-kit-services/`) is preserved for reference. There may be useful code,
> DTOs, contracts, and data models that can be ported across -- particularly service logic,
> Temporal workflow patterns, and database schema designs. But where there is a conflict between
> the old code and the system design spec, **the spec wins.**

### 1.4 API Route Groups

| Route Group | Path | Endpoints | Purpose |
|-------------|------|-----------|---------|
| Auth | `/v1/auth/` | OAuth, login, registration | Authentication |
| Content | `/v1/content/` | Slideshows, items, assets, concepts | Content CRUD + AI |
| Social Media | `/v1/social-media/` | Accounts, posts, analytics, webhooks | Publishing |
| Campaigns | `/v1/campaigns/` | Workflow, style-presets | Campaign orchestration |
| Assets | `/v1/teams/:teamId/assets`, `/v1/teams/:teamId/uploads/*` | Assets, uploads, signed URLs, collections | Media management |
| AI Tools | `/v1/ai-tools/` | Execute | AI tool invocation |
| Organizations | `/v1/organizations/` | Workspaces, permissions | Org management |
| Teams | `/v1/teams/` | Members | Team management |
| Users | `/v1/users/` | Profile, settings | User operations |
| Billing | `/v1/billing/` | Plans, checkout, portal, top-up, local-dev bootstrap, credit balance/history, usage summaries, webhooks | Stripe + credit wallet |
| Integrations | `/v1/integrations/` | Apify CRUD | Third-party connectors |
| Knowledge | `/v1/knowledge/` | CRUD, processing | Knowledge base |
| Approvals | `/v1/approvals/` | Queue, approve, reject | Editorial workflow |
| Admin | `/v1/admin/` | Registry, system ops | Admin operations |

### 1.5 Architectural Principles

| Principle | Implementation |
|-----------|---------------|
| Contract-driven | Effect HttpApi + effect/Schema + auto-generated OpenAPI at `/docs` |
| Low coupling, high cohesion | DDD domain services with Effect layers + dependency injection |
| Reuse | Shared packages under `packages/` (`@tx-agent-kit/*`) |
| Single source of truth (types) | All types from `packages/contracts` (effect/Schema). DTOs organized by domain |
| Immutability (audit) | Credit ledger is append-only. Agent threads/messages are immutable. |
| Deterministic workflows | Temporal rules: no randomness, no direct I/O, no wall-clock reads |
| Reservation-based billing | Reserve -> Execute -> Deduct/Release for async operations |
| API-layer security | No RLS -- single Drizzle client, all auth/authz enforced via Effect middleware |

### 1.6 Steel Spike Status

| Concern | Status |
|---------|--------|
| Vertical slice (TikTok) | **Proven**: OAuth -> content -> AI generation -> video render -> schedule -> post -> analytics |
| Multi-platform | **Unproven**: Meta, YouTube, LinkedIn, Twitter/X |
| Scale to 1K users | **Unproven**: No load testing performed |
| White labelling | **Unproven**: No infrastructure exists |
| Recommended next spike | **Meta (Instagram)** -- validates multi-provider architecture |

---

## 2. Subsystems

tx-agent-kit is composed of 17 subsystems. The service core (subsystems 1-15) is shared across all
frontends (API, CLI, SDK). No business logic lives in any frontend -- the API is the only gateway.

### 2.1 Subsystem Map

**Platform Core:**

| # | Subsystem | Purpose | Status |
|---|-----------|---------|--------|
| 1 | Auth & Identity | JWT access tokens, refresh token rotation, Google OAuth, session management (tx-agent-kit) | Boilerplate exists |
| 2 | Org & Team Management | RBAC, roles, permissions, invite-before-signup, client collaborators, membership guards, brand settings per team | Built/in progress |
| 3 | Billing & Subscriptions | Stripe subscriptions, Try Me/Pro/Agency, prepaid wallet, local-dev bootstrap, admin billing UI | Built/in progress |
| 4 | Credit Service | Usage metering in decimillicents, reserve/finalize pattern, immutable ledger. Cross-cutting -- injected into AI Generation, Workflows. **OpenRouter-first**: all text gen, structured outputs, image gen, and embeddings go through OpenRouter -- cost is derived from OpenRouter's cost response and mapped into our CostResult type. Custom credit calculations only for non-OpenRouter providers (fal.ai, Veo3 video generation, etc.). This massively simplifies cost tracking. | Built/in progress |
| 5 | Notifications | In-app notifications (org-level, stored in DB) + email notifications (per-user preferences: success/failure/digest). Temporal workflow for async email delivery. | New -- not built |
| 6 | Webhooks | Org-scoped webhook subscriptions. Events fired on post publish, campaign completion, approval status change. Filterable by integration. | New -- not built |

**Media & Storage:**

| # | Subsystem | Purpose | Status |
|---|-----------|---------|--------|
| 7 | Asset Management | Media CRUD, collections, signed URLs, metadata. Per-team isolation. | Built/in progress |
| 8 | Media Uploader | R2 presigned upload request/confirm flow plus localhost API upload proxy. Type detection and validation, 50 MB limit. | Built/in progress |
| 9 | Retention Cleaner | Scheduled cleanup per configurable retention policy (90 days / 6 months / Permanent). Also owns full GDPR purge: R2 blobs, Temporal workflow history, Stripe customer records. | New -- not built |

**Services:**

| # | Subsystem | Purpose | Status |
|---|-----------|---------|--------|
| 10 | Social Media OAuth | Platform OAuth with PKCE, token refresh, multi-provider (TikTok, Meta, LinkedIn, YouTube). Token encryption at application layer before DB write. | Rebuild needed |
| 11 | Social Media Publisher | Post to platforms via Direct Post API / PULL_FROM_URL. Status polling, retry, error handling. Platform-specific adapters. | Rebuild needed |
| 12 | Analytics Collector | Collect platform metrics (views, likes, comments, shares) via scheduled Temporal workflows. Time-series snapshots in `post_performance_snapshots`. | Rebuild needed |
| 13 | AI Generation | Multi-provider AI via OpenRouter (text gen, structured outputs, image gen, embeddings) + direct providers for video (Veo3, fal.ai) and audio (ElevenLabs). Owns tool calling and conversation loop. Returns CostResult. Uses Credit Service. Also handles media enrichment: accepts URL or binary file(s), performs AI tagging, Google multimodal embeddings, and semantic search via pgvector. Returns enriched result + CostResult. | Rebuild needed |

**Experimentation:**

| # | Subsystem | Purpose | Status |
|---|-----------|---------|--------|
| 14 | Contextual Prompt Bandit | **Full design:** `specs/design/experiments-design.md`. Separate Python FastAPI service (port 8090). Contextual Thompson sampling over immutable hashed PromptConfig variants. Dual-mode reward: internal eval (LLM-as-judge + golden references, overnight auto-research) and post metrics (real engagement, 24h window). Tables: `exp_experiments`, `exp_variant_configs`, `exp_prompts`, `exp_arms`, `exp_decisions`, `exp_outcomes`, `exp_golden_references`, `exp_arm_state`. 9 invariants. VCR caching for expensive renders. | New -- designed, not built |

**Workflows:**

| # | Subsystem | Purpose | Status |
|---|-----------|---------|--------|
| 15 | Workflows | Temporal workflows organized by domain. `campaigns/*` -- nightly batch, concept -> render -> publish, budget enforcement, content-type strategies. `content/*` -- content lifecycle, two-gate approval, versioning. `media-rendering/*` -- video generation, Remotion slideshows, greenscreen compositor. | Rebuild needed |

**Frontends:**

| # | Subsystem | Purpose | Status |
|---|-----------|---------|--------|
| 16 | API / CLI / SDK | HTTP API (Effect HTTP), CLI (command-line automation, JSON output), SDK (`@tx-agent-kit/node` npm package). All thin clients consuming the same service core. | API: rebuild, CLI/SDK: new |

**Post-Launch:**

| # | Subsystem | Purpose | Status |
|---|-----------|---------|--------|
| 17 | Agency Team Onboarding | Leadsie-style magic-link OAuth flow. Agency sends one branded URL per team (one team = one client), recipient clicks through guided OAuth for TikTok/Meta/LinkedIn/YouTube. No recipient account required. Social accounts linked to `team_id`. Eventually offered free. | Post-launch |

### 2.2 Subsystem Dependencies

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTENDS (16)                                              │
│  ┌──────┐  ┌──────┐  ┌──────┐                              │
│  │ API  │  │ CLI  │  │ SDK  │  (thin clients)              │
│  └──┬───┘  └──┬───┘  └──┬───┘                              │
│     └──────────┼─────────┘                                   │
│                ▼                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  SERVICE CORE (subsystems 1-15)                         │ │
│  │                                                         │ │
│  │  Platform:  Auth │ Org/Team │ Billing │ Credit │ Notif │ │
│  │  Media:     Assets │ Uploader │ Retention                │ │
│  │  Services:  OAuth │ Publisher │ Analytics │ AI Gen     │ │
│  │  Experiment: Prompt Bandit                              │ │
│  │  Workflows: campaigns/* │ content/* │ media-rendering/* │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  POST-LAUNCH (17): Agency Team Onboarding                    │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 Cross-Cutting Requirements

These apply across all subsystems and are not owned by any single one:

| Requirement | Detail |
|-------------|--------|
| API rate limiting | Per-user + per-IP rate limiting on the API gateway |
| OAuth token encryption | Application-layer encryption (AES-256) before writing tokens to DB |
| Idempotency keys | All mutating API endpoints accept an idempotency key to prevent double-execution |
| Request-ID propagation | Unique request ID flows from API -> Temporal -> AI providers for trace correlation |
| Health check endpoints | `/healthz` and `/readyz` on all services, verifying downstream connectivity |
| Alerting | Google Cloud Alerting + OpenTelemetry. Key alerts: nightly batch completion, publisher error rate, Temporal workflow failure spike |
| GDPR purge scope | Retention Cleaner (#9) handles: R2 blobs, Temporal workflow history, Stripe customer records, audit of data sent to external AI APIs |

---

## 3. Temporal Workflows

### 3.1 Task Queues

| Queue | Worker | Concurrency Model | Workload |
|-------|--------|-------------------|----------|
| `api-tasks` | API Tasks Worker | 1,000 activities, 100 workflows, 500 cached | Social posting, OAuth refresh, analytics, campaigns, LLM generation |
| `video-rendering` | Video Rendering Worker | 5 activities, 10 workflows | Video generation, FFmpeg processing, meme composition |

### 3.2 Workflows (Old Codebase Reference)

> **These workflows are from the old tx-agent-kit-services codebase and will need to be
> re-written.** The new implementation should use the content pipeline architecture,
> the agent orchestrator pattern, the SSE event system, and the credit middleware.
> The table below is preserved for reference only -- it shows what existed, not what
> should be built.

| Workflow (old) | Queue | Purpose | Key Behaviour |
|----------|-------|---------|--------------|
| `socialPostingWorkflow` | api-tasks | Publish to social platforms | Validate -> refresh token -> publish -> poll status (up to 12h) |
| `analyticsCollectionWorkflow` | api-tasks | Collect post metrics | Polls platform APIs for performance data |
| `tokenRefreshWorkflow` | api-tasks | Refresh OAuth tokens | Background scheduled, exponential backoff |
| `campaignExecutionWorkflow` | api-tasks | Multi-post campaign | Orchestrates concept -> generation -> scheduling |
| `videoGenerationWorkflow` | video-rendering | Render video from slideshow | FFmpeg pipeline, heartbeats for progress |
| `videoProcessingWorkflow` | video-rendering | Process uploaded video | Transcoding, thumbnail extraction |

### 3.3 Design Rules

- **Deterministic**: No `Date.now()`, `Math.random()`, or direct I/O in workflows
- **Activities for side effects**: All I/O through activity functions
- **Heartbeats**: Required for activities > 30 seconds
- **Retry policy**: 3 max attempts, exponential backoff (1s -> 30s), 16 doublings
- **Credit compensation**: Reserve -> Execute -> Deduct/Release pattern
- **Signals**: `cancelPostingSignal` (cancel before execution), `getPostingStatusQuery` (check status)

### 3.4 Pipeline Events and Real-Time Feedback

Content pipelines emit events via **Temporal activity heartbeats** at every phase transition
and significant step. The frontend consumes these events via **SSE (Server-Sent Events)** to
give users real-time visibility into what the agent is doing for each content item.

#### Event Architecture

```
Temporal Worker                    API Server                     Frontend
─────────────────                  ──────────────                 ────────
                                                                    │
contentPipelineWorkflow            GET /v1/content/{id}/events      │
  │                                  (SSE endpoint)                 │
  ├── activity: ideate             ──────────────────────           │
  │     heartbeat({                │                    │           │
  │       phase: "IDEATE",         │  Temporal Query    │           │
  │       event: "phase_started",  │  getPipelineStatus │  SSE ──→  │ "Generating concept..."
  │       message: "Generating     │        │           │           │
  │         concept..."            │        ▼           │           │
  │     })                         │  Read heartbeat    │           │
  │                                │  data from         │           │
  ├── activity: render_proposal    │  workflow          │           │
  │     heartbeat({                │        │           │           │
  │       phase: "RENDER_PROPOSAL",│        ▼           │           │
  │       event: "tool_call",      │  Push to SSE ─────────────→   │ "Creating storyboard..."
  │       tool: "generate_text",   │  stream            │           │
  │       message: "Creating       │                    │           │
  │         storyboard..."         │                    │           │
  │     })                         └────────────────────┘           │
  │                                                                 │
  ├── activity: agentic_render                                      │
  │     heartbeat({                                                 │
  │       phase: "AGENTIC_RENDER",                                  │
  │       event: "tool_call",      ──── SSE ──────────────────→     │ "Generating video (Veo3)..."
  │       tool: "generate_video",                                   │
  │       iteration: 1,                                             │
  │       message: "Generating                                      │
  │         video (Veo3)..."                                        │
  │     })                                                          │
  │     heartbeat({                                                 │
  │       phase: "AGENTIC_RENDER",                                  │
  │       event: "evaluator",      ──── SSE ──────────────────→     │ "Evaluating quality: 6.2/10"
  │       score: 6.2,                                               │
  │       message: "Score below                                     │
  │         threshold, re-rendering"                                │
  │     })                                                          │
  │     heartbeat({                                                 │
  │       phase: "AGENTIC_RENDER",                                  │
  │       event: "tool_call",      ──── SSE ──────────────────→     │ "Re-rendering (iteration 2)..."
  │       tool: "generate_video",                                   │
  │       iteration: 2,                                             │
  │     })                                                          │
  │     heartbeat({                                                 │
  │       event: "evaluator",      ──── SSE ──────────────────→     │ "Quality: 8.1/10 ✓"
  │       score: 8.1,                                               │
  │     })                                                          │
  │                                                                 │
  ├── heartbeat({                                                   │
  │     event: "awaiting_approval",──── SSE ──────────────────→     │ "Ready for review"
  │     phase: "APPROVE",                                           │
  │     preview_url: "r2://..."                                     │
  │   })                                                            │
```

#### Event Schema

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

#### API Endpoint

```
GET /v1/content/{content_item_id}/events
Accept: text/event-stream

data: {"phase":"IDEATE","event":"phase_started","message":"Generating concept...","timestamp":"..."}
data: {"phase":"RENDER_PROPOSAL","event":"tool_call","tool":"generate_text","message":"Creating storyboard..."}
data: {"phase":"AGENTIC_RENDER","event":"tool_call","tool":"generate_video","iteration":1,"message":"Generating video (Veo3)..."}
data: {"phase":"AGENTIC_RENDER","event":"evaluator","score":6.2,"message":"Score below threshold, re-rendering"}
data: {"phase":"AGENTIC_RENDER","event":"evaluator","score":8.1,"message":"Quality: 8.1/10 ✓"}
data: {"phase":"APPROVE","event":"awaiting_approval","preview_url":"https://...","message":"Ready for review"}
```

#### How It Works

1. **Temporal heartbeats** -- each activity in the pipeline calls `Context.current().heartbeat(event)`
   at every significant step. Heartbeats are fire-and-forget, zero overhead to the workflow.
2. **Temporal queries** -- the API server uses a Temporal query (`getPipelineStatus`) to read the
   latest heartbeat data from the running workflow.
3. **SSE endpoint** -- the API polls the Temporal query on a short interval (1-2s) and pushes
   new events to connected SSE clients. Clients reconnect automatically on disconnect.
4. **Fallback** -- if no SSE connection is active, events are still recorded in `agent_messages`
   (via `pipeline_phase` column) for retrospective viewing.

> **Why SSE, not WebSockets?** SSE is unidirectional (server -> client), which is all we need
> for status updates. It's simpler to implement, works through HTTP/2, auto-reconnects natively,
> and doesn't require a separate connection upgrade. User actions (APPROVE/EDIT/REJECT) go
> through regular REST endpoints.

---

## 4. Rate Limits

### 4.1 Internal (API Gateway)

| Layer | Mechanism | Configuration |
|-------|-----------|---------------|
| HTTP rate limit | Rate limiting middleware (API layer) | Per-endpoint-group limits below |
| Credit balance | Pre-operation check (Postgres `SELECT FOR UPDATE` reservation) | 402 Payment Required if insufficient |
| OpenRouter / AI provider tokens | Provider-side rate limits | Varies per model/provider |

**Per-endpoint-group rate limits (per user, sliding window):**

| Endpoint group | Limit/min | Rationale |
|----------------|-----------|-----------|
| Auth (login, register, password reset) | 10 | Brute-force prevention |
| Read (list, get, search) | 120 | Normal browsing, agent polling |
| Write (create, update, delete) | 60 | Generous -- supports chatbot UX + bulk operations |
| AI generation (generate_*, evaluate_*) | 30 | Generous -- credit reservation in Postgres is the real gate, rate limit is safety net |
| Upload (media upload) | 20 | Bounded by file size + R2 bandwidth |
| Webhooks (inbound from Stripe, platforms) | 300 | Platforms can burst; don't block legitimate callbacks |

> **Credit checks are the primary abuse prevention, not rate limits.** Every paid tool call does
> an atomic Postgres reservation (`SELECT FOR UPDATE` on `organizations.credits_balance`) before
> execution. The HTTP rate limit is a safety net that stops buggy clients from hammering the API
> -- it's not a billing mechanism. Be generous with write and AI limits to support future chatbot
> UX where users send many messages in quick succession.

### 4.2 External (TikTok -- Per Endpoint)

| Endpoint | Limit | Window | Throttle Response |
|----------|-------|--------|-------------------|
| `/v2/user/info/` | 600 | 1 min (sliding) | HTTP 429, `rate_limit_exceeded` |
| `/v2/video/query/` | 600 | 1 min | " |
| `/v2/video/list/` | 600 | 1 min | " |
| `/v2/post/publish/video/init` | 600 | 1 min | " |
| `/v2/post/publish/content/init` | 600 | 1 min | " |
| `/v2/post/publish/status/fetch` | 600 | 1 min | " |

Implementation: In-memory sliding window. Fail-open mode (allows request if limiter itself fails).
Automatic `retry-after` header extraction.

### 4.3 Platform Publishing Concurrency

Different platforms have drastically different concurrency tolerances for the nightly batch:

| Platform | Max Concurrent Publishes | Min Interval | Notes |
|----------|--------------------------|-------------|-------|
| TikTok | 300 | None | Liberal (Postiz: 300) |
| Instagram | 400 | None | Postiz uses 400; conservative 100 also safe |
| YouTube | 200 | None | Quota-limited (1,600 units/video, 10K/day) |
| LinkedIn | 2 | 1s between posts | Most restrictive -- easy to hit rate limits |
| Twitter/X | 1 | None | Per-3-hour window -- needs time gate, not just concurrency |
| Facebook | 100 | None | |
| Threads | 2 | None | |
| Reddit | 1 | 1s | Strict rate limits |

The nightly batch Temporal workflow reads `PlatformConstraints.max_concurrent_publish` when
fanning out publish activities and applies a per-provider semaphore. Without this, 50 LinkedIn
posts scheduled at 9am will all fire simultaneously and hit rate limits.

### 4.4 Aggregate Capacity Estimation (1K Users)

| Scenario | Calculation | Result |
|----------|-------------|--------|
| Posts per day (if 10% of users post daily) | 100 users x 2 posts | 200 posts/day |
| Posts per minute (peak, 2-hour window) | 200 posts / 120 min | ~1.7 posts/min |
| TikTok API calls per post (upload + poll) | ~5-10 calls | 10-17 calls/min peak |
| TikTok rate limit headroom | 600 calls/min limit | Comfortable at 1K users |

**Decision needed:** What are the realistic posts-per-day and peak-hour assumptions at 1K users?

---

## 5. Performance

### 5.1 Throughput Targets

| Metric | Current Config | Target (1K Users) |
|--------|---------------|-------------------|
| API request timeout | 3,600s | **TBD** |
| Temporal activities/sec (sustained) | Not measured | **TBD** |
| Temporal max concurrent activities | 1,000 (configured) | **TBD** |
| Transactions per day | Not measured | **TBD** |
| TPS (sustained) | Not measured | **TBD** |
| TPS (peak) | Not measured | **TBD** |

### 5.2 Asset Operation Latencies

| Operation | Current Behaviour | Latency Target |
|-----------|------------------|----------------|
| Asset upload (50 MB max) | Presigned URL -> direct upload to R2 | **TBD** |
| AI enrichment (tags, embedding) | Async post-upload | **TBD** |
| Asset retrieval (signed URL) | R2 presigned URL generation | **TBD** |
| Semantic search | pgvector IVFFlat similarity | **TBD** |
| Full-text search | PostgreSQL GIN index | **TBD** |

### 5.3 Content Generation Latencies

| Operation | Current Behaviour | Latency Target |
|-----------|------------------|----------------|
| Slideshow generation (AI) | Async Temporal. LLM call (~2-10s) | **TBD** |
| Asset selection (AI agent) | Orchestrator agent, semantic matching via OpenRouter | **TBD** |
| Video rendering (FFmpeg) | Async Temporal. Duration depends on length | **TBD** |
| Meme composition | FFmpeg layering | **TBD** |
| Social post publishing | Async Temporal + platform polling (up to 12h) | **TBD** |

### 5.4 Worker Concurrency

| Worker | Task Queue | Activities | Workflows | Cached Workflows | Rationale |
|--------|-----------|-----------|-----------|-----------------|-----------|
| API Tasks | `api-tasks` | 1,000 | 100 | 500 | I/O-bound: posting, OAuth, analytics, LLM |
| Video Rendering | `video-rendering` | 5 | 10 | -- | CPU-bound: FFmpeg processing |

> **TODO:** These are initial guesses. Need load testing on the Mac Studio to derive real values.
> Per-provider task queues (see Open Questions, Concurrent Job Semaphore) will add more workers
> -- each provider gets its own queue with `maxConcurrentActivityTaskExecutions` set from the
> platform constraints registry. Remotion rendering may need a dedicated worker/queue separate
> from FFmpeg.

---

## 6. Observability

### 6.1 Stack

**Local dev** (Docker Compose):

```
Application (OTEL SDK)
    │ OTLP/HTTP
    ▼
OTEL Collector (0.96.0)  ← 512 MB memory limit, batch 500ms / 50 items
    ├──→ Jaeger (1.74.0)       Traces     :16686
    ├──→ Prometheus (2.51.1)   Metrics    :9090  (OTLP receiver)
    ├──→ Loki (3.5.0)          Logs       :3100
    └──→ agent_threads/messages (Postgres)  AI conversation history + evals
                │
                ▼
         Grafana (11.4.0)      Dashboards :3001

Promtail (3.5.0) ──→ Loki     Docker log collection
Node Exporter (1.6.1)         System metrics :9100
Sentry Spotlight               Local error/trace viewer :8969
```

**Production** (GCP Cloud Operations -- long-term target):

```
Application (OTEL SDK)
    │ OTLP/HTTP
    ▼
GCP Cloud Trace              Distributed tracing (replaces Jaeger)
GCP Cloud Monitoring         Metrics + alerting (replaces Prometheus + Grafana alerting)
GCP Cloud Logging            Logs (replaces Loki + Promtail)
Sentry (cloud)               Error tracking + performance (complements GCP)
agent_threads/messages        AI conversation history + evals (always Postgres)
```

> **Local stack != production stack.** Local dev uses self-hosted Jaeger/Prometheus/Loki/Grafana
> for zero-cost observability during development. Production targets GCP Cloud Operations for
> managed alerting, log retention, and trace analysis -- same OTEL SDK, different exporters.
> The switch is an OTEL Collector config change (swap exporters), not a code change.

### 6.2 Resource Attributes

```
service.namespace: "tx-agent-kit"
deployment.environment: "local" | "staging" | "production"
service.name: per-service (e.g., "api", "worker-api-tasks", "worker-video")
```

### 6.3 Health Checks

| Service | Endpoint | Port |
|---------|----------|------|
| API | `GET /health` | 8080 |
| Temporal | `tctl cluster health` | 7233 |
| OTEL Collector | `GET /health/status` | 13133 |
| Prometheus | `GET /-/healthy` | 9090 |
| Loki | `GET /ready` | 3100 |
| Grafana | `GET /api/health` | 3001 |

---

## 7. Security

### 7.1 Authentication

| Layer | Mechanism |
|-------|-----------|
| User sessions | Custom auth (tx-agent-kit): JWT access tokens + refresh token rotation + session management |
| API routes | JWT validation middleware (global) |
| OAuth (social) | TikTok (live), Meta/Google (planned) |
| Infrastructure | GitHub Actions secrets (CI), 1Password CLI (Hetzner VMs) |

### 7.2 Authorization

| Layer | Mechanism |
|-------|-----------|
| Database | No RLS -- API is the single gateway. Authorization enforced at API layer via middleware. |
| API | Single database client (Drizzle ORM). All auth/authz via Effect middleware. |
| RBAC | `roles` x `permissions` -> `role_permissions` |
| Storage | API-layer presigned URLs (R2). No direct storage access from frontend. |

### 7.3 Secrets Management

| Environment | Method |
|-------------|--------|
| Development | 1Password CLI (`op://` references in `.env.dev`) |
| CI/CD | GitHub Actions secrets |
| Production (Hetzner VMs) | 1Password CLI (`op inject` into Docker env) |

### 7.4 Data Protection

| Concern | Current State | Decision Needed |
|---------|--------------|-----------------|
| Encryption at rest | Supabase AES-256 | Sufficient? |
| Encryption in transit | HTTPS + Cloudflare tunnel | Sufficient? |
| Token encryption | Stored in `user_oauth_tokens` | Review encryption method |
| GDPR right to delete | Org-deletion hard-delete workflow required | Must purge DB rows + storage objects for deleted org |
| Data residency | **EU** -- Supabase EU region + Hetzner EU + R2 | Confirmed: all data in EU for GDPR compliance |
| Audit trail | `credit_ledger` (immutable) + `agent_threads`/`agent_messages` | Retention period? |

---

## 8. Deployment and Infrastructure

### 8.1 Environments

| Environment | API | Frontend | Database | Secrets |
|-------------|-----|----------|----------|---------|
| Development | Local (Node.js, :8080) | Local (Next.js, :3000) | Supabase local | 1Password CLI |
| Pilot / Canary | **Mac Studio** (Docker Compose) | Vercel production | Supabase hosted (EU) | 1Password CLI |
| Production | **Hetzner Cloud VMs** (EU, Docker Compose) | Vercel production | Supabase hosted (EU) | 1Password CLI + Docker secrets |

### 8.2 Cloud Resources

| Resource | Provider | Configuration |
|----------|----------|--------------|
| API + Workers VM | Hetzner Cloud | CAX31 (8 ARM / 16 GB), ~14.49 EUR/mo |
| Rendering VM | Hetzner Cloud | CAX21 (4 ARM / 8 GB), ~7.49 EUR/mo |
| Workflow engine | Temporal Cloud | Managed, $100/mo |
| Object storage | Cloudflare R2 | S3-compatible, zero egress |
| CDN | Cloudflare | Free tier, edge caching |
| Database | Supabase | Managed PostgreSQL, EU region |
| Frontend | Vercel | Next.js hosting |
| Container registry | GitHub Container Registry | Docker images from CI |

### 8.3 CI/CD (GitHub Actions)

| Workflow | Trigger | Timeout | Purpose |
|----------|---------|---------|---------|
| Type check | TS changes | 5 min | TypeScript validation |
| Lint | Code changes | 10 min | ESLint |
| Unit tests (fast) | PR/push | 15 min | Vitest |
| Integration tests | Manual | 35 min | Full stack (Supabase, API, DB) |
| Migration validation | `.sql` changes | -- | SQL migration checks |
| Type generation | Schema changes | 10 min | Drizzle schema + Effect schema generation |
| Deploy to pilot | Main branch / manual | 10 min | Build image, deploy to Mac Studio via SSH |
| Deploy to production | Manual approval | 10 min | Deploy same image to Hetzner VMs via SSH |
| Weekly ESLint scan | Cron | 10 min | Full lint |
| Monthly DB index scan | Cron | 30 min | Performance analysis |

### 8.4 Deployment Pipeline (Mac Studio to Hetzner VMs)

No Kubernetes. Docker Compose on VMs, deployed via SSH from GitHub Actions.

#### Platform Mapping

| Layer | Day 1 / Pilot | Scale-up |
|-------|---------------|----------|
| Compute | Mac Studio (Docker Compose) | Hetzner Cloud VMs (Docker Compose) |
| Deployment | SSH + docker compose pull/up | Same -- SSH + docker compose pull/up |
| Container registry | GitHub Container Registry | GitHub Container Registry |
| Ingress/edge | Cloudflare Tunnel + DNS | Cloudflare Tunnel + DNS |
| Object storage | Cloudflare R2 (dev bucket) | Cloudflare R2 (prod bucket) |
| Workflows | Self-hosted Temporal (dev) | Temporal Cloud ($100/mo) |
| Database | Supabase hosted (EU) | Supabase hosted (EU) |
| Secrets | 1Password CLI (`op inject`) | 1Password CLI (`op inject`) |

#### Deployment Flow

1. Build and test image in GitHub Actions.
2. Push immutable digest to GitHub Container Registry.
3. SSH into target VM, pull new image, `docker compose up -d`.
4. Run smoke tests against deployed environment.
5. Same image, same compose file -- only `.env` differs between pilot and production.

No Helm, no Kubernetes, no cluster management. Docker Compose is sufficient for 2 VMs.

#### Running Real Customers for Cost Estimation

The Mac Studio stays online as the pilot environment, hosting a controlled subset of customer
workloads to measure real unit costs.

| Metric | Source | Why It Matters |
|--------|--------|----------------|
| CPU/memory per service | Prometheus + node_exporter | Maps directly to Hetzner VM sizing |
| Job duration (rendering/workflows) | Temporal + app telemetry | Predicts whether CAX21 is sufficient for rendering |
| Storage usage | R2 usage analytics + database metering | Validates cost model per org |
| Error/retry rates | API + workflow traces | Estimates operational overhead at scale |

### 8.5 Production Cost Summary

| Component | Monthly Cost |
|-----------|-------------|
| Hetzner VM 1 (API + workers) | 14.49 EUR |
| Hetzner VM 2 (Remotion rendering) | 7.49 EUR |
| Temporal Cloud | $100 |
| Cloudflare R2 (with retention) | ~$6-32 |
| Supabase Pro (EU) | $25 |
| Vercel | $20 |
| **Total production infra** | **~$175-200/month** |

### 8.6 Container Images

| App | Base Image | Runtime | Notes |
|-----|-----------|---------|-------|
| API | `node:24-alpine` | Node.js | Effect HttpApi server |
| Worker (video) | `node:24-alpine` | Node.js | FFmpeg installed, non-root `temporal` user |
| Worker (api-tasks) | `node:24-alpine` | Node.js | Same image, different `WORKER_TYPE` build arg |
| Web | `node:24-alpine` | Node.js | Development Dockerfile (pnpm dev) |

---

## 9. Resolved Design Decisions

Decisions made during the system design audit (2026-03-25). Each resolves an open question
from the audit.

### 9.1 Non-Goals (Explicitly Not Building)

| Feature | Reason |
|---------|--------|
| **Marketplace** (buyer/seller, Stripe Connect, payouts) | tx-agent-kit is closed-loop: agencies bring their own clients. No marketplace needed. |
| **Posting streaks / streak notifications** | AI campaigns post autonomously -- streaks are meaningless when the AI maintains them. |
| **Content inspiration library** (platform-seeded popular posts) | The AI IDEATE phase is sufficient for content inspiration. |
| **Lifetime deals** (AppSumo-style) | Not planned. No `is_lifetime_deal` flag needed. |
| **Multi-approver workflows** | Single approver for v1. Multi-approver (creator -> manager -> legal) is post-launch. |
| **Post-publish automation plugs** | Deferred to post-launch. No `post_automations` table in v1. |
| **Yearly billing** | Monthly only at launch. Yearly (credit cadence, proration, refund formula) is post-launch. |

### 9.2 Agency Billing Model

**Agency absorbs all costs.** Single org subscription; the agency pays everything. Per-team
cost reporting is available via `credit_ledger.team_id` for internal invoicing/chargeback
(one team = one client). tx-agent-kit does not bill clients directly.

### 9.3 Campaign Pause Semantics -- Immediate Suspend

When a campaign is paused, **all `processing` assets immediately move to `suspended`**. No
in-flight work is allowed to complete. The `campaigns` table includes:
- `paused_at TIMESTAMPTZ` -- when the pause was initiated
- `pause_reason TEXT` -- optional user-provided reason

Assets in `suspended` state resume from their current pipeline step when the campaign is
unpaused.

### 9.4 RSS/Feed Auto-Posting -- Deferred

Table stub added for future implementation. Not building the workflow for v1.

```sql
feed_sources (
  id UUID PK,
  team_id UUID FK -> teams,
  campaign_id UUID FK -> campaigns (nullable),
  url TEXT NOT NULL,
  poll_interval_minutes INTEGER DEFAULT 60,
  last_polled_at TIMESTAMPTZ,
  status ENUM('active', 'paused', 'error') DEFAULT 'paused',
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
```

### 9.5 Profit Margin -- 10%

All AI cost pass-through uses a **10% markup**. Any references to 5% are outdated.

### 9.6 Manual Credit Top-Up -- Supported

One-time credit purchases via `POST /v1/billing/:organizationId/top-up`:

| Field | Type | Purpose |
|-------|------|---------|
| `amountDecimillicents` | BIGINT | Stripe Checkout amount, bounded between 1 cent and $500 |
| `successUrl` / `cancelUrl` | URL | Return targets after Stripe checkout |

Flow: User selects top-up amount -> Stripe Checkout payment session -> webhook confirms ->
credits added to `organizations.credits_balance` -> `credit_ledger` entry with `entryType =
'purchase'`. Top-up checkout does not change the active subscription pointer.

### 9.7 Promo Codes -- At Launch

Stripe promotion codes enabled for early-user discounts. Applied at checkout via
`stripe.subscriptions.create({ promotion_code: ... })`. No custom promo infrastructure --
Stripe handles validation, limits, and expiry.

### 9.8 Version Chain Forking -- Bug

Add `UNIQUE(parent_id) WHERE parent_id IS NOT NULL` partial index on `team_content_items`.
Two content items pointing to the same parent is a bug, not a feature.

---

## 10. Key Relationships

### 10.1 Entity Hierarchy

```
organizations ──┬──→ teams ──┬──→ team_members
                │            ├──→ team_content_items ──→ assets ──→ scheduled_posts
                │            ├──→ team_media_assets
                │            ├──→ social_accounts
                │            ├──→ campaigns ──→ campaign_social_accounts
                │            │              ──→ campaign_allowed_formats
                │            ├──→ creative_concepts
                │            ├──→ chats ──→ messages
                │            └──→ (scraping deferred to v2)
                ├──→ organization_members
                ├──→ credit_ledger
                └──→ knowledge ──→ knowledge_diffs
                             ──→ pending_knowledge
```

### 10.2 Cascade Deletes

```
organization -> teams (CASCADE) -- but teams should use soft-delete first (see below)
team -> team_content_items (CASCADE)
team_content_items -> assets (CASCADE)
team_content_items -> scheduled_posts (CASCADE)
team -> chats (CASCADE) -> messages (CASCADE)
```

> **Financial records are exempt from CASCADE.** `credit_ledger` and `usage_records` use
> `ON DELETE SET NULL` on `organization_id` -- not CASCADE. These are financial audit trails
> retained for 7 years regardless of org lifecycle. Before org hard-delete, a purge workflow
> archives these records.

> **Team deletion should be soft-delete first.** Replacing hard CASCADE with soft-delete
> (`deleted_at` on teams) preserves financial audit trails linked to team assets. A Temporal
> purge workflow handles: (1) cancel outstanding scheduled posts, (2) archive assets,
> (3) tombstone the team row, (4) R2 cleanup asynchronously.

### 10.3 Organization Deletion Purge Workflow

On organization deletion, cascade delete in PostgreSQL is not enough by itself. A companion
purge workflow must follow this strict ordering:

1. Mark org as `purge_in_progress`
2. Terminate all running Temporal workflows for the org
3. Collect all R2 paths from: `team_media_assets`, `assets`, `agent_messages.attachments`
4. Store paths in `pending_purge_objects` table (survives workflow crashes)
5. Delete R2 objects in batches, marking each as deleted
6. Hard-delete DB rows (CASCADE fires for non-financial tables)
7. Clean up `pending_purge_objects`

### 10.4 GDPR Purge Scope

Complete list of data to delete/anonymise:

- R2 blobs (media, renders, thumbnails, agent attachments)
- Temporal workflow history
- Stripe customer records
- `agent_threads` / `agent_messages` (contains user prompts -- personal data)
- pgvector embeddings (derived from user content)
- `post_performance_snapshots`
- Data references to external AI providers (document DPAs; call deletion APIs where available)
- `subscription_events.payload` -- anonymise PII fields, retain financial amounts for 7 years
- `credit_ledger` / `usage_records` -- archive with anonymised org reference, retain 7 years

---

## 11. Database Enums (Complete Reference)

| Enum | Values |
|------|--------|
| `account_type` | organic, ads |
| `campaign_status` | active, paused, archived |
| `campaign_type` | organic, paid |
| `content_change_type` | ai_generated, human_create, ai_regenerated, user_edit |
| `content_classification` | organic, promotional |
| `content_item_status` | idea, proposed_render, draft, approved, rejected, archived, deleted |
| `content_purpose` | meme, educational, entertaining |
| `content_type` | text, image, image_with_text, green_meme, slideshow, video |
| `creative_concept_source` | ai_generated, user_input, trend_analysis, performance_feedback, competitor_analysis |
| `creative_concept_status` | pending, approved, rejected, archived |
| `asset_source` | workflow, manual_upload |
| `asset_status` | pending, queued, processing, pending_approval, completed, failed, cancelled, suspended, rejected, campaign_paused |
| `asset_type` | text, slideshow, image_with_text, video, image, audio, thumbnail |
| `media_asset_type` | image, video, audio, gif, document |
| `membership_type` | team, client |
| `agent_message_role` | system, user, assistant, tool_call, tool_result |
| `agent_thread_type` | asset_production, campaign_planning, content_generation, evaluation |
| `agent_thread_status` | running, completed, failed, cancelled |
| `pipeline_phase` | SEARCH_TEMPLATES, IDEATE, RENDER_TEXT, RENDER_PROPOSAL, APPROVE, GENERATE_IMAGE, AGENTIC_RENDER, PLATFORM_VALIDATE, ENRICH, SCHEDULE |
| `performance_collection_status` | pending, collecting, completed, failed, stale |
| `permission_action` | create_media, edit_media, delete_media, schedule_posts, view_campaigns, create_campaigns, etc. |
| `post_status` | scheduled, publishing, published, failed, cancelled, cancelled_by_parent, unpublished |
| `orchestrator_tool` | openrouter, fal_ai, elevenlabs, ffmpeg, remotion, transcribe, analyze_media |
| `publish_flow` | save_to_draft, directly_push_content |
| `social_platform` | tiktok, instagram, youtube, linkedin, facebook |
| `subscription_status` | active, inactive, trialing, past_due, canceled, paused, unpaid |
| `team_onboarding_status` | pending, partial, completed, expired, revoked |
| `content_submission_status` | pending, approved, rejected, revision_requested |
| `webhook_delivery_status` | pending, succeeded, failed, dead_lettered |
| `approval_outcome` | approved, rejected, auto_approved |

---

## 12. Open Technical Questions (Cross-Cutting)

> Subsystem-specific open questions live in their respective design docs.
> Only infrastructure and cross-cutting questions remain here.

| # | Area | Question | Status |
|---|------|----------|--------|
| 1 | Compute | What are the per-service CPU/memory requirements? | Derive from Mac Studio pilot via Prometheus |
| 2 | Scaling | When does CAX31 hit capacity? Add a second VM or upgrade? | Monitor during pilot |
| 3 | Cache | Is Redis 256MB sufficient? | Likely yes at 1K users, monitor |
| 4 | Storage | ~~EU bucket needed for data residency?~~ | **Resolved** -- Supabase EU + Hetzner EU + R2 |
| 5 | Storage | ~~Is 50 MB upload limit sufficient?~~ | **Resolved** -- Confirmed 50 MB for now |
| 6 | Monitoring | What alerting thresholds should be configured? | Open |
| 7 | Database | Connection pool sizing for 1K concurrent users? | Open |
| 8 | Load testing | When should we run load tests? What tools? | Open |
| 9 | CDN | ~~Should assets be served through a CDN?~~ | **Resolved** -- Cloudflare edge, always |
| 10 | Video | ~~Should rendering scale horizontally?~~ | **Resolved** -- Separate Hetzner VM for Remotion, Remotion Lambda at 10K |
| 11 | Schema | **Template library schema** -- `template_id` FK exists on `assets` but no `templates` table defined. Known requirements: system + user templates, team-scoped, Remotion/FFmpeg/Satori backends. | **Deferred** -- depends on slideshow, video, and agentic render sub-systems being built first |
| 12 | Schema | ~~`client_id` FK on `social_accounts`~~ | **Resolved** -- dropped `clients` table. One team = one client. `team_id` IS the client scope. |

# Data Model

_Cross-cutting data model references live in the subsystem design docs. See the database enums and key relationships sections above for shared schema references._

# Interfaces

## Cross-Cutting Effect Ports & Services

These interfaces span multiple subsystems and do not belong to any single domain.

```typescript
import { Context } from 'effect'
import type * as Effect from 'effect/Effect'
import type { CoreError } from '../../../errors.js'

// ---------------------------------------------------------------------------
// Health & Diagnostics
// ---------------------------------------------------------------------------

/** Aggregated health check across all dependencies (DB, Redis, Temporal, R2). */
export class HealthCheckService extends Context.Tag('HealthCheckService')<
  HealthCheckService,
  {
    /** Returns per-dependency status. Used by GET /healthz. */
    check: () => Effect.Effect<{
      status: 'healthy' | 'degraded' | 'unhealthy'
      components: ReadonlyArray<{
        name: string                  // e.g. 'postgres', 'redis', 'temporal', 'r2'
        status: 'up' | 'down' | 'degraded'
        latencyMs: number
        message?: string
      }>
      version: string                 // git SHA or package version
      uptime: number                  // seconds since process start
    }, never>
  }
>() {}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/** Generic idempotency key store -- prevents duplicate side effects across
 *  retries, webhook re-deliveries, and Temporal activity replays. */
export class IdempotencyKeyPort extends Context.Tag('IdempotencyKeyPort')<
  IdempotencyKeyPort,
  {
    /** Try to claim a key. Returns true if newly claimed, false if already exists.
     *  Keys expire after ttlSeconds (default 24h). */
    tryClaim: (input: {
      key: string
      scope: string                   // e.g. 'stripe_webhook', 'social_posting', 'credit_reservation'
      ttlSeconds?: number
    }) => Effect.Effect<boolean, unknown>

    /** Check whether a key has been claimed without claiming it. */
    exists: (key: string, scope: string) => Effect.Effect<boolean, unknown>

    /** Release a previously claimed key (e.g. on rollback). */
    release: (key: string, scope: string) => Effect.Effect<void, unknown>
  }
>() {}

// ---------------------------------------------------------------------------
// Request Middleware (Effect HttpApi middleware layer)
// ---------------------------------------------------------------------------

/** Injects a unique request ID into every inbound HTTP request.
 *  Propagated to logs, Temporal workflows, and Sentry traces. */
export class RequestIdMiddleware extends Context.Tag('RequestIdMiddleware')<
  RequestIdMiddleware,
  {
    /** Get the current request's ID (from X-Request-Id header or generated). */
    getRequestId: () => Effect.Effect<string, never>
  }
>() {}

/** Per-user + per-IP rate limiting enforced on every endpoint group (INV-OVR-001).
 *  Backed by Redis sliding-window counters. */
export class RateLimitMiddleware extends Context.Tag('RateLimitMiddleware')<
  RateLimitMiddleware,
  {
    /** Check rate limit for a request. Returns remaining quota or fails with 429. */
    check: (input: {
      identifier: string              // userId or IP address
      endpointGroup: string           // e.g. 'api:read', 'api:write', 'webhook', 'auth'
      windowSeconds: number
      maxRequests: number
    }) => Effect.Effect<{
      allowed: boolean
      remaining: number
      resetAt: Date
    }, CoreError>
  }
>() {}

// ---------------------------------------------------------------------------
// GDPR / Data Purge
// ---------------------------------------------------------------------------

/** Orchestrates right-to-erasure across all subsystems.
 *  Triggered by user account deletion or GDPR request. */
export class GDPRPurgeService extends Context.Tag('GDPRPurgeService')<
  GDPRPurgeService,
  {
    /** Initiate a full purge for a user. Archives financial records (7-year
     *  retention) with anonymised references, then hard-deletes PII. */
    purgeUser: (input: {
      userId: string
      requestedBy: string             // userId of requester (admin or self)
      reason: 'user_request' | 'account_deletion' | 'gdpr_erasure'
    }) => Effect.Effect<{
      purgedEntities: ReadonlyArray<{ entity: string; count: number }>
      archivedFinancialRecords: number
      blobsDeleted: number
    }, CoreError>

    /** Purge all data for an organization (triggered by org deletion workflow).
     *  Financial records (credit_ledger, usage_records) are archived, not deleted. */
    purgeOrganization: (input: {
      organizationId: string
      requestedBy: string
    }) => Effect.Effect<{
      purgedEntities: ReadonlyArray<{ entity: string; count: number }>
      archivedFinancialRecords: number
      blobsDeleted: number
    }, CoreError>

    /** Dry-run: preview what would be purged without executing. */
    previewPurge: (input: {
      userId?: string
      organizationId?: string
    }) => Effect.Effect<{
      entities: ReadonlyArray<{ entity: string; count: number }>
      financialRecordsToArchive: number
      blobsToDelete: number
      estimatedDurationSeconds: number
    }, CoreError>
  }
>() {}
```

# Invariants

```yaml
invariants:
  - id: INV-OVR-001
    statement: "API rate limiting must be enforced per-user + per-IP on every endpoint group"
    severity: high
    verified_by:
      - REQ-OVR-001

  - id: INV-OVR-002
    statement: "All mutating API endpoints must accept an idempotency key header and return the cached response on replay"
    severity: critical
    verified_by:
      - REQ-OVR-002

  - id: INV-OVR-003
    statement: "Request-ID must propagate from API gateway -> Temporal workflow -> external provider calls (OTEL trace context)"
    severity: high
    verified_by:
      - REQ-OVR-003

  - id: INV-OVR-004
    statement: "Health check endpoints must verify downstream connectivity (DB, Redis, Temporal, OTEL Collector)"
    severity: high
    verified_by:
      - REQ-OVR-004

  - id: INV-OVR-005
    statement: "GDPR purge must cover all data stores: R2 blobs, Temporal history, Stripe records, agent data, pgvector embeddings, post_performance_snapshots, subscription_events PII"
    severity: critical
    verified_by:
      - REQ-OVR-005

  - id: INV-OVR-006
    statement: "Financial records (credit_ledger, usage_records) are exempt from CASCADE delete -- use ON DELETE SET NULL on organization_id"
    severity: critical
    verified_by:
      - REQ-OVR-005
      - REQ-OVR-006

  - id: INV-OVR-007
    statement: "Temporal workflows must be deterministic -- no Date.now(), Math.random(), or direct I/O in workflow code"
    severity: critical
    verified_by:
      - REQ-OVR-007

  - id: INV-OVR-008
    statement: "Credit operations must follow Reserve -> Execute -> Deduct/Release pattern for all async billable operations"
    severity: critical
    verified_by:
      - REQ-OVR-008

  - id: INV-OVR-009
    statement: "All types originate from packages/contracts (effect/Schema) -- no ad-hoc type definitions in apps/"
    severity: high
    verified_by:
      - REQ-OVR-009
```

# Failure Modes

```yaml
failure_modes:
  - condition: "OTEL Collector is unreachable or crashes"
    impact: "Traces, metrics, and logs stop flowing to backends (Jaeger/Prometheus/Loki). Application continues to function -- OTEL SDK uses fire-and-forget semantics."
    handling: "OTEL Collector has a 512 MB memory limit and batch processor. Docker Compose restart policy: always. Health check on port 13133. Alert on collector absence via node_exporter (process not running)."

  - condition: "Health check reports unhealthy but service is functional (false negative)"
    impact: "Load balancer / Cloudflare Tunnel removes a healthy instance from rotation, causing unnecessary failover or downtime."
    handling: "Health check verifies component-level connectivity (DB, Redis, Temporal) with short timeouts (2s). If a downstream component is slow but responsive, health check should still pass. Separate /readyz (startup) from /health (ongoing)."

  - condition: "GDPR purge workflow crashes mid-execution (e.g., after deleting some R2 objects but before DB cascade)"
    impact: "Partial purge leaves orphaned data in some stores. Financial records may still reference the org."
    handling: "Purge workflow uses pending_purge_objects table as a crash-safe manifest. On restart, the workflow resumes from the last incomplete step. Temporal durable execution guarantees the workflow will retry until completion."

  - condition: "Redis cache becomes unavailable (crash or OOM)"
    impact: "Rate limit counters, session data, and platform capability caches are lost. Rate limiting fails open (requests allowed). Sessions require re-authentication."
    handling: "Redis restart policy: always. 256 MB LRU eviction policy prevents OOM. Rate limiting is configured to fail-open so API remains available. Session tokens backed by JWT so stateless fallback works."

  - condition: "Temporal Cloud outage or network partition"
    impact: "No new workflows can start. Running workflows pause. Scheduled campaigns, publishing, analytics collection all halt."
    handling: "Temporal Cloud SLA. API returns 503 for workflow-dependent operations with Retry-After header. Non-workflow API operations (CRUD, auth) continue working. Temporal has built-in persistence -- workflows resume automatically when connectivity restores."
```

# Verification

```yaml
verification:
  - requirement_id: REQ-OVR-001
    test_type: integration
    target: "Send N+1 requests within sliding window, assert Nth+1 returns 429 with Retry-After header. Test both per-user and per-IP paths."

  - requirement_id: REQ-OVR-002
    test_type: integration
    target: "POST /v1/content with idempotency key, then replay same request. Assert identical response body, no duplicate DB rows."

  - requirement_id: REQ-OVR-003
    test_type: e2e
    target: "Trigger API -> Temporal -> external provider flow. Query Jaeger for trace_id, assert all three spans share the same trace."

  - requirement_id: REQ-OVR-004
    test_type: integration
    target: "Stop each downstream service (DB, Redis, Temporal) individually, assert /health returns unhealthy with the failed component identified."

  - requirement_id: REQ-OVR-005
    test_type: integration
    target: "Create org with full data (media, posts, threads, embeddings, subscriptions). Run purge workflow. Assert zero data remains except anonymised credit_ledger/usage_records."

  - requirement_id: REQ-OVR-006
    test_type: integration
    target: "pgTAP test: INSERT org + credit_ledger rows, DELETE org, assert credit_ledger rows survive with NULL org_id."

  - requirement_id: REQ-OVR-007
    test_type: integration
    target: "ESLint rule in CI + Temporal workflow replay test with recorded history. Non-deterministic code fails replay."

  - requirement_id: REQ-OVR-008
    test_type: integration
    target: "Reserve credits, simulate activity crash, assert credits_balance restored to pre-reservation value."

  - requirement_id: REQ-OVR-009
    test_type: unit
    target: "ESLint structural rule: no Schema.Struct definitions in apps/ directories."
```
