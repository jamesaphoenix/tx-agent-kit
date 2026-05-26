---
kind: spec
spec_type: prd
doc_id: doc-fb90c8858172
name: assets-prd
title: "Assets"
status: active
version: 2
owners:
  - jamesaphoenix
summary: "Product scope for media assets, R2 storage, upload confirmation, local upload proxy, metadata, search, retention, and prepaid storage metering."
domain: assets
tags:
  - prd
  - migration
  - system-design
  - assets
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-04-17
plan: "~/.codex/plans/2026-03-28-system-design-subsystem-split.md"
---

# Plan

> Full plan: `~/.codex/plans/2026-03-28-system-design-subsystem-split.md`

This PRD is the lightweight companion to `assets-design`.
It keeps the assets scope separately reviewable while the paired design doc owns detailed technical constraints.

# Summary

This PRD captures the high-level product scope for assets within tx-agent-kit.
It is intentionally small and defers detailed technical wording to the paired design doc.

# Implementation Status

As of 2026-04-17, the launch MVP media library is implemented. The shipped scope includes
R2-backed upload request/upload/confirm flows, the local upload proxy, storage metadata
verification, quota and prepaid storage metering guards, multi-file drag-and-drop upload,
asset list/get/delete, compact card/list views, signed preview URLs, image/GIF thumbnail
generation through an async outbox plus Temporal workflow, server-side keyword search, and
media collections with manager UI, filtering, per-asset actions, and selected-asset bulk
add/remove/delete actions.

Remaining follow-up work is semantic/vector search, embeddings, structured media outputs,
video/PDF/audio thumbnails, and compression/transcoding outputs. The agentic AI asset
search endpoint belongs after those enrichment pieces, as tracked in the Temporal
workflows design.

# Problem

**Asset storage must not be loss-making.** All blob storage uses Cloudflare R2 across all environments.

# Scope

Included:
- 2.1 Storage: Cloudflare R2
- 2.2 Storage Usage Model (1K Users)
- 2.4 Provider Decision: Cloudflare R2 (All Environments)
- 2.5 Implementation: What Changes Where
- 2.6 Cost Metering and prepaid storage overage
- 2.7 Compute: Self-Hosted → Hetzner Cloud VM
- 2.8 Asset Size Reference
- 2.9 Cost Reduction Strategies
- 2.10 Asset Metadata (`team_media_assets` table)
- 2.11 Search
- Media collections and collection membership management
- 2.12 Governance
- 2.13 Storage Architecture
- 2.14 Storage Decisions Summary
- Browser upload UX, including the local API upload proxy for CORS-safe development

Excluded:
- Other top-level system design sections that are split into their own companion PRD/design pairs.
- New requirements or reinterpretations that are not already implied by the migrated source section.

# Requirements

```yaml
ears_requirements:
  - id: REQ-ASSETS-001
    kind: ubiquitous
    statement: "The system shall provide the Assets capabilities defined in the paired design doc."
    priority: must
    rationale: "This subsystem needs its own explicit product scope after the monolithic design split."
  - id: REQ-ASSETS-002
    kind: ubiquitous
    statement: "The system shall cover Cloudflare R2 storage, the 1K-user storage usage model, upload confirmation, local upload proxy behavior, cost metering and prepaid storage overage, compute placement, asset size limits, cost reduction strategies, asset metadata (`team_media_assets` table), search, governance, storage architecture, and storage decisions within the Assets scope."
    priority: must
    rationale: "The split PRD should reflect the full section inventory that moved into the companion design doc."
  - id: REQ-ASSETS-003
    kind: state-driven
    while: "work is scoped to Assets"
    statement: "While work is scoped to Assets, the system shall preserve the constraints, data shapes, and operational rules captured in the paired design doc and current billing/storage contracts."
    priority: must
    rationale: "The migrated design doc remains the detailed source of truth for this subsystem."
  - id: REQ-ASSETS-004
    kind: unwanted
    if: "implementation details conflict with the migrated Assets source section"
    statement: "If implementation details conflict with the Assets design, then the system shall defer to the paired design doc and billing design until a newer spec supersedes them."
    priority: must
    rationale: "The split must remain lossless and authoritative until refined."
  - id: REQ-ASSETS-005
    kind: state-driven
    while: "the web app runs on localhost or 127.0.0.1"
    statement: "While the web app runs on localhost or 127.0.0.1, the system should support uploading file bytes through the API upload proxy instead of requiring direct browser-to-R2 upload."
    priority: should
    rationale: "Local QA should not be blocked by R2 CORS configuration while the production path can still use presigned uploads."
  - id: REQ-ASSETS-006
    kind: event-driven
    when: "a client confirms an upload"
    statement: "When a client confirms an upload, the system shall verify the object through storage metadata before creating the media asset record."
    priority: must
    rationale: "Declared client file size is not trusted for billing or quota accounting."
```

# Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-ASSETS-001
    statement: "The Assets scope is isolated into its own tx-managed PRD/design pair."
  - id: AC-ASSETS-002
    statement: "The PRD scope inventory covers the subsection areas assigned to Assets."
  - id: AC-ASSETS-003
    statement: "The companion design doc is aligned with current asset, storage, and billing implementation contracts."
  - id: AC-ASSETS-004
    statement: "The media upload flow is tested through request, local upload proxy or presigned upload, confirm, and list rendering."
  - id: AC-ASSETS-005
    statement: "The API upload proxy validates team ownership, upload status, content type, and exact byte length before writing to storage."
  - id: AC-ASSETS-006
    statement: "The media UI supports collection filtering, collection management, and bulk add/remove/delete actions for selected assets."
```

# Non-goals

- Folding adjacent subsystem sections back into a larger cross-cutting spec.
