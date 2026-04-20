# tx-agent-kit System Design Audit — Consolidated Report

> **Date:** 2026-03-25
> **Method:** 14 specialized agents analyzed Postiz production code (`.vendor/postiz-app/`) against `specs/system-design.md`
> **Total findings:** 166 across 14 domains | **33 CRITICAL** | **74 HIGH** | **58 MEDIUM** | **1 LOW**

---

## Executive Summary

The system design is ambitious and well-structured, but has **three systemic problems** that cut across every subsystem:

1. **Ghost tables** — `campaigns`, `creative_concepts`, and `content_approvals` are referenced dozens of times but never defined with columns
2. **No concurrency guards** — The credit reservation, campaign budgets, and storage counters all use read-then-write patterns with no locking
3. **Cascade deletes destroy audit trails** — `credit_ledger` and `usage_records` have `ON DELETE CASCADE` despite being described as "immutable"

---

## Part 1: Tables Referenced But Never Defined

These are the highest-priority gaps — they block implementation of entire subsystems.

| Ghost Table | Referenced In | Times Referenced | Impact |
|---|---|---|---|
| **`campaigns`** | Sections 5.5, 5.6, 9.6, entity hierarchy, enums, API routes | 12+ locations | Blocks all campaign automation |
| **`creative_concepts`** | Section 4.2 diagram, entity hierarchy, enums, cascade tree | 6+ locations | Blocks content pipeline upstream |
| **`content_approvals`** | Section 4.2 ("Gate 2 maps to assets.status + content_approvals") | 3+ locations | Blocks Gate 2 approval implementation |

### Recommended: `campaigns` table (minimum viable)

```sql
campaigns (
  id, team_id, name, status ENUM(active/paused/archived),
  approval_mode ENUM(auto/approval_required/hybrid),
  content_types TEXT[], posts_per_day INTEGER,
  cadence_windows JSONB, start_date DATE, end_date DATE,
  monthly_budget BIGINT, paused_at TIMESTAMPTZ, pause_reason TEXT,
  created_at, updated_at
)
campaign_social_accounts (campaign_id, social_account_id)  -- target accounts
campaign_budget_periods (id, campaign_id, period_start, period_end, credits_used)
```

### Recommended: `creative_concepts` table

```sql
creative_concepts (
  id, team_id, campaign_id(nullable), title, description,
  source ENUM(ai_generated/user_input/trend_analysis),
  status ENUM(pending/approved/rejected/archived),
  content_type ENUM, brief JSONB, thread_id(nullable),
  created_by(nullable), created_at, updated_at
)
```

### Recommended: `content_approvals` table

```sql
content_approvals (
  id, content_item_id, asset_id, gate_number SMALLINT CHECK(1 or 2),
  outcome ENUM(approved/rejected/auto_approved),
  approver_user_id(nullable), rejection_reason TEXT,
  edit_iteration SMALLINT, created_at
)
```

---

## Part 2: CRITICAL Findings (31 total — grouped by theme)

### Financial Data Integrity (5 CRITICAL)

| # | Finding | Domain | Fix |
|---|---------|--------|-----|
| 1 | **Credit balance TOCTOU race** — `checkUsageCaps` pseudocode reads balance then reserves in separate steps. Two concurrent ops can double-spend. | Concurrency | Atomic `UPDATE ... WHERE (balance - reserved) >= cost RETURNING *` or `SELECT FOR UPDATE` |
| 2 | **Campaign budget race** — Same TOCTOU on `campaigns.monthly_credits_usage_consumed` during parallel nightly batch fan-out | Concurrency | Same atomic pattern; batch workflow needs `workflowIdConflictPolicy: USE_EXISTING` |
| 3 | **`credit_ledger` CASCADE DELETE** — Schema has `onDelete: cascade` on `organizationId` despite doc saying "immutable audit trail" | GDPR | Change to `onDelete: set null`; archive before org hard-delete; retain 7 years for tax |
| 4 | **Auto-recharge failure leaves assets permanently suspended** — No Temporal signal to wake suspended workflows when credits are added | Billing | Define `creditAdded` Temporal signal; add max suspension TTL (7 days) |
| 5 | **Subscription downgrade mid-cycle with storage over new limit** — No enforcement of new hard ceiling on downgrade | Billing | Pre-downgrade impact calculator; immediate `plan_storage_limit` update |

