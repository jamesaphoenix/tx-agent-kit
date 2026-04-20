# System Design Review — Unified Report

> **Generated:** 2026-03-26
> **Reviewers:** 12 specialized agents (data model, security, Temporal, billing, publishing, AI pipeline, performance, Postiz gaps, state machine, storage/infra, internal consistency, API design)
> **Scope:** `specs/system-design.md` + Postiz codebase comparison

---

## CRITICAL Issues (28)

### Data Model
| # | Issue | Recommendation |
|---|-------|----------------|
| 1 | **Missing `auto_recharge_attempts` table** — referenced in §9.3 but no schema | Define table: id, org_id FK, amount, status, stripe_intent_id, error, attempt_number, timestamps |
| 2 | **Missing `permissions` + `role_permissions` schema** — authorization model incomplete | Define full RBAC schema: permissions table + role_permissions junction |
| 3 | **Missing `users` table schema** — referenced everywhere but never defined | Define: id, email UNIQUE, name, timezone, disabled_at, timestamps |
| 4 | **Missing `user_oauth_tokens` table** — core OAuth token storage never defined | Define: id, social_account_id FK, access_token ENCRYPTED, refresh_token, expires_at, scope, timestamps |
| 5 | **`experiments` table referenced but never defined** — blocks bandit system | Define: id, team_id FK, name, status, treatment_arm JSONB, timestamps |

### Security
| # | Issue | Recommendation |
|---|-------|----------------|
| 6 | **OAuth token encryption unspecified** — no algorithm, key management, or rotation | Specify AES-256-GCM, key versioning, rotation policy, 1Password vault for keys |
| 7 | **Content review tokens too broad** — scoped to entire team, 7-day expiry, no brute-force protection | Enforce 256-bit entropy, rate limit token validation (5/min), reduce default expiry to 48h |
| 8 | **Presigned URL scope undefined** — could leak cross-tenant if not per-object | Enforce per-object signed URLs scoped to team_id + asset_id |

### Temporal Workflows
| # | Issue | Recommendation |
|---|-------|----------------|
| 9 | **Token refresh uses TERMINATE_EXISTING** — kills mid-execution refresh, inconsistent state | Switch to USE_EXISTING, add post-termination token state validation |
| 10 | **Nightly batch no per-post error isolation** — one fatal child blocks entire batch | Wrap each child workflow in error handler, always send batch summary email |
| 11 | **Credit reservation no compensation on crash** — reserved credits hang indefinitely | Add 24h auto-release timeout, activity failure handler calls release |
| 12 | **resolve-pending-post-ids unbounded polling** — no max attempts, rate limit risk | Add max 10 poll attempts per post, rate limit awareness, exponential backoff |

### Billing
| # | Issue | Recommendation |
|---|-------|----------------|
| 13 | **Stripe webhook idempotency race** — event_id not recorded atomically with ledger entry | Single transaction: upsert event_id → if 0 rows affected, abort → else create ledger |
| 14 | **Monthly budget reset has no mechanism** — no trigger, job, or code to create new period row | Create row on subscription activation, add UNIQUE(org_id, period_start), define rollover Temporal job |
| 15 | **Storage overage deducted before upload completes** — user loses credits if upload fails | Reverse flow: allow upload → on completion event, atomically deduct + increment bytes |
| 16 | **Reserve→execute→finalize crash window unspecified** — no timeout, no auto-release | Define 24h timeout, explicit flow per op type, activity failure handler calls release |

### Publishing
| # | Issue | Recommendation |
|---|-------|----------------|
| 17 | **No polling timeout** — Postiz uses `while(true)` with no max duration | Add max polling duration per provider (Instagram 30min, TikTok 5min) |
| 18 | **Per-provider semaphore undefined** — design recommends but no Temporal config shown | Define per-provider task queues with `maxConcurrentActivityTaskExecutions` from PlatformConstraints |
| 19 | **Token refresh race with publish window** — token can expire between refresh and actual publish | Check `token_refreshed_at` before each publish, force refresh if >1hr old |

### AI Pipeline
| # | Issue | Recommendation |
|---|-------|----------------|
| 20 | **Bandit discount formula undefined** — spec says "discount" but no formula | Define: either `reward *= 0.5` for edited assets, or exclude from arm comparison entirely |
| 21 | **Cost estimates unreliable** — RENDER_PROPOSAL shows rough numbers, no tolerance band | Add ±15% accuracy requirement, fail hard if variance >25%, surface overrun to user |
| 22 | **Shell tool no timeout** — ffmpeg on corrupted input hangs indefinitely | Add per-tool timeout: ffprobe 30s, ffmpeg 120s, kill on exceed |

