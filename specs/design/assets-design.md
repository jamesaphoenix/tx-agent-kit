---
kind: spec
spec_type: design
doc_id: doc-fc7f10b04b8f
name: assets-design
title: "Assets"
status: active
version: 5
owners:
  - jamesaphoenix
summary: "Media asset storage, upload flow, metadata, search, retention, and prepaid storage metering on Cloudflare R2."
domain: assets
tags:
  - design
  - assets
  - storage
  - r2
depends_on: [tenancy-model-design]
supersedes: []
implements: assets-prd
last_reviewed_at: 2026-04-17
---

# Summary

**Asset storage must not be loss-making.** All blob storage uses Cloudflare R2 across all
environments (dev, staging, production) with zero egress cost. The system meters storage per
organization from day 1, enforces retention policies via a Retention Cleaner, and uses a
two-phase upload confirmation flow to prevent abuse.

This spec covers subsystems **#7 Asset Management**, **#8 Media Uploader**, and
**#9 Retention Cleaner**.

# Implementation Status

As of 2026-04-17, the launch MVP media library is implemented for authenticated team
usage: request/upload/confirm, local API upload proxy, R2 metadata verification,
storage metering and quota guards, asset list/get/delete, web multi-file upload/list/delete,
and server-side keyword search across filename plus AI metadata. The media page exposes
native multi-file drag-and-drop upload, compact card/list views with previews, a Collections
manager, collection filtering, per-asset add/remove collection actions, and selected-asset
bulk add/remove/delete actions. Media collection routes persist collection records and
collection membership, including team isolation checks when adding assets to a collection.

The KISS thumbnail pipeline is implemented for image and GIF uploads: upload confirmation
emits an `assets.thumbnail_requested` outbox event in the same transaction as the asset row,
the worker dispatches a Temporal child workflow, and the activity reads the original R2 object,
generates a bounded WebP preview, stores it under the asset thumbnail key, and writes
`team_media_assets.thumbnail_path`. The web UI asks the API for a thumbnail signed URL and
falls back to the original image/GIF URL while a thumbnail is not yet available.

Follow-up work remains for semantic/vector search, the full enrichment pipeline that
generates embeddings and structured outputs, video/PDF/audio thumbnails, and compression
or transcoding outputs. Until embeddings exist, semantic asset search is rejected explicitly
instead of silently degrading to a non-semantic list or keyword search. The separate agentic
AI asset search endpoint is specified in `temporal-workflows-design` and remains gated on
the embedding pipeline plus structured outputs per media type.

# Architecture

## Storage Provider: Cloudflare R2 (All Environments)

Cloudflare R2 is used for all environments -- local development, staging, and production. Same
S3-compatible API, same `@aws-sdk/client-s3` code, different buckets per environment.

| Environment | R2 Bucket | Endpoint |
|-------------|-----------|----------|
| Local dev | `tx-agent-kit-dev-{username}` | R2 S3 API |
| Staging | `tx-agent-kit-staging` | R2 S3 API |
| Production | `tx-agent-kit-prod` | R2 S3 API |

No self-hosted storage. No local S3 emulators. R2's free tier (10 GB storage, 10M reads, 1M
writes per month) covers local development with zero cost. Staging and production use the same
provider -- no environment parity issues.

**Environment config (only these values change between environments):**

```bash
# .env.dev / .env.staging / .env.prod
R2_ACCOUNT_ID=op://tx-agent-kit-services/{env}/R2_ACCOUNT_ID
R2_ACCESS_KEY_ID=op://tx-agent-kit-services/{env}/R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=op://tx-agent-kit-services/{env}/R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME=tx-agent-kit-{env}
R2_PUBLIC_URL=https://cdn-{env}.tx-agent-kit.local
```

### R2 Pricing

#### Standard Storage

| Component | Rate | Free Tier |
|-----------|------|-----------|
| Storage | $0.015/GB/month | 10 GB/month |
| Egress | **$0 (free)** | -- |
| Ingress | **$0 (free)** | -- |
| Class A ops (writes: PutObject, CopyObject, ListObjects, etc.) | $4.50/million | 1M/month |
| Class B ops (reads: GetObject, HeadObject, etc.) | $0.36/million | 10M/month |
| Deletes (DeleteObject, AbortMultipartUpload) | **$0 (free)** | -- |

#### Infrequent Access Storage (for cold/archived assets)

| Component | Rate |
|-----------|------|
| Storage | $0.01/GB/month |
| Class A ops | $9.00/million |
| Class B ops | $0.90/million |
| Data retrieval | $0.01/GB |
| Minimum storage duration | 30 days (charged even if deleted earlier) |

Zero egress eliminates the hidden cost killer. A team previewing a 30 MB video 50 times/month =
1.5 GB of egress -- on GCS that costs $0.18, on R2 it costs $0.

Source: [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)

## Storage Usage Model (1K Users)

### Assumptions

| Assumption | Value | Rationale |
|------------|-------|-----------|
| Organizations | ~500 | 1K users, ~2 users per org |
| Posts per org/day | 10 | Mix of manual + campaign posts |
| Posts per org/month | 300 | 10/day x 30 days |
| Render per post | 1 | AI video or Remotion slideshow |
| Average render size | 15 MB | Weighted: TikTok 15-30s marketing content |
| Source uploads per org/month | 50 | Brand images, audio, product shots |
| Average source file size | 8 MB | Weighted: images ~2 MB, videos ~30 MB, audio ~5 MB |
| Thumbnail per asset | 1 | ~50 KB each, negligible |

### Monthly Storage per Org

| Component | Calculation | New Storage/month |
|-----------|------------|-------------------|
| Renders | 300 posts x 15 MB | 4.5 GB |
| Source uploads | 50 files x 8 MB | 0.4 GB |
| Thumbnails | 350 x 50 KB | ~17 MB (negligible) |
| **Total new per org/month** | | **~4.9 GB** |

### R2 Operations per Month (1K Users, 500 Orgs)

| Operation | Monthly Volume | Free Tier | Billable | Cost |
|-----------|---------------|-----------|----------|------|
| **Writes (Class A)** | | **1M free** | | |
| Render uploads | 150,000 | | | |
| Thumbnail uploads | 150,000 | | | |
| Source uploads | 25,000 | | | |
| **Total writes** | **~325,000** | Within free tier | 0 | **$0** |
| **Reads (Class B)** | | **10M free** | | |
| Dashboard previews (1K users x 50/day x 30) | 1,500,000 | | | |
| Media library browsing | 100,000 | | | |
| TikTok PULL_FROM_URL | 150,000 | | | |
| **Total reads** | **~1,750,000** | Within free tier | 0 | **$0** |

**At 1K users, R2 operations are entirely within the free tier.** Even at 10x volume (~3.25M
writes, ~17.5M reads), operations cost ~$12/month. This is negligible and does not need to be
baked into the pricing model.

### R2 Storage Cost at Scale (500 Orgs)

| Month | Cumulative Storage (no deletion) | R2 Cost/month | With 90-day Retention |
|-------|----------------------------------|---------------|-----------------------|
| 1 | 2.45 TB | $36.75 | 2.45 TB / $36.75 |
| 3 | 7.35 TB | $110.25 | ~7.35 TB / $110.25 |
| 6 | 14.7 TB | $220.50 | ~7.35 TB / $110.25 (plateau) |
| 12 | 29.4 TB | $441.00 | ~7.35 TB / $110.25 (plateau) |

With 90-day render retention, storage plateaus at ~3 months of production. **R2 storage cost
stabilises at ~$110/month for 500 orgs.** Per-org R2 cost at plateau: ~$110 / 500 =
**$0.22/month per org**.

## Upload Confirmation Flow

Presigned URLs are not trusted for size enforcement. The upload flow uses a two-phase
confirmation:

1. **Request phase**: Client sends `{file_size, content_hash, mime_type}`. API checks
   dedup (existing `content_hash` match?), checks quota, creates a `pending_uploads` row
   -- does NOT yet touch active storage counters or `credits_balance`.
2. **Upload phase**: The client uploads bytes either directly to the returned presigned R2 URL
   or, on localhost/dev where browser-to-R2 CORS is brittle, through
   `PUT /v1/teams/:teamId/uploads/:uploadId/content`. The API-mediated path reads the binary
   request body, validates team ownership, status, content type, and exact content length, then
   writes the object through the same storage adapter.
