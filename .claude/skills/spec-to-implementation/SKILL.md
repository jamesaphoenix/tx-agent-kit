---
name: spec-to-implementation
description: End-to-end spec implementation with agent swarms. Analyzes a design spec, identifies gaps, implements with TDD, then runs adversarial review-fix loops until clean. Use when a design doc exists and you need to build or complete the implementation.
argument-hint: <path-to-spec> [--phase gap-analysis|tdd|implement|review-fix|prevention]
---

# Spec to Implementation

Automated spec-driven implementation pipeline. Takes a design doc, swarms agents to analyze gaps,
builds with TDD, then adversarial-reviews until no bugs remain.

## When to use

- A design spec exists in `specs/design/` and needs implementation
- Partial implementation exists and you need to identify + fill gaps
- Post-implementation hardening (adversarial review + fix loops)

## Pipeline Overview

```
Phase 1: Gap Analysis        →  5-10 sub-agents compare spec vs codebase
Phase 2: TDD                 →  Write failing tests for all gaps
Phase 3: Implementation      →  Build code in worktrees to pass tests
Phase 4: Adversarial Review  →  10-15 reviewers per worktree, fix loop
Phase 5: Prevention          →  Surface ESLint rules + test strategies
```

**Merge is NOT part of this pipeline.** Merging is a human-initiated action. This skill
produces worktrees with clean, reviewed code. The human (or a separate `/merge` command)
decides when and where to merge. This keeps the skill safe for `/loop` usage — it will
never auto-merge into any branch.

Each phase is independently runnable via the `--phase` argument. Without `--phase`, run all
phases sequentially.

## Runtime

- **Claude Code**: Use `/loop 10m /spec-to-implementation <spec-path>` for continuous
  review-fix cycles. Maximum runtime: **1-1.5 hours** (the loop auto-stops or use CronDelete).
  The loop is safe because no phase modifies `main` or any shared branch.
- **Codex**: Use `./scripts/ralph.sh --design-doc <name> --runtime codex` to dispatch tasks
  from the spec's task graph.

---

## Phase 1: Gap Analysis

Determine what the spec requires vs what exists. Launch **5-10 sub-agents** in parallel,
each investigating a different dimension of the spec.

### Agent Allocation (scale with spec size)

| Spec sections | Agent count | Rationale |
|---------------|-------------|-----------|
| < 5 tables, < 10 routes | 5 agents | Small spec |
| 5-15 tables, 10-30 routes | 7 agents | Medium spec |
| > 15 tables, > 30 routes | 10 agents | Large spec |

### Standard Agent Roles

1. **DB Schema Agent** — Compare spec data model tables/columns/constraints against
   `packages/infra/db/src/schema.ts`. Check FKs, cascades, indexes, unique constraints.
2. **Domain Layer Agent** — Compare spec interfaces (ports, services, middleware) against
   `packages/core/src/domains/`. Check method signatures, missing ports, missing services.
3. **API Routes Agent** — Compare spec API routes against `apps/api/src/api.ts` and
   `apps/api/src/routes/`. Check endpoints, HTTP methods, status codes, request/response schemas.
4. **Contracts Agent** — Compare spec types/enums against `packages/contracts/src/`.
   Check schemas, literals, missing types.
5. **Tests Agent** — Compare spec verification requirements against test files. Check
   which REQ/INV IDs have tests, which are missing, test quality.
6. **Web Pages Agent** (if spec has UI) — Check `apps/web/` for pages/components required
   by the spec.
7. **Permissions Agent** (if spec has RBAC) — Check permission definitions, role assignments,
   middleware wiring.

### Output

Produce a **gap table**:
```
| Gap ID | Spec Section | What's Missing | Priority | Files Affected |
```

---

## Phase 2: TDD — Write Failing Tests

For each gap identified in Phase 1, write **failing integration tests first**.

### Rules

