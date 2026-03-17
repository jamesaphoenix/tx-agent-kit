---
name: system-design-doc
description: Generate a system-level design document via `tx doc add design`. Covers cross-cutting architecture, service boundaries, data flows, scalability, and deployment topology. References plan via file path instead of embedding. Plan lives in ~/.codex/plans/<name>.md. Use for system-wide or multi-domain designs (vs /design-doc for feature-scoped).
argument-hint: <system-or-initiative-name>
---

# Generate System Design Document

Create a system-level design document using the tx doc primitive. System design docs cover cross-cutting architecture spanning multiple domains. For single-feature designs, use `/design-doc`.

## Workflow State Machine

```
START
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 0: PLAN GATE                                    │
│                                                      │
│ Is there an active plan in this conversation?        │
│                                                      │
│ ├─ YES → Save plan to `~/.codex/plans/<name>.md` if not       │
│ │        already saved. Set `plan: ~/.codex/plans/<name>.md`   │
│ │        in frontmatter.                              │
│ │        → Continue to Step 1                        │
│ │                                                    │
│ └─ NO  → Tell user to run /plan first.               │
│          If enough detail, generate plan, save to    │
│          `~/.codex/plans/<name>.md`.                           │
│          → Continue to Step 1                        │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: SCAFFOLD via tx                              │
│                                                      │
│ tx doc add design <name> --title "<title>"           │
│ ├─ SUCCESS → Continue to Step 2                      │
│ └─ FAIL (exists) → Edit existing doc                 │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: DEEP CONTEXT GATHERING                       │
│                                                      │
│ Read: ARCHITECTURE.md, QUALITY.md, DEPLOYMENT.md,    │
│       ROLLBACK.md, RUNBOOKS.md, CLAUDE.md,           │
│       schema.ts, workflows.ts, all infra packages,   │
│       all existing specs (tx doc list)               │
│ → Continue to Step 3                                 │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: FILL DOCUMENT                                │
│                                                      │
│ Write `# Plan` first (reference to plan file from     │
│ Step 0).                                              │
│ Then fill all sections from plan + codebase.         │
│                                                      │
│ MINIMUM THRESHOLDS:                                  │
│   - Invariants: ≥ 7                                  │
│   - Failure modes: ≥ 3                               │
│   - Verification entries: ≥ 5                        │
│   - Design decisions: ≥ 2                            │
│   - Service boundaries: ≥ 3                          │
│   - Data flow diagrams: ≥ 2                          │
│                                                      │
│ RULE: No section may be left as a template/stub.     │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: SELF-AUDIT                                   │
│                                                      │
│ Every plan item captured? No stubs? Minimums met?    │
│ All diagrams complete? Cross-cutting addressed?      │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: VALIDATE                                     │
│                                                      │
│ tx spec lint                                         │
│ ├─ PASS → Continue to Step 6                         │
│ └─ WARN/FAIL → Fix, re-validate                     │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: DISCOVER + LINK + REPORT                     │
│                                                      │
│ tx spec discover --doc <name>                        │
│ tx doc link <overview> <design>                      │
│ tx doc show <name>                                   │
│ Print summary                                        │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 6.5: SYNC PLAN FILE                             │
│                                                      │
│ Read the plan file from frontmatter `plan:` path.    │
│ UPDATE the plan file to incorporate everything       │
│ the doc surfaced: service boundaries, data flows,    │
│ design decisions, invariants, failure modes,         │
│ deployment topology, scalability strategy.           │
│ The plan file must reflect the FULL current state.   │
│ This is a MANDATORY step, not optional.              │
└─────────────────────────────────────────────────────┘
  │
  ▼