3. **Confirm phase**: After upload completes (R2 Event or `POST /media/confirm/:id`),
   API verifies actual size via R2 `HeadObject`, creates the `team_media_assets` row from
   the verified size, and increments `storage_metering.active_bytes` plus
   `high_water_mark_bytes`.
4. **Expiry**: `pending_uploads` rows that expire without confirmation are cleaned up
   by the Retention Cleaner. R2 objects from abandoned uploads are deleted.

For direct presigned uploads, the URL is not the source of truth for size enforcement. The
confirm phase verifies the uploaded object with R2 `HeadObject`, compares it with the declared
size, deletes mismatched objects, and marks the pending upload failed. The local API upload proxy
also validates exact content length before writing bytes to R2. If the storage adapter later moves
from presigned `PUT` URLs to presigned POST policies, it must include a `content-length-range`
condition as an additional R2-side guard.

> **Implementation note (2026-04-16):** the web media page prefers the API upload proxy on
> `localhost` / `127.0.0.1` and uses direct presigned `PUT` elsewhere. This keeps local QA fast
> without requiring every developer to tune bucket CORS before testing media upload.

## Storage Architecture (Bucket Layout)

```
Bucket: team-media/
├── {team_id}/
│   ├── {uuid}_{original_filename}        # Original (or compressed) asset
│   └── {uuid}_{original_filename}_thumb   # WebP thumbnail
└── templates/
    └── {filename}                         # Shared system templates
```

Access control via S3 presigned URLs generated by the API (replaces Supabase RLS on
`storage.objects`). URLs expire after configurable TTL.

### At Scale (Cloudflare R2)

Same bucket structure, same key paths. Environment changes are bucket, endpoint, and credentials
only.

## Storage Service (R2 via S3 SDK)

```typescript
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const createStorageService = ({ s3Client, bucket }) => ({
  createSignedUrl: async ({ storagePath, expiresIn }) => {
    const command = new GetObjectCommand({ Bucket: bucket, Key: storagePath });
    return getSignedUrl(s3Client, command, { expiresIn });
  },
});
```

Same code works across all environments -- only the S3 endpoint URL, credentials, and bucket name
change via environment variables.

## Implementation: What Changes Where

The storage layer is cleanly abstracted. Two service files handle all storage operations, and the
frontend never talks to storage directly (API-first).

### Implemented Files

| File | Responsibility |
|------|----------------|
| `packages/infra/storage/src/client.ts` | R2/S3 client, presigned read/write URLs, object upload, metadata, delete, list |
| `packages/core/src/domains/assets/application/upload-service.ts` | Request/upload/confirm flow, deduplication, quota check, HeadObject verification, metering update |
| `packages/core/src/domains/assets/application/media-asset-service.ts` | Asset list/get/update/delete and signed original/thumbnail read URLs |
| `packages/core/src/domains/assets/application/asset-thumbnail-service.ts` | Async thumbnail generation orchestration for image/GIF assets |
| `packages/core/src/domains/assets/application/retention-cleaner-service.ts` | Expired upload cleanup, retained asset cleanup, org/team purge |
| `packages/core/src/domains/assets/application/storage-metering-service.ts` | Current usage and hard-cap quota checks |
| `apps/api/src/routes/assets.ts` | Authenticated asset upload, CRUD, signed URL, search, and collection routes |
| `apps/worker/src/workflows.ts` | Outbox dispatch and `assetThumbnailWorkflow` child workflow |
| `apps/worker/src/asset-thumbnail-generator.ts` | Sharp-backed WebP thumbnail generator with bounded input pixels and dimensions |
| `apps/api/src/routes/storage-metering.ts` | Organization storage usage/quota read endpoints |
| `packages/infra/db/drizzle/migrations/0034_assets_domain.sql` | Asset, pending upload, collection, and storage metering tables |
| `packages/infra/db/drizzle/migrations/0035_storage_billing_and_metadata.sql` | Asset metadata and storage metering high-water column |
| `packages/infra/db/drizzle/migrations/0038_billing_pricing_spec.sql` | `storage_usage` period rollups and billing usage schema |
| `apps/web/app/(application)/org/[orgId]/[teamId]/media/page.tsx` | Media management page using generated Orval asset hooks/functions |

### API Boundary Rules

| Rule | Rationale |
|------|-----------|
| Frontend talks to the API only | Storage credentials and tenancy checks remain server-side |
| `team_media_assets.storage_path` stores the R2 key | Provider details stay behind the storage adapter |
| Upload confirmation owns metering | Client-declared file size is never trusted for billing or quotas |

## Search

| Method | Technology | Index Type | Query Example |
|--------|-----------|-----------|---------------|
| Keyword | PostgreSQL full-text search | GIN on `tsvector` | "sunset beach" |
| Semantic | pgvector | IVFFlat on `vector_embedding` | "relaxing vacation mood" |
| Filtered | Standard B-tree | `(team_id, is_deleted)` | Combined with above |

**Current implementation:** keyword search is live and team-scoped. Semantic search remains
intentionally unavailable until embeddings are generated and indexed; `semantic=true` returns a
typed unsupported-semantic-search error rather than falling back to a weaker result set.

**Agentic search:** after embeddings and structured outputs per media type exist, Temporal
activities and agents use the dedicated `POST /teams/:teamId/assets/agent-search` endpoint
specified in `temporal-workflows-design`. That endpoint is separate from the human media-library
search route and remains disabled until its dependency gates are satisfied.

## Asset Size Reference

### Video Sizes by Duration

| Duration | Resolution | Codec | Bitrate | File Size |
|----------|-----------|-------|---------|-----------|
| 30 seconds | 1080x1920 (9:16) | H.264 | 8 Mbps | ~30 MB |
| 30 seconds | 1080x1920 (9:16) | H.265/HEVC | 5 Mbps | ~19 MB |
| 1 minute | 1080x1920 (9:16) | H.264 | 8 Mbps | ~60 MB |
| 1 minute | 1080x1920 (9:16) | H.265/HEVC | 5 Mbps | ~38 MB |
| 3 minutes | 1080x1920 (9:16) | H.264 | 8 Mbps | ~180 MB |
| 3 minutes | 1080x1920 (9:16) | H.265/HEVC | 5 Mbps | ~113 MB |
| 5 minutes | 1080x1920 (9:16) | H.264 | 8 Mbps | ~300 MB |
| 10 minutes | 1080x1920 (9:16) | H.264 | 8 Mbps | ~600 MB |

**TikTok typical content is 15-60 seconds.** Most generated content will be 15-30 second
slideshows (~15-30 MB in H.264, ~10-19 MB in H.265).

**Note:** The previous 50 MB upload limit was too low for 1+ minute H.264 videos. The current
asset upload contract raises user uploads to 200 MB, with transcoding/compression still available
to reduce stored bytes.

### Image Sizes by Resolution

| Resolution | Aspect Ratio | Use Case | JPEG (~85% quality) | WebP (~80% quality) | PNG |
|-----------|-------------|----------|--------------------|--------------------|-----|
| 1080x1920 | 9:16 (portrait) | TikTok, Instagram Stories, Reels | 300-800 KB | 150-400 KB | 2-6 MB |
| 1080x1080 | 1:1 (square) | Instagram Feed, Facebook | 200-600 KB | 100-300 KB | 1.5-4 MB |
| 1200x630 | ~1.9:1 (landscape) | Facebook/LinkedIn link previews | 200-500 KB | 100-250 KB | 1.5-4 MB |
| 1280x720 | 16:9 (landscape) | YouTube thumbnails | 150-400 KB | 80-200 KB | 1-3 MB |
| 400x400 | 1:1 | Thumbnail/preview | 30-80 KB | 15-40 KB | 200-500 KB |

### Recommended Resolutions by Platform

| Platform | Primary Format | Resolution | Aspect Ratio |
|----------|---------------|-----------|-------------|
| TikTok | Video / Slideshow | 1080x1920 | 9:16 |
| Instagram Reels | Video | 1080x1920 | 9:16 |
| Instagram Feed | Image / Carousel | 1080x1080 | 1:1 |
| Instagram Stories | Image / Video | 1080x1920 | 9:16 |
| Facebook Feed | Image / Video | 1080x1080 or 1200x630 | 1:1 or 1.9:1 |
| YouTube | Video | 1920x1080 | 16:9 |
| YouTube Shorts | Video | 1080x1920 | 9:16 |
| LinkedIn | Image | 1200x630 | 1.9:1 |
| Twitter/X | Image | 1200x675 | 16:9 |

## Compression Strategy

