---
kind: spec
spec_type: prd
doc_id: doc-3c10cb014ea2
name: temporal-workflows-prd
title: "Temporal Workflows"
status: draft
version: 1
owners:
  - jamesaphoenix
summary: "Lightweight product scope for the \"Temporal Workflows\" subsystem split."
domain: temporal-workflows
tags:
  - prd
  - migration
  - system-design
  - temporal
  - workflows
depends_on: []
supersedes: []
implements: null
last_reviewed_at: 2026-03-28
plan: "~/.codex/plans/2026-03-28-system-design-subsystem-split.md"
---

# Plan

> Full plan: `~/.codex/plans/2026-03-28-system-design-subsystem-split.md`

This PRD is the lightweight companion to `temporal-workflows-design`.
It keeps the temporal workflows scope separately reviewable while the paired design doc remains the detailed technical source of truth.

# Summary

This PRD captures the high-level product scope for temporal workflows within tx-agent-kit.
It is intentionally small and defers detailed technical wording to the paired design doc.

# Problem

Content pipelines emit events via **Temporal activity heartbeats** at every phase transition and significant step. The frontend consumes these events via **SSE (Server-Sent Events)** to give users real-time visibility into what the agent is doing for each content item.

# Scope

Included:
- 13.1 Task Queues
- 13.2 Workflows
- 13.3 Design Rules
- 13.4 Pipeline Events & Real-Time Feedback
- Agent-facing search over enriched team media after embeddings and media-type structured outputs are complete

Excluded:
- Other top-level system design sections that are split into their own companion PRD/design pairs.
- Adjacent subsystem requirements unless explicitly added by subsequent revisions to this PRD/design pair.

# Requirements

```yaml
ears_requirements:
  - id: REQ-TEMPORAL-WORKFLOWS-001
    kind: ubiquitous
    statement: "The system shall provide the Temporal Workflows capabilities defined in the paired design doc."
    priority: must
    rationale: "This subsystem needs its own explicit product scope after the monolithic design split."
  - id: REQ-TEMPORAL-WORKFLOWS-002
    kind: ubiquitous
    statement: "The system shall cover 13.1 Task Queues, 13.2 Workflows, 13.3 Design Rules, and 13.4 Pipeline Events & Real-Time Feedback within the Temporal Workflows scope."
    priority: must
    rationale: "The split PRD should reflect the full section inventory that moved into the companion design doc."
  - id: REQ-TEMPORAL-WORKFLOWS-003
    kind: state-driven
    while: "work is scoped to Temporal Workflows"
    statement: "While work is scoped to Temporal Workflows, the system shall preserve the constraints, data shapes, and operational rules captured in the paired design doc."
    priority: must
    rationale: "The migrated design doc remains the detailed source of truth for this subsystem."
  - id: REQ-TEMPORAL-WORKFLOWS-004
    kind: unwanted
    if: "implementation details conflict with the migrated Temporal Workflows source section"
    statement: "If implementation details conflict with the migrated Temporal Workflows source section, then the system shall defer to the paired design doc until a newer spec supersedes it."
    priority: must
    rationale: "The split must remain lossless and authoritative until refined."
  - id: REQ-TEMPORAL-WORKFLOWS-005
    kind: event-driven
    when: "the media embedding pipeline and media-type structured-output enrichment pipeline are complete"
    statement: "When enriched media search prerequisites are complete, the system shall expose a team-scoped agentic asset search endpoint that Temporal activities and tx-agent-kit agents can use to retrieve ranked media results with explanations."
    priority: should
    rationale: "Agentic content workflows need a reliable media retrieval primitive that uses embeddings and structured metadata rather than filename-only search."
```

# Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-TEMPORAL-WORKFLOWS-001
    statement: "The Temporal Workflows scope is isolated into its own tx-managed PRD/design pair."
  - id: AC-TEMPORAL-WORKFLOWS-002
    statement: "The PRD scope inventory covers the subsection areas assigned to Temporal Workflows."
  - id: AC-TEMPORAL-WORKFLOWS-003
    statement: "The companion design doc preserves the migrated source section verbatim."
  - id: AC-TEMPORAL-WORKFLOWS-004
    statement: "The paired design doc defines the agentic asset search endpoint, prerequisite gate, activity boundary, response shape, and dependency-not-ready behavior."
```

# Non-goals

- Rewriting or condensing the migrated source text in this pass.
- Folding adjacent subsystem sections back into a larger cross-cutting spec.
