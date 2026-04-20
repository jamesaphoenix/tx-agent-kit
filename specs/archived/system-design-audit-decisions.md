# System Design Audit — Open Decisions

> These items require your input before they can be implemented into the system design.
> Go through each, make your decision, and we'll implement them in a follow-up pass.

---

## Decision 1: Client Access Model — Full Login vs Stateless Review Links

The agency model needs external clients to approve content. Two options:

**Option A — Full Login:** Clients are users with restricted permissions. Requires `team_members` rows, client-specific permission sets, seat counting.

**Option B — Stateless Review (recommended by audit):** Clients do NOT have accounts. Content review happens via signed URLs rendering a read-only review page. Add `content_review_tokens` table. Matches your stated "no client account required" goal.

> **Your call:** A or B?

---

## Decision 2: Agency Billing — Who Pays for AI Costs?

Three models:

**Option A — Agency absorbs all:** Single org subscription; agency pays everything. Per-client cost reporting via `credit_ledger.client_id`.

**Option B — Client pays directly:** Each client has their own tx-agent-kit subscription. Agency accesses with delegated permission.

**Option C — Split:** Subscription is agency's; per-client AI usage tracked separately for external invoicing.

> **Your call:** A, B, or C? (A is simplest to implement)

---

## Decision 3: Marketplace — Explicitly Not Building?

Postiz has a full buyer/seller marketplace (Orders, PayoutProblems, MessagesGroups, Stripe Connect). The audit recommends explicitly documenting that tx-agent-kit will NOT build a marketplace — the agency model is closed-loop (agencies bring their own clients).

> **Confirm:** "No marketplace" is intentional and should be documented as a non-goal?

---

## Decision 4: Cross-Team Content Sharing Within an Org

Teams are currently siloed. Agencies managing multiple brands (each a team) may want a shared asset library. Two options:

**Option A — Defer:** Explicitly document teams are intentionally siloed for v1. Shared libraries are post-launch.

**Option B — Implement now:** Add `shared_with_org BOOLEAN` flag on `team_media_assets`.

> **Your call:** A or B?

---

## Decision 5: Streak Notifications — Drop or Redesign?

Postiz uses posting streaks as a retention mechanism (email at 22h if no post). With tx-agent-kit's autonomous AI campaigns posting automatically, streaks are meaningless — the AI maintains the streak.

**Option A — Drop entirely:** No streak feature.

**Option B — Redesign as "Content Consistency Score":** Track human engagement with the platform rather than post frequency.

> **Your call:** A or B?

---

## Decision 6: Campaign Pause Semantics — What Happens to In-Flight Assets?

When a campaign is paused, assets may be mid-render. Three options:

**Option A — Complete current phase, then halt:** In-flight assets finish their current pipeline step, then enter `campaign_paused` state.

**Option B — Immediate suspend:** All `processing` assets immediately move to `suspended`.

**Option C — User chooses per-campaign:** Add `auto_suspend_on_pause BOOLEAN` to campaigns.

> **Your call:** A, B, or C?

---

## Decision 7: RSS/Feed Auto-Posting — In Scope for v1?

Postiz's core automation feature. Watches RSS feeds, auto-generates social posts from new articles.

**Option A — Defer to post-launch:** Add `feed_sources` table stub but don't build the workflow.

**Option B — Include in v1:** Full implementation with `feed_sources` table + Temporal polling workflow.

> **Your call:** A or B?

---

## Decision 8: Profit Margin — 5% or 10%?

The system design says 10% markup (§9.4). The use-case doc says 5% (4.9-billing-and-pricing.md). These contradict each other.

> **Your call:** Which is correct? (We'll update both docs to match)

---

## Decision 9: Manual Credit Top-Up — Supported or Not?

Currently only auto-recharge and subscription credits are described. Try Me users who exhaust $22 credits must upgrade.

**Option A — No manual top-up:** Forced upgrade funnel. Simpler billing.

**Option B — Support one-time purchases:** `POST /billing/top-up` endpoint, Stripe PaymentIntent flow.

> **Your call:** A or B?

---

## Decision 10: Yearly Billing — In Scope for Launch?

Postiz supports both monthly and yearly. tx-agent-kit's design only covers monthly.

**Option A — Monthly only at launch:** Yearly added post-launch.

**Option B — Design yearly now:** Credit allocation cadence, proration, refund formula.

> **Your call:** A or B?

---

## Decision 11: Post-Publish Automation Plugs — In Scope?

Postiz has "Plugs" — per-integration automations that run after publishing (auto-repost, add comment from different account). tx-agent-kit has no equivalent.

**Option A — Defer:** Not in v1.

**Option B — Include:** Add `post_automations` table + post-publish Temporal activity hook.

> **Your call:** A or B?

---

## Decision 12: Content Inspiration Library — In Scope?

Postiz ships a platform-seeded `PopularPosts` table — browseable content inspiration. tx-agent-kit's AI IDEATE phase partially fills this role.

**Option A — Skip:** The AI IDEATE phase is sufficient.

**Option B — Include:** Add `content_inspiration` table seeded by platform team.

> **Your call:** A or B?

---

## Decision 13: Lifetime Deals — Plan for It?

Postiz has full lifetime deal support (AppSumo-style). If tx-agent-kit ever wants to run lifetime deals, the foundation should be laid now.

**Option A — Not planning lifetime deals.**

**Option B — Add foundation now:** `is_lifetime_deal BOOLEAN` on orgs + `lifetime_deal_codes` table + guard in webhook handler.

> **Your call:** A or B?

---

## Decision 14: Promo Codes / Discount Infrastructure — In Scope?

Postiz has Stripe promotion codes, retention discounts (offer coupon when user tries to cancel), and affiliate tracking.

**Option A — Not at launch.**

**Option B — Add Stripe promo code support at launch.**

> **Your call:** A or B?

---

## Decision 15: Multi-Approver Workflows — In Scope for v1?

Enterprise agencies may need: creator submits → marketing manager approves → legal approves. Current design has single-approver gates.

**Option A — Single approver for v1.** Multi-approver is post-launch.

**Option B — Design multi-approver now:** Add `approval_policy JSONB` on campaigns/teams, `approval_requests` table.

> **Your call:** A or B?

---

## Decision 16: Version Chain Forking — Intentional or Bug?

Two content items can currently both point to the same `parent_id` (a fork). Is this intentional (creative branching) or a bug to prevent?

**Option A — Intentional:** Document it. No unique constraint.

**Option B — Bug:** Add `UNIQUE(parent_id)` partial index where `parent_id IS NOT NULL`.

> **Your call:** A or B?