| Format | Strategy | Savings |
|--------|----------|---------|
| Video uploads | Transcode to H.265/HEVC at 5 Mbps target bitrate | 35-40% smaller than H.264 |
| Video renders | Generate directly in H.265 from FFmpeg pipeline | Already optimised at source |
| Image uploads | Convert to WebP, strip EXIF metadata | 40-60% smaller than JPEG |
| Image uploads (PNG) | Convert to WebP if photographic, keep PNG only for graphics with transparency | 70-90% smaller |
| Thumbnails | Generate bounded WebP previews up to 512px on the longest side, quality ~82% | ~20-80 KB each |

**Storage impact of compression at 1K users (200 teams):**

| Scenario | Monthly Upload Volume | Without Compression | With Compression |
|----------|----------------------|--------------------|--------------------|
| Images (50 uploads x 500 KB avg) | 200 teams x 25 MB | 5 GB/month | ~2.5 GB/month |
| Videos (20 renders x 30 MB avg) | 200 teams x 600 MB | 120 GB/month | ~72 GB/month |
| **Total new data/month** | | **125 GB** | **~75 GB** |
| **Cumulative at 12 months** | | **1.5 TB** | **~900 GB** |

Compression saves ~40% storage volume, which directly reduces cost regardless of provider.

## Cost Reduction Strategies

| Strategy | Saving | Complexity |
|----------|--------|-----------|
| **Aggressive retention** -- hard-delete soft-deleted assets after 1-2 days (default 48h) | Prevents indefinite growth | Low |
| **Thumbnail-only previews** -- serve thumbnails in library, full asset only on click | Reduces egress by ~80%; implemented for image/GIF assets | Medium |
| **Video compression** -- transcode uploads to H.265/HEVC at target bitrate | Reduces video size by 30-50% | Medium |
| **Image compression** -- convert uploads to WebP, strip EXIF | Reduces image size by 40-60% | Low |
| **Deduplication** -- hash-based dedup for identical uploads across teams | Prevents redundant storage | Medium |
| **CDN caching** -- cache popular assets at edge (free with Cloudflare Tunnel) | Reduces origin reads | Low |
| **Async generation** -- create stored thumbnails through an outbox-triggered Temporal workflow | Keeps uploads responsive and avoids regenerating hot previews | Low |
| **Per-org quotas** -- hard limit on storage per plan tier | Caps worst-case cost | Low |

## Cost Metering & Storage Billing

Storage is metered from day 1 so the system can enforce per-organization storage limits and
recover overage cost through the prepaid credit wallet. The current model is the same one locked
in by `billing-and-pricing-design`: flat-rate subscription access plus prepaid storage overage,
with hard ceilings at 2x plan storage.

### Billing Model

#### Plan Storage Allowances

Each plan includes a storage allowance. Overage beyond the allowance is charged from credits.

| Plan | Price | Included Storage | Hard Ceiling (2x) | Our R2 Cost at Included Storage | Margin |
|------|-------|------------------|-------------------|---------------------------------|--------|
| **Try Me** | $19/mo | 10 GB | 20 GB | $0.15/mo | 99.2% |
| **Pro** | $49/mo | 100 GB | 200 GB | $1.50/mo | 96.9% |
| **Agency** | $199/mo | 500 GB | 1 TB | $7.50/mo | 96.2% |

#### Plan Feature Comparison

| Feature | Try Me ($19/mo) | Pro ($49/mo) | Agency ($199/mo) |
|---------|-----------------|---------------|-------------------|
| **Storage included** | 10 GB | 100 GB | 500 GB |
| **Storage hard cap** | 20 GB (2x) | 200 GB (2x) | 1 TB (2x) |
| **Team members** | Unlimited | Unlimited | Unlimited |
| **AI credits included** | None | None | None |
| **Welcome credit** | $9 one-time | $20 one-time | $45 one-time |
| **Storage overage rate** | $0.10/GB/mo from credits | $0.10/GB/mo from credits | $0.08/GB/mo from credits |
| **Auto-recharge** | User opt-in | User opt-in | User opt-in |

#### Storage Cost Economics

R2 charges $0.015/GB/month. The current billing design charges storage overage from prepaid
credits at $0.10/GB/month for Try Me / Pro and $0.08/GB/month for Agency, with the billing
service applying the standard 1.10x usage margin. This keeps storage comfortably profitable
while making overage legible to customers.

**Break-even analysis per plan:**

| Plan | Included Storage | Our R2 Cost | Plan Price | Storage % of Revenue |
|------|------------------|-------------|------------|----------------------|
| Try Me (10 GB) | $0.15/mo | $19/mo | 0.8% |
| Pro (100 GB) | $1.50/mo | $49/mo | 3.1% |
| Agency (500 GB) | $7.50/mo | $199/mo | 3.8% |

Even at maximum overage (2x cap), storage cost is bounded:

| Plan | Max Storage (2x) | Max R2 Cost | Overage Revenue | Net |
|------|------------------|-------------|-----------------|-----|
| Try Me (20 GB) | $0.30/mo | $1.00/mo | +$0.70 |
| Pro (200 GB) | $3.00/mo | $10.00/mo | +$7.00 |
| Agency (1 TB) | $15.00/mo | $40.00/mo | +$25.00 |

Storage is never loss-making at any scale.

#### Real-Time Metering

Storage metering has two counters:

- `active_bytes`: current bytes held by active, non-deleted assets. This is the real-time source
  for quota checks.
- `high_water_mark_bytes`: peak bytes seen by the organization during the current metering
  window. Deletes reduce `active_bytes` but never reduce the high-water mark for that window.

#### Overage & Credit Deduction Flow

```
1. User requests an upload
   |
2. Upload guard projects storage_metering.active_bytes + declared_file_size
   | within included storage -> allow upload
   | above included storage but below hard cap -> require sufficient credits for overage
   | above hard cap -> reject with HTTP 402
   |
3. Client uploads bytes
   |
4. Confirm phase verifies actual R2 HeadObject size
   |
5. Asset row is created with actual size and storage_metering updates active/high-water bytes
```

#### Hard Cap Behavior (2x Plan)

When storage reaches 2x the plan's included bytes:
- **New uploads rejected** with HTTP 402 (Payment Required)
- **Existing assets remain accessible** (signed URLs, downloads, previews)
- **User prompted to upgrade** plan, add credits if relevant, or delete assets to free space

### What to Measure

| Metric | Source | How | Granularity |
|--------|--------|-----|-------------|
| **Current active bytes** | `storage_metering.active_bytes` | Updated atomically on confirm/delete | Per org, real-time |
| **High-water mark bytes** | `storage_metering.high_water_mark_bytes` | `GREATEST(previous_high_water, active_bytes + delta)` on upload | Per org, metering window |
| **Bytes stored (uploads)** | `team_media_assets.file_size` | `SUM(file_size) WHERE is_deleted = false` grouped by org | Per org |
| **Upload volume** | `team_media_assets.file_size` for assets created in period | `SUM(file_size) WHERE created_at > interval` | Per org, period |
| **Period rollup** | `storage_usage.current_bytes` | One row per org/billing period for reconciliation | Per org, billing period |
| **Egress** | R2 has zero egress cost | N/A -- $0 regardless of access volume | -- |

### Data Model: `storage_usage`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `org_id` | UUID (FK) | Ownership |
| `period_start` | TIMESTAMPTZ | Billing period start |
| `period_end` | TIMESTAMPTZ | Billing period end |
| `current_bytes` | BIGINT | Storage used for the period rollup |
| `plan_storage_limit` | BIGINT | Plan allowance snapshotted for the period |
| `plan_tier` | TEXT | Plan tier snapshotted for the period |
| UNIQUE | `(org_id, period_start)` | One storage rollup per org per period |

### Billing Ledger Rule (Non-Negotiable)

The billing system must use an append-only ledger with idempotent writes. Build charges from:

1. Database facts (`team_media_assets.file_size`, deletion state, ownership)
2. Real-time storage counters (`storage_metering`)
3. Period rollups (`storage_usage`)
4. R2 usage analytics for operation counts
5. Reconciliation jobs against R2 dashboard

Never deduct credits directly from volatile metrics counters. The `credit_ledger` is the single
source of truth for storage overage debits.

## Compute: Self-Hosted to Hetzner Cloud VM

Day 1 runs on Mac Studio. When we outgrow local bandwidth or need higher availability, we migrate
to **Hetzner Cloud VMs** (EU) -- not Kubernetes. Simple Docker Compose on a VM, same containers.

