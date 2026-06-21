---
name: adversarial-bug-hunt
description: Long-running (multi-hour) adversarial hunt for P0/P1/P2 bugs across the codebase. Mixes codebase observation, mechanical linting, real test + telemetry verification, and parallel skeptic sub-agents that must REFUTE each candidate before it is accepted. Fixes verified bugs on a branch off main with surgical per-bug commits, re-runs gates, and writes a dated report to the Desktop. Never pushes or merges. Use when you want a deep, autonomous bug-finding-and-fixing pass.
argument-hint: [--hours 3] [--report ~/Desktop] [--report-only] [--base main] [--area <path-or-domain>] [--no-commit]
---

# Adversarial Bug Hunt

A multi-hour, evidence-driven hunt for real P0/P1/P2 bugs. The defining principle is
**adversarial verification**: a finding is not a bug until a skeptic sub-agent has tried to
refute it and failed, and there is concrete evidence (a failing test, a trace, or an
unambiguous code path). This kills plausible-but-wrong findings before they waste a fix.

It then fixes the verified bugs on an isolated branch off `main`, one surgical commit per
bug, re-runs the affected gates, and writes a dated report to your Desktop. It never pushes
and never merges - you review and ship.

## When to use
- You want a deep autonomous bug pass over the whole repo or one area.
- Pre-release hardening (e.g. before a release freeze).
- After a large feature lands and you want an adversarial second opinion.

## When NOT to use
- A single known bug with a known fix - just fix it.
- You need new features - use `golden-path-crud` / `spec-to-implementation`.
- You only want a diff review of the current branch - use `/code-review`.

## Pipeline

```
Phase 0  Setup + baseline      worktree off main, infra up, capture pre-existing red, scaffold report
Phase 1  Mechanical sweep      lint / type-check / knip / pgTAP / tests / ast-grep anti-patterns  (cheap signal)
Phase 2  Adversarial review    N parallel sub-agents, one per dimension, hunt by bug class       (candidates)
Phase 3  Adversarial verify    skeptics try to REFUTE each candidate; default-reject; require repro
Phase 4  Fix + verify          TDD repro test -> minimal fix -> affected gates -> surgical commit (one per bug)
Phase 5  Report                append each bug to the Desktop report as you go (crash-safe)
                               loop rounds by area until time budget or K dry rounds
```

---

## HARD SAFETY RAILS (read first, never violate)

Breaking one is worse than missing a bug.

1. **Branch off `main`. Work in a dedicated worktree.** Never edit `main` directly.
2. **Never push and never merge.** This skill stops at clean local commits. The human ships.
3. **Surgical commits only. NEVER `git add -A`.** Stage only the files for the one bug you just
   fixed. The working tree may contain unrelated parallel work - do not sweep it in.
4. **One commit per verified bug**, with a message that states the bug, the root cause, and the
   evidence.
5. **Never weaken a gate to make it green.** No `as any`, `@ts-ignore`, `eslint-disable`,
   `.skip`, `xfail`, loosened assertions, or deleted tests to "pass". If the only fix is risky
   or large, do NOT fix - log it as `needs-human` in the report.
6. **Never disable tests, infra, or telemetry.** OTEL / Sentry / Spotlight stay on; their
   overhead is a fixed cost, not a perf lever.
7. **Every fix needs a verifying test.** Prefer a failing integration test that reproduces the
   bug, then make it pass (TDD). Never defer the integration test.
8. **Do not fix pre-existing baseline failures** unless they are a bug you independently
   discovered and verified. Note them in the report so they are not blamed on this run.
9. **Affected-only locally is fine for iteration**, but the run is not "done" until the human
   pushes the branch and checks the full-suite CI on the PR (local runs are affected-only, so
   cross-package or CI-only breakage only shows in CI). Say this explicitly in the report.

If `--report-only` is passed: run Phases 0-3, write the report, make NO code changes and NO
commits. If `--no-commit` is passed: apply fixes to the working tree but do not commit.

---

## Severity rubric (tuned to this codebase)

Assign severity from impact, not from how clever the bug is.

**P0 - ship-blocker / actively harmful**
- Money / billing wrong: double-charge, wrong amount charged, a payment/credit applied without
  its expected audit record, a billing loop.
