# tx-agent-kit — Business Requirements

> **Status:** Draft — To be discussed and refined **Date:** 25-02-2026

---

## 1. What is tx-agent-kit?

tx-agent-kit is an autonomous social growth platform that makes organic social media as measurable and
scalable as paid advertising. It allows marketing teams to connect their social media accounts,
generate content using AI, schedule and publish posts across platforms, and measure performance —
all from a single dashboard.

A key product direction is **partially automated campaign execution** (in the spirit of Google Ads):
users set goals, guardrails, and budgets, and tx-agent-kit automates content generation and scheduling
within those constraints.

### Target Audience

The primary audience is **marketing teams and technical marketing professionals** — social media
managers, content marketers, brand managers, and small-to-mid-size marketing agencies. We are not
targeting enterprise users. The product should be accessible, affordable, and optimised for teams of
2-15 people who need to produce and publish high-quality social content at scale without a large
production budget.

---

## 2. Scale

The system must support up to **1,000 users** in its initial phase.

Users are organised into **Organizations** and **Teams**. An organization is the billing entity (the
company paying for the product). Each organization can have one or more teams, and each team manages
its own social accounts, content, and media. Users belong to teams and are granted permissions
through roles.

There are two membership types: **team members** (internal staff) and **clients** (external
stakeholders with limited access, e.g., for content approvals).

### Decisions (Confirmed)

- **Organization count at 1K users:** target **~500 organizations** (average ~2 users per org)
- **Plan limits:** enforce a maximum of **50 teams per organization**
- **Plan limits:** enforce a maximum of **50 users per team**

---

## 3. Actors

| Actor                    | Description                                                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Social Media Manager** | Primary day-to-day user. Uploads media, creates content, generates AI slideshows and videos, reviews and confirms concepts before rendering, reviews rendered output before scheduling, and publishes to social platforms. |
| **Campaign Manager**     | Plans and runs multi-post campaigns across social accounts. Configures campaign type (organic or paid), content formats, and publishing flow. Still confirms content through the two-gate approval process.                |
| **Approver**             | Reviews scheduled content before it goes live. Can approve, reject with a reason, or request edits. Typically a team lead, marketing director, or client stakeholder.                                                      |
| **Team Admin**           | Manages team membership, assigns roles and permissions, configures team brand settings. Often the same person as the marketing lead.                                                                                       |
| **Organization Admin**   | Manages billing, usage, subscriptions, and organization-wide settings. Has access to all teams within the organization.                                                                                                    |
| **Agency** (future)      | Manages multiple organizations/brands from a single interface. Requires white labelling and multi-tenant management.                                                                                                       |

---

## 4. High Level Features

Each use case is summarised below. Full details live in [`use-cases/`](./use-cases/).

### [4.1 Social Account Management](./use-cases/4.1-social-account-management.md)

Connect social media accounts via OAuth with automatic token refresh. TikTok is implemented; Meta
(Instagram/Facebook) is next.

### [4.2 Media Library](./use-cases/4.2-media-library.md)

Shared per-team media library with AI-powered tagging, vector search, and soft delete. Supports
uploads up to 50 MB.

### [4.3 AI Content Generation](./use-cases/4.3-ai-content-generation.md)

The core value proposition. AI generates concepts (this will be text + ascii) from a creative brief,
then renders them into platform-formatted video or slideshow.

We support multiple content formats, including **green screen memes**, **slideshows**, **videos**,
**text** and **text + image posts**.

### [4.4 Content Scheduling and Publishing](./use-cases/4.4-content-scheduling-publishing.md)

Schedule approved content to social platforms with validation, token refresh, and async status
polling. Posts move through: scheduled, publishing, published, failed, or cancelled. Users can
schedule up to **10 posts per day per platform**.

### [4.5 Content Approval Workflow](./use-cases/4.5-content-approval-workflow.md)

A mandatory **two-gate human-in-the-loop** process (concept confirmation, then render confirmation)
ensures every published piece is deliberately approved. Concept approval is optional, but render
proposals and scheduling require approval. Approvers can approve, reject with reason, or reschedule.