### Data Model Completeness (8 CRITICAL)

| # | Finding | Domain | Fix |
|---|---------|--------|-----|
| 6 | **No social_account FK on `scheduled_posts`** — Cannot identify which platform account to publish to | Scheduling | Add `social_account_id UUID NOT NULL` |
| 7 | **No cross-platform post grouping** — "Post to TikTok + Instagram simultaneously" has no data model | Scheduling | Add `publication_group_id UUID NOT NULL` |
| 8 | **`content_approvals` table referenced but never defined** | Content | Define full schema (see Part 1) |
| 9 | **`post_performance` has no structural columns** — Only metric columns listed; no id, post_id, platform, collected_at | Analytics | Define complete table with all FKs and indexes |
| 10 | **No `clients` table** — Agency client identity has no schema anchor | Agency | Add `clients` table + `social_accounts.client_id` FK now |
| 11 | **No content submission/client approval workflow** — Agency→client approval is separate from AI pipeline gates | Agency | Add `content_submissions` table |
| 12 | **Token ownership undefined** — Magic-link flow has no `access_granted_via` tracking | Agency | Add `access_granted_via`, `token_revoked_at` to `social_accounts` |

### GDPR & Compliance (4 CRITICAL)

| # | Finding | Domain | Fix |
|---|---------|--------|-----|
| 13 | **No GDPR Article 20 (right to portability)** — No data export endpoint exists in design | GDPR | Add `POST /api/gdpr/export-request` endpoint spec |
| 14 | **`agent_threads`/`agent_messages` not in GDPR purge scope** — Contains user prompts (personal data) | GDPR | Add to purge checklist; define 90-day retention |
| 15 | **R2 deletion ordering problem** — If DB rows deleted first via CASCADE, R2 paths are lost = orphaned blobs | GDPR | Two-phase: collect paths → delete R2 → delete DB rows |

### Security (3 CRITICAL)

| # | Finding | Domain | Fix |
|---|---------|--------|-----|
| 16 | **No webhook HMAC signature** — Any party can forge webhook payloads | Webhooks | Add `signing_secret` column; send `X-tx-agent-kit-Signature` header |
| 17 | **No webhook delivery log** — Zero delivery observability | Webhooks | Add `webhook_deliveries` table |
| 18 | **No webhook retry/dead-letter** — Fire-and-forget; events permanently lost on endpoint failure | Webhooks | Exponential backoff (30s→5m→30m→2h→24h); auto-disable after 100 consecutive failures |

### OAuth Integration (1 CRITICAL)

| # | Finding | Domain | Fix |
|---|---------|--------|-----|
| 19 | **No multi-step OAuth state** — Meta requires page selection after initial auth; no `in_between_steps` flag | OAuth | Add `in_between_steps BOOLEAN` to `social_accounts`; gate scheduler |

### Other (2 CRITICAL)

| # | Finding | Domain | Fix |
|---|---------|--------|-----|
| 20 | **Presigned URL size is unenforceable** — User declares 5MB, uploads 200MB | Media | Use POST policy with `content-length-range` condition |
| 21 | **Collection schedule for analytics completely undefined** — No snapshot intervals specified | Analytics | Define decay schedule: 1h, 3h, 6h, 12h, 24h, 48h, 72h, 7d, 14d, 30d |

---

## Part 3: HIGH Findings — Top 30 (of 67)

### Scheduling & Publishing

| Finding | Fix |
|---------|-----|
| No recurring/evergreen post support (Postiz has `intervalInDays`) | Add `recurrence_interval_days` to `scheduled_posts` |
| No thread delay model for Twitter/LinkedIn threads | Add `parent_post_id` self-ref + `delay_minutes` to `scheduled_posts` |
| Partial success undefined (TikTok published, Instagram failed) | One `scheduled_posts` row per platform; group via `publication_group_id` |
| No watchdog for stuck posts + no token refresh retry in publisher | Hourly compensation workflow scanning for stuck `publishing` posts |
| Editing content while asset is `processing` — race condition | Add `edit_version INTEGER` to assets; optimistic lock on transitions |
| Scheduled posts orphaned when parent content is rejected/archived | Cancel Temporal workflows on parent state change |