- Security / authz: missing role check, tenant isolation break, token/secret leak, an endpoint
  reachable without auth, IDOR across orgs/workspaces.
- Data loss or corruption: destructive migration, missing transaction boundary, outbox event
  lost, a financial/audit trail mutated or pruned.
- Prod-down: crash on a common path, infinite retry/reconnect loop, deadlock, DB connection
  pool exhaustion.

**P1 - broken core behavior**
- A core feature returns wrong results or silently no-ops.
- A reservation/release pattern that leaks a held resource or fails to release on all paths.
- Temporal workflow non-determinism, or `apps/api` importing `@temporalio/*`.
- Infra failures surfaced as 4xx instead of 500, or a generic boundary `Error` masking the real
  root cause.
- Auth: session cleared on a transient network blip (logout-on-blip), rate-limit bypass.

**P2 - degraded but not broken**
- Edge-case correctness, wrong error message, off-by-one, missing pagination contract.
- Server-truth desync from a guessed/optimistic client write.
- Avoidable N+1, missing index on a hot query, needless re-render storms.
- Frontend: bare `<button>` used for a styled action instead of `.btn` classes, non-shadcn
  hand-rolled UI, runtime API access not going through generated Orval hooks.

Anything that cannot be reproduced or evidenced is **not a bug** - it is a candidate that
failed verification. Record it in the "rejected" section, do not fix it.

---

## Phase 0 - Setup + baseline

```bash
# 1. Isolated worktree off main (raw `git worktree add` is blocked by a hook; use create.sh)
./scripts/worktree/create.sh fix/bug-hunt-$(date +%F) main
cd .worktrees/bug-hunt-$(date +%F)   # path create.sh prints

# 2. Shared infra (idempotent; never tear down - it is shared across worktrees)
pnpm infra:ensure

# 3. Baseline: capture what is ALREADY red so this run never gets blamed for it
pnpm lint:quiet         2>&1 | tee /tmp/bughunt-baseline-lint.txt   || true
pnpm type-check:quiet   2>&1 | tee /tmp/bughunt-baseline-types.txt  || true
pnpm test:integration:quiet 2>&1 | tee /tmp/bughunt-baseline-int.txt || true

# 4. Scaffold the Desktop report (append as you go so a crash leaves a partial report)
REPORT="$HOME/Desktop/adversarial-bug-hunt-$(date +%F).md"
```

Watch the environment gotchas before blaming a "bug":
- If integration ports collide, a worktree may have grabbed `:5000` (macOS AirPlay holds it) -
  set a free `WORKTREE_PORT_OFFSET` in the worktree `.env`.
- A migration failing with `type vector does not exist` is usually a shared-Postgres
  extension-schema issue (another worktree installed pgvector into its own schema), not a code
  bug - `ALTER EXTENSION vector SET SCHEMA public` locally.
- A budget-killed integration run leaves orphan vitest processes - kill them before retrying.

---

## Phase 1 - Mechanical sweep (cheap signal first)

Run the cheap mechanical detectors before spending sub-agent tokens. Each hit is a candidate,
not yet a bug.

```bash
pnpm lint            # ESLint + structural enforce-*.mjs + shell + jscpd duplication
pnpm type-check
pnpm lint:knip       # unused files / deps / exports
pnpm test:db:pgtap   # DB trigger + constraint contracts
pnpm test:integration:quiet   # affected-only; surfaces real failures fast
```

Then structural anti-pattern search (shape, not text - prefer `ast-grep`/`sg`, fall back to
`grep`). Hunt for, at minimum:
- Floating promises / missing `await` on DB or network calls.
- Empty `catch {}` / errors swallowed without report.
- `as any` / `@ts-ignore` / `eslint-disable` smuggled into source (forbidden - each is a finding).
- `apps/web` importing `effect`, `drizzle-orm`, `next/server`, or hitting the API outside
  generated Orval hooks.
- `drizzle-orm` used outside `packages/infra/db`; `process.env` read outside env modules.
- Missing transaction boundaries around multi-write operations; outbox writes not in the same tx.

Record candidates with file:line so Phase 3 can verify them.

---

## Phase 2 - Adversarial deep review (parallel sub-agents)

Fan out sub-agents, **one per dimension**, each with a narrow charter to find a specific bug
class in a specific area. Scale the count to the area and time budget.