### [4.6 Campaigns + Budgets](./use-cases/4.6-campaigns.md)

Partially automated multi-post campaigns that generate and publish content on a schedule. Users
retain control through approval modes, safety rules, and budget guardrails. Campaigns include budget
caps, pacing rules, and stop conditions. Initial campaign testing will run on TikTok only, even
though direct publishing must support multiple platforms from launch.

### [4.7 Analytics](./use-cases/4.7-analytics.md)

Collect and normalise performance metrics (views, engagement) across platforms via time-series
snapshots.

### [4.8 Knowledge Base](./use-cases/4.8-knowledge-base.md)

Per-team brand knowledge (guidelines, product info) used by AI for content generation. Supports a
proposal/approval workflow for edits.

### [4.9 Billing and Pricing](./use-cases/4.9-billing-and-pricing.md)

Flat-rate monthly subscription for platform access plus a prepaid credit wallet for AI/video/image
usage and storage overage at a 10% infrastructure markup. Plans do not bundle recurring AI credits.
Credits are tracked in decimillicents via an immutable ledger and never expire. Storage runs on
Cloudflare R2 (zero egress). No free tier or free trial. The organization spend cap is optional and
user-set; campaign budgets are deferred until campaigns need them.

### [4.10 Team and Role Management](./use-cases/4.10-team-and-role-management.md)

Role-based permissions for team members and account-backed client collaborators, with
invite-before-signup by email and optional workspace scope. Stateless content review links remain
available for clients who should not create accounts. Teams store brand settings that influence
AI-generated content.

### 4.11 Agency Client Onboarding (Post-Launch)

**Not required for launch.** A Leadsie-style magic-link onboarding flow for agencies to request
access to their clients' social media accounts without the client needing to be tech-savvy.

The agency sends a single branded link to the client. The client clicks the link, authenticates
with their social platforms (TikTok, Meta, Google, LinkedIn), and grants the agency's tx-agent-kit
team the required permissions — all in a guided, step-by-step flow. The agency is notified when
access is granted.

**Key capabilities:**

- **One-link onboarding** — agency sends a single URL (e.g., `https://tx-agent-kit.local/onboard/{agency}`)
  via email, SMS, or embedded on their website
- **Guided OAuth flow** — client logs into each platform and grants permissions through a
  simplified, branded interface (no PDFs, no back-and-forth)
- **Multi-platform support** — TikTok, Instagram/Facebook (Meta), LinkedIn, YouTube, Google Ads
  in one session
- **Real-time status tracking** — agency dashboard shows which clients have completed onboarding,
  which are pending, and which platforms are connected
- **Branded experience** — agency logo, colours, and custom URL (ties into white labelling)
- **Notifications** — agency receives email/in-app notification when a client completes onboarding
- **No client account required** — the client does not need an tx-agent-kit account. They only
  authenticate with their social platforms.

**Why post-launch:** This depends on the Agency actor (§3), white labelling (§6), and multi-
platform OAuth (§5) all being in place. It's a natural extension once agencies are onboarded
as customers.

---

## 5. Platform Support

| Platform  | Status          | Notes                                                                             |
| --------- | --------------- | --------------------------------------------------------------------------------- |
| TikTok    | **Implemented** | Full pipeline: OAuth, posting, analytics. Initial campaign testing will run here. |
| Instagram | Launch target   | Via Meta Graph API. Required for day-1 multi-platform publishing.                 |
| Facebook  | Launch target   | Delivered via Meta integration for day-1 multi-platform publishing.               |
| YouTube   | Not started     |                                                                                   |
| LinkedIn  | Launch target   | Required for day-1 multi-platform publishing.                                     |
| Twitter/X | Not started     |                                                                                   |

### Decisions (Confirmed)

- Day-1 publishing must support TikTok, Instagram, Facebook, and LinkedIn.
- Automated campaigns will be tested on TikTok first before expanding to other platforms.

---

## 6. White Labelling

White labelling is not currently implemented. The platform runs under a single tx-agent-kit brand.

Teams do store brand settings (colours, typography, tone) but these are used to guide AI content
generation, not to theme the UI.

