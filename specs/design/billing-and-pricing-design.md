---
kind: spec
spec_type: design
doc_id: doc-102b9eb3b547
name: billing-and-pricing-design
title: "Billing & Pricing"
status: active
version: 3
owners:
  - jamesaphoenix
summary: "Stripe integration, subscription plans, credit system, usage metering, storage billing, and cost controls for tx-agent-kit."
domain: billing-and-pricing
tags:
  - design
  - billing
  - pricing
  - credits
  - stripe
depends_on: [tenancy-model-design]
supersedes: []
implements: billing-and-pricing-prd
last_reviewed_at: 2026-04-17
---

# Summary

tx-agent-kit is an **infrastructure company**. The business model has two cleanly separated revenue
streams:

1. **Flat-rate monthly subscription** — covers platform access, storage, rate-limit headroom,
   and support tier. Nothing bundled. Unlimited members. Storage overage is prepaid from credits.
2. **Pay-as-you-go AI usage** — LLMs, video, voice, and image generation are passed through at
   cost + **10% markup**, funded by top-up credits the user explicitly purchases (or auto-recharge).

Subscriptions **do not include bundled AI credits**. Users see exactly what they pay for: a
platform fee for storage and infrastructure, plus a prepaid wallet for AI operations. The only
credits that arrive automatically are the one-time **welcome credit** on first successful
subscription charge.

All AI usage is prepaid from the credit wallet. No debt is ever possible. Credits **never expire**.
Stripe is the payment rail only — the `credit_ledger` is the single source of truth for all usage
tracking.

This spec covers subsystems **#3 Billing & Subscriptions** and **#4 Credit Service**.

# Architecture

## Revenue Model

1. **Monthly subscription plan (flat rate, storage-only)** — Try Me / Pro / Agency. Buys platform
   access, storage allocation, rate-limit ceilings, and support tier. Does not buy AI credits.
2. **Top-up credits (prepaid wallet)** — explicit one-time purchases and auto-recharge top-ups
   funded by the user. This is where all AI spend flows. Margin is 1.10x on provider cost.