```
+---------------------------------------------------------+
|  DAY 1: MAC STUDIO                                      |
|  +----------+  +----------+  +------------------------+ |
|  | Effect   |  | Temporal |  | Redis                  | |
|  | HttpApi  |  | Workers  |  |                        | |
|  +----------+  +----------+  +------------------------+ |
|  Storage: Cloudflare R2 (dev bucket)                    |
+---------------------------------------------------------+
        <-> Cloudflare Tunnel (storage + API)

+---------------------------------------------------------+
|  SCALE: HETZNER CLOUD VMs (EU)                          |
|  +------------------------------+  +-------------------+ |
|  | VM 1: CAX31 (8 ARM / 16 GB) |  | VM 2: CAX21       | |
|  | - Effect HttpApi             |  | (4 ARM / 8 GB)    | |
|  | - Temporal Workers (I/O)     |  | - Remotion render  | |
|  | - Redis                      |  | (headless Chrome)  | |
|  | ~EUR14.49/mo                 |  | ~EUR7.49/mo        | |
|  +------------------------------+  +-------------------+ |
|                                                         |
|  Temporal Cloud ($100/mo)     External AI APIs          |
|  Supabase (EU region)         OpenRouter, fal.ai, etc.  |
|  Cloudflare R2 (storage)      Cloudflare CDN (edge)     |
+---------------------------------------------------------+
```

In production, the split is:
- **Storage**: Cloudflare R2 (zero egress, S3-compatible)
- **Compute**: Hetzner Cloud VMs (EU) -- Docker Compose, no Kubernetes
- **Workflows**: Temporal Cloud ($100/mo managed)
- **Database**: Supabase (EU region -- colocated with Hetzner for low latency)
- **AI providers**: OpenRouter (multi-model), fal.ai (video), ElevenLabs (audio) -- always external APIs
- **CDN**: Cloudflare edge (always, free)

**Why Hetzner over GCP/AWS:**
- CAX31 (8 ARM / 16 GB / 20 TB bandwidth) = EUR14.49/mo. Equivalent on GCP = $60-80/mo.
- 20 TB included bandwidth eliminates egress surprises.
- EU datacenter colocates with Supabase EU for minimal latency.
- Simple VMs with Docker Compose -- no Kubernetes operational overhead for a 2-person team.

## Governance

| Concern | Implementation | Decision Needed |
|---------|---------------|-----------------|
| Tenant isolation | Team-level RLS (database) + presigned URLs (storage) | Cross-team sharing within org? |
| GDPR right to delete | Organization deletion triggers hard-delete workflow across DB + object storage | **Required** -- delete all org data on org deletion |
| Tagging | AI auto-tags + manual freeform tags | Controlled taxonomy needed? |
| Compression | Recommended: WebP for images, H.265 for video on upload | Accept quality tradeoff for 35-60% storage saving? |
| Encryption at rest | R2 (AES-256 server-side encryption) | Sufficient -- managed by Cloudflare |

## Unified Permission System (Org + Team)

### Roles

Unified `admin` / `member` / `viewer` at both org and team levels. Org ownership is
tracked via `organizations.owner_user_id` (not a role).

### Role → Permission Mapping

| Permission | Admin | Member | Viewer |
|-----------|-------|--------|--------|
| `view_organization` | yes | yes | yes |
| `view_workflows` | yes | yes | yes |
| `view_analytics` | yes | yes | yes |
| `view_assets` | yes | yes | yes |
| `create_teams` | yes | yes | no |
| `create_workflows` | yes | yes | no |
| `edit_workflows` | yes | yes | no |
| `execute_workflows` | yes | yes | no |
| `upload_assets` | yes | yes | no |
| `manage_assets` | yes | yes | no |
| `delete_assets` | yes | yes | no |
| `delete_workflows` | yes | yes | no |
| `export_analytics` | yes | yes | no |
| `manage_organization` | yes | no | no |
| `manage_organization_members` | yes | no | no |
| `manage_billing` | yes | no | no |
| `manage_team_members` | yes | no | no |
| `assign_roles` | yes | no | no |
| `delete_teams` | yes | no | no |
| `manage_integrations` | yes | no | no |
| `manage_api_keys` | yes | no | no |

### Membership Types and Auto-Join

| Type | On org invite accepted | On new team created | Default team role |
|------|----------------------|--------------------|----|
| `team` | Auto-added to ALL existing teams | Auto-added to new team | `member` |
| `client` | Added to specific invited team(s) only | NOT auto-added | Specified on invite |

DB triggers enforce auto-join:
- `auto_join_teams_on_org_member_insert` — when `team`-type member joins org, INSERT into
  `team_members` for every team in the org with role `member`
- `auto_add_org_members_on_team_create` — when a new team is created, INSERT all `team`-type
  org members into `team_members` with role `member`

### Asset Permission Enforcement

| Operation | Permission | Check Level |
|-----------|-----------|-------------|
| List/get/search assets | `view_assets` | Team |
| Upload assets | `upload_assets` | Team |
| Edit asset metadata | `manage_assets` | Team |
| Delete assets | `delete_assets` | Team |
| Manage collections | `manage_assets` | Team |
| View storage usage | `view_assets` | Org |
| Manage billing | `manage_billing` | Org |
| Add/remove team members | `manage_team_members` | Team |

### Frontend Role Gating

Components:
- `RequirePermission` — hides children when user lacks permission
- `RequireRole` — redirects entire page when user lacks required role
- `usePermissions()` hook — returns `{ hasPermission, role, isAdmin, isMember, isViewer }`

Pages:
- Settings pages → admin only (redirect)
- Media page → upload/delete buttons hidden for viewer
- Members page → invite/role controls hidden for non-admin
- Sidebar nav → settings links hidden for non-admin

# Data Model

## `team_media_assets`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `team_id` | UUID (FK) | Ownership / isolation |
| `original_filename` | TEXT | Upload name |
| `file_size` | BIGINT | Bytes -- **used for billing metering** |
| `mime_type` | TEXT | Content type |
| `asset_type` | ENUM | `image`, `video`, `audio`, `gif`, `document` |
| `storage_path` | TEXT | Bucket path (R2 S3 key) |
| `thumbnail_path` | TEXT | Stored WebP thumbnail path when an async thumbnail has been generated |
| `ai_title` | TEXT | AI-generated title |
| `ai_description` | TEXT | AI-generated description |
| `ai_tags` | TEXT[] | AI-assigned tag array |
| `vector_embedding` | vector(3072) | Google multimodal embedding for semantic search ([Vertex AI multimodal embeddings](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings), [Gemini Embedding](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)) |
| `content_category` | TEXT | Classified category |
| `emotion` | JSONB | Emotion analysis |
| `purpose` | TEXT[] | Inferred use cases |
| `is_deleted` | BOOLEAN | Soft delete flag |
| `deleted_at` | TIMESTAMPTZ | Deletion timestamp |
| `content_hash` | TEXT (nullable) | SHA-256 hex digest for deduplication. Pre-upload lookup returns existing asset if hash matches. UNIQUE index on `(team_id, content_hash) WHERE is_deleted = false`. |
| `processing_status` | ENUM | `pending`, `processing`, `completed`, `failed` -- asset lifecycle/enrichment state. Current uploads confirm as `completed`; future compression/transcoding may use processing states. |
| `processing_error` | TEXT (nullable) | Error details from thumbnail generation, transcoding, or other enrichment steps |
| `embedding_generated_at` | TIMESTAMPTZ (nullable) | When the vector embedding was last generated. Used to detect staleness after metadata edits. |
| `embedding_model` | TEXT (nullable) | Which model generated the embedding (for re-indexing on model upgrade) |
| `hard_deleted_at` | TIMESTAMPTZ (nullable) | Idempotency flag for the Retention Cleaner. If set, R2 object already deleted. |
| `shared_with_org` | BOOLEAN DEFAULT false | When `true`, asset is visible to all teams within the same organization. Enables cross-team shared asset libraries for agencies managing multiple brands. |

# Interfaces