### Decision (Confirmed)

White labelling is a **future phase** and is **not required for launch**.

---

## 7. Compliance and Data Governance

### GDPR

Right-to-be-forgotten is a hard requirement. When an organization is deleted, the system must
automatically hard-delete all organization data (database records, media/storage objects, and
derived artifacts) rather than leaving tenant data in soft-deleted state.

### Data isolation

All user data is isolated at the team level. Authorization is enforced at the **API layer** (not
database-level RLS) — every route validates org/team membership before querying. Drizzle ORM
queries always scope by `team_id` or `organization_id`. Storage paths in R2 are partitioned by
team ID.

### Decisions (Confirmed)

- **Storage provider:** Cloudflare R2 — all environments (dev, staging, prod). Separate buckets.
- **Metadata stays in PostgreSQL.** Only blob data lives in R2.
- **Cloud deployment trigger:** When concurrent media uploads exceed ~100 Mbps upload (Mac Studio
  ceiling), migrate to a cloud VM + R2. Self-hosted bandwidth is sufficient for ~1K users.

### Cloudflare R2 Pricing (Complete)

Source: [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)

#### Standard Storage

| Component | Rate | Free Tier |
|-----------|------|-----------|
| Storage | $0.015/GB/month | 10 GB/month |
| Egress (downloads, previews) | **$0 (free)** | — |
| Ingress (uploads) | **$0 (free)** | — |
| Class A ops (writes: PutObject, CopyObject, CreateMultipartUpload, UploadPart, CompleteMultipartUpload, ListObjects, etc.) | $4.50/million | 1M/month |
| Class B ops (reads: GetObject, HeadObject, HeadBucket, etc.) | $0.36/million | 10M/month |
| Deletes (DeleteObject, AbortMultipartUpload) | **$0 (free)** | — |

#### Infrequent Access Storage (for cold/archived assets)

| Component | Rate |
|-----------|------|
| Storage | $0.01/GB/month |
| Class A ops | $9.00/million |
| Class B ops | $0.90/million |
| Data retrieval | $0.01/GB |
| Minimum storage duration | 30 days (charged even if deleted earlier) |

#### Storage Cost Model (1K Users, 500 Orgs, 10 Posts/Day/Org)

| Metric | Value |
|--------|-------|
| New storage per org/month | ~4.9 GB (300 renders × 15 MB + 50 uploads × 8 MB) |
| New storage platform-wide/month | ~2.45 TB |
| **With 90-day retention (plateau)** | **~7.35 TB** |
| **R2 cost at plateau** | **~$110/month for all 500 orgs** |
| **R2 cost per org at plateau** | **~$0.22/month** |

#### R2 Operations Cost (1K Users)

| Operation | Monthly Volume | Free Tier | Cost |
|-----------|---------------|-----------|------|
| Writes (renders + uploads + thumbnails) | ~325,000 | 1M free | **$0** |
| Reads (previews + browsing + PULL_FROM_URL) | ~1,750,000 | 10M free | **$0** |

**At 1K users, R2 operations are entirely within the free tier.** Even at 10× volume, operations
cost ~$12/month. Operations do not need to be factored into plan pricing.

### Storage Billing Model: Tiered Base + Pay-Per-GB Overage

Storage is billed from the **prepaid credit wallet**: each plan tier includes a storage allocation.
When an org exceeds it, uploads consume credits at the transparent per-GB overage rate. At the hard
storage ceiling, new uploads are rejected with HTTP 402 while existing assets remain accessible.

This aligns with the overall billing philosophy:

```
Customer cost model:
├── Plan subscription (fixed)                  ← platform access + included storage
└── Prepaid credits consumed as usage happens  ← AI/video/image/voice/storage overage
```

#### Per-Organization Storage & Asset Limits