| Time budget | Sub-agents per round | Notes |
|-------------|----------------------|-------|
| ~1 hour     | 5-6                  | Highest-risk dimensions only |
| ~3 hours    | 8-10                 | Full dimension set, 2-3 rounds |
| ~4+ hours   | 10-12                | Full set + a completeness-critic round |

### Standard dimensions (pick by area)
1. **Billing / payments** - charge/credit symmetry, audit-record emission, reservation release, idempotency.
2. **Security / authz / tenancy** - role checks, cross-org isolation, secret handling, auth on every route.
3. **Concurrency / transactions** - races, missing locks, deadlocks, outbox atomicity, pool limits.
4. **Data integrity / migrations** - destructive DDL, per-schema (`current_schema`) vs `public.*`, FKs/cascades.
5. **Temporal determinism** - non-deterministic workflow code, `apps/api` importing `@temporalio/*`, retry semantics.
6. **Error handling / observability** - infra failure -> 500, real root cause captured not generic boundary Error.
7. **API contract** - request/response schema, status codes, pagination contract, surface-policy drift.
8. **Frontend correctness** - server-truth desync, Orval-hook usage, shadcn/`.btn` conventions, role gating.
9. **Telemetry-driven** - read REAL running systems: Spotlight / Jaeger / Prometheus / Sentry for live errors and slow traces, then trace symptom -> source.

### Sub-agent charter template
```
You are a skeptical senior engineer hunting <DIMENSION> bugs in <AREA>.
Goal: find real P0/P1/P2 bugs, NOT style nits. For each, return:
  { title, severity(P0|P1|P2), file, line, rootCause, evidence, repro(how to trigger), proposedFix }
Rules:
  - Read the actual code path end to end; do not guess.
  - Prefer bugs you can back with a failing test, a trace, or an unambiguous code path.
  - If you are not sure it is real, mark confidence:low - it will be refuted in verification.
  - Do NOT fix anything. Reporting only.
Severity rubric and codebase-specific bug classes: see the skill's rubric section.
```

**Claude Code**: launch these in a single message (multiple `Agent` tool calls) so they run
concurrently, or drive the whole find -> verify pipeline with the `Workflow` tool (see
Orchestration). **Codex**: run dimensions sequentially, or dispatch via `scripts/ralph.sh`.

---

## Phase 3 - Adversarial verification (refute or it is not a bug)

For each candidate from Phases 1-2, spawn one or more **skeptic** sub-agents whose job is to
REFUTE it. This is the heart of the skill.

### Skeptic charter
```
Try to PROVE this is NOT a bug: <candidate>.
Look for: the guard that already handles it, the caller that makes it unreachable, the test
that already covers it, a misread of the code, an env/test artifact (not a real defect).
Default to refuted:true if you cannot produce concrete evidence it is real.
Return { refuted(bool), reason, evidenceForRealBug?, suggestedReproTest? }.
```

Acceptance rules:
- For P0/P1 candidates, require a **reproduction**: ideally a failing integration test, or a
  trace/log showing the failure, or a code path with no possible guard.
- Use majority vote for high-stakes findings (e.g. 3 skeptics, accept only if <=1 refutes).
- A candidate that cannot be reproduced or evidenced is **rejected** - log it, do not fix it.
- Distinguish real defects from environment artifacts (stale dist, leaked schema, budget-kill,
  port collision). Local-pass != CI-pass and CI-fail != code bug.

Output: a deduped list of **accepted bugs** (with severity + repro) and a **rejected** list
(with the refutation reason).

---

## Phase 4 - Fix + verify (one bug at a time)

Process accepted bugs highest severity first. For each:

1. **Write/confirm the failing test** that reproduces the bug (TDD). Prefer
   `*.integration.test.ts(x)` with real API + DB; unit only where integration is impractical.
2. **Implement the minimal fix.** No drive-by refactors. No new `as any`/disables.
3. **Run the affected gates** and confirm green:
   ```bash
   pnpm lint:quiet && pnpm type-check:quiet && pnpm test:integration:quiet
   ```