```typescript
import { Context, type Option } from 'effect'
import type * as Effect from 'effect/Effect'
import type { ListParams, PaginatedResult } from '../../../pagination.js'

// ---------------------------------------------------------------------------
// Domain record types (representative -- actual fields mirror the data model)
// All single-record return types use Effect's Option<T> instead of T | null.
// ---------------------------------------------------------------------------

type MediaAssetRecord = {
  readonly id: string
  readonly teamId: string
  readonly originalFilename: string
  readonly fileSize: number
  readonly mimeType: string
  readonly assetType: 'image' | 'video' | 'audio' | 'gif' | 'document'
  readonly storagePath: string
  readonly thumbnailPath: string | null
  readonly aiTitle: string | null
  readonly aiDescription: string | null
  readonly aiTags: ReadonlyArray<string>
  readonly contentHash: string | null
  readonly processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  readonly processingError: string | null
  readonly isDeleted: boolean
  readonly deletedAt: Date | null
  readonly hardDeletedAt: Date | null
  readonly sharedWithOrg: boolean
  readonly createdAt: Date
  readonly updatedAt: Date
}

type PendingUploadRecord = {
  readonly id: string
  readonly teamId: string
  readonly userId: string
  readonly declaredFileSize: number
  readonly contentHash: string | null
  readonly mimeType: string
  readonly storagePath: string
  readonly presignedUrl: string
  readonly status: 'pending' | 'confirmed' | 'expired' | 'failed'
  readonly expiresAt: Date
  readonly createdAt: Date
}

type StorageMeteringRecord = {
  readonly organizationId: string
  readonly activeBytes: number
  readonly softDeletedBytes: number
  readonly activeAssetCount: number
  readonly softDeletedAssetCount: number
  readonly measuredAt: Date
}

type CollectionRecord = {
  readonly id: string
  readonly teamId: string
  readonly name: string
  readonly description: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

// ---------------------------------------------------------------------------
// Store Ports (persistence seams)
// ---------------------------------------------------------------------------

export class MediaAssetStorePort extends Context.Tag('MediaAssetStorePort')<
  MediaAssetStorePort,
  {
    list: (teamId: string, params: ListParams) => Effect.Effect<PaginatedResult<MediaAssetRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    getByIdIncludeDeleted: (id: string) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    getManyByIds: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<MediaAssetRecord>, unknown>
    findByContentHash: (teamId: string, contentHash: string) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    create: (input: {
      id?: string
      teamId: string
      originalFilename: string
      fileSize: number
      mimeType: string
      assetType: 'image' | 'video' | 'audio' | 'gif' | 'document'
      storagePath: string
      thumbnailPath: string | null
      contentHash: string | null
      outboxEvent?: {
        eventType: 'assets.thumbnail_requested'
        aggregateType: 'assets'
        aggregateId: string
        payload: Record<string, unknown>
      }
    }) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    update: (input: {
      id: string
      aiTitle?: string | null
      aiDescription?: string | null
      aiTags?: ReadonlyArray<string>
      thumbnailPath?: string | null
      processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
      processingError?: string | null
      sharedWithOrg?: boolean
    }) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    softDelete: (id: string) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    hardDelete: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    markHardDeleted: (id: string) => Effect.Effect<Option.Option<MediaAssetRecord>, unknown>
    listSoftDeletedForRetention: (input: {
      olderThan: Date
      limit: number
    }) => Effect.Effect<ReadonlyArray<MediaAssetRecord>, unknown>
    listByOrganization: (organizationId: string, params: ListParams) => Effect.Effect<PaginatedResult<MediaAssetRecord>, unknown>
  }
>() {}

export class PendingUploadStorePort extends Context.Tag('PendingUploadStorePort')<
  PendingUploadStorePort,
  {
    getById: (id: string) => Effect.Effect<Option.Option<PendingUploadRecord>, unknown>
    create: (input: {
      teamId: string
      userId: string
      declaredFileSize: number
      contentHash: string | null
      mimeType: string
      storagePath: string
      presignedUrl: string
      expiresAt: Date
    }) => Effect.Effect<Option.Option<PendingUploadRecord>, unknown>
    confirm: (id: string) => Effect.Effect<Option.Option<PendingUploadRecord>, unknown>
    markExpired: (id: string) => Effect.Effect<Option.Option<PendingUploadRecord>, unknown>
    markFailed: (id: string) => Effect.Effect<Option.Option<PendingUploadRecord>, unknown>
    listExpired: (now: Date, limit: number) => Effect.Effect<ReadonlyArray<PendingUploadRecord>, unknown>
  }
>() {}

export class StorageMeteringPort extends Context.Tag('StorageMeteringPort')<
  StorageMeteringPort,
  {
    getForOrganization: (organizationId: string) => Effect.Effect<Option.Option<StorageMeteringRecord>, unknown>
    incrementBytes: (organizationId: string, deltaBytes: number) => Effect.Effect<void, unknown>
    decrementBytes: (organizationId: string, deltaBytes: number) => Effect.Effect<void, unknown>
    snapshot: (organizationId: string) => Effect.Effect<StorageMeteringRecord, unknown>
  }
>() {}

export class CollectionStorePort extends Context.Tag('CollectionStorePort')<
  CollectionStorePort,
  {
    list: (teamId: string, params: ListParams) => Effect.Effect<PaginatedResult<CollectionRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<CollectionRecord>, unknown>
    create: (input: {
      teamId: string
      name: string
      description: string | null
    }) => Effect.Effect<Option.Option<CollectionRecord>, unknown>
    update: (input: {
      id: string
      name?: string
      description?: string | null
    }) => Effect.Effect<Option.Option<CollectionRecord>, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    addAsset: (collectionId: string, assetId: string) => Effect.Effect<void, unknown>
    removeAsset: (collectionId: string, assetId: string) => Effect.Effect<void, unknown>
    listAssets: (collectionId: string, params: ListParams) => Effect.Effect<PaginatedResult<MediaAssetRecord>, unknown>
  }
>() {}

// ---------------------------------------------------------------------------
// Adapter Ports (external systems)
// ---------------------------------------------------------------------------

export class StorageAdapterPort extends Context.Tag('StorageAdapterPort')<
  StorageAdapterPort,
  {
    /** Generate a presigned PUT URL. Confirm still verifies R2 metadata before creating the asset. */
    createPresignedUploadUrl: (input: {
      storagePath: string
      mimeType: string
      maxBytes: number
      expiresInSeconds: number
    }) => Effect.Effect<{ url: string; expiresAt: Date }, unknown>
    /** Generate a presigned GET URL for reading an asset. */
    createPresignedReadUrl: (input: {
      storagePath: string
      expiresInSeconds: number
    }) => Effect.Effect<string, unknown>
    /** Verify actual object size via HeadObject. */
    headObject: (storagePath: string) => Effect.Effect<{ size: number; contentType: string }, unknown>
    /** Read object bytes for worker-side enrichment such as thumbnail generation. */
    getObject: (storagePath: string) => Effect.Effect<Uint8Array, unknown>
    /** Delete an object from storage. */
    deleteObject: (storagePath: string) => Effect.Effect<void, unknown>
    /** Delete multiple objects in a batch. */
    deleteObjects: (storagePaths: ReadonlyArray<string>) => Effect.Effect<void, unknown>
  }
>() {}

export class ThumbnailGeneratorPort extends Context.Tag('ThumbnailGeneratorPort')<
  ThumbnailGeneratorPort,
  {
    generate: (input: {
      bytes: Uint8Array
      mimeType: string
    }) => Effect.Effect<{
      bytes: Uint8Array
      mimeType: 'image/webp'
      extension: 'webp'
    }, unknown>
  }
>() {}

// ---------------------------------------------------------------------------
// Application Services
// ---------------------------------------------------------------------------

export class UploadService extends Context.Tag('UploadService')<
  UploadService,
  {
    /** Phase 1: validate, check dedup, check quota, create pending_uploads row, return presigned URL. */
    requestUpload: (input: {
      teamId: string
      userId: string
      fileName: string
      fileSize: number
      contentHash: string | null
      mimeType: string
    }) => Effect.Effect<{
      uploadId: string
      presignedUrl: string
      deduplicated: boolean
      existingAssetId: string | null
    }, unknown>
    /** Optional upload proxy: stream bytes to storage through the API for local/dev CORS-safe upload. */
    uploadContent: (
      teamId: string,
      uploadId: string,
      body: Uint8Array,
      contentType: string
    ) => Effect.Effect<{ uploaded: true }, unknown>
    /** Phase 2: verify via HeadObject, create asset, and meter storage from actual bytes. */
    confirmUpload: (uploadId: string) => Effect.Effect<MediaAssetRecord, unknown>
  }
>() {}

export class MediaAssetService extends Context.Tag('MediaAssetService')<
  MediaAssetService,
  {
    getById: (teamId: string, assetId: string) => Effect.Effect<MediaAssetRecord, unknown>
    list: (teamId: string, params: ListParams) => Effect.Effect<PaginatedResult<MediaAssetRecord>, unknown>
    softDelete: (teamId: string, assetId: string) => Effect.Effect<MediaAssetRecord, unknown>
    updateMetadata: (input: {
      teamId: string
      assetId: string
      aiTitle?: string | null
      aiDescription?: string | null
      aiTags?: ReadonlyArray<string>
    }) => Effect.Effect<MediaAssetRecord, unknown>
    getSignedUrl: (teamId: string, assetId: string) => Effect.Effect<string, unknown>
    getThumbnailSignedUrl: (teamId: string, assetId: string) => Effect.Effect<string | null, unknown>
    search: (input: {
      teamId: string
      query: string
      semantic: boolean
      params: ListParams
    }) => Effect.Effect<PaginatedResult<MediaAssetRecord>, unknown>
  }
>() {}

export class AssetThumbnailService extends Context.Tag('AssetThumbnailService')<
  AssetThumbnailService,
  {
    generateForAsset: (input: {
      teamId: string
      assetId: string
    }) => Effect.Effect<{ generated: boolean; skippedReason?: string }, unknown>
  }
>() {}

export class StorageMeteringService extends Context.Tag('StorageMeteringService')<
  StorageMeteringService,
  {
    /** Get current storage usage for an organization. */
    getUsage: (organizationId: string) => Effect.Effect<StorageMeteringRecord, unknown>
    /** Project an upload against plan allowance, overage zone, and hard cap. */
    checkQuota: (organizationId: string, additionalBytes: number) => Effect.Effect<{
      allowed: boolean
      hasSubscription: boolean
      inOverage: boolean
      currentBytes: number
      includedBytes: number
      hardCapBytes: number
    }, unknown>
  }
>() {}

export class RetentionCleanerService extends Context.Tag('RetentionCleanerService')<
  RetentionCleanerService,
  {
    /** Clean up expired pending uploads: delete R2 objects, mark rows expired. */
    cleanExpiredUploads: () => Effect.Effect<number, unknown>
    /** Hard-delete soft-deleted assets past retention window, excluding referenced assets. */
    cleanRetainedAssets: (retentionHours: number) => Effect.Effect<number, unknown>
    /** Hard-delete all assets for a deleted organization (GDPR). */
    purgeOrganization: (organizationId: string) => Effect.Effect<number, unknown>
  }
>() {}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

/*
  Uploads
    POST   /teams/:teamId/uploads/request             -> request upload (phase 1)
    PUT    /teams/:teamId/uploads/:uploadId/content    -> optional API upload proxy
    POST   /teams/:teamId/uploads/:uploadId/confirm    -> confirm upload (phase 2)

  Media Assets
    GET    /teams/:teamId/assets                       -> list assets (paginated)
    GET    /teams/:teamId/assets/:assetId              -> get asset details
    PATCH  /teams/:teamId/assets/:assetId              -> update metadata
    DELETE /teams/:teamId/assets/:assetId              -> soft-delete asset
    GET    /teams/:teamId/assets/:assetId/url          -> get presigned read URL
    GET    /teams/:teamId/assets/:assetId/thumbnail-url -> get presigned thumbnail URL if generated
    GET    /teams/:teamId/assets/search                -> keyword/semantic search

  Collections
    GET    /teams/:teamId/collections                  -> list collections (paginated)
    POST   /teams/:teamId/collections                  -> create collection
    PATCH  /teams/:teamId/collections/:collectionId    -> update collection
    DELETE /teams/:teamId/collections/:collectionId    -> delete collection
    GET    /teams/:teamId/collections/:collectionId/assets -> list assets in collection
    POST   /teams/:teamId/collections/:collectionId/assets -> add asset to collection
    DELETE /teams/:teamId/collections/:collectionId/assets/:assetId -> remove asset

  Storage Metering
    GET    /organizations/:orgId/storage/usage         -> get storage usage
    GET    /organizations/:orgId/storage/quota          -> check quota status
*/
```