### State Machine
| # | Issue | Recommendation |
|---|-------|----------------|
| 23 | **Gate 1 rejection → asset cascade undefined** — assets orphaned on concept rejection | Define: on content_item → rejected, all child assets → cancelled |
| 24 | **edit_iteration no uniqueness** — duplicate approval rows collapse audit trail | Add UNIQUE(content_item_id, gate, edit_iteration) constraint |
| 25 | **Video edit feature flag not server-side** — client can POST edit bypassing UI flag | Add server guard: reject 400 if asset_type=video and allow_video_edit=false |

### API Design
| # | Issue | Recommendation |
|---|-------|----------------|
| 26 | **No endpoint specification** — 14 route groups listed but zero concrete endpoints | Create OpenAPI 3.1 spec or specs/API.md with all CRUD endpoints |
| 27 | **No standardized error schema** — scattered error formats across sections | Define: `{ code, message, details?, statusCode }` contract in packages/contracts |
| 28 | **No pagination standard** — list endpoints have no cursor/offset spec | Define cursor-based pagination: `{ cursor?, limit, results[], nextCursor }` |

### Internal Consistency
| # | Issue | Recommendation |
|---|-------|----------------|
| 29 | **Upload limit contradiction** — §2.8 says "raise to 200 MB", §20 says "confirmed 50 MB" | Finalize: 50 MB for MVP, 200 MB post-launch. Update all 3 locations. |
| 30 | **Profit margin mismatch** — spec says 1.10×, codebase has 1.5× | Confirm and update code. Add CI check to prevent drift. |

---

## HIGH Issues (42)

### Data Model
- Missing `storage_usage` hard ceiling columns for quota enforcement
- `agent_threads.total_credits` missing decimillicent unit documentation
- `credit_ledger.source_type` enum missing `storage_overage_renewal` and `top_up`
- `team_content_items.parent_id` unique constraint underspecified
- `oauth_pending_selections` table for multi-step OAuth not defined

### Security
- API-layer auth validation — no test that middleware blocks cross-team access
- Multi-step OAuth intermediate state (`in_between_steps`) — no cleanup after 24h
- GDPR purge workflow — no timeline, no recovery on failure, no R2 deletion verification
- JSONB validation — no enforcement mechanism for platform_settings/publish_results schemas
- Shell tool sandbox — no spec for mechanism (seccomp/cgroup), CPU/memory limits, command whitelist

### Temporal
- Budget check race — pre-batch token sweep and budget check not in single transaction
- Meta family token refresh — no atomic update across sibling accounts
- Heartbeat timeouts unspecified per activity type
- TikTok polling overlap with resolve-pending-post-ids

### Billing
- Negative balance not prevented — no CHECK constraint on credits_balance
- 10% markup applied inconsistently — no central Markup module
- Refund calculation undefined — no formula for cancellation proration
- Monthly storage reconciliation race — concurrent deletes during calculation
- Chargeback reversal — no flow to restore credits if dispute won
- Plan tier limits (seats, accounts) marked TBD — no enforcement

### Publishing
- Error categorization too broad — TikTok rate limit vs Instagram daily limit need different retry strategies
- Carousel/multi-post atomicity — no publication_group state machine for partial failures
- PULL_FROM_URL vs FILE_UPLOAD — no per-platform upload strategy matrix
- Watchdog 30min threshold — false positives on legitimate long Instagram uploads
- Missed-schedule recovery — hourly scan misses posts during extended downtime

### AI Pipeline
- Evaluator self-evaluation bias — no enforcement preventing same model for generation + evaluation
- Sample size — no minimum posts-per-arm before bandit picks winner
- Credit check per evaluator iteration — agent can overshoot budget in loops
- Reward signal pipeline — no Temporal workflow connecting post_performance back to arm weights
- RENDER_PROPOSAL cost accuracy — no real-time estimate from cost service
- Experiment arm distribution algorithm unspecified (Thompson sampling? epsilon-greedy?)

### Performance
- Video Rendering Worker undersized (5 concurrent for 400 nightly renders)
- api-tasks queue has no per-provider isolation
- Database connection pool sizing TBD (Supabase default 15 is grossly insufficient)
- pgvector IVFFlat index untuned (3072 dims, no lists/probes config)
- OTEL Collector 512MB may drop telemetry during batch bursts
- API request timeout 3600s is dangerous for sync operations
- In-memory rate limiter not shared across API instances