### OAuth & Social

| Finding | Fix |
|---------|-----|
| No per-account posting time slots | Add `posting_schedule JSONB` to `social_accounts` |
| No soft-disable without deletion | Add `disabled BOOLEAN`, `deleted_at`, `refresh_needed` to `social_accounts` |
| No parent-child account hierarchy (Meta Business Manager) | Add `root_provider_account_id` + `parent_social_account_id` |
| Token refresh failure has no actionable gate state | Add `refresh_needed BOOLEAN` to `social_accounts`; fire notification |
| No scope tracking/enforcement on re-auth | Add `granted_scopes TEXT[]`; validate against `requiredScopes` per provider |
| No agency/customer-linked account model | Add `client_id` FK to `social_accounts` (nullable) |

### RBAC & Tenancy

| Finding | Fix |
|---------|-----|
| Client members have no defined access path to team resources | Define whether clients need `team_members` rows or use review tokens |
| Team removal doesn't restrict org-level data visibility | Add `TeamAuthMiddleware` that validates `team_members` row |
| CASCADE delete on teams destroys financial audit trails | Replace with soft-delete; archive ledger entries before hard-delete |
| No last-admin guard | Add `is_owner BOOLEAN` with partial unique index; enforce in code |
| Invitation revocation unspecified | Add `revokedAt`, `teamId` to invitations |
| Organization ownership transfer missing | Add `owner_user_id` to organizations; transfer endpoint |
| Custom roles have no privilege escalation safeguards | Add `is_system BOOLEAN` to roles; cap at actor's own permissions |

### Billing

| Finding | Fix |
|---------|-----|
| Yearly billing entirely absent | Add section covering credit cadence, proration, refund formula |
| Stripe webhook idempotency — duplicate events double-charge | Add `processed_stripe_events` dedup table |
| Chargeback handling missing | Add `charge.dispute.created` webhook handler; freeze credits |
| Billing period transition race at midnight | Use TIMESTAMPTZ; create new period row before old expires |

### Campaigns

| Finding | Fix |
|---------|-----|
| Campaign budget reset mechanism missing | Use `campaign_budget_periods` table (same pattern as `monthly_credits_usage`) |
| No campaign frequency/schedule expression | Add `cadence_windows JSONB` + `posts_per_cadence_period` |
| No catch-up for missed nightly batch | Compensation workflow scanning for missed windows |
| No RSS/feed-based auto-posting | Add `feed_sources` table (url, poll_interval, target_campaign_id) |
| Budget reservation race in parallel fan-out | Atomic `SELECT FOR UPDATE` wrapping check + reserve |

---

## Part 4: Missing Tables Summary

Tables that need to be added to the Drizzle schema:

| Table | Priority | Subsystem |
|-------|----------|-----------|
| `campaigns` | P0 — blocks subsystem 15 | Workflows |
| `campaign_social_accounts` | P0 | Workflows |
| `campaign_budget_periods` | P0 | Billing × Workflows |
| `creative_concepts` | P0 — blocks content pipeline | Content |
| `content_approvals` | P0 — blocks Gate 2 | Content |
| `clients` | P1 — lay foundation now | Agency |
| `content_submissions` | P1 | Agency |
| `client_onboarding_invitations` | P1 | Agency |
| `client_onboarding_platform_status` | P1 | Agency |
| `agency_brand_configs` | P1 | Agency |
| `templates` | P1 — blocks SEARCH_TEMPLATES phase | Content |
| `content_presets` (hashtag sets, snippets) | P2 | Content |
| `content_signatures` | P2 | Content |
| `webhook_deliveries` | P1 | Webhooks |
| `publishing_errors` | P1 | Publishing |
| `post_publish_errors` | P1 | Publishing |
| `notification_preferences` | P1 | Notifications |
| `notification_reads` | P2 | Notifications |
| `audit_events` | P1 | Compliance |
| `deletion_events` | P1 | GDPR |
| `legal_holds` | P2 | GDPR |
| `processed_stripe_events` | P1 | Billing |
| `pending_uploads` | P1 | Media |
| `feed_sources` | P2 | Campaigns |
| `post_automations` | P2 | Publishing |

---

## Part 5: Missing Columns on Existing Tables