## Storage Decisions Summary

| # | Decision | Chosen | Rationale |
|---|----------|--------|-----------|
| 1 | Storage provider (all environments) | **Cloudflare R2** | S3-compatible, zero egress, $0.015/GB. Same provider for dev/staging/prod. |
| 2 | Local dev storage | **R2 dev bucket** (free tier: 10 GB) | No local S3 emulators. Same code, same provider, different bucket. |
| 3 | ~~Migration target~~ | N/A | No migration needed -- R2 from day 1 |
| 4 | Cost metering from day 1 | **Yes** -- per-org bytes + egress + operations, written to immutable ledger | Prevents loss-making storage and supports auditable billing |
| 5 | Upload limit | **Raise to 200 MB** (from 50 MB) | 1-minute H.264 video = ~60 MB, current limit too low |
| 6 | Compression on upload | **Yes** -- WebP for images, H.265 for video | 35-60% storage reduction, direct cost saving |
| 7 | CDN | **Cloudflare edge** | Reduces origin egress by 60-80%, handles global distribution |
| 8 | Retention for soft deletes | **1-2 days** (default 48h, asset-level soft delete only) | Organization deletion is hard-delete (no retention) |
| 9 | Per-org storage quota | **Try Me 10 GB, Pro 100 GB, Agency 500 GB; 2x hard cap** | Caps worst-case cost per customer and matches billing constants |
| 10 | Compute location | **Hetzner Cloud VMs (EU) + Temporal Cloud** | Simple Docker Compose on VMs, colocated with Supabase EU |

# Invariants