### State Machine
- `campaign_paused` transition rules undefined for non-processing assets
- Soft-delete cascade to scheduled_posts not explicit
- Asset vs content_item status consistency rules missing
- Auto-approval rule versioning — rule change mid-pipeline causes inconsistent outcomes

### API Design
- Webhooks design is stub-only (no delivery guarantee, retry, signature, dead-letter)
- CLI/SDK/MCP surface not defined
- Bulk operations not addressed
- Idempotency key schema missing
- SSE reconnection and backpressure unspecified
- Rate limit response headers not specified
- No search endpoint specification
- No async operation polling endpoint contract

### Storage/Infra
- CDN cache invalidation on re-render
- Hetzner CAX31 may OOM under peak load (API + Redis + OTEL on same VM)
- Remotion CAX21 (4 ARM / 8 GB) insufficient for headless Chrome peak
- No backup strategy for R2 or Postgres documented
- GDPR purge workflow — no idempotency, no resume on crash
- EU data residency not enforced at R2 bucket level

---

## MEDIUM Issues (45)

_(Summarized — full details in individual agent reports)_

**Data Model:** Asset render variants not tracked, post_performance partition strategy missing, storage audit trail missing, content version chain semantics ambiguous, creative_concepts.use_count not atomic

**Security:** Token refresh pre-batch timing, credit reservation edge cases, secrets rotation, JWT revocation, root account token propagation isolation level

**Temporal:** Nightly batch workflow ID collision near midnight, SSE bottleneck at 500 queries/sec, token refresh idempotency, missed batch recovery scan too narrow, Instagram activity timeout too short

**Billing:** Financial audit archival incomplete, auto-recharge mid-operation failure, cost deduction rollback, duplicate event TTL, usage cap mid-cycle changes, presigned URL multi-use

**Publishing:** Content validation fallback (1:1 → 9:16 auto-crop), thread chain parent failure cascade, rate limit jitter scope (per-post vs per-provider), publication group partial failure reporting, Instagram container 24h expiry pre-warning

**AI Pipeline:** Message ordering/nesting integrity, magic_tool log analysis SLA, prompt context size limits, evaluator loop intermediate render cleanup timing, missing abort_current_render tool

**Performance:** R2 compression failure not retried, agent thread message accumulation unbounded, rate limiter should be in Redis not in-memory, campaign budget reset alignment with billing cycle, Hetzner VM memory pressure

**State Machine:** Version chain forking ambiguity, scheduled post cascade slow query risk, suspended asset resume flow undefined, gate expiration SLA undefined, approval token revocation race

**API Design:** Content negotiation, export endpoints, validation error schema, analytics query endpoints, OAuth linking endpoints, agent thread API, test mode/sandbox

**Consistency:** asset_type enum overloaded (media vs rendered), validation limits not plan-aware, subsystem dependency diagram incomplete, pipeline phase enum naming (APPROVE vs APPROVE_EDIT)

---

## LOW Issues (18)

_(Not blocking — documentation/polish items)_

- agent_messages.role deviates from OpenAI spec (tool_call/tool_result vs tool)
- publication_group_id no orphan cleanup
- platform staleness rules hardcoded
- presigned URL signature algorithm unspecified
- R2 operations monitoring incomplete
- cost forecasting for storage overage not shown to user pre-upload
- cursor format undocumented
- timezone handling guidance missing
- enum values not centralized for SDK consumers
- API versioning strategy unclear

---

## Recommended Priority Order

### Before Implementation Starts
1. **Define missing table schemas** (users, user_oauth_tokens, permissions, experiments, auto_recharge_attempts)
2. **Finalize upload limit** (50 MB vs 200 MB) and profit margin (1.10× vs 1.5×)
3. **Define standardized API error schema + pagination contract**
4. **Specify credit reservation timeout + auto-release**

### During MVP Build
5. Per-provider Temporal task queues (semaphore pattern)
6. Server-side video edit guard
7. Nightly batch per-post error isolation
8. Shell tool sandbox spec (timeouts, resource limits)
9. Token refresh race fix (USE_EXISTING, pre-publish refresh check)
10. Stripe webhook atomic idempotency

### Before Launch
11. GDPR purge workflow (idempotent, resumable)
12. Connection pool sizing (load test)
13. Content review token hardening (entropy, rate limiting)
14. Presigned URL per-object scoping
15. CDN cache invalidation on re-render

### Post-Launch Hardening
16. Bandit reward pipeline (Temporal workflow connecting performance → arms)
17. Bulk operations API
18. Webhook delivery system (retry, signature, dead-letter)
19. CLI/SDK/MCP surface definition
20. pgvector index tuning