DONE
```

## Step 0 — Plan Gate

**The plan is the primary input.** Check for plan content in the conversation:

- If the user ran `/plan` or was in plan mode, the plan is saved as a standalone file at `~/.codex/plans/<name>.md` (relative to repo root).
- If a plan already exists in the conversation, write it to that file.
- If a plan file already exists at that path, read it instead.
- If no plan but detailed user request, generate a plan yourself (research the codebase, think through topology/services/constraints) and save it to `~/.codex/plans/<name>.md`.
- If no plan and vague request, ask user to run `/plan` first.

The doc's frontmatter gets `plan: ~/.codex/plans/<name>.md` and the `# Plan` section contains a reference link + brief summary, not the full verbatim content.

## Step 1 — Scaffold via tx

```bash
tx doc add design $ARGUMENTS --title "<Human-Readable Title>"
```

Creates `specs/design/<name>.md`. If exists, edit instead.

## Step 2 — Deep Context Gathering

Read ALL of these:

- `docs/ARCHITECTURE.md`, `docs/QUALITY.md`, `docs/DEPLOYMENT.md`, `docs/ROLLBACK.md`, `docs/RUNBOOKS.md`
- `CLAUDE.md`
- All existing specs: `tx doc list`
- `packages/infra/db/src/schema.ts`
- `apps/worker/src/workflows.ts`
- `apps/api/src/`
- `packages/infra/*/`

## Step 3 — Fill the Document

### Required Frontmatter (already generated by tx)

```yaml
---
kind: spec
spec_type: design
name: <name>
title: "<title>"
status: draft
version: 1
owners:
  - <team-or-person>
summary: System-level design for <title>
domain: platform
tags:
  - design
  - system
depends_on: []
supersedes: []
implements: null
last_reviewed_at: <YYYY-MM-DD>
plan: ~/.codex/plans/<name>.md
---
```

### Body Structure — ALL sections MUST have real content

**`# Plan` comes first (as a reference to the plan file). Every subsequent section draws from the plan file content. No section may be a stub.**

```markdown
# Plan

> Full plan: [~/.codex/plans/<name>.md](../~/.codex/plans/<name>.md)

<2-3 sentence summary of what the plan covers. The full plan lives in the file referenced above.>

# Summary

2-3 sentences on system-level design scope and key decisions.

# Architecture

## Current State

What exists today. What works, what doesn't. Reference `docs/ARCHITECTURE.md`.

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      External Traffic                        │
│                    (Cloudflare Tunnel)                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Ingress Layer                           │
│                 (k3s Ingress / GKE LB)                       │
└──────────┬──────────────────────────────────┬───────────────┘
           │                                  │
           ▼                                  ▼
┌─────────────────────┐          ┌─────────────────────┐
│    API Service       │          │   Web Service        │
│  (Effect HttpApi)    │          │  (Next.js SPA)       │
│  [NEW/MOD]           │          │  [NEW/MOD]           │
└──────────┬───────────┘          └──────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Core Domain Layer                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │  Auth    │  │  Org    │  │  Team   │  │ <New>   │      │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘      │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Infrastructure Layer                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │PostgreSQL │  │ Temporal │  │  Redis   │  │ Langfuse │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Worker Layer                               │
│  ┌──────────────────────────────────────────┐               │
│  │  Temporal Worker                          │               │
│  └──────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

Mark: `[NEW]` / `[MOD]` / `[REMOVE]`.

## Service Boundaries

**MINIMUM: ≥ 3 services.**

| Service | Deployment | Scaling Strategy | Communication |
|---------|-----------|-----------------|---------------|

## Data Flows

**MINIMUM: ≥ 2 data flow diagrams.**

### Flow 1: <Name>

```
[Source] → Protocol → [Service A] → Protocol → [Service B] → [Store]
```

## Design Decisions

**MINIMUM: ≥ 2 decisions with ADR-lite format.**

### Decision 1: <Title>

**Context:** Why needed.
**Options:**

| Option | Pros | Cons |
|--------|------|------|

**Decision:** Option X because <reasoning>.
**Consequences:** What follows.

# Interfaces

```yaml
interfaces:
  - name: <ServiceInterface>
    type: api_endpoint | message_contract | event_payload
    definition: |
      // definition
