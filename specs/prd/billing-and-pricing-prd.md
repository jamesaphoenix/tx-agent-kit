---
kind: spec
spec_type: prd
doc_id: doc-825737202c8a
name: billing-and-pricing-prd
title: "Billing & Pricing"
status: active
version: 2
owners:
  - jamesaphoenix
summary: "Product scope for subscriptions, prepaid credits, usage metering, billing UI, and local-dev billing bootstrap."
domain: billing-and-pricing
tags:
  - prd
  - migration
  - system-design
  - billing
  - and
  - pricing
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-04-17
plan: "~/.codex/plans/2026-03-28-octospark-system-design-subsystem-split.md"
---

# Plan

> Full plan: `~/.codex/plans/2026-03-28-octospark-system-design-subsystem-split.md`

This PRD is the lightweight companion to `billing-and-pricing-design`.
It keeps the billing & pricing scope separately reviewable while the paired design doc preserves the full source text verbatim.

# Summary

This PRD captures the high-level product scope for billing & pricing within tx-agent-kit.
Detailed invariants, data model, event contracts, and implementation status live in the paired
design doc.

# Implementation Status

As of 2026-04-17, the launch billing slice is implemented: prepaid credit ledger,
reservation/finalization/release flows, Stripe checkout/top-up/webhook idempotency,
refund/dispute/payment-failure handling, auto-recharge settings, usage caps, welcome
credits, storage overage billing, local dev billing bootstrap, owner-scoped billing
notifications, `tx-agent-kit.local` billing email links, and dedicated billing overview,
plans, history, usage, and settings UI surfaces. Campaign-level budget enforcement
remains deferred until the campaigns subsystem lands.

# Problem

tx-agent-kit needs billing that is transparent to customers and mechanically safe for the product:
flat-rate subscription access, prepaid credits for AI/storage overage, no hidden bundled credits,
and no financial double-write or double-charge failure modes.

# Scope

Included:
- 9.1 Revenue Model
- 9.2 Usage Metering Architecture
- 9.3 Data Model
- 9.4 Usage Pricing (10% Infrastructure Markup)
- 9.5 Storage Billing: Prepaid Credits Model
- 9.6 Usage Cap System (Two-Level)
- 9.7 Billing Integration
- 9.7a Stripe Webhook Idempotency
- 9.8 Billing Decisions (Confirmed)
- 9.9 Open Questions
- Dedicated billing UI routes and components
- Local development billing bootstrap for fast QA without Stripe checkout

Excluded:
- Other top-level system design sections that are split into their own companion PRD/design pairs.
- New requirements or reinterpretations that are not already implied by the migrated source section.

# Requirements

```yaml
ears_requirements:
  - id: REQ-BILLING-AND-PRICING-001
    kind: ubiquitous
    statement: "The system shall provide the Billing & Pricing capabilities defined in the paired design doc."
    priority: must
    rationale: "This subsystem needs its own explicit product scope after the monolithic design split."
  - id: REQ-BILLING-AND-PRICING-002
    kind: ubiquitous
    statement: "The system shall cover 9.1 Revenue Model, 9.2 Usage Metering Architecture, 9.3 Data Model, 9.4 Usage Pricing (10% Infrastructure Markup), 9.5 Storage Billing: Prepaid Credits Model, 9.6 Usage Cap System (Two-Level), 9.7 Billing Integration, 9.7a Stripe Webhook Idempotency, 9.8 Billing Decisions (Confirmed), and 9.9 Open Questions within the Billing & Pricing scope."
    priority: must
    rationale: "The split PRD should reflect the full section inventory that moved into the companion design doc."
  - id: REQ-BILLING-AND-PRICING-003
    kind: state-driven
    while: "work is scoped to Billing & Pricing"
    statement: "While work is scoped to Billing & Pricing, the system shall preserve the constraints, data shapes, and operational rules captured in the paired design doc."
    priority: must
    rationale: "The migrated design doc remains the detailed source of truth for this subsystem."
  - id: REQ-BILLING-AND-PRICING-004
    kind: unwanted
    if: "implementation details conflict with the migrated Billing & Pricing source section"
    statement: "If implementation details conflict with the migrated Billing & Pricing source section, then the system shall defer to the paired design doc until a newer spec supersedes it."
    priority: must
    rationale: "The split must remain lossless and authoritative until refined."
  - id: REQ-BILLING-AND-PRICING-005
    kind: ubiquitous
    statement: "The system shall keep subscription plan access separate from prepaid credit wallet usage; subscription plans shall not grant recurring bundled AI credits."
    priority: must
    rationale: "The current product model is flat-rate platform access plus explicit prepaid usage."
  - id: REQ-BILLING-AND-PRICING-006
    kind: event-driven
    when: "Stripe sends a webhook for subscriptions, payments, refunds, disputes, or invoices"
    statement: "When Stripe sends a webhook for subscriptions, payments, refunds, disputes, or invoices, the system shall process it idempotently and ignore stale subscription events that do not match the organization's active Stripe subscription."
    priority: must
    rationale: "Recent hardening prevents double credits, double debits, and stale webhook state rollback."
  - id: REQ-BILLING-AND-PRICING-007
    kind: state-driven
    while: "a user is developing or testing locally"
    statement: "While a user is developing or testing locally, the system shall expose a non-production-only billing bootstrap that can activate subscription state and seed local welcome credits without requiring Stripe checkout."
    priority: should
    rationale: "Local QA needs to exercise subscribed and credited app flows quickly without relying on external Stripe test-card flows."
  - id: REQ-BILLING-AND-PRICING-008
    kind: ubiquitous
    statement: "The web app shall expose dedicated billing overview, plans, history, usage, and settings surfaces for admins with manage_billing permission."
    priority: must
    rationale: "Billing is no longer a small subsection of organization settings."
  - id: REQ-BILLING-AND-PRICING-009
    kind: unwanted
    if: "the billing implementation requires Stripe metered subscription items or STRIPE_*_METERED_PRICE_ID values for AI usage"
    statement: "If the billing implementation requires Stripe metered subscription items or STRIPE_*_METERED_PRICE_ID values for AI usage, then the system shall reject that design and use the prepaid credit ledger plus manual top-up and auto-recharge flows instead."
    priority: must
    rationale: "Stripe is the payment rail; the local immutable credit ledger is the source of truth for credits and usage deduction."
```

# Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-BILLING-AND-PRICING-001
    statement: "The Billing & Pricing scope is isolated into its own tx-managed PRD/design pair."
  - id: AC-BILLING-AND-PRICING-002
    statement: "The PRD scope inventory covers the subsection areas assigned to Billing & Pricing."
  - id: AC-BILLING-AND-PRICING-003
    statement: "The companion design doc preserves the migrated source section verbatim."
  - id: AC-BILLING-AND-PRICING-004
    statement: "Stripe webhook handling is covered for idempotency, stale subscription gating, refunds, disputes, payment failures, and active-subscription hydration."
  - id: AC-BILLING-AND-PRICING-005
    statement: "Billing admin UI routes are covered by web integration tests, including guarded access for members without manage_billing."
  - id: AC-BILLING-AND-PRICING-006
    statement: "The local development billing bootstrap is rejected outside development/test environments and grants its local welcome credit idempotently."
```

# Non-goals

- Folding adjacent subsystem sections back into a larger cross-cutting spec.
- Implementing full email notification templates for every billing event; billing emits events first and notifications consume them separately.