4. **Commit surgically** - stage only this bug's files:
   ```bash
   git add <only the files for THIS fix>     # NEVER git add -A
   git commit -m "fix(<area>): <bug> [P<n>]

   Root cause: <one line>.
   Evidence: <failing test / trace>.
   Verified: <test name> now passes; lint+type+affected-int green."
   ```
5. **Append the bug to the report immediately** (crash-safe).

If a fix balloons in scope, conflicts with parallel work, or only passes by weakening a gate:
**stop, revert that fix, and log it as `needs-human`** in the report with your analysis.

---

## Phase 5 - Report (Desktop, append-as-you-go)

Write to `$HOME/Desktop/adversarial-bug-hunt-$(date +%F).md`. Structure:

```markdown
# Adversarial Bug Hunt - <date>
Branch: fix/bug-hunt-<date> (off main) | Areas swept: <list> | Time: <start>-<end>

## Summary
| Severity | Found | Fixed | Needs-human | Rejected |
|----------|-------|-------|-------------|----------|
| P0 | _ | _ | _ | _ |
| P1 | _ | _ | _ | _ |
| P2 | _ | _ | _ | _ |

## Fixed bugs
### [P0] <title>
- Location: file:line
- Root cause: ...
- Evidence / repro: <failing test name or trace id>
- Fix: <what changed>
- Verification: <test passes; gates green>
- Commit: <sha>

## Needs human (not fixed - too risky / large / ambiguous)
### [P1] <title> - why deferred, suggested approach

## Rejected candidates (failed adversarial verification)
- <title> - refuted because <reason>

## Baseline (pre-existing red, NOT caused by this run)
- <lint/type/test failures present before the hunt began>

## Next steps for the human
- Review commits on fix/bug-hunt-<date>, then push and check the full-suite CI on the PR
  (local runs were affected-only; full suite + cross-package breakage only show in CI).
```

---

## Looping for hours (time-box)

This is designed to run for a long session. Structure the run as **rounds**, each round taking
one area/dimension, running Phases 1-5, then marking the area swept.

- **Stop conditions**: stop when the wall-clock hits `--hours` (default 3) OR when **2
  consecutive rounds find no new verified bug** (loop-until-dry). Whichever comes first.
- A final **completeness-critic** round asks: which area/dimension/modality did I not sweep,
  which accepted bug lacks a repro, which trace did I not read? Its answers seed one more round.
- **Claude Code, continuous**: run under `/loop` and drive the per-round fan-out with the
  `Workflow` tool. Prefer continuous workflow execution over frequent checkpoints, and fan out
  independent dimensions to parallel sub-agents.
- Respect a token budget if one is set: scale sub-agents per round to the remaining budget.

---

## Orchestration by host

**Claude Code**
- Parallel finders: one message with multiple `Agent` calls (subagent_type `Explore` for
  read-only hunts, `general-purpose` when a repro test must be written).
- Whole pipeline: the `Workflow` tool with `pipeline(dimensions, find, verify)` so each
  dimension's findings verify as soon as that finder returns. Use a barrier only to dedup
  across all findings before fixing.
- The main thread keeps the gates + the surgical commit (do not let sub-agents commit).

**Codex**
- Codex auto-loads this `SKILL.md`. Run dimensions sequentially in one session, or dispatch
  per-dimension tasks via `scripts/ralph.sh` (see the `ralph-loop` skill).
- Same hard rails: branch off main, surgical commits, no push/merge, repro before fix.

---

## Anti-patterns (do not do these)
- Reporting a "bug" with no repro and no evidence.
- Fixing a candidate that a skeptic refuted.
- `git add -A` / committing unrelated working-tree changes.
- Disabling a test, lint rule, or telemetry to go green.
- Pushing, merging, or touching `main` directly.
- Treating a CI-only or environment artifact (stale dist, leaked schema, port collision,
  budget-kill) as a code bug.
- Counting `pnpm lint`/`type-check`/`test` as passed when piped through `grep`/`head` without
  `set -o pipefail` (the first command's exit code is lost).

## Example invocations
```
/adversarial-bug-hunt                      # 3h default, fix+commit off main, report to Desktop
/adversarial-bug-hunt --hours 4 --area packages/core/src/domains/billing
/adversarial-bug-hunt --report-only        # find + verify + report, zero code changes
/loop /adversarial-bug-hunt --hours 4      # continuous multi-hour run
```
