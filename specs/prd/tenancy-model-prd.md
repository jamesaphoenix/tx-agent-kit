---
kind: spec
spec_type: prd
doc_id: doc-086892334f42
name: tenancy-model-prd
title: "Tenancy Model"
status: active
version: 2
owners:
  - jamesaphoenix
summary: "Product scope for auth, organizations, workspaces, RBAC, invitations, member lifecycle, and tenant isolation."
domain: tenancy-model
tags:
  - prd
  - migration
  - system-design
  - tenancy
  - model
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-04-17
plan: "~/.codex/plans/2026-03-28-system-design-subsystem-split.md"
---

# Plan

> Full plan: `~/.codex/plans/2026-03-28-system-design-subsystem-split.md`

This PRD is the lightweight companion to `tenancy-model-design`.
It keeps the tenancy model scope separately reviewable while the paired design doc preserves the full source text verbatim.

# Summary

This PRD captures the high-level product scope for tenancy model within tx-agent-kit.
It is intentionally small and defers detailed technical wording to the paired design doc.

# Implementation Status

As of 2026-04-17, the launch-critical auth and tenancy slice is implemented and its
decomposed tx tasks are complete. The shipped scope covers org ownership, disabled
memberships, roles and permissions, review tokens, invite-before-signup flows, team and
organization membership APIs, ownership transfer, last-admin/self-removal protections,
workspace-scoped authorization middleware, and integration coverage for the main
permission and lifecycle invariants.

# Problem

Content review clients do **not** need tx-agent-kit accounts. Content review happens via signed URLs
that render a read-only review page. The members system also supports account-backed client
collaborators via invitations when a client needs ongoing workspace-scoped access inside the app.

# Scope

Included:
- Hierarchy
- Scale Targets
- Database Tables
- Client Access Model — Stateless Review
- Isolation
- Team Authorization Middleware
- Ownership & Last-Admin Guards
- Email-first invitations, including invite-before-signup
- Member lifecycle UI behavior, including last-admin/self-removal guards

Excluded:
- Other top-level system design sections that are split into their own companion PRD/design pairs.
- New requirements or reinterpretations that are not already implied by the migrated source section.

# Requirements

```yaml
ears_requirements:
  - id: REQ-TENANCY-MODEL-001
    kind: ubiquitous
    statement: "The system shall provide the Tenancy Model capabilities defined in the paired design doc."
    priority: must
    rationale: "This subsystem needs its own explicit product scope after the monolithic design split."
  - id: REQ-TENANCY-MODEL-002
    kind: ubiquitous
    statement: "The system shall cover Hierarchy, Scale Targets, Database Tables, Client Access Model — Stateless Review, Isolation, Team Authorization Middleware, and Ownership & Last-Admin Guards within the Tenancy Model scope."
    priority: must
    rationale: "The split PRD should reflect the full section inventory that moved into the companion design doc."
  - id: REQ-TENANCY-MODEL-003
    kind: state-driven
    while: "work is scoped to Tenancy Model"
    statement: "While work is scoped to Tenancy Model, the system shall preserve the constraints, data shapes, and operational rules captured in the paired design doc."
    priority: must
    rationale: "The migrated design doc remains the detailed source of truth for this subsystem."
  - id: REQ-TENANCY-MODEL-004
    kind: unwanted
    if: "implementation details conflict with the migrated Tenancy Model source section"
    statement: "If implementation details conflict with the migrated Tenancy Model source section, then the system shall defer to the paired design doc until a newer spec supersedes it."
    priority: must
    rationale: "The split must remain lossless and authoritative until refined."
  - id: REQ-TENANCY-MODEL-005
    kind: event-driven
    when: "an organization admin invites a teammate or client collaborator by email"
    statement: "When an organization admin invites a teammate or client collaborator by email, the system shall create a pending invitation even if the invitee does not yet have an account."
    priority: must
    rationale: "Invite-before-signup is now the intended onboarding path for member management."
  - id: REQ-TENANCY-MODEL-006
    kind: state-driven
    while: "a pending invitation has no invitee_user_id"
    statement: "While a pending invitation has no invitee_user_id, only an authenticated user with a normalized email matching the invitation email shall be able to list or accept it."
    priority: must
    rationale: "Email-first invitations must not create cross-account access leaks."
  - id: REQ-TENANCY-MODEL-007
    kind: unwanted
    if: "a signed-in user attempts to remove their own organization membership"
    statement: "If a signed-in user attempts to remove their own organization membership, then the system shall reject or skip the operation with a specific user-facing notification."
    priority: must
    rationale: "Self-removal by the last admin/owner previously appeared to do nothing and must be explicit."
```

# Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-TENANCY-MODEL-001
    statement: "The Tenancy Model scope is isolated into its own tx-managed PRD/design pair."
  - id: AC-TENANCY-MODEL-002
    statement: "The PRD scope inventory covers the subsection areas assigned to Tenancy Model."
  - id: AC-TENANCY-MODEL-003
    statement: "The companion design doc preserves the migrated source section verbatim."
  - id: AC-TENANCY-MODEL-004
    statement: "Integration tests cover invite-before-signup by email, invitation acceptance, client membership type, and optional workspace scope."
  - id: AC-TENANCY-MODEL-005
    statement: "Member-management UI tests cover last-admin and self-removal guard behavior."
```

# Non-goals

- Rewriting or condensing the migrated source text in this pass.
- Folding adjacent subsystem sections back into a larger cross-cutting spec.