```

## Inter-Service Contracts

| From | To | Protocol | Contract |
|------|-----|----------|----------|

## API Surface Changes

| Method | Path | Change | Breaking? |
|--------|------|--------|-----------|

# Data Model

## Schema Overview

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Table A   │────<│ Table B   │────<│ Table C   │
└──────────┘     └──────────┘     └──────────┘
```

## New Tables + Migration Plan

| Order | Migration | Description | Backwards-Compatible |
|-------|-----------|-------------|---------------------|

# Invariants

**MINIMUM: ≥ 7 system-level invariants.**

```yaml
invariants:
  - id: INV-SYS-001
    statement: <what must be true across the system>
    enforcement: <mechanism>
```

# Failure Modes

**MINIMUM: ≥ 3 failure modes.**

```yaml
failure_modes:
  - id: FM-SYS-001
    trigger: <cause>
    impact: <effect>
    detection: <how detected>
    mitigation: <automatic>
    recovery: <human>
```

# Verification

**MINIMUM: ≥ 5 entries. Every invariant MUST have a verification entry.**

```yaml
verification:
  - invariant: INV-SYS-001
    test_file: <path>
    test_name: "description [INV-SYS-001]"
    type: lint | integration | pgtap
```

# Testing Strategy

## Unit Tests

| Domain | Test Files | Focus |
|--------|-----------|-------|

## Integration Tests

| Layer | Test Files | Focus |
|-------|-----------|-------|

## Database Contract Tests

| Test File | Focus |
|-----------|-------|

## Quality Gate Sequence

```bash
pnpm lint && pnpm type-check && pnpm test && pnpm test:integration
pnpm test:db:pgtap
tx spec discover --doc <name>
tx spec fci --doc <name>
tx spec lint
```

# Scalability

## Current Capacity

| Metric | Current | Target |
|--------|---------|--------|

## Scaling Strategy

| Component | Horizontal | Vertical | Notes |
|-----------|-----------|----------|-------|

# Deployment & Operations

## Deployment Topology

| Environment | Infrastructure | Deploy Command |
|------------|---------------|----------------|

## Rollback

Reference `docs/ROLLBACK.md`.

## Monitoring

| Signal | Source | Alert Threshold |
|--------|--------|----------------|

# Security

| Concern | Mitigation | Layer |
|---------|-----------|-------|

# Open Questions

- [ ] System-level questions
```

## Step 4 — Self-Audit

Re-read and verify:
1. Every plan item captured somewhere.
2. Minimums met: ≥7 invariants, ≥3 failure modes, ≥5 verifications, ≥2 decisions, ≥3 services, ≥2 data flows.
3. No stubs, no empty tables.
4. All diagrams complete.
5. Cross-cutting concerns addressed (security, monitoring, deployment, rollback).
6. Verify plan file exists at the path in frontmatter and its content is consistent with the doc.

## Step 5 — Validate

```bash
tx spec lint
```

## Step 6 — Discover, Link & Report

```bash
tx spec discover --doc <name>
tx doc link <overview> <design>
tx doc show <name>
```

## Step 6.5 — Sync Plan File (MANDATORY)

After filling and validating the doc, **update the plan file** at the `plan:` frontmatter path to reflect everything the doc surfaced. The plan file must be the living source of truth — not a stale initial draft.

What to add to the plan file:
- Service boundaries and deployment topology
- Data flow details and inter-service contracts
- Design decisions and their rationale
- Invariants, failure modes, scaling strategy
- Security considerations and monitoring signals

Read the current plan file, merge in the new information, and write it back.

## After Generation

1. Print output path (`specs/design/<name>.md`).
2. Summarize: invariant count, failure mode count, service count, decision count.
3. List open questions.
4. Run `tx spec lint`.
5. If the plan file is modified later, update the `# Plan` summary and derived sections in this doc. If this doc's scope changes, update the plan file to stay consistent.