```yaml
invariants:
  - id: INV-AST-001
    statement: >
      Upload confirmation must happen within 60 minutes of the presigned URL being
      issued. If the confirm phase does not complete within this window, the
      pending_uploads row is treated as abandoned. The Retention Cleaner deletes the
      orphaned R2 object and marks the row as expired.
    severity: critical
    verified_by:
      - REQ-AST-001

  - id: INV-AST-002
    statement: >
      All team_media_assets rows must have a non-null team_id. No unscoped assets
      are permitted. API endpoints must validate team membership before creating or
      querying assets.
    severity: critical
    verified_by:
      - REQ-AST-002

  - id: INV-AST-003
    statement: >
      The Retention Cleaner must only hard-delete assets that have already been
      soft-deleted, are older than the retention window, and do not have
      hard_deleted_at set. Active assets are never retention-cleaner candidates.
      Campaign/publishing references must pin or copy asset usage before
      scheduled-post deletion semantics are introduced.
    severity: critical
    verified_by:
      - REQ-AST-003

  - id: INV-AST-004
    statement: >
      Storage metering must be accurate with no double-counting. The confirm phase
      increments storage_metering.active_bytes from the actual file size returned by
      R2 HeadObject, not the client-declared size. Soft-deleted assets are excluded
      from active_bytes counts. storage_metering.active_bytes is the real-time
      source of truth for quota checks and storage_usage is the period rollup for
      reconciliation.
    severity: critical
    verified_by:
      - REQ-AST-004

  - id: INV-AST-005
    statement: >
      The billing system must use an append-only ledger with idempotent writes.
      Credits must never be deducted from volatile metrics counters. Charges are
      built from database facts (team_media_assets.file_size, deletion state,
      ownership), storage_metering counters, storage_usage period rollups, and
      reconciliation jobs against R2 analytics.
    severity: critical
    verified_by:
      - REQ-AST-005

  - id: INV-AST-006
    statement: >
      Direct presigned upload URLs must not be trusted as the source of size truth.
      The API upload proxy rejects bodies whose exact byte length differs from the
      requested size, and the confirm phase must verify R2 HeadObject size against
      the pending_uploads.declared_file_size before creating an asset or updating
      metering. Mismatched objects are deleted and the pending upload is marked
      failed.
    severity: high
    verified_by:
      - REQ-AST-006

  - id: INV-AST-007
    statement: >
      Pre-upload deduplication uses content_hash (SHA-256). If an active (non-deleted)
      asset with the same team_id and content_hash exists, the upload is skipped and
      the existing asset is returned. UNIQUE index on (team_id, content_hash) WHERE
      is_deleted = false enforces this at the DB level.
    severity: high
    verified_by:
      - REQ-AST-007

  - id: INV-AST-008
    statement: >
      The Retention Cleaner uses hard_deleted_at as an idempotency flag. If set, the
      R2 object has already been deleted and the cleaner skips the row. This prevents
      double-delete errors and ensures the cleaner is safe to re-run.
    severity: high
    verified_by:
      - REQ-AST-008

  - id: INV-AST-009
    statement: >
      Organization deletion triggers a hard-delete workflow that removes all assets
      across all teams in the org from both PostgreSQL and R2 object storage. No
      retention period applies to org-level deletion (GDPR right to delete).
    severity: critical
    verified_by:
      - REQ-AST-009

  - id: INV-AST-010
    statement: >
      The confirm phase must verify actual file size via R2 HeadObject and use that
      value (not the client-declared file_size) for billing, metering, and the
      team_media_assets.file_size column.
    severity: high
    verified_by:
      - REQ-AST-010

  - id: INV-AST-011
    statement: >
      Storage metering must track high_water_mark_bytes as the peak active bytes
      seen in the current metering window. Uploads update it with
      GREATEST(previous_high_water, active_bytes + delta). Deletes reduce
      active_bytes but never reduce high_water_mark_bytes for that window.
    severity: critical
    verified_by:
      - REQ-AST-011

  - id: INV-AST-012
    statement: >
      Uploads must be rejected with HTTP 402 when the organization's current storage
      exceeds 2x the plan's included storage allowance. Existing assets and read
      operations (signed URLs, downloads) must remain accessible.
    severity: critical
    verified_by:
      - REQ-AST-012

  - id: INV-AST-013
    statement: >
      Storage overage costs must be deducted from the organization's credits_balance
      through credit_ledger rows with idempotent reference IDs. Upload-time checks
      require enough available prepaid credits for projected overage, and monthly
      reconciliation charges ongoing overage from storage_usage period rollups.
    severity: critical
    verified_by:
      - REQ-AST-013

  - id: INV-AST-014
    statement: >
      When projected storage would exceed available prepaid credits for overage, or
      when projected storage would exceed the plan hard cap, all new uploads must be
      blocked. Existing assets and read operations remain accessible.
    severity: critical
    verified_by:
      - REQ-AST-014

  - id: INV-AST-015
    statement: >
      The storage_usage table must have a UNIQUE constraint on
      (org_id, period_start) to prevent duplicate period rollups. Reconciliation
      must be idempotent by deriving a stable monthly reference ID before writing
      to credit_ledger.
    severity: high
    verified_by:
      - REQ-AST-015

  - id: INV-AST-016
    statement: >
      Asset search must be executed server-side within the requested team scope.
      Keyword search matches original_filename, AI title, AI description, and AI
      tags while excluding deleted assets and assets from other teams. Semantic
      search must be rejected until embeddings are generated and indexed.
    severity: high
    verified_by:
      - REQ-AST-016

  - id: INV-AST-017
    statement: >
      Media collection endpoints must persist collection records and collection
      asset membership, and the web media library must expose collection creation,
      filtering, and per-asset add/remove controls. Collection membership is
      team-scoped: an asset may only be added to a collection when both the asset
      and collection belong to the same team, and cross-team membership attempts
      must fail.
    severity: high
    verified_by:
      - REQ-AST-017
```

# Failure Modes

```yaml
failure_modes:
  - condition: "R2 upload succeeds but the confirmation callback fails (network error, API crash, timeout)."
    impact: >
      R2 object exists but no team_media_assets row is created. The asset is
      invisible to the user and R2 storage is consumed without metering. The
      pending_uploads row remains in pending state.
    handling: >
      The Retention Cleaner runs on a schedule (e.g., every 15 min) and identifies
      pending_uploads rows past their expiry window (60 min). For each expired row,
      it issues a DeleteObject to R2 and marks the row as expired. The client can
      also retry the confirm call (POST /media/confirm/:id) which is idempotent.

  - condition: "Retention Cleaner runs while an asset is still visible in a team library."
    impact: >
      If the cleaner deletes an active asset, users could lose media that still
      appears in the library or is still available for future campaign selection.
    handling: >
      Retention cleanup only lists assets with is_deleted = true, deleted_at older
      than the retention window, and hard_deleted_at IS NULL. Active assets never
      enter the cleaner candidate set. Publishing-specific asset pinning is owned
      by the campaign/publishing design once scheduled post references exist.

  - condition: "Client declares a smaller file_size in the request phase than the actual upload."
    impact: >
      A direct presigned PUT could write a larger object than the request phase
      projected, consuming more storage than allowed by the quota check.
    handling: >
      The local API upload proxy rejects bodies whose exact byte length differs
      from the pending upload. For direct presigned PUTs, the confirm phase
      verifies actual size via R2 HeadObject. If actual size differs from declared
      size, the upload is rejected: the R2 object is deleted and the pending_uploads
      row is marked as failed.

  - condition: "R2 HeadObject call fails during confirm phase (R2 outage, transient error)."
    impact: >
      Cannot verify actual file size. Confirm phase cannot complete. Asset remains
      in pending state.
    handling: >
      Retry the HeadObject call with exponential backoff (up to 3 retries). If all
      retries fail, leave the pending_uploads row for the Retention Cleaner to
      handle on its next run. The client can retry the confirm call later.

  - condition: "Organization deletion initiated while assets are being uploaded or published."
    impact: >
      Race condition between the GDPR hard-delete workflow and in-flight uploads
      or publish workflows. Partially deleted state.
    handling: >
      Organization deletion sets a deleted_at flag on the org first, which
      immediately blocks new uploads and publishes (middleware rejects requests
      for deleted orgs). The hard-delete workflow then processes all teams and
      assets. In-flight Temporal workflows detect the deleted org and self-cancel.

  - condition: "Storage period rollup is stale or missing when reconciliation runs."
    impact: >
      Monthly overage reconciliation may skip a charge until the next rollup update,
      but upload-time quota checks still use real-time storage_metering counters.
    handling: >
      Reconciliation reads the most recent storage_usage row and no-ops if none is
      available. Re-running reconciliation for the same period is safe because the
      credit_ledger reference ID is stable for the organization and month.
```

# Verification

```yaml
verification:
  - requirement_id: REQ-AST-001
    test_type: integration
    target: >
      Create a pending_uploads row with a 60-min expiry. Advance time past expiry.
      Run the Retention Cleaner. Verify the pending_uploads row is marked expired
      and the R2 object is deleted (mock or real R2 call).

  - requirement_id: REQ-AST-002
    test_type: unit
    target: >
      Attempt to insert a team_media_assets row with team_id = NULL. Verify the
      database rejects the insert (NOT NULL constraint). Verify API endpoints
      reject asset creation requests without valid team membership.

  - requirement_id: REQ-AST-003
    test_type: integration
    target: >
      Create one active asset and one soft-deleted asset older than the retention
      window. Run the Retention Cleaner. Verify the active asset is not deleted and
      the soft-deleted eligible asset is hard-deleted exactly once.

  - requirement_id: REQ-AST-004
    test_type: integration
    target: >
      Upload an asset via the full two-phase flow. Verify storage_metering.active_bytes
      is incremented by the actual R2 HeadObject size. Soft-delete the asset. Verify
      active_bytes in storage_metering excludes the deleted asset. Verify no
      double-counting occurs when confirm is retried.

  - requirement_id: REQ-AST-005
    test_type: unit
    target: >
      Verify the billing ledger insert is idempotent (same charge_id does not
      create duplicate rows). Verify charges reference database facts
      (team_media_assets.file_size) rather than volatile counters.

  - requirement_id: REQ-AST-006
    test_type: integration
    target: >
      Request an upload for a small file. Attempt to upload a mismatched body
      through the API proxy and verify a 400 response. For direct presigned PUT,
      write a larger object and verify confirm deletes the object, marks the
      pending upload failed, and does not create an asset or update metering.

  - requirement_id: REQ-AST-007
    test_type: integration
    target: >
      Upload an asset with a known content_hash. Attempt to upload another asset
      with the same team_id and content_hash. Verify the second upload is skipped
      and the existing asset is returned. Verify the UNIQUE constraint fires if
      a direct DB insert is attempted.

  - requirement_id: REQ-AST-008
    test_type: unit
    target: >
      Set hard_deleted_at on a team_media_assets row. Run the Retention Cleaner.
      Verify it skips the row and does not issue a DeleteObject call to R2.

  - requirement_id: REQ-AST-009
    test_type: integration
    target: >
      Create an organization with teams and assets. Delete the organization.
      Verify all team_media_assets rows are hard-deleted from PostgreSQL.
      Verify corresponding R2 objects are deleted (mock or real R2 call).

  - requirement_id: REQ-AST-010
    test_type: integration
    target: >
      Upload a file where actual R2 size differs from client-declared size.
      Verify the confirm phase rejects the upload before creating a
      team_media_assets row or incrementing storage_metering.

  - requirement_id: REQ-AST-011
    test_type: integration
    target: >
      Confirm an upload and verify storage_metering.high_water_mark_bytes is set to
      active_bytes. Soft-delete/decrement storage and verify active_bytes drops while
      high_water_mark_bytes stays at the previous peak.

  - requirement_id: REQ-AST-012
    test_type: integration
    target: >
      Seed storage_metering.active_bytes at the plan hard cap and request another
      upload. Verify HTTP 402 is returned while signed read URLs for existing assets
      still work.

  - requirement_id: REQ-AST-013
    test_type: integration
    target: >
      Charge storage overage with a stable reference ID. Verify credit_ledger gets
      one negative usage row, credits_balance decreases on first call, and a second
      call with the same reference leaves the balance unchanged.

  - requirement_id: REQ-AST-014
    test_type: integration
    target: >
      Seed storage just below the included limit with insufficient credits for a
      projected overage upload. Verify preUploadCheck rejects the upload while the
      hard-cap rejection path remains independent of credits.

  - requirement_id: REQ-AST-015
    test_type: integration
    target: >
      Verify storage_usage has a UNIQUE index on (org_id, period_start). Verify
      monthly overage reconciliation derives a stable reference ID and is idempotent
      when run repeatedly for the same period.

  - requirement_id: REQ-AST-016
    test_type: integration
    target: >
      Seed assets in two teams with filename, AI title, AI description, and AI tag
      matches. Call GET /teams/:teamId/assets/search and verify only matching
      assets from that team are returned. Call the same endpoint with semantic=true
      and verify it returns a clear unsupported-semantic-search error until
      embeddings exist.

  - requirement_id: REQ-AST-017
    test_type: integration
    target: >
      Create, list, update, and delete a media collection. Add and remove an asset
      from the collection, then verify the collection asset listing reflects the
      membership changes. Attempt to add an asset from another team and verify the
      request fails without creating membership.
```