- One test file per domain area (e.g., `tenancy-model.integration.test.ts`)
- Follow existing test patterns: `createDbAuthContext`, `requestJson`, `addMemberToOrg`
- Tag tests with `[INV-*]` IDs from the spec's invariants block
- Tests MUST fail initially (TDD red phase)
- Use `apps/api/src/*.integration.test.ts` for API tests
- Use `apps/web/app/**/*.integration.test.tsx` for React component tests

### Agent Strategy

Launch **1 agent per gap cluster** (group related gaps). Each agent:
1. Reads the spec section for its gaps
2. Reads existing test patterns in the repo
3. Writes failing tests in an isolated worktree
4. Runs `pnpm type-check` to verify tests compile (even if they'd fail at runtime)

---

## Phase 3: Implementation

Build the code to make tests pass. Use the `/worktree` skill conventions.

### Agent Strategy

Launch **1 agent per vertical slice** in isolated worktrees. A vertical slice is:
contracts + domain + ports + adapters + service + API route + handler.

Each agent:
1. Works in its own worktree (branch: `feat/<domain>-<feature>`)
2. Implements bottom-up: DB schema/migration → effect schemas → domain types → ports →
   adapters → service → API endpoint → route handler → mapper
3. Runs `pnpm type-check` (MUST pass before signaling done)
4. Does NOT run integration tests (deferred to post-merge)

### File Ownership Declaration

**CRITICAL**: To prevent merge conflicts, the orchestrator MUST declare file ownership
for each agent upfront. No two agents should create or modify the same file.

```
Agent 1 (team-members): owns packages/core/src/domains/team/, apps/api/src/routes/teams.ts
Agent 2 (roles-crud):   owns packages/core/src/domains/role/, apps/api/src/routes/roles.ts
Agent 3 (invitations):  owns packages/infra/db/src/repositories/invitations.ts
```

If two agents need the same file (e.g., `apps/api/src/api.ts` for endpoint registration),
assign one agent as the owner and have the other agent document what needs to be added
(the orchestrator merges manually).

### Worktree Safety Rules

Per `/worktree` skill:
- One task per worktree
- Branch from `main`
- No `pnpm dev` or `pnpm test:integration` (port conflicts)
- `pnpm type-check` is safe in parallel
- Commit before signaling done

---

## Phase 4: Adversarial Review-Fix Loop

The core hardening phase. For each worktree, launch **10-15 adversarial reviewers**.

### Reviewer Roles (per worktree)

| # | Role | What it checks |
|---|------|----------------|
| 1 | **Security Reviewer** | Auth bypass, injection, IDOR, missing permission checks |
| 2 | **Logic Reviewer** | Race conditions, null handling, incorrect status codes, edge cases |
| 3 | **Contract Reviewer** | Schema mismatches, request/response shape correctness |
| 4 | **Test Coverage Reviewer** | Missing test cases, untested error paths, missing edge cases |
| 5 | **DDD Pattern Reviewer** | Correct layer boundaries, dependency direction, port/adapter alignment |
| 6 | **DB Safety Reviewer** | FK cascades, migration safety, constraint correctness, N+1 queries |
| 7 | **Error Handling Reviewer** | Swallowed errors, wrong error codes, missing error mapping |
| 8 | **Concurrency Reviewer** | Race conditions, unique constraint handling, idempotency |
| 9 | **API Contract Reviewer** | OpenAPI spec accuracy, pagination correctness, consistent naming |
| 10 | **Cross-Worktree Reviewer** | Merge conflicts, duplicate domain files, overlapping exports |

Scale to 15 reviewers for large worktrees (> 10 files changed) by adding:
- Performance Reviewer (N+1 queries, missing indexes, unbounded queries)
- Accessibility Reviewer (for web pages — aria labels, semantic HTML)
- Observability Reviewer (missing logging, tracing, error reporting)
- Backward Compat Reviewer (breaking changes to existing APIs/schemas)
- Config/Env Reviewer (hardcoded values, missing env vars, secret leaks)

### Review-Fix Loop

```
while (criticalIssues > 0) {
  1. Compile all reviewer findings → consolidated bug report
  2. Categorize: CRITICAL / IMPORTANT / LOW
  3. Launch fix agents (1 per worktree with criticals)
  4. Wait for fixes
  5. Re-review fixed worktrees (launch new reviewers)
  6. Repeat until zero criticals
}
```

**Maximum iterations**: 3 loops. If criticals remain after 3 loops, escalate to human.

### Using /loop for the review-fix cycle

```
/loop 10m Check progress on fix agents. For completed fixes: re-review the diff for
correctness. If new issues found, launch follow-up fix agents. Track remaining criticals.
Once all criticals resolved, compile final report and stop.
```

Maximum loop runtime: **1-1.5 hours**. Use `CronDelete <job-id>` to stop early.

---

## Phase 5: Prevention

After all criticals are fixed and merged, surface systemic improvements that would have
caught the bugs earlier.

### What to Surface

1. **ESLint rules** — Should a new rule in `packages/tooling/eslint-config/` catch this class
   of bug? (e.g., `enforce-tenant-scope`, `no-swallowed-errors`, `enforce-auth-principal-usage`)
2. **Structural lint scripts** — Should a new script in `scripts/lint/enforce-*.mjs` prevent
   this? (e.g., `enforce-auth-on-mutations.mjs`)
3. **pgTAP tests** — Should DB-level constraints be tested in `packages/infra/db/pgtap/`?
4. **Test patterns** — Should a new test helper or factory be added to `packages/testkit/`?
   (e.g., `createTeamWithMembers`, `expectForbidden`)
5. **Architecture guards** — Should the `/worktree` or `/new-integration-test` skill be
   updated?

### Prevention must be actionable

Don't just list recommendations — **implement them** as part of this phase:
- Write the ESLint rule + test
- Write the testkit factory
- Add the pgTAP test
- Update the skill files

---

## Loop Behavior (Claude Code + Codex)

This skill is designed to run in `/loop`. Each invocation is **idempotent** — it checks
current state, identifies remaining gaps/bugs, fixes them, and reports. It never merges.

### Auto-Stop Condition

**When zero critical issues remain, the skill reports "CLEAN" and the loop should stop.**

The orchestrator (Claude Code or Codex) should:
1. Run the review-fix phase
2. If criticals found → fix → re-review
3. If zero criticals → report final status → `CronDelete <job-id>` to stop the loop
4. Maximum runtime: **1-1.5 hours** (hard cap, stop even if issues remain)

### Multi-Pass Trust Model

Don't trust the first pass. The loop enables multi-pass verification:

```
Pass 1: Gap analysis + TDD + implement
Pass 2: Adversarial review (10-15 agents) → find bugs
Pass 3: Fix bugs → re-review → find more bugs
Pass 4: Fix remaining → re-review → zero criticals → STOP
```

Each `/loop` iteration runs one pass of review-fix. Multiple iterations compound into
a high-confidence result.

### Claude Code

```bash
# Full pipeline (one-shot)
/spec-to-implementation specs/design/tenancy-model-design.md

# Review-fix loop (multi-pass, auto-stops when clean)
/loop 10m /spec-to-implementation specs/design/tenancy-model-design.md --phase review-fix

# Gap analysis only
/spec-to-implementation specs/design/tenancy-model-design.md --phase gap-analysis
```

### Codex (via ralph.sh)

```bash
# Decompose spec into task graph
tx decompose specs/design/tenancy-model-design.md

# Run Ralph — each task gets spec context injected
./scripts/ralph.sh --design-doc tenancy-model-design --runtime codex

# Multi-pass: run Ralph again after first pass completes
# Ralph will pick up remaining tasks and re-review completed ones
./scripts/ralph.sh --design-doc tenancy-model-design --runtime codex
```