| Table | Column(s) to Add | Why |
|-------|-------------------|-----|
| `scheduled_posts` | `social_account_id`, `publication_group_id`, `parent_post_id`, `delay_minutes`, `platform_settings JSONB`, `error_code`, `error_message`, `retry_count`, `recurrence_interval_days`, `asset_id`, `comment_of_post_id`, `use_short_link`, `hard_deadline BOOLEAN` | Scheduling completeness |
| `social_accounts` | `in_between_steps`, `posting_schedule JSONB`, `disabled`, `deleted_at`, `refresh_needed`, `root_provider_account_id`, `parent_social_account_id`, `client_id`, `granted_scopes TEXT[]`, `access_granted_via`, `token_revoked_at`, `additional_settings JSONB`, `custom_instance_details JSONB` | OAuth completeness |
| `organizations` | `owner_user_id`, `is_lifetime_deal`, `max_clients`, `payment_grace_period_ends_at`, `link_shortening_preference` | Billing + agency |
| `assets` | `edit_version INTEGER`, `gate_expires_at`, `template_id`, `template_version`, `position INTEGER`, `storage_path`, `file_size` | Content pipeline |
| `team_media_assets` | `content_hash`, `processing_status ENUM`, `processing_error`, `embedding_generated_at`, `embedding_model`, `hard_deleted_at` | Media management |
| `org_members` / `team_members` | `disabled_at TIMESTAMPTZ` | Deactivation without deletion |
| `invitations` | `revoked_at`, `revoked_by_user_id`, `team_id` | Invitation lifecycle |
| `roles` | `is_system BOOLEAN` | Prevent deletion of seed roles |
| `users` | `anonymised_at TIMESTAMPTZ` | GDPR user-level erasure |
| `credit_ledger` | `stripe_event_id UNIQUE`, `stripe_refund_id UNIQUE`, `client_id` | Dedup + agency attribution |
| `post_performance` | All structural columns (id, scheduled_post_id, social_account_id, platform, org_id, collection_status, media_type, platform_extended_metrics JSONB) | Currently only has metric columns |
| `teams` | `timezone TEXT DEFAULT 'UTC'` | Scheduling timezone support |

---

## Part 6: Concurrency Patterns Required

Every mutable counter/balance in the system needs atomic guards:

| Counter | Pattern | SQL Idiom |
|---------|---------|-----------|
| `organizations.credits_balance` / `reserved_credits` | `SELECT FOR UPDATE` wrapping check + reserve | Single transaction per tool call |
| `campaigns.monthly_credits_usage_consumed` | Replace with `campaign_budget_periods` table (append-only) | Atomic `credits_used += delta` |
| `storage_usage.current_bytes` | `SELECT FOR UPDATE` at presigned URL generation | Reserve before URL issued |
| `monthly_credits_usage.credits_used` | Atomic increment | `UPDATE SET credits_used = credits_used + $delta` |
| `assets.status` | Conditional state transition | `UPDATE ... WHERE status = $expected RETURNING id` |
| OAuth token refresh | Temporal workflow serialization | `workflowId: token_refresh_${id}`, `TERMINATE_EXISTING` |
| Nightly batch | Deterministic workflow ID | `workflowId: nightly_batch_${date}`, `USE_EXISTING` |

---

## Part 7: GDPR Purge Scope (Complete)

The design currently lists: R2 blobs, Temporal workflow history, Stripe customer records. **Missing from scope:**

- `agent_threads` / `agent_messages` (contains user prompts — personal data)
- `agent_messages.attachments` R2 URLs (must be collected before DB delete)
- pgvector embeddings (derived from user content)
- `post_performance_snapshots` (linked to identifiable accounts)
- `subscription_events.payload` JSONB (contains Stripe PII)
- Data sent to external AI providers (document DPAs; call deletion APIs where available)
- `credit_ledger` / `usage_records` (financial records — retain anonymised for 7 years)

**Purge ordering (non-negotiable):**
1. Mark org `purge_in_progress`
2. Terminate all running Temporal workflows for org
3. Collect all R2 paths from DB into `pending_purge_objects`
4. Delete R2 objects in batches
5. Hard-delete DB rows (CASCADE fires)
6. Clean up `pending_purge_objects`

---

## Part 8: Design Document Contradictions