# Thumbnail Pipeline

Thumbnail generation is intentionally asynchronous. Upload confirmation should remain fast and
should not require the API process to hold full media files in memory for CPU work.

1. `UploadService.confirmUpload` verifies the R2 object, creates the asset row, updates storage
   metering, and, for `image`/`gif` assets, inserts `assets.thumbnail_requested` into
   `domain_events` in the same DB transaction.
2. `outboxPollerWorkflow` claims the event and starts `assetThumbnailWorkflow` as a child workflow
   with a deterministic workflow ID derived from the outbox event ID.
3. The `generateAssetThumbnail` activity loads the asset, skips unsupported media types and assets
   that already have `thumbnail_path`, reads original bytes from R2, generates a WebP preview
   through `ThumbnailGeneratorPort`, writes the thumbnail object, and patches `thumbnail_path`.
4. The web UI calls `GET /teams/:teamId/assets/:assetId/thumbnail-url`. If no thumbnail exists yet,
   images/GIFs may fall back to the original signed URL; other media types render a stable type icon.

This KISS production path covers image/GIF previews without blocking upload confirmation. Video
poster frames, PDF first-page thumbnails, audio waveform art, richer structured extraction, and
compression/transcoding remain part of the later enrichment pipeline.

# Media Management Page

## Overview

The media management page is the primary UI for teams to browse, upload, organize, and manage
their media assets. It lives at `/org/[orgId]/[teamId]/media` and follows the existing
`DashboardShell` + `AppSidebar` patterns.

## Layout

| Component | Description |
|-----------|-------------|
| **Toolbar** | Search bar, view toggle (list/card), collection filter, type filter, Collections manager button, upload button |
| **Bulk selection bar** | Selected count, add to collection, remove from current collection, delete selected, clear selection |
| **Asset grid/table** | Compact card view (thumbnail grid) or list view (table with preview column) |
| **Collections manager** | Dialog for creating, renaming, and deleting collections |
| **Upload dialog** | Multi-file drag-and-drop zone, file picker, per-file status queue, two-phase confirmation |
| **Asset detail panel** | Slide-over or dialog showing full preview, metadata, AI tags, actions |

## View Modes

### Card View (default)
- Compact thumbnail grid with responsive columns (2 on mobile, 3 on tablet, 4+ on desktop)
- Each card: preview thumbnail or media-type icon, filename, file size, asset type badge, processing status indicator
- Click → opens asset detail panel
- Checkbox for multi-select (bulk add/remove collection and bulk delete)

### List View
- Table with columns: selection, preview thumbnail/icon, filename, type, size, status, created date, actions
- Sortable columns: filename, file size, created date
- Row click → opens asset detail panel

## Filtering & Sorting

| Filter | Type | Values |
|--------|------|--------|
| Asset type | Multi-select chips | image, video, audio, gif, document |
| Processing status | Dropdown | pending, processing, completed, failed |
| Search | Text input | Keyword search on filename, AI title, AI description |

| Sort | Columns |
|------|---------|
| Created date | asc / desc (default: desc) |
| Filename | asc / desc |
| File size | asc / desc |

## Upload Flow (UI)

1. User clicks "Upload Asset" button -> upload dialog opens
2. Drag-and-drop zone or file picker accepts one or many files (`multiple`, accept: image/*, video/*, audio/*, .gif, .pdf, .doc)
3. For each file, the client computes SHA-256 content hash (optional, for dedup)
4. For each file, call `POST /teams/:teamId/uploads/request` with `{fileName, fileSize, contentHash, mimeType}`
5. If `deduplicated: true` -> show that file as deduplicated and continue the rest of the queue
6. Otherwise -> upload through the API proxy in local/dev or PUT file to presigned URL in deployed environments
7. On upload complete -> call `POST /teams/:teamId/uploads/:uploadId/confirm`
8. The asset appears in the grid/table as completed; image/GIF thumbnails populate asynchronously after the outbox/Temporal pipeline writes `thumbnail_path`

## Actions

| Action | Scope | Confirmation |
|--------|-------|-------------|
| Delete | Single or bulk | Confirmation dialog with count |
| Add/remove collection | Single or bulk | Bulk actions operate on selected assets; removal is available when filtering a collection |
| Download | Single | Direct presigned URL download |
| Copy URL | Single | Copy signed URL to clipboard |
| Edit metadata | Single | Inline edit of title, description, tags |

## Integration Tests

Tests use `renderWithProviders` + real API backend following project test policy.

| Test | What it verifies |
|------|-----------------|
| Renders empty state | Shows "No assets yet" when team has no assets |
| Renders asset grid | Shows asset cards with thumbnails after seeding data |
| Toggles list/card view | Switches between grid and table layouts |
| Filters by asset type | Applies type filter, verifies filtered results |
| Sorts by file size | Changes sort, verifies order |
| Upload flow | Opens dialog, triggers upload request, uploads bytes directly or through the local API proxy, shows progress, confirms |
| Drag/drop upload | Drops a file on the upload zone, uploads through the same request/upload/confirm flow, and renders the completed asset |
| Multi-file upload | Selects multiple files in one dialog, uploads each file independently, and renders all completed assets |
| Delete flow | Selects asset, clicks delete, confirms, verifies removed |
| Bulk delete flow | Selects multiple assets, uses the top-level delete action, confirms, and verifies all selected assets are removed |
| Search | Types query, verifies filtered results |
| Collections | Opens the Collections manager, creates/renames/deletes a collection, adds an asset, filters by collection, removes the asset from the collection |
| Bulk collection actions | Selects multiple assets, bulk-adds them to a collection, filters that collection, then bulk-removes them |
| Thumbnail URL | Confirms image/GIF upload emits an async thumbnail event and serves a thumbnail signed URL once `thumbnail_path` exists |
| Pagination | Scrolls/pages through large asset sets |

# Open Questions

- Controlled taxonomy for asset tagging vs. freeform — decision needed.
- Cross-team sharing within org — deferred to a future collaboration spec.
- ~~Per-org storage quota values per plan tier?~~ **Resolved** — Try Me 10 GB, Pro 100 GB, Agency 500 GB; uploads blocked above 2x included storage.
- ~~Is 50 MB upload limit sufficient?~~ **Resolved** — Raised to 200 MB to support short-form video uploads.
- ~~Should assets be served through a CDN?~~ **Resolved** — Cloudflare edge, always.