The strategic bet: **honest, legible pricing wins technical buyers.** The subscription tells the
truth ("you're paying for storage and access") and the wallet tells the truth ("you're paying
for the AI you used"). No bundled credits means no arguments about rollover, no "did my plan
include that," no unexplained charges.

## Plans

| | Try Me | Pro | Agency |
|--|--------|-----|--------|
| **Price** | $19/mo | $49/mo | $199/mo |
| **Included AI credits** | **None** | **None** | **None** |
| **Welcome credit (one-time)** | $9 | $20 | $45 |
| **Storage allocation** | 10 GB | 100 GB | 500 GB |
| **Members** | **Unlimited** | **Unlimited** | **Unlimited** |
| **Rate limit tier** | Low | Mid | High |
| **Support** | Community | Email, 48h | Email, 24h + Slack |
| **Auto-recharge** | Available (user opt-in) | Available (user opt-in) | Available (user opt-in) |

Annual billing: 2 months free (16.7% discount), same welcome credit amounts, same storage tiers.

> **No seats. No bundled AI credits. No margin hard cap.** These three rules are locked in as
> invariants (`INV-BILLING-NO-SEAT-LIMITS`, `INV-BILLING-NO-BUNDLED-CREDITS`,
> `INV-BILLING-CREDITS-NEVER-EXPIRE`). They must not be re-introduced as plan differentiators.

### Welcome Credits

On the **first successful `invoice.payment_succeeded` Stripe webhook** for an organization,
the billing system grants a one-time welcome credit ledger entry:

| Plan | Welcome credit | Rationale |
|---|---|---|
| Try Me | $9 | Enough for real image/text experimentation |
| Pro | $20 | Finishes a mini-project (images + short video) |
| Agency | $45 | Funds a first client deliverable |

**Rules:**

- **One-time per organization lifetime.** Upgrades (Try Me → Pro → Agency) do not re-grant.
  Tracked via `organizations.welcome_credit_granted_at` (nullable timestamp).
- **Granted on first successful charge**, not on checkout session creation. Abandoned checkouts
  produce no grant.
- **Never expire.** Welcome credits are permanent until spent or admin-adjusted. Same invariant
  as all other credits (`INV-BILLING-CREDITS-NEVER-EXPIRE`).
- **Refund-forgiven.** If the subscription is refunded within the Stripe refund window, welcome
  credits are **not clawed back**. Welcome credits are marketing expense, not a refundable
  purchase. Refund handlers filter out entries where `reason = 'welcome_credit'` when computing
  clawback amounts.
- **Ledger entry type:** `adjustment` with `reason: 'welcome_credit'`. Emits a
  `billing.welcome_credit_granted` domain event (consumed by notifications for the welcome email).
- **Grant atomicity:** the webhook handler checks `welcome_credit_granted_at IS NULL`, writes
  the ledger entry, sets the timestamp, and emits the outbox event in a single DB transaction.

> **Implementation note (2026-04-16):** production Stripe `invoice.payment_succeeded`
> handling grants the plan-specific welcome credit exactly once per organization, guarded by
> `organizations.welcome_credit_granted_at` and committed atomically with the
> `billing.welcome_credit_granted` outbox event. The local-dev bootstrap remains available via
> `POST /v1/billing/{organizationId}/dev/complete-local`; it activates local billing, writes
> local `cus_local_*` / `sub_local_*` / `pm_local_*` identifiers, and grants one idempotent
> $20 local welcome-credit-equivalent row. It is disabled in staging/production.

> **Cancellation refund policy** — subscription fees themselves are non-refundable. Purchased
> top-up credits remaining on cancellation are refunded pro-rata via Stripe refund. Welcome
> credits are forgiven on refund (never clawed back). The refund handler excludes welcome credit
> entries from the clawback calculation.

## Stripe Integration: Pre-paid Wallet Model

Stripe is the **payment rail only** -- it processes charges but does not track usage. The
`credit_ledger` is the single source of truth for all usage tracking.

```
Stripe knows:                          credit_ledger knows:
+-- Subscription plan                  +-- Every AI operation
+-- Payment methods                    +-- Every credit deduction
+-- Charges (subscription +            +-- Balance history
|   auto-recharge)                     +-- Per-asset cost
+-- Refunds                            +-- Per-phase cost
                                       +-- Reserve/finalize state
```

**No dual-system sync needed.** Stripe and the credit ledger track different things. Stripe
handles money in, the ledger handles credits consumed. Reconciliation is a simple monthly
check: `SUM(stripe charges) == SUM(credit_ledger WHERE source = 'purchase' OR 'auto_recharge')`.

**No Stripe metered subscription items.** Checkout sessions attach only the fixed recurring
plan price. AI usage, storage overage, manual top-ups, and auto-recharge are all represented
as local immutable credit-ledger entries. The app must not require `STRIPE_*_METERED_PRICE_ID`
configuration for normal billing flows.

## Credit Flow

```
User signs up -> picks plan (Stripe Subscription)
    |
    v
Stripe charges plan price ($19/$49/$199) -> invoice.payment_succeeded webhook
    |
    v
Billing webhook handler (atomic, one tx):
    +-- Update organizations.is_subscribed, subscription_status, plan
    +-- If welcome_credit_granted_at IS NULL:
    |     +-- credit_ledger entry: { entryType: 'adjustment',
    |     |                          reason: 'welcome_credit',
    |     |                          amount: +$9/$20/$45 }
    |     +-- Set organizations.welcome_credit_granted_at = now()
    |     +-- Emit billing.welcome_credit_granted outbox event
    v
User wants to run an AI operation
    |
    v
Credit middleware checks:
    +-- credits_balance - reserved_credits >= estimated cost? -> reserve + proceed
    +-- no, auto-recharge enabled? -> Stripe PaymentIntent -> credits added -> proceed
    +-- no, no auto-recharge? -> 402, operation rejected with "top up credits" error
    |
    v
On completion: deduct actual cost x 1.10 margin from credits_balance
    |
    v
credit_ledger: { entryType: 'usage', amount: -X, assetId, phase, metadata }
```

Subscriptions never grant recurring AI credits. The only way credits land in the wallet is
(a) welcome credit on first charge, (b) explicit top-up via checkout, (c) auto-recharge
off-session PaymentIntent, or (d) admin adjustment.

## Auto-Recharge (Available on All Plans)

Auto-recharge is a user opt-in setting, not a plan feature. Any plan can enable it. Users set
a threshold (e.g. $10) and an amount (e.g. $50). When the available balance drops below the
threshold after a `finalize`, a `billing.credits_low_balance` event fires and the Temporal
worker executes an off-session Stripe PaymentIntent using the saved payment method.

Enabling auto-recharge requires both a threshold and an amount. Partial settings updates must
validate the merged post-patch state, so a request cannot clear either field while the existing
row remains enabled. Threshold `0` is forbidden because the ledger only emits low-balance events
when the threshold is positive. Amount and threshold use the same integer/min/max rails as one-time
top-ups. The worker keeps at most one
pending auto-recharge attempt per org, supports retry scheduling, and records
`requires_action` challenges for frontend 3DS handling. External Stripe charges are serialized
per attempt with a Postgres advisory lock so parallel workers can race on the same pending row
without issuing duplicate PaymentIntents. When a `requires_action` challenge is unresolved, new
low-balance events reuse that challenge surface instead of creating additional attempts. On
success, the local credit ledger and `billing.credits_recharged` outbox event commit before the
attempt is marked `succeeded`; if the terminal attempt update fails, retrying the same attempt is
safe because both Stripe and the ledger are keyed by the attempt id. Unexpected Stripe/worker
exceptions move the attempt into the same 48-hour retry queue instead of leaving it `pending`.

```
credits_balance - reserved_credits drops below threshold
    |
    v
billing.credits_low_balance outbox event
    |
    v
triggerAutoRecharge activity -> off-session Stripe PaymentIntent
    |
    +-- succeeded         -> credit_ledger { entryType: 'auto_recharge', amount: +$X }
    |                        emit billing.credits_recharged event
    +-- requires_action   -> emit billing.recharge_requires_action (clientSecret for 3DS)
    +-- failed            -> schedule one retry in 48h; notify user via notifications subsystem
```

## Implemented Hardening Since Initial Billing Build

The last hardening pass converted several implicit assumptions into enforced contracts:

- **Stripe session creation is per-org rate limited.** Checkout, portal, and top-up session
  creation share a per-org limiter because each call can hit Stripe and cost money.
- **Money-moving Stripe SDK calls require idempotency keys.** This is now mechanically enforced
  by the Stripe idempotency ESLint rule.
- **Webhook state changes are gated to the current subscription/customer.** Late
  `customer.subscription.*` and `invoice.payment_*` events for stale subscription IDs are ignored
  rather than overwriting the active subscription. `customer.subscription.created`,
  `customer.subscription.updated`, and `customer.subscription.deleted` must carry a usable Stripe
  subscription ID before mutating local subscription state. `customer.subscription.updated` also
  has a monotonic period-end guard so older events cannot move the current period backwards.
- **Top-up checkout cannot partially mutate subscription state.** `checkout.session.completed`
  in `payment` mode validates the positive bounded `amount_total` before any local Stripe
  customer/payment fields are written. Payment-mode sessions credit the wallet but never write
  subscription IDs or subscription plans, even if a malformed payload includes those fields.
- **Invoice webhooks wait for local subscription linkage.** `invoice.payment_succeeded` and
  `invoice.payment_failed` fail closed when the Stripe subscription ID is missing or has not yet
  been linked locally, releasing the processed-event claim so Stripe redelivery can retry after
  `customer.subscription.created/updated` establishes the plan. Late invoices for already-canceled
  subscriptions remain ignored rather than resurrecting access.
- **Top-up and auto-recharge webhook amounts are bounded.** `checkout.session.completed` in
  `payment` mode must carry a positive cents amount that converts to decimillicents and stays
  within the configured top-up maximum. `payment_intent.succeeded` with an
  `autoRechargeAttemptId` must also carry a positive bounded settled amount before wallet
  crediting. Malformed, zero, overflow, or above-cap payloads fail closed and release the Stripe
  idempotency claim for retry instead of being marked processed.
- **Refunds are first-class ledger events.** `charge.refunded` computes the refund delta from
  Stripe's cumulative `amount_refunded` and `previous_attributes.amount_refunded`, appends a
  negative `refund` ledger row, and emits `billing.credits_refunded`. Malformed cumulative or
  previous refund amounts fail closed and release the Stripe idempotency claim for retry instead
  of being processed as zero-delta no-ops.
- **Auto-recharge cannot double-call Stripe for the same attempt.** The worker reuses the single
  pending attempt row per organization, then acquires an attempt-scoped Postgres advisory lock
  before calling Stripe. Parallel workers that lose the lock return without issuing a second
  PaymentIntent.
- **Unresolved 3DS challenges suppress new auto-recharge attempts.** A failed attempt with
  `failure_reason = 'requires user action'` and a `billing.recharge_requires_action` event is
  treated as still actionable. Further low-balance events do not create another attempt until the
  existing challenge is resolved or superseded by explicit payment-method changes.
- **Auto-recharge success cannot be marked before wallet credit.** Both the worker's direct
  PaymentIntent success path and the `payment_intent.succeeded` webhook reconciliation path append
  the `auto_recharge` ledger row and `billing.credits_recharged` outbox event before marking the
  attempt `succeeded`. This prevents a stranded "paid but not credited" state if the local ledger
  commit fails after Stripe succeeds.
- **Auto-recharge crashes enter the retry queue.** Unexpected Stripe/worker exceptions mark the
  attempt failed and schedule the normal T+48h retry; retry-attempt crashes become
  `permanent_failed`. Attempts must not be left indefinitely `pending`.
- **Disputes are idempotent and fail-closed end-to-end.** `charge.dispute.created` requires a
  positive safe disputed amount before freezing/suspending through a zero-amount hold event.
  `charge.dispute.closed` rejects unknown outcomes, and a `lost` outcome requires a positive safe
  disputed amount before the negative adjustment and `billing.dispute_resolved` event. Malformed
  dispute amounts release the Stripe idempotency claim for retry instead of being persisted as `$0`
  holds or `$0` lost resolutions.
- **Payment-failed grace deadlines are event-authored.** `billing.payment_failed` carries
  `gracePeriodEndsAt`; worker side effects use that exact timestamp when present and only compute
  `now + 7 days` as a compatibility fallback.
- **Billing notification links are environment-aware and org-scoped.** Worker emails derive action
  links from `WEB_BASE_URL` and point to `/org/{organizationId}/billing...` routes, not hard-coded
  production or non-org billing paths.
- **All financial numeric seams validate aggressively.** `reserve`, `finalize`, `release`,
  `creditsPurchased`, `creditsRecharged`, `recordUsage`, `checkUsageCaps`, billing settings,
  monthly usage increments, stale-reservation reclaim age, and storage overage costs reject
  NaN/Infinity/fractional/negative values. Number-based operands that later touch bigint-backed
  financial columns must also be `Number.isSafeInteger(...)` so unsafe integers never reach DB
  writes after already losing precision. BigInt range checks cover cents-to-decimillicents and
  quantity × unit-cost overflow. Worker schedule env vars are parsed as strict positive integers;
  partial values like `1.5` or `10abc` fail startup rather than being truncated with `parseInt`.
- **Read endpoints have bounded query shapes.** Usage summary windows are capped at 92 days and
  credit-history cursors are validated as UUIDs before reaching SQL casts.

## Usage Metering Architecture

```
User triggers AI operation (generation, rendering, campaign)
    |
    v
Credit middleware (API layer)
    +-- Validate organization membership
    +-- Check credits_balance >= estimated cost
    +-- Check organization usage_cap not exceeded
    +-- Check plan limits (Try Me hard cap)
    +-- Reserve credits (async ops) or deduct (sync ops)
    |
    v
Operation executes
    |
    v
On success: Finalize at actual cost + 10% infrastructure markup
On failure: Release reserved credits
On budget exceeded mid-operation: asset -> SUSPENDED
    |
    v
Append to credit_ledger (immutable, transparent breakdown)
```

### Atomicity Guarantee (Non-Negotiable)

All credit mutations (`reserve`, `finalize`, `release`) **must** use atomic SQL -- never
read-then-write from application code.

```sql
-- Atomic credit reservation (single statement, no TOCTOU race)
BEGIN;
SELECT credits_balance, reserved_credits, usage_cap
  FROM organizations
  WHERE id = $org_id
  FOR UPDATE;  -- exclusive row lock

-- Check passes:
UPDATE organizations
  SET reserved_credits = reserved_credits + $estimated_cost
  WHERE id = $org_id
    AND (credits_balance - reserved_credits) >= $estimated_cost;
COMMIT;
```

If the `UPDATE` affects 0 rows, the reservation failed -- reject the operation. The
`monthly_credits_usage.credits_used` counter must use `UPDATE SET credits_used = credits_used + $delta`
(atomic increment), never read-modify-write.

The same `SELECT FOR UPDATE` pattern applies to campaign budget checks -- both the org cap
and campaign budget must be checked within a single locked transaction per tool call.

## Usage Pricing (10% Infrastructure Markup)

| Operation | Provider | Raw Cost | With 10% Markup |
|-----------|----------|----------|-----------------|
| Image generation | gpt-image-1 | $0.001/image | $0.0011/image |
| Video generation (1s) | Veo-3 | $0.75/sec | $0.825/sec |
| Video generation (1s) | Kling v2.1 Standard | $0.05/sec | $0.055/sec |
| Video generation (1s) | Kling v2.1 Pro | $0.09/sec | $0.099/sec |
| Text generation (1K tokens) | GPT-5 | ~$0.01 | ~$0.011 |
| Voice generation | ElevenLabs | Tiered | Tiered x 1.10 |

**Margin:** 1.10x (10% infrastructure markup), configurable in `system_settings.profit_margin`.

**Note:** The current codebase has a 1.5x margin configured. This needs to be updated to 1.10x to
reflect the new pricing strategy.

**OpenRouter-first**: For OpenRouter-routed operations (text gen, structured outputs, image gen,
embeddings), cost is taken directly from OpenRouter's response and mapped into `CostResult`.
Custom credit calculations are only needed for direct-provider calls (fal.ai, Veo3 video gen,
ElevenLabs audio). We want our own internal costResult metric. Look at the model we have in /Users/jamesaphoenix/Desktop/projects/just-understanding-data/tx-agent-kit-services here within the credit service package. We want to take some inspiration for the shape of costResult from that. Notice that it can be an array, so that it is easily aggregated?

## Storage Billing: Prepaid Credits Model

Storage is prepaid. Each plan includes a storage allocation. Beyond that, storage costs are
deducted from the credit balance **at upload time**. No postpaid invoicing.

```
Monthly billing:
+-- Plan subscription (fixed, via Stripe)     <- primary revenue
+-- All usage (AI + storage overage) is prepaid from credit balance
    +-- Auto-recharge tops up credits when low (available on all plans)
```

### Storage Tiers

| Limit | Try Me | Pro | Agency |
|-------|--------|-----|--------|
| Included storage per org | 10 GB | 100 GB | 500 GB |
| Storage overage rate | $0.10/GB from credits | $0.10/GB from credits | $0.08/GB from credits |
| Max uploads/hour | 20 | 100 | 500 |
| Max single file size | 50 MB | 200 MB | 200 MB |
| Hard storage ceiling | 20 GB | 200 GB | 1 TB |

### How It Works

1. Each plan includes a storage allocation (10 GB / 100 GB / 500 GB).
2. Pre-upload checks reject invalid file sizes (`NaN`, `Infinity`, fractional, negative, or
   greater than `Number.MAX_SAFE_INTEGER` bytes) before projecting storage usage or calculating
   overage cost.
3. Uploads within the allocation are **free** (included in plan).
4. At **80% of included storage** -> dashboard warning + email to org admin.
5. At **100% of included storage** -> further uploads deduct storage credits from `credits_balance` at $0.10/GB.
6. At **zero credit balance** -> uploads rejected (402). User must add credits or upgrade.
7. At **hard ceiling** -> uploads rejected (402) regardless of credit balance.
8. **No debt is ever possible.** Users can never store more than they've paid for.

### Prepaid Storage Model

```
User uploads 5 MB file
    |
    v
Pre-upload check (at presigned URL generation):
    +-- current_bytes + 5 MB <= plan_storage_limit?
    |     +-- yes -> upload free (included in plan)
    |     +-- no -> calculate overage cost:
    |           overage = (current_bytes + 5 MB) - plan_storage_limit
    |           cost = overage x $0.10/GB (with 10% markup)
    |           credits_balance >= cost? -> deduct + allow upload
    |           credits_balance < cost? -> 402 Upload Rejected
    |
    v
Hard ceiling check:
    +-- current_bytes + 5 MB <= hard_ceiling? -> allow
    +-- exceeded -> 402 Upload Rejected (even if credits available)
```

**Example — Try Me plan ($19/mo, 10 GB included):**
```
Upload 1:  3 GB photo set      -> 3/10 GB used -> free (within plan)
Upload 2:  5 GB video project  -> 8/10 GB used -> free (within plan), 80% warning shown
Upload 3:  4 GB video          -> 12/10 GB used -> 2 GB overage
           overage cost: 2 GB x $0.10 x 1.10 = $0.22 (debited from credits_balance)
Upload 4:  10 GB dump attempt  -> would be 22 GB -> exceeds 20 GB hard ceiling
           -> 402 Upload Rejected (even if credits available)
```

> **Users can never store more than they've paid for.** This eliminates the "upload bomb +
> disappear" risk entirely. The presigned URL is only issued after both the credit check and
> hard ceiling check pass.

Updated on every upload: `current_bytes += file_size`.
Updated on every delete: `current_bytes -= file_size` (credits are NOT refunded on delete --
storage credits are consumed at upload time).

### Monthly Storage Reconciliation

**Implementation status:** `StorageBillingService.reconcileMonthlyOverage` is implemented and
integration-tested. The Temporal schedule that drives it is **planned but not yet wired** — the
activity/workflow pair and a `storage-reconcile-schedule` entry in
`apps/worker/src/schedules.ts` is the remaining work.

**Schedule design:** a **nightly** Temporal schedule (`storage-reconcile-schedule`, default
cron `0 3 * * *` UTC) iterates every org whose `storage_usage.period_end < now()` and whose
most recent reconciliation ledger entry is missing for that period. This handles Stripe's
non-calendar-aligned billing anchors correctly without per-org schedules, at the cost of up to
24 hours of reconciliation lag (acceptable for $0.10/GB overage charges).

**Idempotency:** each reconciliation call uses `reference_id = reconcile:<orgId>:<periodEnd>`.
The `credit_ledger` already enforces `(organization_id, reference_id)` uniqueness on non-null
reference IDs, so repeated runs are no-ops.

At each billing period rollover, the scheduled Temporal workflow checks every org's
`current_bytes` against their `plan_storage_limit`. If they're over, ongoing storage overage
is charged from credits.

The upload-time charge covers the **first month** of overage storage. Reconciliation handles
ongoing months where the files are still stored.

```
Period rollover (1st of month, scheduled Temporal workflow):
    |
    v
For each org:
    current_bytes > plan_storage_limit?
    +-- no -> nothing to do
    +-- yes ->
          overage = current_bytes - plan_storage_limit
          monthly_cost = (overage / 1 GB) x $0.10 x 1.10 (with markup)
          |
          credits_balance >= monthly_cost?
          +-- yes -> deduct from credits_balance
          |         credit_ledger: { source: "usage", type: "storage_overage_renewal",
          |                          amount: -monthly_cost, overage_bytes: overage }
          |
          +-- no -> all operations SUSPENDED for this org
                   notification: "You're storing {X} on a {Y} plan.
                   Delete files or add credits to continue."
                   (auto-recharge will fire first for Pro/Agency --
                    only suspends if recharge also fails)
```

**Example -- ongoing overage:**
```
Month 1: User uploads 120 MB on 100 MB plan
         -> 20 MB overage charged at upload time ($0.00215)

Month 2: User hasn't deleted anything, still 120 MB stored
         -> reconciliation charges 20 MB x $0.10/GB x 1.10 = $0.00215
         -> deducted from credits_balance

Month 3: User deletes 30 MB, now 90 MB stored
         -> 90 MB < 100 MB plan limit -> no charge
```

### Retention Policies (Configurable Per-Org)

Each plan has sensible defaults. Org admins can adjust via **Settings -> Storage -> Retention**.
When changing retention, the system forecasts storage and cost impact before the admin confirms --
including estimated overage and a recommendation to upgrade if the change would push them over cap.

| Asset type | Default | Options |
|------------|---------|---------|
| Published renders | **90 days** after published to all intended platforms | 90 days / 6 months / Permanent |
| Failed/cancelled renders | **90 days** | 90 days / 6 months / Permanent |
| Soft-deleted assets | **90 days** | 90 days / 6 months / Permanent |
| Source uploads (images, audio) | **Permanent** | 90 days / 6 months / Permanent |
| Thumbnails | **Delete with parent** | Not configurable |

**90-day retention clock:** Starts only after the render has been published to **all intended
platforms**. Pending cross-posts keep the render alive.

**Platform references:** After render deletion from R2, the system retains the platform post
reference (post ID, URL, thumbnail URL) in the database -- enough for the dashboard, no blob cost.

### R2 Cost Basis and Margin Analysis

#### R2 Pricing

| R2 Pricing | Rate |
|------------|------|
| Storage | $0.015/GB/month |
| Egress | $0 (free) |
| Ingress | $0 (free) |
| Class A ops (writes) | $4.50/million |
| Class B ops (reads) | $0.36/million |

Overage at $0.10/GB carries **85% gross margin** over R2's $0.015/GB. Even 20 GB overage = $2/month
extra -- trivial for the customer, never loss-making for us.

#### Per-Org Margin Analysis

| Scenario | Storage | R2 Cost/month | Notes |
|----------|---------|---------------|-------|
| Light Try Me org | 2 GB | $0.03 | Occasional uploads |
| Typical Pro org | 15 GB | $0.23 | Regular content production |
| Heavy Pro (10 vids/day) | 24 GB plateau | $0.36 | With retention policies |
| Max Pro (at cap) | 50 GB | $0.75 | Would pay overage beyond this |
| Max Agency (at cap) | 250 GB | $3.75 | Would pay overage beyond this |

#### Platform-Wide R2 Cost (1K Users, 200 Teams)

| Month | Cumulative (no deletion) | R2 Cost | With Retention (plateau) |
|-------|--------------------------|---------|--------------------------|
| 1 | 140 GB | $2.10 | 140 GB / $2.10 |
| 6 | 840 GB | $12.60 | ~420 GB / $6.30 |
| 12 | 1,680 GB | $25.20 | ~420 GB / $6.30 |

With retention, platform storage plateaus at ~420 GB after 3 months. **Total R2 cost stabilises
at ~$6/month for all 200 teams.**

## Usage Cap System (Two-Level)

Every AI/video operation is gated by a **two-level usage cap** that prevents overspend. Both caps
are checked **before each individual action**, not just at campaign start.

> **Implementation status:** the org-level cap is fully implemented with atomic threshold
> crossing and event emission (`INV-BILLING-008` + `INV-BILLING-009`). The **campaign-level
> cap is stubbed** in `usage-cap-service.ts` — when `input.campaignId` is provided, the service
> logs a debug message and skips the check. Full campaign-level enforcement is blocked on the
> campaigns subsystem landing (`campaigns` table + domain + `campaigns.monthly_budget`
> + `campaigns.monthly_credits_usage_consumed`). Plumbing `campaignId` through callers is
> already safe — the check is a no-op until the subsystem lands.

> **Re-scope note:** the org-level `usage_cap_decimillicents` field is now an **optional
> user-set spend limit**, not a plan-enforced constraint. With no bundled credits and no
> margin hard cap, plans no longer impose caps; users can optionally configure one as a
> spending guardrail ("don't let me burn more than $200 in AI this month").

```
Before each AI/video operation:
    |
    +-- 1. Check org monthly usage cap
    |      Has org spent >= $300 (configurable) this month?
    |      -> YES: reject operation, notify admin, pause campaigns
    |
    +-- 2. Check campaign monthly budget
    |      Has this campaign spent >= its allocated budget this month?
    |      -> YES: reject operation, pause this campaign only
    |
    +-- 3. Both pass -> estimate cost -> reserve credits -> execute
```

### Organization-Level Usage Cap

| Field | Detail |
|-------|--------|
| Setting | `organizations.usage_cap` (BIGINT, decimillicents) |
| Default | Configurable per plan tier |
| Who sets it | Org admin, via Settings -> Billing -> Usage Cap |
| Scope | All AI + video operations across all campaigns and manual usage |
| When exceeded | All automation pauses. Manual AI operations return 402. Email + dashboard alert. |
| Reset | Monthly, aligned with billing period |
| Resume options | Admin raises cap, waits for period reset, or tops up credits |

### Campaign-Level Monthly Budget

| Field | Detail |
|-------|--------|
| Setting | `campaigns.monthly_budget` (BIGINT, decimillicents) |
| Default | Required field when creating a campaign |
| Who sets it | Campaign manager, when creating/editing the campaign |
| Scope | All AI + video operations triggered by this specific campaign |
| When exceeded | This campaign pauses. Other campaigns unaffected. |
| Reset | Monthly, aligned with campaign billing period |
| Tracking | `campaigns.monthly_credits_usage_consumed` (BIGINT, resets each period) |

### Pre-Action Check Flow (Effect pseudocode)

```typescript
class UsageCapExceeded extends Data.TaggedError("UsageCapExceeded")<{
  readonly scope: "organization" | "campaign"
}> {}

const checkUsageCaps = (
  orgId: string,
  campaignId: string | null,
  estimatedCost: bigint
) =>
  Effect.gen(function* () {
    // 1. Org-level cap (atomic read under FOR UPDATE)
    const org = yield* OrgRepo.getForUpdate(orgId)

    if (org.usageConsumed + estimatedCost > org.usageCap) {
      yield* Effect.all([
        CampaignService.pauseAllForOrg(orgId),
        NotificationService.notify(orgId, "usage_cap_exceeded")
      ], { concurrency: "unbounded" })
      return yield* new UsageCapExceeded({ scope: "organization" })
    }

    // 2. Campaign-level budget (if within a campaign context)
    if (campaignId) {
      const campaign = yield* CampaignRepo.getForUpdate(campaignId)

      if (campaign.monthlyCreditsUsageConsumed + estimatedCost > campaign.monthlyBudget) {
        yield* Effect.all([
          CampaignService.pause(campaignId),
          NotificationService.notifyCampaignManager(campaignId, "budget_exceeded")
        ], { concurrency: "unbounded" })
        return yield* new UsageCapExceeded({ scope: "campaign" })
      }
    }

    // 3. Both passed -- atomic credit reservation
    yield* CreditService.reserve(orgId, estimatedCost)
  })
```

### Warning Thresholds

| Threshold | Action |
|-----------|--------|
| 80% of org cap | Dashboard warning + email to org admin |
| 95% of org cap | Urgent dashboard warning + email |
| 100% of org cap | Block all AI ops, pause all campaigns, email + in-app notification |
| 80% of campaign budget | Dashboard warning on campaign page |
| 100% of campaign budget | Pause campaign, notify campaign manager |

## Upload Hard Limits (Abuse Prevention)

| Limit | Try Me | Pro | Agency | Purpose |
|-------|--------|-----|--------|---------|
| Max single file | 50 MB | 200 MB | 200 MB | Prevent single massive uploads |
| Max uploads/hour | 20 | 100 | 500 | Prevent scripted abuse / thrashing |
| Max total storage | 20 GB | 200 GB | 1 TB | Hard ceiling — 402 beyond this, even with credits |

## Signup Fraud Prevention

- **$1 authorization hold on signup** -- immediately released. Filters out stolen/empty/prepaid
  cards. Stripe handles the auth, we never see the card number.
- **Stripe Radar** enabled for fraud scoring on all charges.
- Real card required for all plans (no free tier, no trial without card).

## Aggressive Cleanup on Churn

- **Failed payment** -> 7-day grace period (operations suspended) -> hard-delete all media from R2
- **Account cancelled** -> immediate soft-delete of all media -> hard-delete after 30 days
- **No free storage for ex-customers.** Once the subscription lapses, the clock starts.

# Interfaces

## Effect Ports & Services

The billing domain already implements `BillingStorePort`, `UsageStorePort`, `SubscriptionEventStorePort`,
`StripePort`, `BillingGuardPort`, `ClockPort`, and `BillingService` (see `packages/core/src/domains/billing/`).
The interfaces below cover what the design describes but is **not yet coded**.

```typescript
import { Context, type Option } from 'effect'
import type * as Effect from 'effect/Effect'
import type { CoreError } from '../../../errors.js'

// ---------------------------------------------------------------------------
// Ports (persistence seams)
// All single-record return types use Effect's Option<T> instead of T | null.
// ---------------------------------------------------------------------------

/** Append-only credit ledger -- financial audit trail retained 7 years.
 *  Rows are never updated or deleted (INV-BILLING-001). */
export class CreditLedgerStorePort extends Context.Tag('CreditLedgerStorePort')<
  CreditLedgerStorePort,
  {
    /** Append a single immutable entry. Returns the created row. */
    append: (input: {
      organizationId: string
      entryType: 'purchase' | 'usage' | 'adjustment' | 'refund' | 'auto_recharge' | 'reserve' | 'release'
      amountDecimillicents: number       // positive = credit, negative = debit
      reason: string
      referenceId?: string | null        // idempotency / correlation key
      stripeEventId?: string | null      // belt-and-suspenders dedup (INV-BILLING-005)
      assetId?: string | null
      phase?: string | null
      metadata?: Record<string, unknown>
    }) => Effect.Effect<{ id: string; createdAt: Date }, unknown>

    /** List entries for an org, newest-first, with optional filters. */
    listForOrganization: (input: {
      organizationId: string
      entryType?: 'purchase' | 'usage' | 'adjustment' | 'refund' | 'auto_recharge' | 'reserve' | 'release'
      after?: Date
      before?: Date
      limit?: number
      cursor?: string
    }) => Effect.Effect<ReadonlyArray<{
      id: string
      entryType: string
      amountDecimillicents: number
      reason: string
      referenceId: string | null
      createdAt: Date
    }>, unknown>

    /** Check whether a Stripe event has already been recorded. */
    existsByStripeEventId: (stripeEventId: string) => Effect.Effect<boolean, unknown>
  }
>() {}

/** Append-only usage records -- financial audit trail retained 7 years (INV-BILLING-002). */
export class UsageRecordStorePort extends Context.Tag('UsageRecordStorePort')<
  UsageRecordStorePort,
  {
    /** Append a usage record. Never updates existing rows. */
    append: (input: {
      organizationId: string
      category: string               // e.g. 'text_generation' | 'image_generation' | 'video_generation' | 'storage'
      quantity: number
      unitCostDecimillicents: number
      totalCostDecimillicents: number
      marginMultiplier: number        // e.g. 1.10
      referenceId?: string | null
      assetId?: string | null
      metadata?: Record<string, unknown>
      recordedAt: Date
    }) => Effect.Effect<{ id: string; recordedAt: Date }, unknown>

    /** Idempotent lookup by reference ID within an org. */
    findByReferenceId: (
      organizationId: string,
      referenceId: string
    ) => Effect.Effect<Option.Option<{ id: string; totalCostDecimillicents: number }>, unknown>

    /** Summarize usage for a billing period (used by dashboards). */
    summarizeForPeriod: (input: {
      organizationId: string
      category?: string
      periodStart: Date
      periodEnd: Date
    }) => Effect.Effect<{ totalQuantity: number; totalCostDecimillicents: number }, unknown>
  }
>() {}

/** Idempotent store for processed Stripe webhook events (INV-BILLING-005). */
export class ProcessedStripeEventStorePort extends Context.Tag('ProcessedStripeEventStorePort')<
  ProcessedStripeEventStorePort,
  {
    /** Insert-or-ignore. Returns true if newly inserted, false if already existed. */
    tryInsert: (eventId: string) => Effect.Effect<boolean, unknown>

    /** Lookup by event ID. */
    findById: (eventId: string) => Effect.Effect<Option.Option<{ eventId: string; processedAt: Date }>, unknown>
  }
>() {}

// ---------------------------------------------------------------------------
// Services (application layer)
// ---------------------------------------------------------------------------

/** Credit reserve/finalize/release lifecycle (INV-BILLING-003, INV-BILLING-004).
 *  All mutations use atomic SQL with SELECT FOR UPDATE -- never read-then-write. */
export class CreditService extends Context.Tag('CreditService')<
  CreditService,
  {
    /** Atomically reserve credits for an in-flight async operation.
     *  Fails if (credits_balance - reserved_credits) < estimatedCost. */
    reserve: (input: {
      organizationId: string
      estimatedCostDecimillicents: number
      referenceId: string            // correlation key for finalize/release
      reason: string
    }) => Effect.Effect<{ reservationId: string; remainingBalance: number }, CoreError>

    /** Finalize a reservation: deduct actual cost (with margin) and release hold.
     *  Appends to credit_ledger with source = 'usage'. */
    finalize: (input: {
      organizationId: string
      reservationId: string
      actualCostDecimillicents: number
      marginMultiplier: number       // e.g. 1.10
      assetId?: string | null
      phase?: string | null
      metadata?: Record<string, unknown>
    }) => Effect.Effect<{ finalCostDecimillicents: number; remainingBalance: number }, CoreError>

    /** Release a reservation without charging (operation failed/cancelled). */
    release: (input: {
      organizationId: string
      reservationId: string
      reason: string
    }) => Effect.Effect<{ releasedAmount: number; remainingBalance: number }, CoreError>

    /** Get current available balance (credits_balance - reserved_credits). */
    getAvailableBalance: (
      organizationId: string
    ) => Effect.Effect<{ creditsBalance: number; reservedCredits: number; available: number }, CoreError>
  }
>() {}

/** Storage billing -- prepaid credit deductions at upload time. */
export class StorageBillingService extends Context.Tag('StorageBillingService')<
  StorageBillingService,
  {
    /** Pre-upload check: validates plan limits, hard ceiling, and credit balance.
     *  Returns the cost to deduct (0 if within plan allocation). */
    preUploadCheck: (input: {
      organizationId: string
      fileSizeBytes: number
    }) => Effect.Effect<{
      allowed: boolean
      overageBytes: number
      overageCostDecimillicents: number
      reason?: string                // human-readable rejection reason
    }, CoreError>

    /** Deduct storage overage credits after a confirmed upload. */
    chargeStorageOverage: (input: {
      organizationId: string
      overageBytes: number
      costDecimillicents: number
      referenceId: string            // upload ID for idempotency
    }) => Effect.Effect<{ charged: boolean }, CoreError>

    /** Monthly reconciliation: charge ongoing overage for orgs storing beyond plan. */
    reconcileMonthlyOverage: (
      organizationId: string
    ) => Effect.Effect<{ overageBytes: number; chargedDecimillicents: number }, CoreError>
  }
>() {}

/** Stripe webhook handler -- processes inbound Stripe events with idempotency. */
export class StripeWebhookHandlerPort extends Context.Tag('StripeWebhookHandlerPort')<
  StripeWebhookHandlerPort,
  {
    /** Verify signature, dedup via processed_stripe_events, and dispatch to handler. */
    handle: (
      rawBody: string,
      signature: string
    ) => Effect.Effect<
      { processed: true; idempotent: boolean; eventId: string },
      CoreError
    >

    /** Handle chargeback: freeze credits on dispute.created, resolve on dispute.closed. */
    handleDispute: (input: {
      eventId: string
      disputeStatus: 'created' | 'closed'
      outcome?: 'won' | 'lost'       // only present when disputeStatus = 'closed'
      chargeAmountDecimillicents: number
      organizationId: string
    }) => Effect.Effect<void, CoreError>
  }
>() {}

// ---------------------------------------------------------------------------
// API Routes (apps/api)
// ---------------------------------------------------------------------------

/**
 * Billing API routes exposed by apps/api (Effect HttpApi).
 *
 * GET  /v1/billing/:orgId/credits          -> CreditService.getAvailableBalance
 * GET  /v1/billing/:orgId/credits/history   -> CreditLedgerStorePort.listForOrganization
 * GET  /v1/billing/:orgId/usage             -> UsageRecordStorePort.summarizeForPeriod
 * POST /v1/billing/:orgId/top-up            -> Stripe PaymentIntent + credit_ledger purchase entry
 * POST /v1/billing/webhook                  -> StripeWebhookHandlerPort.handle
 * GET  /v1/billing/:orgId/settings          -> BillingService.getBillingSettings (existing)
 * PUT  /v1/billing/:orgId/settings          -> BillingService.updateBillingSettings (existing)
 * POST /v1/billing/:orgId/checkout          -> BillingService.createCheckoutSession (existing)
 * POST /v1/billing/:orgId/portal            -> BillingService.createPortalSession (existing)
 */
```

## Billing Integration

- **Stripe** for payments (webhook, subscriptions, one-time purchases)
- **402 Payment Required** returned when credits insufficient
- **402 Payment Required** returned when org usage cap or campaign budget would be exceeded
- All AI operations return `CostResult`:
  ```
  { costInCredits, costInDollars, marginCostInCredits, marginCostInDollars }
  ```
- **OpenRouter-first**: For OpenRouter-routed operations, cost is taken directly from OpenRouter's
  response and mapped into `CostResult`. Custom credit calculations only for direct-provider calls.
- Margin is applied at the `CostResult` level -- transparent to the user in their usage dashboard

## Domain Events (Transactional Outbox)

Credit mutations that cross thresholds or change org state emit domain events via the transactional
outbox (`domain_events` table). Events are inserted within the same DB transaction as the credit
mutation, guaranteeing at-least-once delivery to downstream consumers (Temporal workflows).

### Event Types

| Event | Emitted when | Payload |
|-------|-------------|---------|
| `billing.credits_purchased` | Stripe payment adds credits | `{ organizationId, amountDecimillicents, stripeEventId }` |
| `billing.credits_recharged` | Auto-recharge succeeds | `{ organizationId, amountDecimillicents, stripePaymentIntentId }` |
| `billing.credits_refunded` | Stripe refund removes credits | `{ organizationId, amountDecimillicents, stripeEventId }` |
| `billing.credits_low_balance` | Balance drops below auto-recharge threshold | `{ organizationId, currentBalance, threshold }` |
| `billing.usage_cap_warning` | 80% or 95% of org cap reached | `{ organizationId, percentUsed, capDecimillicents }` |
| `billing.usage_cap_exceeded` | 100% of org cap reached | `{ organizationId, capDecimillicents }` |
| `billing.campaign_budget_exceeded` | 100% of campaign budget reached | `{ organizationId, campaignId, budgetDecimillicents }` |
| `billing.payment_failed` | Stripe invoice.payment_failed | `{ organizationId, stripeEventId, gracePeriodEndsAt }` |
| `billing.dispute_created` | Chargeback filed | `{ organizationId, stripeEventId, chargeAmountDecimillicents }` |
| `billing.dispute_resolved` | Chargeback resolved | `{ organizationId, outcome: 'won' \| 'lost', chargeAmountDecimillicents, stripeEventId }` |
| `billing.subscription_cancelled` | Customer cancels | `{ organizationId }` |
| `billing.recharge_requires_action` | Off-session auto-recharge needs customer SCA/3DS | `{ organizationId, attemptId, amountDecimillicents, stripePaymentIntentId, clientSecret }` |

### Idempotency

Every domain event uses `referenceId` (from the credit ledger entry ID) as the `correlationId`.
For webhook-originated events, the credit ledger entry ID (a UUID) serves as the correlation key
rather than the raw Stripe event ID (which is a text string incompatible with the UUID
`correlation_id` column). The Stripe event ID is stored separately on the `credit_ledger` row
via `stripe_event_id` for audit tracing. Downstream consumers must be idempotent — processing
the same `correlationId` twice must produce no additional side effects.

### Credit-Positive Re-evaluation Pattern

Rather than each event carrying explicit "resume" logic, a single downstream consumer handles all
credit-positive events (`purchased`, `recharged`, `dispute.resolved` with outcome `won`):

1. Read the org's current `credits_balance`, `reserved_credits`, and `usage_cap`
2. If `credits_balance - reserved_credits > 0` and the org was previously suspended → clear suspension
3. If the org's campaigns were paused due to `usage_cap.exceeded` → re-evaluate and unpause those
   whose budget is now under cap

This avoids duplicating resume logic across multiple event handlers and ensures a consistent
re-evaluation path regardless of how credits were added.

### Events NOT in the outbox

The reserve/finalize/release lifecycle is synchronous and atomic — it does not emit outbox events.
These are internal credit accounting operations that complete within the API request. Only threshold
crossings and state changes flow through the outbox for downstream consumers.

## Stripe Webhook Idempotency

Stripe delivers webhooks at-least-once. Duplicate events must not double-charge credits.

| Table | Purpose |
|-------|---------|
| `processed_stripe_events` | `(event_id TEXT PRIMARY KEY, processed_at TIMESTAMPTZ)` |

Before any webhook processing, insert the Stripe event ID with `ON CONFLICT DO NOTHING`.
If 0 rows affected, the event was already processed -- return early. The `credit_ledger`
purchase and auto_recharge rows must include `stripe_event_id` as a unique column for
belt-and-suspenders deduplication.

### Chargeback Handling

Handle `charge.dispute.created` webhook: immediately freeze the org's credit balance and
suspend all operations. Handle `charge.dispute.closed`: if dispute lost (customer won),
permanently deduct the disputed amount; if dispute won (charge upheld), unfreeze.

### Payment Failure Lifecycle

```
active -> grace_period (7 days, ops suspended) -> terminated (hard-delete media)
```

- `invoice.payment_failed` -> emit `billing.payment_failed` with `gracePeriodEndsAt`; worker stores
  that exact timestamp in `organizations.payment_grace_period_ends_at`
- Operations suspended (reads allowed, no new AI/uploads)
- `invoice.paid` during grace -> cancel grace period, resume operations
- Grace period expires -> trigger Temporal purge workflow for org media

## Notifications Integration

Billing is a **producer of domain events**. The consumer fan-out lives in the notifications
subsystem (`specs/design/notifications-design.md`). The minimal-first implementation plan:

1. **Reuse the existing email infra.** `packages/infra/email/` already provides `EmailDeliveryPort`
   (Resend-backed), React Email templates, Svix-verified webhooks for delivery/engagement events,
   and an `email_sends` tracking table. Do not build new email infra.
2. **Add billing email templates** to `packages/infra/email/src/templates/billing/` mirroring
   the existing `onboarding/` and `shared/layout.tsx` pattern: `welcome-credit-granted.tsx`,
   `credits-low-balance.tsx`, `credits-purchased.tsx`, `credits-recharged.tsx`,
   `credits-refunded.tsx`, `recharge-requires-action.tsx`, `payment-failed.tsx`,
   `usage-cap-warning.tsx`, `usage-cap-exceeded.tsx`, `dispute-created.tsx`,
   `subscription-cancelled.tsx`.
3. **Add a `BillingEmailPort`** in the billing domain mirroring the existing `PasswordResetEmailPort`
   (auth) and `InvitationEmailPort` (organization) pattern. One method per template.
4. **Build a worker handler** (`apps/worker/src/billing-notification-handler.ts`) that subscribes
   to `billing.*` events from the outbox and fans out to both the `notifications` table (via
   `NotificationService.create`) and the `BillingEmailPort`. Idempotent via outbox event ID
   stored in `notifications.metadata.outbox_event_id`.
5. **Defer** the full event-type catalog, digest batching, per-user preferences, and non-email
   channels from the notifications spec. Ship billing events first — those are already emitted
   and sitting in the outbox waiting to be consumed.

**Implementation note (2026-04-16):** Phase 1 billing fan-out is implemented. Billing worker
workflows perform their core side-effect first, then call `notifyBillingEvent` to create the
in-app notification and best-effort billing email. Email failure is caught and logged after the
notification row exists, so notification visibility is not blocked by Resend or template errors.
Notification rows are idempotent and race-safe by `metadata.outbox_event_id`; concurrent workers
collapse to one in-app row for the same outbox event. Email action links are built from
`WEB_BASE_URL` and org-scoped billing routes.
Temporal workflows import constants through narrow `@tx-agent-kit/contracts/constants` subpaths
to avoid bundling Effect schemas into the Temporal sandbox.

The notifications domain itself (`packages/core/src/domains/notifications/`) is a **top-level
peer domain**, not a sub-domain of billing. Billing events are one input to notifications among
many; the notifications domain must be build-time independent so other subsystems (publishing,
campaigns, OAuth, etc.) can wire into it without cycling through billing.

## UI Surfaces

The billing subsystem owns the following UI surfaces in `apps/web/`. Each surface consumes
generated Orval hooks from `apps/web/lib/api/generated/billing/`.

| Surface | Path | Hook(s) | Status |
|---|---|---|---|
| Credit balance widget | `components/billing/CreditBalanceWidget.tsx` | `useBillingGetCreditBalance` | ✅ built + integrated into sidebar/billing pages |
| Top-up dialog | `components/billing/TopUpDialog.tsx` | `useBillingCreateTopUpSession` | ✅ built; requires confirmation before Stripe handoff |
| Plan selector / upgrade flow | `app/(application)/org/[orgId]/billing/plans/page.tsx` | `useBillingCreateCheckoutSession` | ✅ built; first checkout returns to welcome onboarding, existing subscribers return to billing |
| Credit history / ledger table | `app/(application)/org/[orgId]/billing/history/page.tsx` | `useBillingGetCreditHistory` | ✅ built with compound-keyset pagination |
| Usage dashboard (by category) | `app/(application)/org/[orgId]/billing/usage/page.tsx` | `useBillingGetUsageSummary` | ✅ built with in-place skeletons to avoid layout shift |
| Auto-recharge settings form | `components/billing/AutoRechargeForm.tsx` | `useBillingUpdateBillingSettings` | ✅ built; validates threshold + amount together |
| Spend cap form (optional user-set limit) | `components/billing/SpendCapForm.tsx` | `useBillingUpdateBillingSettings` | ✅ built |
| Stripe Portal link button | `components/billing/ManagePaymentMethodButton.tsx` | `useBillingCreatePortalSession` | ✅ built |
| 3DS challenge modal | `components/billing/ThreeDSChallengeModal.tsx` | Stripe.js `confirmCardPayment` + `useBillingGetAutoRechargeRequiresAction` | ✅ built |
| Suspension banner | `components/SuspensionBanner.tsx` | `useBillingGetCreditBalance` | ✅ built |
| Grace period banner | `components/billing/GracePeriodBanner.tsx` | `useBillingGetBillingSettings` | ✅ built |
| Dedicated billing settings route | `app/(application)/org/[orgId]/billing/settings/page.tsx` | `useBillingGetBillingSettings`, `useBillingUpdateBillingSettings`, `useBillingGetCreditHistory` | ✅ built |
| Org settings billing summary | `app/(application)/org/[orgId]/settings/page.tsx` | `useBillingGetBillingSettings` | ✅ summary/link only; detailed controls moved to dedicated billing settings |
| Billing nav item | `components/AppSidebar.tsx` | `useBillingGetCreditBalance` | ✅ built; desktop sidebar shows current credits |
| Onboarding spend cap step | `components/onboarding/SpendCapStep.tsx` | `useBillingUpdateBillingSettings` | ✅ built |
| No-cap reminder card | `components/billing/NoCapReminderCard.tsx` | `useBillingGetNoCapReminder`, `useBillingDismissNoCapReminder` | ✅ built; dismissal is per-user/per-org |
| Local dev billing activator | `components/billing/LocalBillingDevCard.tsx` | `useBillingCompleteLocalBillingSetup` | ✅ dev/test only |
| Custom dev utilities | `components/devtools/CustomDevUtils.tsx` | auth/org/team/billing generated clients | ✅ dev/test only; fixed bottom-center launcher |

### Route Layout

Billing lives at a **dedicated `/org/{orgId}/billing/*` route**, not inside `/settings`. Billing
has enough surface area (5 sub-pages) that jamming it into settings would make settings unusable.

| Route | Purpose |
|---|---|
| `/org/{orgId}/billing` | Overview — balance widget, current plan, next charge, quick actions (top up, upgrade, manage payment method) |
| `/org/{orgId}/billing/plans` | Plan selector and upgrade flow (checkout session creation) |
| `/org/{orgId}/billing/history` | Paginated credit ledger viewer |
| `/org/{orgId}/billing/usage` | Usage dashboard — category breakdown, progress bars vs optional spend cap, monthly trend |
| `/org/{orgId}/billing/settings` | Auto-recharge config, spend cap, billing email, payment method (Stripe Portal link), welcome credit history |

A top-level "Billing" nav item is added to `AppSidebar.tsx` under the Settings group, distinct
from the existing "Org Settings" link.

### shadcn/ui Primitives

New primitives required (beyond what org settings already uses): `Switch` (auto-recharge toggle),
`Table` + `TableHeader`/`TableRow`/`TableCell` (ledger history), `Progress` (usage bars),
`Tabs` (billing sub-navigation if not using route-based nav), `AlertDialog` (confirm top-up
amount + confirm plan upgrade), and `Form` + `zodResolver` for the settings forms.

> **Implementation note (2026-04-16):** current pages use shadcn primitives and generated Orval
> hooks. Loading states should reserve component space with skeletons instead of page-level
> spinners that move the route layout.

### Onboarding: Optional Spend Cap Setup

After a user completes their first successful subscription charge (the same trigger that grants
the welcome credit), the onboarding wizard surfaces an **optional spend cap** step. This is the
natural UX counterpart to `INV-BILLING-CREDITS-NEVER-EXPIRE`: credits stay forever, but users
get a day-one guardrail against accidental overspend.

**Placement in the flow:**

```
Stripe checkout success
    -> webhook grants welcome credit + emits billing.welcome_credit_granted
    -> user lands on /org/{orgId}/onboarding/welcome
    -> "Welcome! Here's your $20 welcome credit to get started"
    -> Next step: /org/{orgId}/onboarding/spend-cap    <-- this step
    -> Continue to /org (the app homepage resolver; no "first AI action tour" exists)
```

**Step UI (`components/onboarding/SpendCapStep.tsx`):**

- **Title:** "Set a monthly spend cap (optional)"
- **Body:** one sentence — "We'll stop AI operations if your spending hits this cap. You can
  change or remove it anytime in billing settings."
- **Input:** radio/preset buttons with `$50`, `$100`, `$250`, `$500`, `Custom`, `No cap`.
  Custom opens a number input (validated against `AUTO_RECHARGE_AMOUNT_MIN/MAX_DECIMILLICENTS`
  bounds).
- **Default selection:** `$100` — sensible middle ground, not aggressive, easy to dismiss or
  adjust.
- **Primary button:** "Set cap and continue" — calls `useBillingUpdateBillingSettings` with
  `usageCapDecimillicents`.
- **Secondary button:** "Skip for now" — visible, not hidden behind a "skip" link. Sets
  `usageCapDecimillicents = null` and advances.

**What backs it:** the existing `organizations.usage_cap_decimillicents` column is already
wired through `UsageCapService.checkUsageCaps` (80/95/100% threshold path). The only new code
is the onboarding UI writing to the existing endpoint. No new domain logic, no new migration.

**If skipped:** `usage_cap_decimillicents = NULL` → no cap, auto-recharge still works if
configured, user is in full trust mode. This is the current default and behavior does not
change.

**Non-blocking follow-up (`components/billing/NoCapReminderCard.tsx`):** for users who skip,
the billing overview page (`/org/{orgId}/billing`) shows a dismissible card:

> **No spend cap set.** Consider adding one for peace of mind. *[Set a cap]* *[Dismiss]*

Dismiss is sticky per-user per-org (stored in `user_ui_preferences` or equivalent). The card
never re-appears after dismissal. No other nagging.

**Rationale:** AWS, Stripe, Cloudflare, and Twilio all surface spend alerts/budget alarms as
user empowerment features. Prompting for this on day one tells technical buyers "we respect
your need for cost control" without imposing it. The step is skippable and defaulted to a
reasonable value, so activation-rate cost is minimized. The trust dividend from offering spend
control at the welcome moment is larger than the step cost.

**Invariant tie-in:** this surface writes to `organizations.usage_cap_decimillicents`, which
is already an optional user-set spend limit (not a plan-enforced constraint, per the
re-scope note in the Usage Cap System section).

### 3DS Challenge Flow

When auto-recharge returns `requires_action` from Stripe, the worker emits
`billing.recharge_requires_action` with the PaymentIntent `clientSecret` in the payload. The
frontend consumes this via either (a) polling the notifications API, or (b) SSE push once
that's wired. The `ThreeDSChallengeModal` component loads Stripe.js, calls
`stripe.confirmCardPayment(clientSecret)`, and displays the bank's authentication challenge.
On success, Stripe re-runs the charge and the normal webhook path lands the credits. On failure,
the modal surfaces the failure reason and a retry button.

### Spec-to-UI Audit

Every design doc in `specs/design/` should include a `## UI Surfaces` section (even if just
`None — internal-only subsystem.`). This enables `subsystem-audit` and `tx spec batch` to
mechanically track which declared surfaces have matching components and integration tests.

# Data Model

## Core Tables

| Table | Purpose | Key Detail |
|-------|---------|-----------|
| `organizations.credits_balance` | Available credits | BIGINT (decimillicents) |
| `organizations.reserved_credits` | Held for in-flight async ops | BIGINT |
| `organizations.usage_cap` | Max allowed usage for billing period | BIGINT (decimillicents), configurable |
| `credit_ledger` | Immutable transaction log | source_type: `purchase`, `usage`, `adjustment`, `refund`, `auto_recharge` |
| `auto_recharge_attempts` | Auto top-up tracking | status: `pending`, `succeeded`, `failed`, `requires_action`, `permanent_failed`; one pending attempt per org |
| `monthly_credits_usage` | Per-org per-period credit usage | Dedicated table definition below |
| `storage_usage` | Per-org per-period storage metering | Dedicated table definition below |
| `user_ui_preferences` | Per-user UI dismissals | Stores no-cap reminder dismissal per user/org |

**Unit:** 1 decimillicent = $0.00001. 1 cent = 100,000 decimillicents. Stored as BIGINT to avoid
floating-point errors.

> **`credit_ledger` and `usage_records` use `ON DELETE SET NULL` on `organization_id`** -- not
> CASCADE. These are immutable financial audit trails retained for 7 years for tax compliance.
> Before org hard-delete, a purge workflow archives these records with an anonymised org
> reference. The monthly reconciliation check (`SUM(stripe charges) == SUM(credit_ledger
> purchases)`) remains valid even after the org is deleted.

## `monthly_credits_usage`

One row per org per billing period. No resets, no cron, no reconciliation. New row created
when billing period starts.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | PK |
| `org_id` | UUID | FK to organizations |
| `period_start` | DATE | Billing period start (e.g. 2026-03-01) |
| `period_end` | DATE | Billing period end (e.g. 2026-03-31) |
| `credits_used` | BIGINT | Running total, incremented atomically on each operation |
| `plan_tier` | TEXT | FK references `organizations.plan_tier` -- always reads live value, not a snapshot |
| `created_at` | TIMESTAMPTZ | |

> **`usage_cap` lives on `organizations.usage_cap`, not snapshotted here.** If the org admin
> changes their cap mid-cycle, it takes effect immediately. The budget check always reads the
> live value from the org row.

Budget check on every AI tool call:
```sql
SELECT mcu.credits_used, o.usage_cap
FROM monthly_credits_usage mcu
JOIN organizations o ON o.id = mcu.org_id
WHERE mcu.org_id = :org_id
  AND mcu.period_start <= now()
  AND mcu.period_end >= now();
```

No reset cron. Historical usage queryable forever.

## `storage_usage`

One row per org per billing period. Storage beyond the plan's included allocation is deducted
from the credit balance in real-time. **No postpaid invoicing -- no debt is possible.**

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | PK |
| `org_id` | UUID | FK to organizations |
| `period_start` | DATE | Billing period start |
| `period_end` | DATE | Billing period end |
| `current_bytes` | BIGINT | Current storage used (updated on upload/delete) |
| `plan_storage_limit` | BIGINT | Snapshot of included storage at period start |
| `plan_tier` | TEXT | Snapshot |

## Billing Decisions (Confirmed)

| # | Decision | Outcome |
|---|----------|---------|
| 1 | Free tier | No free tier |
| 2 | Free trial | No free trial |
| 3 | Budget control | Optional org monthly spend cap; campaign budgets deferred until campaigns require them |
| 4 | Campaign compliance | Campaign cap plumbing is intentionally stubbed until the campaigns subsystem lands |
| 5 | Storage billing | Tiered base (10/100/500 GB) + prepaid credit overage + hard storage ceiling |
| 6 | Storage retention | Configurable per-org with cost forecast before changes |

# Invariants

```yaml
invariants:
  - id: INV-BILLING-001
    statement: >
      `credit_ledger` is append-only (immutable audit trail). Rows are never updated or
      deleted. Retained for 7 years for tax compliance. Uses `ON DELETE SET NULL` on
      `organization_id` -- not CASCADE.
    severity: critical
    verified_by:
      - REQ-BILLING-001

  - id: INV-BILLING-002
    statement: >
      `usage_records` are append-only (immutable). Retained for 7 years for tax compliance.
      Uses `ON DELETE SET NULL` on `organization_id` -- not CASCADE. Financial records are
      exempt from CASCADE delete.
    severity: critical
    verified_by:
      - REQ-BILLING-006

  - id: INV-BILLING-003
    statement: >
      Reserve/finalize pattern -- credits must be reserved before async work starts and
      finalized (actual cost deducted) or released (reservation freed) after completion.
      All credit mutations (reserve, finalize, release) must use atomic SQL with
      `SELECT FOR UPDATE` -- never read-then-write from application code.
    severity: critical
    verified_by:
      - REQ-BILLING-002

  - id: INV-BILLING-004
    statement: >
      Credit balance must never go negative. The `UPDATE` for reservation only succeeds when
      `(credits_balance - reserved_credits) >= estimated_cost`. If the UPDATE affects 0 rows,
      the reservation failed and the operation is rejected.
    severity: critical
    verified_by:
      - REQ-BILLING-003

  - id: INV-BILLING-005
    statement: >
      Stripe webhook processing must be idempotent. Before processing, insert the Stripe
      event ID into `processed_stripe_events` with `ON CONFLICT DO NOTHING`. If 0 rows
      affected, the event was already processed -- return early. The `credit_ledger` purchase
      and auto_recharge rows include `stripe_event_id` as a unique column for belt-and-suspenders
      deduplication. If a state-mutating webhook fails validation, arrives before required local
      Stripe subscription linkage exists, or a downstream wallet/ledger commit fails, delete the
      processed-event claim before returning the error so Stripe redelivery can retry end-to-end.
    severity: critical
    verified_by:
      - REQ-BILLING-004

  - id: INV-BILLING-006
    statement: >
      10% markup on all AI cost pass-through. Margin is 1.10x, configurable in
      `system_settings.profit_margin`. Applied at the `CostResult` level -- transparent to
      the user in their usage dashboard.
    severity: high
    verified_by:
      - REQ-BILLING-005

  - id: INV-BILLING-007
    statement: >
      Financial records (`credit_ledger`, `usage_records`) are exempt from CASCADE delete.
      They use `ON DELETE SET NULL` on `organization_id`. Before org hard-delete, a purge
      workflow archives these records with an anonymised org reference.
    severity: critical
    verified_by:
      - REQ-BILLING-006

  - id: INV-BILLING-008
    statement: >
      The `monthly_credits_usage.credits_used` counter must use atomic increment
      (`UPDATE SET credits_used = credits_used + $delta`), never read-modify-write.
    severity: critical
    verified_by:
      - REQ-BILLING-007

  - id: INV-BILLING-009
    statement: >
      Domain events for threshold crossings (usage_cap.exceeded, low_balance, etc.)
      must be inserted into the `domain_events` table within the same DB transaction
      as the credit mutation that triggers them. No event may be emitted without the
      corresponding balance change, and no balance change that crosses a threshold
      may commit without its event.
    severity: high
    verified_by:
      - REQ-BILLING-008

  - id: INV-BILLING-010
    statement: >
      Downstream consumers of billing domain events must be idempotent. Processing
      the same `correlationId` twice must produce no additional side effects.
      The `correlationId` is derived from the credit ledger entry ID or Stripe event ID.
    severity: high
    verified_by:
      - REQ-BILLING-009

  - id: INV-BILLING-NO-SEAT-LIMITS
    statement: >
      Subscription plans do not impose seat / member limits. Every plan (Try Me,
      Pro, Agency) permits unlimited organization members. Seat-based pricing
      must not be re-introduced as a plan differentiator without an explicit
      business decision to reverse this invariant. The `organization_members`
      table has no seat count column and no enforcement path.
    severity: high
    verified_by:
      - REQ-BILLING-NO-SEAT-LIMITS

  - id: INV-BILLING-NO-BUNDLED-CREDITS
    statement: >
      Subscription plans do not grant recurring AI credits on renewal. Credits
      arrive in the wallet only via (a) one-time welcome credit on first
      successful subscription charge, (b) explicit user top-up via Stripe
      Checkout, (c) auto-recharge off-session PaymentIntent, or (d) admin
      manual adjustment. The monthly invoice.payment_succeeded webhook must not
      write a `purchase` ledger entry for plan renewals. Storage allocation is
      the only thing plans grant directly.
    severity: critical
    verified_by:
      - REQ-BILLING-NO-BUNDLED-CREDITS

  - id: INV-BILLING-CREDITS-NEVER-EXPIRE
    statement: >
      Purchased, auto-recharged, welcome, and admin-granted credits are
      permanent until spent, refunded, or explicitly adjusted. No scheduled
      expiry, no monthly reset, no "use it or lose it" logic. The
      `credit_ledger` has no expiry column and no scheduled purge of balance
      rows. This is a product guarantee for the infrastructure-company
      positioning — users trust that credits are always there.
    severity: critical
    verified_by:
      - REQ-BILLING-CREDITS-NEVER-EXPIRE

  - id: INV-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
    statement: >
      The welcome credit grant is one-time per organization lifetime. The
      `organizations.welcome_credit_granted_at` timestamp is checked inside
      the transaction that writes the ledger entry; if non-null, no grant
      occurs. Upgrades between plans do not re-grant. The grant triggers on
      first successful `invoice.payment_succeeded` webhook only. Refunds
      never claw back welcome credits — the refund clawback path filters
      entries where `reason = 'welcome_credit'`.
    severity: high
    verified_by:
      - REQ-BILLING-WELCOME-CREDIT-ONCE-PER-ORG
```

# Failure Modes

```yaml
failure_modes:
  - condition: Stripe webhook delivery fails or retries (at-least-once delivery)
    impact: >
      Without idempotency, duplicate webhooks could double-credit an account (purchase
      events) or double-deduct (refund events), corrupting the credit balance.
    handling: >
      The `processed_stripe_events` table deduplicates by `event_id`. Insert with
      `ON CONFLICT DO NOTHING` before processing. If 0 rows affected, return early.
      The `credit_ledger` also enforces uniqueness on `stripe_event_id` as a second layer.

  - condition: Credit reservation succeeds but the work crashes (orphaned reservation)
    impact: >
      Reserved credits are held indefinitely, reducing the effective available balance.
      The user appears to have fewer credits than they actually do.
    handling: >
      A scheduled Temporal workflow scans for reservations older than a configurable timeout
      (e.g., 2 hours for video generation, 30 minutes for text generation). Stale reservations
      are released back to the balance with a `credit_ledger` entry of type `release` noting
      the reason. The Temporal activity that performs the work must finalize or release in its
      cleanup/finally handler.

  - condition: Auto-recharge payment fails (card declined, insufficient funds)
    impact: >
      Pro/Agency org cannot top up credits. In-flight operations that depend on credit
      availability will fail. Campaigns cannot proceed.
    handling: >
      The `auto_recharge_attempts` table tracks status (`pending`, `succeeded`, `failed`,
      `permanent_failed`). On first failure, notify the user and schedule one retry at T+48h.
      If the retry also fails, mark `permanent_failed`; the user must update the payment method
      or manually top up credits before further work can proceed.

  - condition: Org deletion is triggered while credits are reserved for in-flight operations
    impact: >
      Financial records could be orphaned or lost. In-flight operations could complete without
      proper cost tracking.
    handling: >
      Org deletion is a multi-step Temporal workflow. Before hard-delete: (1) cancel all
      in-flight operations, (2) release all reserved credits, (3) archive `credit_ledger` and
      `usage_records` with anonymised org reference, (4) process any refund for remaining
      credit balance. Financial records use `ON DELETE SET NULL` -- they survive org deletion
      for the 7-year retention period.

  - condition: Chargeback / dispute filed on a Stripe charge
    impact: >
      Credits were already granted for a payment now being disputed. The org could consume
      credits funded by a reversed charge.
    handling: >
      Handle `charge.dispute.created` webhook: require a positive safe disputed amount, then
      immediately freeze the org's credit balance and suspend all operations. Handle
      `charge.dispute.closed`: reject unknown outcomes; if dispute lost (customer won), require a
      positive safe disputed amount and permanently deduct it; if dispute won (charge upheld),
      unfreeze.

  - condition: Domain event inserted but outbox poller crashes before dispatching
    impact: >
      Threshold-crossing events (usage_cap_exceeded, credits_low_balance) sit in `pending`
      status. Campaigns are not paused, auto-recharge is not triggered, and admins are not
      notified despite the balance having already changed.
    handling: >
      The outbox poller is a Temporal scheduled workflow that runs every few seconds. If it
      crashes, Temporal automatically retries. Events remain in `pending` status until
      successfully dispatched. The poller uses `SELECT ... FOR UPDATE SKIP LOCKED` to allow
      parallel polling without double-processing. Stale `processing` events are reclaimed
      after a configurable timeout.

  - condition: Outbox consumer processes a credit-positive event but the re-evaluation query fails
    impact: >
      Campaigns remain paused despite the org now having sufficient credits. The org admin
      sees credits available but campaigns are stuck.
    handling: >
      The re-evaluation consumer is idempotent — it can be safely retried. Temporal retries
      the activity with exponential backoff. The consumer reads live org state (not cached),
      so a retry after a transient DB error will see the correct balance and unpause
      campaigns accordingly.

  - condition: Duplicate domain events for the same threshold crossing
    impact: >
      Without idempotency, the same usage_cap_exceeded event could trigger duplicate
      notifications or attempt to pause already-paused campaigns.
    handling: >
      Events use `correlationId` derived from the credit ledger entry ID. Downstream
      consumers check whether the action was already performed (e.g., campaign already
      paused, notification already sent) before acting. The `WorkflowIdReusePolicy.REJECT_DUPLICATE`
      policy on Temporal child workflows prevents duplicate workflow starts.
```

# Verification

```yaml
verification:
  - requirement_id: REQ-BILLING-001
    test_type: integration
    target: >
      Verify that `credit_ledger` has no UPDATE or DELETE triggers. Attempt an UPDATE on a
      `credit_ledger` row and confirm it is rejected (if enforced via policy) or verify via
      integration test that no application code path issues UPDATE/DELETE against the table.

  - requirement_id: REQ-BILLING-002
    test_type: integration
    target: >
      Execute an async operation flow: reserve credits, verify `reserved_credits` increased,
      finalize with actual cost, verify `credits_balance` decreased by actual cost and
      `reserved_credits` decreased by estimated cost. Repeat with release path and verify
      `reserved_credits` returns to original value.

  - requirement_id: REQ-BILLING-003
    test_type: integration
    target: >
      Set `credits_balance` to $5 and `reserved_credits` to $3. Attempt to reserve $3
      (available = $5 - $3 = $2, which is less than $3). Confirm the reservation fails
      and `reserved_credits` is unchanged.

  - requirement_id: REQ-BILLING-004
    test_type: integration
    target: >
      Process a Stripe webhook event. Process the same event ID again. Verify the
      `credit_ledger` contains exactly one entry for that event, and the second processing
      returned early without side effects.

  - requirement_id: REQ-BILLING-005
    test_type: unit
    target: >
      For each operation type in the usage pricing table, verify that the `CostResult`
      includes exactly 1.10x markup over the raw provider cost. Verify the margin
      multiplier is read from `system_settings.profit_margin`.

  - requirement_id: REQ-BILLING-006
    test_type: integration
    target: >
      Create an org with `credit_ledger` and `usage_records` entries. Delete the org.
      Verify the financial records still exist with `organization_id = NULL`.

  - requirement_id: REQ-BILLING-007
    test_type: integration
    target: >
      Run two concurrent credit deductions for the same org. Verify the final
      `credits_used` reflects the sum of both deductions (no lost updates from
      read-modify-write race).

  - requirement_id: REQ-BILLING-008
    test_type: integration
    target: >
      Trigger a credit deduction that crosses the usage cap threshold. Verify that
      a `billing.usage_cap_exceeded` domain event is inserted into `domain_events`
      within the same transaction as the credit mutation. Verify no event is emitted
      when the deduction stays under the cap. Verify the outbox poller picks up the
      event and dispatches it to the worker.

  - requirement_id: REQ-BILLING-009
    test_type: integration
    target: >
      Process a billing domain event via the Temporal worker. Process the same
      `correlationId` again. Verify the downstream action (e.g., campaign pause,
      notification send) is performed exactly once. Verify the second processing
      is a no-op.
```

# Implementation Status (updated 2026-04-17)

| Invariant | Verified by (tests / structural) |
|-----------|---|
| INV-BILLING-001 (credit_ledger append-only) | `pgtap/004_billing_immutability.pgtap.sql` + `billing-credits.integration.test.ts` |
| INV-BILLING-002 (usage_records append-only) | `pgtap/004_billing_immutability.pgtap.sql` + repo policy |
| INV-BILLING-003 (reserve/finalize/release lifecycle atomic SQL) | `billing-credits.integration.test.ts` (14 refs — reserve + finalize + reclaim) |
| INV-BILLING-004 (balance never negative, 0-row UPDATE guard) | `billing-credits.integration.test.ts` + `credit-ledger.ts` conditional UPDATE |
| INV-BILLING-005 (Stripe idempotency via `processed_stripe_events` + partial unique index) | `billing.integration.test.ts` + `pgtap/004_billing_immutability.pgtap.sql` (plan 9) + migration `0039_credit_ledger_stripe_event_unique.sql` |
| INV-BILLING-006 (1.10× markup, basis-points math) | `contracts/src/billing.test.ts` (`createCostResult` + `createCostResultFromOpenRouterUsage`) |
| INV-BILLING-007 (FK ON DELETE SET NULL) | `pgtap/004_billing_immutability.pgtap.sql` (current_schema scoped) + `scripts/lint/enforce-domain-invariants.mjs` |
| INV-BILLING-008 (atomic `monthly_credits_usage.credits_used` increment) | `billing-usage-cap.integration.test.ts` (concurrent upsert) + `usageCapRepository.incrementMonthlyUsageAndEmit` |
| INV-BILLING-009 (domain event in same tx as mutation) | `billing-outbox-emission.integration.test.ts` (8 tests) + `credit-service.ts` / `usage-cap-service.ts` |
| INV-BILLING-010 (idempotent downstream consumers) | `billing-activities.integration.test.ts` + `workflows.ts` (`workflowIdReusePolicy: REJECT_DUPLICATE`) |

## Implemented subsystems

- **CreditService** — `reserve` / `finalize` / `release` / `getAvailableBalance` / `creditsPurchased` / `creditsRecharged` / `releaseStaleReservations`, all atomic via `creditLedgerRepository.append({ outboxEvent? })` and `finalizeReservation({ lowBalanceThreshold? })`.
- **UsageCapService** — `checkUsageCaps` (80 / 95 / 100 % classification) + `incrementMonthlyUsage` + `incrementMonthlyUsageAndEmit` (atomic increment + threshold event) + `emitUsageCapExceeded` (rejection-path event).
- **StorageBillingService** — `preUploadCheck` / `chargeStorageOverage` / `reconcileMonthlyOverage`. Plan-aware, honours hard ceilings (Try Me 500 MB / Pro 100 GB / Agency 500 GB), rejects unsafe byte/cost operands before DB writes, and is idempotent via `reconcile:<orgId>:YYYY-MM` reference IDs.
- **Stripe webhook handler** — primary idempotency gate via `processed_stripe_events.tryInsert`, secondary audit log in `subscription_events`. `checkout.session.completed` (mode=payment) validates positive, bounded `amount_total` before any checkout state write and before `creditsPurchased`; payment-mode sessions never write subscription IDs or plans. `payment_intent.succeeded` with `autoRechargeAttemptId` validates a positive bounded settled amount and credits the wallet before terminally marking the attempt succeeded. `charge.dispute.created` validates a positive safe disputed amount before writing the zero-amount hold + `billing.dispute_created` event. `charge.dispute.closed` rejects unknown outcomes and requires a positive safe amount on `lost` before writing the negative adjustment + `billing.dispute_resolved` event. All domain events commit in the same tx as the ledger write, and validation/commit failures release the processed Stripe claim.
- **Webhook ordering and stale-event guards** — subscription create/update/delete events fail closed when the Stripe subscription ID is missing, and subscription/invoice success/failure events are ignored when their Stripe subscription ID does not match the org's current subscription. Invoice success/failure events fail closed when the invoice arrives before the local subscription row is linked, allowing Stripe retry after the subscription event lands so welcome credits are not missed. Subscription updates cannot move `subscription_current_period_end` backwards. Top-up checkout sessions do not clear active subscription pointers.
- **Refund handling** — `charge.refunded` appends a negative `refund` ledger row for the delta refund amount and emits `billing.credits_refunded`. Cents-to-decimillicents conversion is BigInt-safe, rejects malformed Stripe amounts, and rejects negative deltas while preserving legitimate zero-delta no-ops.
- **Top-up endpoint** — `POST /v1/billing/:orgId/top-up` creates a one-time Stripe Checkout session in `payment` mode; the webhook path above is what actually credits the ledger.
- **Rate-limited Stripe session endpoints** — checkout, portal, and top-up session creation are per-org limited to protect Stripe costs and prevent spam-click amplification.
- **Worker consumers** — child workflows (`creditsPurchased`, `creditsRecharged`, `creditsLowBalance`, `usageCapWarning`, `usageCapExceeded`, `campaignBudgetExceeded`, `paymentFailed`, `disputeCreated`, `disputeResolved`, `subscriptionCancelled`, `rechargeRequiresAction`, `creditsRefunded`, `welcomeCreditGranted`) are dispatched by `outboxPollerWorkflow`. Each workflow performs its billing side-effect first (grace period, auto-recharge attempt, ledger adjustment, 3DS challenge recording, etc.) and then fans out the same outbox event through `notifyBillingEvent` for in-app + email notification delivery. Payment-failed consumers use the webhook-authored grace deadline; auto-recharge consumers serialize Stripe calls per attempt and reuse unresolved 3DS challenges. Campaign pausing remains stubbed until the campaigns subsystem exists.
- **Orphaned reservation reclaim** — `releaseStaleReservationsWorkflow` runs every 10 minutes, releasing reservations older than `RESERVATION_RECLAIM_MAX_AGE_SECONDS` (default 7200 s). The workflow/env seam requires strict positive integer ages. Idempotent on repeat.
- **Local dev billing bootstrap** — `POST /v1/billing/:orgId/dev/complete-local` is available only outside staging/production. It activates local subscription state, seeds local Stripe-like IDs, clears payment grace state, and grants a one-time $20 local welcome credit idempotently.
- **Production welcome-credit grant** — `invoice.payment_succeeded` grants Try Me / Pro / Agency welcome credit exactly once after the first successful charge, stamps `welcome_credit_granted_at`, and emits `billing.welcome_credit_granted` in the same transaction.
- **Billing notification delivery** — billing outbox events now create owner-scoped in-app notification rows and best-effort billing emails through `BillingEmailPort`. Refund receipts are included via `credits-refunded.tsx`. Billing email URLs canonicalize to `https://tx-agent-kit.local/org/<orgId>/...` when `WEB_BASE_URL` is unset and preserve configured `tx-agent-kit.local` environment hosts when set.
- **Billing UI** — dedicated billing overview/plans/history/usage/settings routes, billing sidebar nav, credit balance widget, top-up dialog, plan confirmation dialog, auto-recharge and spend-cap forms, no-cap reminder, grace-period banner, local billing card, 3DS challenge modal, and in-place usage skeletons are implemented and covered by web integration tests.

## Known Implementation Gaps

- **Campaign budget enforcement:** campaign-level usage caps remain stubbed until the campaigns
  subsystem needs per-campaign budgets.

## Decisions

- **Credits stay in `packages/core`, not `packages/infra`.** Billing has real business rules (margin application, usage cap semantics, plan transitions, credit-positive re-evaluation, chargeback flows) that are pure domain logic, not pure infrastructure. Moving them would (a) break the `domain-invariants` ESLint plugin which only scans `packages/core/src/domains/`, (b) collapse the business-rule layer into the adapter layer, and (c) add a new cross-package tier that isn't needed for a single case. DB weight alone is not a reason to leave the domain layer.

# Open Questions

| # | Question |
|---|----------|
| 1 | ~~Pricing research needed — finalize Pro/Agency~~ — **Resolved 2026-04-14**: flat-rate storage-only model confirmed. Try Me $19 / Pro $49 / Agency $199. Unlimited members on all tiers. No bundled AI credits. Welcome credit $9/$20/$45 one-time per org. Credits never expire. |
| 2 | ~~What is included in the base plan?~~ — **Resolved 2026-04-14**: storage allocation (10/100/500 GB), rate-limit tier, support tier, unlimited members. No bundled AI credits. AI usage funded via top-up wallet only. |
| 3 | ~~How are credits purchased~~ — **Resolved**: both auto-recharge (triggered by `billing.credits_low_balance`) and manual top-up (`POST /v1/billing/:orgId/top-up`) are supported. Auto-recharge is a user opt-in on all plans (not plan-gated). |
| 4 | HTTP rate limiting: configured via `RATE_LIMIT_WINDOW` and `RATE_LIMIT_MAX_REQUESTS` env vars — what are the appropriate values per plan tier? Low/Mid/High buckets TBD. |
| 5 | **Short link table** — `use_short_link` referenced on `scheduled_posts` but no `short_links` table defined. Deferred — not needed for MVP. Revisit when click-tracking is prioritized. |
| 6 | ~~Email/notification system~~ — **Resolved 2026-04-14**: reuse existing `packages/infra/email` (`EmailDeliveryPort` + React Email templates + Resend + Svix webhooks). Build minimal notifications domain that consumes `billing.*` outbox events. Full event catalog and digest batching deferred. See Notifications Integration section + `specs/design/notifications-design.md`. |
| 7 | **Campaigns subsystem** — campaign-level usage cap enforcement is stubbed in `usage-cap-service.ts`. Unblocked when `campaigns` table + domain lands. Deferred indefinitely until a real user requests per-campaign budgets. |
