# Postiz vs tx-agent-kit — Gap Analysis

> **Date:** 2025-03-25
> **Source:** Deep comparison of [postiz-app](https://github.com/gitroomhq/postiz-app) (`.vendor/postiz-app/`) against `specs/system-design.md`
> **Method:** 8 parallel agents each analyzing a domain area

---

## Table of Contents

1. [Prisma Schema — Full Data Model Comparison](#1-prisma-schema--full-data-model-comparison)
2. [Social Platform Integrations](#2-social-platform-integrations)
3. [Billing & Subscriptions](#3-billing--subscriptions)
4. [Scheduling & Publishing](#4-scheduling--publishing)
5. [Analytics](#5-analytics)
6. [Media & Assets](#6-media--assets)
7. [Team / Org / Agency Model](#7-team--org--agency-model)
8. [Notifications, Comments & Collaboration](#8-notifications-comments--collaboration)
9. [Consolidated Gap Summary](#9-consolidated-gap-summary)

---

## 1. Prisma Schema — Full Data Model Comparison

### Postiz Entity Inventory (45 tables)

#### Core (8)
| # | Table | Purpose |
|---|-------|---------|
| 1 | `Organization` | Billing entity, API key, subscription prefs |
| 2 | `User` | Profile, auth, social media agency info |
| 3 | `Tags` | Post categorization |
| 4 | `Subscription` | Stripe subscription tier tracking |
| 5 | `GitHub` | GitHub token storage |
| 6 | `Trending` | Trending data (language-specific) |
| 7 | `Star` | GitHub stars tracking |
| 8 | `Media` | File storage metadata |

#### Team & Access (4)
| # | Table | Purpose |
|---|-------|---------|
| 9 | `UserOrganization` | Org membership with roles |
| 10 | `Customer` | Named clients within org |
| 11 | `UsedCodes` | Promo code tracking |
| 12 | `ItemUser` | User-specific key-value settings |

#### Publishing (7)
| # | Table | Purpose |
|---|-------|---------|
| 13 | `Integration` | Social media accounts (token, refresh, posting times) |
| 14 | `Post` | Scheduled posts with state machine |
| 15 | `TagsPosts` | Junction table |
| 16 | `Signatures` | Email signatures |
| 17 | `AutoPost` | RSS/feed auto-posting rules |
| 18 | `Sets` | Named reusable content templates |
| 19 | `ThirdParty` | Alternative provider credentials |

#### Messaging & Commerce (6)
| # | Table | Purpose |
|---|-------|---------|
| 20 | `Messages` | In-app messaging between users |
| 21 | `MessagesGroup` | Conversation threads (buyer/seller) |
| 22 | `Orders` | Commerce orders with status tracking |
| 23 | `OrderItems` | Line items in orders |
| 24 | `PayoutProblems` | Financial disputes |
| 25 | `SocialMediaAgency` | Agency profile registry |

#### Content (3)
| # | Table | Purpose |
|---|-------|---------|
| 26 | `Comments` | Post-level comments |
| 27 | `PopularPosts` | Content inspiration library |
| 28 | `SocialMediaAgencyNiche` | Agency specialty areas |

#### Notifications & Webhooks (3)
| # | Table | Purpose |
|---|-------|---------|
| 29 | `Notifications` | In-app notifications |
| 30 | `Webhooks` | Org-level webhook subscriptions |
| 31 | `IntegrationsWebhooks` | Junction table |

#### Errors & Logging (2)
| # | Table | Purpose |
|---|-------|---------|
| 32 | `Errors` | Publishing failure log |
| 33 | `Mentions` | @mention tracking for notifications |

#### OAuth (3)
| # | Table | Purpose |
|---|-------|---------|
| 34 | `OAuthApp` | Custom OAuth app registry |
| 35 | `OAuthAuthorization` | User OAuth grants |
| 36 | `oauth_states` | CSRF tokens |

#### Postiz Enums (9)
`OrderStatus`, `From`, `State` (QUEUE/PUBLISHED/ERROR/DRAFT), `SubscriptionTier`, `Period`, `Provider`, `Role` (SUPERADMIN/ADMIN/USER), `APPROVED_SUBMIT_FOR_ORDER`, `ShortLinkPreference`

### tx-agent-kit Entity Inventory (~40 tables)

Core Tenancy (11), Assets & Media (3), Content Pipeline (7), Social Integration (7), Billing & Credits (4), Analytics (2), Infrastructure (3), plus enums (24 types).

### Gap Table: Postiz Tables with No tx-agent-kit Equivalent

| Postiz Table | Category | tx-agent-kit Status | Severity |
|---|---|---|---|
| `Orders` / `OrderItems` / `PayoutProblems` | Commerce | **Intentional exclusion** — no marketplace | None |
| `SocialMediaAgency` / `SocialMediaAgencyNiche` | Agency profiles | Not planned for v1 | Low |
| `AutoPost` | RSS auto-posting | **Deferred** (Section 19a) | Low |
| `Sets` | Content templates | Referenced (`templates`) but no schema | **Medium** |
| `PopularPosts` | Content inspiration | **Deferred** (Section 11) | Low |
| `Signatures` | Email signatures | Out of scope | None |
| `Messages` / `MessagesGroup` | Messaging | Not planned | Low |
| `GitHub` / `Star` | GitHub integration | Not planned | None |
| `UsedCodes` | Promo codes | Offloaded to Stripe | None |
| `ItemUser` | User preferences | No equivalent | **Medium** |
| `Mentions` | @mention tracking | AI enrichment instead | Low |
| `Trending` | Trend discovery | **Deferred** (Section 11) | Low |
| `ThirdParty` | 3rd-party creds | Vague in spec | **Medium** |

### Critical Schema Gaps (Design Required)

1. **Short Link Table** — `scheduled_posts.use_short_link` is referenced but no `short_links` table exists
2. **Template Library** — `assets.template_id` references templates but no schema defined
3. **User Preferences** — No `preferences JSONB` on `users` or `user_preferences` junction table
4. **`client_id` FK on `social_accounts`** — Postiz links integrations to clients; tx-agent-kit's `social_accounts` doesn't have a `client_id` FK (agencies managing multiple clients' accounts need this)
5. **Notification schema detail** — Architecture described but table schema sparse
6. **Third-party integration credentials** — No `third_party_integrations` table for Apify, etc.

---

## 2. Social Platform Integrations

### Platform Coverage

Postiz supports **36 providers**. tx-agent-kit plans **6** (TikTok, Instagram, Facebook, YouTube, LinkedIn, X/Twitter).

**Postiz additionally supports:** Threads, Bluesky, Reddit, Mastodon (self-hosted), Pinterest, Slack, Discord, Twitch, Kick, Dev.to, Hashnode, Medium, Dribbble, Farcaster, Nostr, WordPress, Lemmy, Skool, MeWe, Moltbook, Whop, ListMonk, GMB (Google My Business), and more.

### OAuth Token Refresh

| Aspect | Postiz | tx-agent-kit |
|--------|--------|-----------|
| Approach | Inline per-provider `refreshToken()` method | Temporal workflow `token-refresh.workflow.ts` |
| Error handling | `handleErrors()` per provider | Generic PLATFORM_VALIDATE phase |
| Scalability | Less scalable (in-request) | More scalable (background workflow) |

### Platform-Specific Publishing Quirks tx-agent-kit Should Know

#### TikTok
- **Two publishing methods:** `DIRECT_POST` (rate limited, privacy restricted if unverified) vs `UPLOAD` (inbox)
- **Dynamic capability detection:** `maxVideoLength()` API call per account
- **Pending limit:** Max 5 pending posts in inbox (`spam_risk_too_many_pending_share`)
- **Status polling:** `POST /v2/post/publish/status/fetch` with exponential backoff (10s → 60min)
- **77 specific error codes** catalogued in Postiz (`tiktok.provider.ts` lines 41-238)

#### Instagram/Meta
- **Multi-step OAuth:** User token → long-lived exchange → page enumeration (dual fetch: `me/accounts` + `me/businesses/owned_pages`) → page selection → page token stored
- **Media creation state machine:** `IN_PROGRESS` polling before publishing (30s intervals)
- **Carousel:** Requires `is_carousel_item=true` per media; collaborators not allowed on stories
- **31+ error codes** including: `2207042` (max 25 posts/day), `2207001` (spam detection)

#### LinkedIn
- **PDF conversion for carousels:** Images auto-converted to PDF via `image-to-pdf` library
- **Chunked upload:** 2MB chunks for videos (resumable with ETag tracking)
- **Most restrictive:** `maxConcurrentJob = 2`
- **Text escaping:** Complex regex for URN mention syntax (12 special chars)

#### X/Twitter
- **Account capability detection:** `verified` flag during auth (Premium=4000 chars, Free=200)
- **Token format:** Combines `access_token:access_secret` (OAuth 1.0a)
- **No refresh support:** `refreshToken()` returns empty values

#### YouTube
- **Channel selection:** Multi-step OAuth → channel list → user picks
- **Quota:** 10K units/day; video upload = 1,600 units (not enforced in Postiz)
- **Binary streaming:** Downloads from R2 and streams directly (not PULL_FROM_URL)
- **Custom thumbnail:** Separate API call after video upload

### Rate Limiting Comparison

| Provider | Postiz (`maxConcurrentJob`) | tx-agent-kit Spec |
|----------|---------------------------|----------------|
| TikTok | 300 | 600/min |
| Instagram | 400 | 100 |
| Facebook | 100 | — |
| YouTube | 200 | 200 |
| LinkedIn | 2 | 2 (1s between) |
| X/Twitter | 1 | 1 (3-hour window) |
| Reddit | 1 | — |

**Key finding:** Postiz uses static `maxConcurrentJob`, not dynamic rate-limit headers. tx-agent-kit should implement:
1. Automatic `retry-after` / `x-rate-limit-remaining` header extraction
2. Per-endpoint rate limits (TikTok has endpoint-specific limits)

### Missing in tx-agent-kit Spec

1. **Async job polling** — Instagram/YouTube require polling for media creation status; not specified
2. **Video upload streaming** — YouTube requires binary stream, not PULL_FROM_URL
3. **Custom instance support** — No column for self-hosted Mastodon/Bluesky instance URLs
4. **Per-provider error code registry** — Postiz has 77+ TikTok errors, 31+ Instagram errors catalogued
5. **Concurrent job semaphore** — How Temporal fan-out respects per-provider `maxConcurrentJob` not specified (risk: 50 LinkedIn posts hitting simultaneously)

---

## 3. Billing & Subscriptions

### Fundamental Model Difference

| Aspect | Postiz | tx-agent-kit |
|--------|--------|-----------|
| **Model** | Pure seat-based subscription | Hybrid subscription + usage credits |
| **Tiers** | 5 (FREE→ULTIMATE, $0-$99/mo) | 3 (Try Me $30, Pro TBD, Agency TBD) |
| **Usage tracking** | Simple monthly counter | Financial ledger (decimillicents) |
| **Credit system** | Count-based (1 credit = 1 image) | Cost-based (actual provider cost + 10% markup) |
| **Atomicity** | NOT atomic (race condition risk) | Atomic (`SELECT FOR UPDATE`) |
| **Idempotency** | Implicit (webhook filtering) | Explicit (`processed_stripe_events` table) |
| **Trial** | 7-day on first subscription | None (hard card requirement) |
| **Grace period** | Not documented | 7 days on payment failure |
| **Storage billing** | Included in plan | Prepaid with per-GB overage ($0.10/GB, 85% margin) |
| **Auto-recharge** | N/A | Yes (Pro/Agency, configurable threshold) |
| **Campaign budgets** | No | Yes (two-level cap) |

### Postiz Credit Race Condition (Bug)

```typescript
// Postiz: create → execute → delete on failure — NOT atomic
async useCredit<T>(org, type, func) {
  const data = await credits.create({ organizationId: org.id, credits: 1, type });
  try { return await func(); }
  catch (err) { await credits.delete({ where: { id: data.id } }); throw err; }
}
```

Two concurrent calls can both pass the credit check. tx-agent-kit's reserve-finalize pattern solves this.

### tx-agent-kit Advantages Over Postiz

1. **Immutable ledger** — compliance audit trail
2. **Two-phase reserve/finalize** — prevents double-charging
3. **Explicit grace period** — 7 days with ops suspended, then hard-delete media
4. **Campaign-level budgets** — not just org-level
5. **Storage cost recovery** — Postiz absorbs storage cost entirely

### Stripe Webhook Handling

| Aspect | Postiz | tx-agent-kit |
|--------|--------|-----------|
| Deduplication | None (relies on Stripe) | `processed_stripe_events` table |
| Card validation | $1 auth-only charge on signup | — |
| Proration | `invoices.createPreview()` | — |
| Chargeback | `PayoutProblems` table | Freeze credits, handle dispute lifecycle |

---

## 4. Scheduling & Publishing

### Data Model: Flat vs Separated

| Aspect | Postiz | tx-agent-kit |
|--------|--------|-----------|
| **Structure** | Single `Post` table + `Integration` | Separated: `team_content_items` → `assets` → `scheduled_posts` |
| **Status** | 4 states: `QUEUE`, `PUBLISHED`, `ERROR`, `DRAFT` | 8+ states per entity (content item, asset, post) |
| **Grouping** | `group` string field (cross-platform batch) | `campaigns` table with budgets + A/B testing |
| **Threading** | `parentPostId` self-ref + `delay` (minutes) | `parent_post_id` + `delay_minutes` + `comment_of_post_id` |
| **Media** | Flat `image` JSON string | Separate `assets` table with version chains |
| **Platform settings** | `settings` JSON string | Per-platform constraint registry + validation phase |

### Scheduling Mechanism

**Postiz:** Temporal workflow sleeps until `publishDate`:
```typescript
await sleep(dayjs(post.publishDate).diff(dayjs(), 'millisecond'));
```
- Hourly `missingPostWorkflow` scans for posts 2-3 hours past due with `state = 'QUEUE'`
- Retry: 5 iterations in-workflow, 3 max activity attempts, 2-min exponential backoff

**tx-agent-kit:** Temporal nightly batch workflow + hourly watchdog:
- `nightly_batch_{YYYY-MM-DD}` with `USE_EXISTING` conflict policy
- Missed-schedule recovery every 30 min for posts stuck in `publishing`
- Error categories: `transient` (retry), `permanent` (stop), `auth` (user intervention)

### Recurring/Evergreen Content

**Postiz:** `intervalInDays` field with absolute millisecond math — **will drift across DST transitions**

**tx-agent-kit:** `recurrence_interval_days` + IANA `timezone` field — DST-aware by design (implementation TBD)

### Auto-Posting / RSS Feeds

**Postiz has this; tx-agent-kit does not:**
- `AutoPost` model: RSS URL, sync settings, AI content generation flag, integration targets
- Temporal workflow polls every 1 hour via `while(true) { autoPost(id); await sleep(3600000); }`

**tx-agent-kit:** Explicitly deferred (Section 19a). Could be implemented via agent-driven campaigns.

### Platform Validation — Major tx-agent-kit Advantage

**Postiz:** One asset per post, one post per integration. No auto-variants. Settings validated at post time, not schedule time. User must manually create separate posts for TikTok vs Instagram.

**tx-agent-kit:** `PLATFORM_VALIDATE` phase auto-generates platform-specific variants (different aspect ratios, codecs). Fails early with actionable feedback (e.g., "Duration 65s — TikTok requires <60s").

### Two-Gate Approval — tx-agent-kit Only

**Postiz:** Single gate: user schedules → published. No concept/render separation.

**tx-agent-kit:** Gate 1 (concept approval) → Gate 2 (render approval) → schedule. User sees cost + tool chain before expensive rendering. Edit feedback loops within agent threads.

### Timezone Handling

| Aspect | Postiz | tx-agent-kit |
|--------|--------|-----------|
| Storage | `timezone` INT (UTC offset) | `timezone` TEXT (IANA, e.g. `America/New_York`) |
| DST handling | None — absolute ms math | IANA timezone-aware (design intent) |
| Scheduling | All absolute timestamps via dayjs | `scheduled_at` (UTC) + `scheduled_at_local` (display) |

---

## 5. Analytics

### Fundamental Architecture Difference

| Aspect | Postiz | tx-agent-kit |
|--------|--------|-----------|
| **Collection** | On-demand (lazy, user-triggered) | Scheduled per-post workflow (proactive) |
| **Storage** | Redis cache only (ephemeral, 1hr TTL) | PostgreSQL tables + time-series snapshots |
| **Metrics** | Raw platform metrics only | Raw + 5 derived metrics |
| **Time-series** | None (single snapshot) | 10 snapshots per post (1h→30d) |
| **Error handling** | Silent (returns `[]`) | Recorded in snapshot row |
| **Audit trail** | None | Full (10 checkpoints + errors) |

### Metrics Collected

**Postiz** fetches raw platform metrics (views, likes, comments, shares) via API on user request. `percentageChange` is hardcoded to 0 or 5. No engagement rate, no scoring.

**tx-agent-kit** computes derived metrics:
- `engagement_rate` = (likes + comments + shares + saves) / impressions × 100
- `performance_score` = Z-score vs 90-day account average, mapped to 0-100
- `virality_score` = share_count / impression_count × 1000
- `quality_score` = Pre-publication AI evaluator score (frozen at publish)
- `bandit_reward` = log(1 + 1·likes + 2·comments + 3·shares)

### Collection Schedule (tx-agent-kit Only)

| Checkpoint | Hours Since Post | Rationale |
|---|---|---|
| 1-2 | 1h, 3h | Early signal / rising phase |
| 3-5 | 6h, 12h, 24h | **24h = canonical reward point for bandit** |
| 6-8 | 48h, 72h, 7d | Peak closing / long-tail |
| 9-10 | 14d, 30d | Decay monitoring |

**Staleness rules:** TikTok/Instagram Reels: 30d. LinkedIn/Twitter: 14d. YouTube: 90d. Viral exception: if engagement_rate at 7d > 2x account average → extend to 90d.

### Platform-Specific Analytics Quirks (from Postiz)

- **TikTok:** Requires `publish_id → video_id` translation before analytics fetch
- **Facebook:** Reactions and clicks return nested objects (by type), require aggregation
- **Instagram:** Requires Business account + Facebook Graph API
- **YouTube:** Uses YouTube Data API (not REST)

### Aggregate Views

**Postiz:** Basic card grid with line charts. No comparative analysis, no time-series trends, no export.

**tx-agent-kit:** Materialized weekly views per team/platform. Enables best posting times analysis, content performance ranking, viral detection, quality feedback loops (quality_score vs engagement_rate correlation).

---

## 6. Media & Assets

### Upload Flow

| Aspect | Postiz | tx-agent-kit |
|--------|--------|-----------|
| **Method** | Backend relay (Express Multer) + optional multipart | Presigned URLs (direct browser → R2) |
| **Validation** | API layer only (mimetype check) | R2 layer (content-length-range) + post-upload HeadObject |
| **Size limits** | Images: 10 MB, Videos: 1 GB | Images: 10 MB, Videos: 200 MB (recommended) |
| **Deduplication** | None | SHA-256 content hash, unique per team |
| **Path layout** | Flat random filenames at bucket root | `{team_id}/{uuid}_{original_filename}` |

### Metadata Richness

**Postiz `Media` table:** `id`, `name`, `path`, `organizationId`, `fileSize` (defaults to 0!), `type`, `thumbnail`, `alt`

**tx-agent-kit `team_media_assets` table:** All of the above PLUS: `ai_title`, `ai_description`, `ai_tags[]`, `vector_embedding` (3072-dim), `content_category`, `emotion` (JSONB), `purpose[]`, `processing_status`, `content_hash`, `embedding_model`, `shared_with_org`

### Processing Pipeline

**Postiz:** No compression, no transcoding, no thumbnail generation, no embeddings. Images uploaded as-is.

**tx-agent-kit:** WebP conversion (40-60% savings), H.265 video transcoding (35-40% savings), automatic thumbnail generation (400x400 WebP), Google multimodal embeddings for semantic search.

### Search

**Postiz:** Pagination only (`getMedia(org, page)`, 18 items, `createdAt DESC`)

**tx-agent-kit:** Full-text (PostgreSQL), semantic (pgvector IVFFlat), filtered (B-tree on `team_id, is_deleted`)

### Video Generation

| Provider | Postiz | tx-agent-kit |
|----------|--------|-----------|
| **Slideshows** | FAL + ElevenLabs + Transloadit (sync) | Remotion (self-hosted, headless Chrome) |
| **AI Video** | KIE AI (Veo3) — blocking poll loop | fal.ai (Veo3) — async Temporal workflow |
| **Avatar Video** | HeyGen — blocking poll loop | Not planned |
| **Processing** | Synchronous (timeout risk) | Asynchronous (Temporal) |
| **Cost tracking** | Generic credit deduction | Per-operation cost in credit_ledger |

### Storage Governance

| Aspect | Postiz | tx-agent-kit |
|--------|--------|-----------|
| **Soft delete** | `deletedAt` timestamp | `is_deleted` + `deleted_at` |
| **Hard delete** | **Commented out** (never runs) | Scheduled Retention Cleaner (1-2 day grace) |
| **Cost metering** | None (`fileSize` defaults to 0) | Per-org daily tracking, immutable ledger |
| **Retention policy** | None (unbounded growth) | Configurable per plan |
| **GDPR delete** | Not implemented | Immediate hard-delete on org deletion |
| **Cross-team sharing** | N/A (org-level only) | `shared_with_org` flag |

---

## 7. Team / Org / Agency Model

### Hierarchy

**Postiz:** Flat — single `Organization` level. All resources scoped to `organizationId` only.

**tx-agent-kit:** Hierarchical — `Organization → Team → User`. Resources scoped to both `organization_id` AND `team_id`. Team-level authorization middleware rejects org members who aren't team members.

### Roles & Permissions

| Aspect | Postiz | tx-agent-kit |
|--------|--------|-----------|
| **Role model** | 3-tier enum: `SUPERADMIN`, `ADMIN`, `USER` | Custom RBAC: `roles` + `permissions` + `role_permissions` tables |
| **Permission enforcement** | Subscription-tier gated (CASL) | Granular actions (`create_media`, `schedule_posts`, `manage_billing`) |
| **Custom roles** | Not supported | Supported (non-system roles) |

### Member Deactivation

**Postiz:** Boolean `disabled` flag — no timestamp, no audit trail of when/by whom.

**tx-agent-kit:** `disabled_at` TIMESTAMPTZ — preserves audit trail, allows temporary blocking while maintaining data attribution.

### Invitations

**Postiz:** JWT token with 1-hour expiry. No revocation tracking. DTO: `{ email, role, sendEmail }`.

**tx-agent-kit:** Token-based with `revoked_at`, `revoked_by_user_id`, and `team_id` for direct-to-team invites. Full revocation audit trail.

### Client/Agency Model

**Postiz:** `Customer` table (metadata only). `SocialMediaAgency` for public agency profiles. No client accounts — just metadata.

**tx-agent-kit:** Two-tier: (1) Internal clients as org members with `membership_type: 'client'`, (2) External clients via stateless `content_review_tokens` (signed URLs, no account required, permission-scoped: view/comment/approve/reject).

### Ownership Guards

**Postiz:** First user = `SUPERADMIN`. No explicit ownership transfer. No last-admin guard.

**tx-agent-kit:** `organizations.owner_user_id` FK. Ownership transfer requires current owner's confirmation. Owner cannot be removed without transfer. Last-admin guard prevents demoting the only remaining admin.

### Data Isolation

**Both:** API-level authorization (no RLS). **tx-agent-kit adds:** Team-level middleware that prevents org-members from accessing arbitrary teams via `team_id` parameter.

---

## 8. Notifications, Comments & Collaboration

### Notification System

| Aspect | Postiz | tx-agent-kit |
|--------|--------|-----------|
| **In-app** | Full: badge count, paginated list, unread tracking | Not yet built |
| **Email** | Pluggable providers (Resend/NodeMailer), templates, retry logic | Planned |
| **Digest** | Temporal workflow batches hourly | Not yet specified |
| **User prefs** | `sendSuccessEmails`, `sendFailureEmails`, `sendStreakEmails` | Not yet defined |
| **Notification types** | `success`, `fail`, `info` | Event types exist but routing undefined |

### Real-Time Updates

**Postiz:** HTTP polling (SWR stale-while-revalidate). No WebSocket/SSE.

**tx-agent-kit:** Server-Sent Events (SSE) for pipeline progress. Event types: `phase_started`, `phase_completed`, `tool_call`, `tool_result`, `evaluator`, `awaiting_approval`, `error`, `suspended`, `completed`. Temporal heartbeats → API polling → SSE stream.

### AI Chat

**Postiz has a complete AI chat system (Mastra framework, GPT-5.2):**
- 8 built-in tools: list integrations, validate platform rules, schedule posts, generate videos/images
- Persistent thread history with working memory
- Agent understands platform-specific posting rules

**tx-agent-kit:** Workflow-based agents (Temporal), no interactive chat UI documented.

### Content Approval

**Postiz:** No dedicated approval workflow. Basic internal comments on posts (nested threads, edit/delete).

**tx-agent-kit:** Two-gate approval pipeline + stateless client review via signed URLs. `content_approvals` table tracks gate number, outcome, rejection reason, edit iteration. External clients can approve/reject without accounts.

### Webhooks

**Postiz:** Basic: `Webhooks` table + `IntegrationsWebhooks` junction. Simple HTTP POST to configured URL. No delivery guarantees.

**tx-agent-kit:** Transactional outbox pattern (planned, not yet built). Will support event filtering and guaranteed delivery.

### Email System

**Postiz (production-ready):**
- Pluggable provider abstraction (Resend, NodeMailer, empty stub)
- 3-retry with 700ms backoff
- HTML templates with gradient backgrounds
- Temporal digest workflow (hourly batching)
- Preference-based routing (success/failure/info types)

**tx-agent-kit:** Not yet implemented.

---

## 9. Consolidated Gap Summary

### Critical Gaps (Design Required Before Launch)

| # | Gap | Source | Impact |
|---|-----|--------|--------|
| 1 | **Async job polling for Instagram/YouTube** — media creation requires status polling (30s intervals) before publish completes | Social | Publishing will fail without it |
| 2 | **Per-provider error code registry** — Postiz catalogues 77+ TikTok, 31+ Instagram, 31+ Facebook error codes | Social | Generic error handling misses platform-specific issues (spam detection, content policy, rate limits) |
| 3 | **Concurrent job semaphore** — how Temporal fan-out respects per-provider `maxConcurrentJob` | Social | Risk of 50 LinkedIn posts hitting simultaneously (LinkedIn limit = 2 concurrent) |
| 4 | **`client_id` FK on `social_accounts`** — agencies need to track which client owns which social account | Schema | Multi-client agency workflow broken |
| 5 | **Short link table** — `use_short_link` referenced on `scheduled_posts` but no `short_links` table | Schema | Can't track shortened URLs or clicks |
| 6 | **Template library schema** — `template_id` FK exists on `assets` but no `templates` table defined | Schema | Can't manage Remotion/content templates |
| 7 | **Email/notification system** — Postiz has complete email (Resend/NodeMailer), digest batching, in-app notifications; tx-agent-kit has none yet | Notifications | Users won't know about publish success/failure, approval requests |

### Medium Gaps (Should Address)

| # | Gap | Source | Impact |
|---|-----|--------|--------|
| 8 | **Video upload streaming for YouTube** — requires binary stream, not PULL_FROM_URL | Social | YouTube publishing broken |
| 9 | **Character limit variance** by account type (X Premium=4000, Free=200) | Social | Wrong content validation |
| 10 | **Custom instance URLs** for self-hosted Mastodon/Bluesky | Social | Can't connect decentralized platforms |
| 11 | **User preferences store** (key-value or JSONB) — Postiz has `ItemUser` table | Schema | No way to persist UI prefs, notification settings |
| 12 | **Third-party integration credentials** table — Postiz has `ThirdParty` model for Apify etc. | Schema | No storage for external service credentials |
| 13 | **Retry policy specification** — Postiz uses 5 retries, 2-min exponential backoff; tx-agent-kit says "TBD" | Scheduling | Undefined retry behavior for failed publishes |
| 14 | **Token refresh pre-batch strategy** — mentioned as "pre-batch sweep 30min before window" but not detailed | Scheduling | Could fail mid-publish if tokens expire |
| 15 | **TikTok publish_id → video_id translation** — required before analytics fetch | Analytics | TikTok analytics will fail without ID mapping |

### tx-agent-kit Strengths Over Postiz

| Area | tx-agent-kit Advantage |
|------|-------------------|
| **Data model** | Separated content → asset → post (vs Postiz's flat `Post`) enables version chains, A/B testing |
| **Approval workflow** | Two-gate (concept + render) + stateless client review tokens |
| **Billing** | Immutable credit ledger, atomic reserves, campaign-level budgets |
| **Analytics** | Time-series snapshots (10 per post), derived metrics, bandit optimization |
| **Media processing** | WebP/H.265 compression (40-60% savings), AI embeddings, semantic search |
| **Storage governance** | Hard-delete cleanup, GDPR compliance, cost metering per org |
| **Platform validation** | Auto-generates platform-specific variants, fails early with actionable feedback |
| **Authorization** | Team-level middleware, RBAC with granular permissions, ownership guards |
| **Timezone handling** | IANA timezone strings (DST-aware) vs Postiz's UTC offset INT |
| **Real-time updates** | SSE for pipeline progress vs Postiz's HTTP polling |

### Intentional Exclusions (Not Gaps)

| Feature | Postiz Has | tx-agent-kit Decision |
|---------|-----------|-------------------|
| Marketplace (Orders, Payouts) | Yes | Explicitly excluded — no buyer/seller model |
| Agency profiles/directory | Yes | Not planned for v1 |
| AI chat UI (Mastra, 8 tools) | Yes | Workflow-based agents (Temporal) instead |
| Email signatures | Yes | Out of scope |
| GitHub integration | Yes | Not a social platform |
| Promo code tracking | Yes | Offloaded to Stripe |
| RSS auto-posting | Yes | Deferred (Section 19a) |
| Trend scraping / `PopularPosts` | Yes | Deferred (Section 11) — AI IDEATE replaces |
| Multi-approver workflows | Yes | Deferred — v1 single approver |
| Post-publish automation plugs | Yes | Deferred |
| HeyGen avatar video | Yes | Not planned (focus on Veo3 + Remotion) |

### Lessons from Postiz Bugs & Patterns

1. **Credit race condition** — Postiz's non-atomic `create → execute → delete` pattern is unsafe. Two concurrent calls can both pass credit check. tx-agent-kit's `SELECT FOR UPDATE` reserve-finalize is correct.
2. **No webhook idempotency** — Postiz has no dedup; duplicate Stripe webhooks can create duplicate subscriptions. tx-agent-kit's `processed_stripe_events` table is correct.
3. **`fileSize` defaults to 0** — Postiz never actually sets file size on upload, making billing/metering impossible. tx-agent-kit must always set this via HeadObject verification.
4. **Hard delete commented out** — Postiz's `DeleteObjectCommand` is commented out, leading to unbounded R2 storage growth. tx-agent-kit's Retention Cleaner is essential.
5. **DST drift** — Postiz's `intervalInDays` uses absolute millisecond math. Recurring daily posts drift by 1 hour on DST transitions. tx-agent-kit's IANA timezone approach avoids this.
6. **Blocking video polling** — Postiz uses `while(true)` loops with 3-10s intervals for HeyGen/Veo3 generation. This blocks the request handler and risks timeouts. tx-agent-kit's Temporal workflows are correct.
7. **Analytics silently fail** — Postiz returns `[]` on API errors with no logging. tx-agent-kit records `collection_error` in snapshot rows.
8. **No graceful degradation** — If a platform capability is disabled (e.g., TikTok public posting while unverified), Postiz shows no user-facing warning. tx-agent-kit's App Capabilities table addresses this.
9. **LinkedIn PDF workaround** — Postiz converts carousel images to PDF for LinkedIn (required by API). tx-agent-kit should handle this in the provider layer.