| Location | Contradiction | Resolution Needed |
|----------|---------------|-------------------|
| §9.4 says 10% markup / use-case 4.9 says 5% markup | Two different documents disagree on the profit margin | Pick one; update both |
| §9.3 says `credit_ledger` is "immutable" / schema has `ON DELETE CASCADE` | DDL contradicts design intent | Change to `ON DELETE SET NULL`; archive before purge |
| §9.6 says `campaigns.monthly_credits_usage_consumed` "resets each period" / no reset mechanism exists | No cron, no trigger, no workflow defined | Use `campaign_budget_periods` table instead (same as org-level pattern) |
| `plan_tier` on `monthly_credits_usage` described as "always reads live value, not a snapshot" / column exists labeled "snapshot" | Contradictory snapshot semantics | Clarify: snapshot for reporting, live value for enforcement |

---

## Part 9: Platform Provider & Publishing Gaps (15 findings)

From the Platforms agent — the last to complete.

### CRITICAL (2)

| # | Finding | Fix |
|---|---------|-----|
| 1 | **`scheduled_posts` has no `platform_settings` column** — TikTok privacy/duet/stitch, Instagram post_type, YouTube title/tags, LinkedIn carousel mode have nowhere to be stored as input | Add `platform_settings JSONB` to `scheduled_posts`; validate via discriminated union |
| 2 | **`social_accounts` missing sub-type, root-account, additional-settings columns** — Cannot distinguish Instagram Business vs Creator, no parent token for Meta hierarchy, no per-account provider config | Add `account_sub_type`, `root_account_id`, `additional_settings JSONB`, `refresh_needed`, `profile_handle` |

### HIGH (7)

| # | Finding | Fix |
|---|---------|-----|
| 3 | **`PLATFORM_VALIDATE` has no validation rules registry** — Constraints (max duration, aspect ratio, codec, character limit) are nowhere | Define `PlatformConstraints` registry in `packages/contracts` keyed by provider + sub-type |
| 4 | **Instagram multi-step OAuth unmodeled** — 5-step flow (Facebook OAuth → long-lived token → page enum → IG account selection → page token) | Add `oauth_pending_selections` table or `setup_state JSONB` on `social_accounts` |
| 5 | **`maxLength()` must be context-dependent** — X Premium = 4000 chars, free = 200; Mastodon varies per instance | Per-field limits in `PlatformConstraints`; `characterLimitRequiresAccountQuery` flag |
| 6 | **Cross-platform publishing group has no data model** — Same finding as Scheduling agent | Add `group_id UUID` to `scheduled_posts` |
| 7 | **No `refresh_needed` permanent-failure flag** — Publisher retries indefinitely against broken tokens | Add `refresh_failed_at TIMESTAMPTZ` + `refresh_failure_reason TEXT` |
| 8 | **TikTok unverified app constraint has no pre-flight enforcement** — Users schedule public posts that silently become private | Add `app_capabilities` config table; `PLATFORM_VALIDATE` blocks invalid privacy settings |
| 9 | **YouTube requires binary file streaming, not PULL_FROM_URL** — Resumable upload, separate thumbnail API, quota units tracking | Document FILE_UPLOAD as first-class; add streaming pipeline; track YouTube quota units |

### MEDIUM (6)

| # | Finding | Fix |
|---|---------|-----|
| 10 | **LinkedIn carousel requires image-to-PDF conversion** — Not in rendering pipeline | Add `document` asset type; add `to_pdf` rendering tool |
| 11 | **Self-hosted platforms (Mastodon, Bluesky) have no model** | Add `custom_instance_url` to `social_accounts`; dynamic OAuth registration step |
| 12 | **Per-account `additionalSettings` missing** | Add `additional_settings JSONB` to `social_accounts` |
| 13 | **No API versioning/deprecation handling plan** | Add `api_version TEXT` to `social_accounts`; deprecation tracking in config |
| 14 | **Instagram Story 24h TTL not tracked** — Analytics collection fails on expired stories | Add `content_expires_at TIMESTAMPTZ` to `scheduled_posts` |
| 15 | **`maxConcurrentJob` throttling not modeled** — LinkedIn allows 2 concurrent, X allows 1 | Add concurrency config to `PlatformConstraints`; per-provider semaphore in batch |