| Limit                       | Try Me         | Pro            | Agency         |
| --------------------------- | -------------- | -------------- | -------------- |
| Media uploads per org/month | 200            | 1,000          | 5,000          |
| AI renders per org/month    | 50             | 500            | 2,000          |
| Included storage per org    | 10 GB          | 100 GB         | 500 GB         |
| Storage overage rate        | $0.10/GB from credits | $0.10/GB from credits | $0.08/GB from credits |
| Hard storage ceiling        | 20 GB          | 200 GB         | 1 TB           |
| Max single file size        | 50 MB          | 50 MB          | 50 MB          |

#### How storage billing works

1. Each plan includes a base storage allocation (10 / 100 / 500 GB).
2. At **80% usage** → dashboard warning + email to org admin.
3. At **100% included storage** → overage is deducted from credits before upload completion.
4. At **zero available credits** → upload is rejected with a top-up/upgrade message.
5. At **hard ceiling** → upload is rejected regardless of credit balance.

#### Retention Policy (Configurable Per-Org)

Each plan comes with sensible default retention periods. Org admins can adjust them via
**Settings → Storage → Retention Policies**. When changing retention, the system forecasts the
storage and cost impact before the admin confirms — including estimated overage charges and a
recommendation to upgrade if the change would push them over their plan cap.

| Asset type | Default | Options |
|------------|---------|---------|
| Published renders | **90 days** after published to all intended platforms | 90 days / 6 months / Permanent |
| Failed/cancelled renders | **90 days** | 90 days / 6 months / Permanent |
| Soft-deleted assets | **90 days** | 90 days / 6 months / Permanent |
| Source uploads (images, audio) | **Permanent** | 90 days / 6 months / Permanent |
| Thumbnails | **Delete with parent** | Not configurable |

**Platform references:** After a render is deleted from R2, the system retains the platform post
reference (post ID, URL, thumbnail URL) in PostgreSQL — enough for the dashboard, no blob cost.

**90-day retention clock:** Starts only after the render has been published to **all intended
platforms**. Pending cross-posts keep the render alive.

See `use-cases/4.9-billing-and-pricing.md` for full retention forecast examples and overage
projection logic.

#### Margin Analysis (Pro plan, heavy user: 10 TikToks/day)

| Metric                                | Value                            |
| ------------------------------------- | -------------------------------- |
| New renders/month                     | 300 × 15 MB = 4.5 GB             |
| Rolling 90-day render retention       | ~13.5 GB                         |
| Source assets (cumulative, 12 months) | ~10 GB                           |
| **Steady-state total**                | **~24 GB — under 100 GB Pro allocation** |
| R2 cost at 100 GB                     | $1.50/month                      |
| R2 cost at steady-state (24 GB)       | $0.36/month                      |

Even a power user producing 10 videos/day stays under the Pro cap with retention policies. The
$0.10/GB overage rate (85% margin over R2's $0.015/GB) ensures storage is never loss-making, while
being trivial for customers ($2 extra for 20 GB overage).

### Open Questions (Resolved)

- ~~Storage capacity per post~~ → See system-design.md section 2.3 for per-file-type size estimates.
  Weighted average is ~8 MB for uploads, ~15 MB for TikTok renders.
- ~~Maximum storage allowance per org~~ → Tiered: 10 GB (Try Me), 100 GB (Pro), 500 GB (Agency)
  with prepaid credit overage and hard ceilings.
- ~~Bundled vs metered storage?~~ → Hybrid: generous base included in plan, pay-per-GB overage when
  exceeded, paid from credits before upload completion.

---

## 8. Open Questions Summary

### Important (affects architecture)

1. What are the acceptable latencies for content generation and posting?
2. How many users will be active simultaneously at peak?
3. What are the CPU and memory requirements per service? — **To be derived from self-hosted
   pilot.** Once real customer workloads run on Mac Studio, measure per-service resource usage
   (API, Temporal workers, Remotion rendering) via Prometheus/Grafana. These numbers feed directly
   into cloud VM sizing when we migrate to cloud.

### Good to resolve (affects pricing)

4. What are the monthly plan tiers and price points?
5. What is included in the base plan vs. usage-based?
6. ~~Is the 50 MB file upload limit sufficient for high-quality video?~~ → Confirmed 50 MB for now.
7. ~~What should the maximum storage allowance be per org?~~ → Tiered caps confirmed (see §7).
