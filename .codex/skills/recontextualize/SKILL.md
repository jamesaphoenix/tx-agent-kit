---
name: recontextualize
description: Produce a DEEP, massive briefing that re-establishes full mental context on a piece of work just completed on a branch — every critical workflow with its own code snippets, verbatim test titles, spine files, data paths, new tests, and open follow-ups. Use when returning to a branch after a break, picking up someone else's work, or handing off work to another agent. Length is NOT capped; scannability is the measure — the briefing must have a Workflow Index for jumping, and every workflow must include a code snippet.
argument-hint: "[--base <ref>] [--branch <ref>] [--focus <glob>] [--out <file>]"
metadata:
  short-description: "Deep re-contextualization briefing on recent work"
---

# Recontextualize — Rebuild full mental context on recent work

When you return to a branch after hours or days away, you've lost the thread: you know roughly what you were doing but not the exact surface area, not the pivotal commits, not the snippets of code you should re-read first. This skill produces a **self-contained massive briefing** that rebuilds the full mental model in one pass: every critical workflow, the code that drives it, the tests that pin it, the data paths it touches, and the follow-ups still open.

**This is not a summary skill.** Go deep. A 2000-line briefing is fine — better a thorough one you can jump around in via a Workflow Index than a tight one that cut corners on the workflows you were actually resuming today.

Useful for:
- Returning to a long-running branch after a context break
- Picking up someone else's in-progress branch
- Writing a PR description that captures the *why* not just the *what*
- Handing off work to another engineer or agent
- Filing a design review note

**Not** a substitute for reading the actual diff or the commit messages. This is the briefing *before* the diff, the table of contents *for* the diff.

## Inputs

| Flag | Default | Purpose |
|---|---|---|
| `--base <ref>` | `main` (or configured default branch) | The ref to diff against — everything since this point is "the work" |
| `--branch <ref>` | current HEAD | The ref the work lives on |
| `--focus <glob>` | none | Restrict analysis to files matching this glob (e.g. `packages/core/src/domains/billing/**`) |
| `--out <file>` | stdout | Write the briefing to a file instead of printing it |
| `--max-snippets N` | 8 | Cap on the number of code snippets in the briefing |

## Workflow State Machine

```
START
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 0: RESOLVE REFS                                 │
│                                                      │
│ Resolve base + branch refs. Fail fast if base isn't  │
│ reachable from branch (nothing to contextualize).    │
│                                                      │
│   git merge-base <base> <branch>                     │
│   git rev-parse <base> <branch>                      │
│                                                      │
│ Record the merge-base as the "start of work".        │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: COMMIT SURVEY                                │
│                                                      │
│ Pull the commit stream since the merge-base:         │
│                                                      │
│   git log --reverse --pretty=format:'%h|%s|%an|%ad'  │
│     --date=short <merge-base>..<branch>              │
│                                                      │
│ Record: total commit count, authors, date range,     │
│ and the raw list.                                    │
│                                                      │
│ If there are > 30 commits, you are probably          │
│ briefing an entire feature branch — raise the        │
│ snippet budget and expect multiple workflows.        │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: CHANGED-FILE SURVEY                          │
│                                                      │
│   git diff --stat <merge-base>..<branch>             │
│   git diff --name-status <merge-base>..<branch>      │
│                                                      │
│ If --focus <glob> is set, filter to matching files.  │
│                                                      │
│ Bucket the files by subsystem using the layer map    │
│ (see "Subsystem Layer Map" below). Each bucket is    │
│ a candidate critical workflow.                       │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: IDENTIFY CRITICAL WORKFLOWS                  │
│                                                      │
│ For each bucket with > 0 files, identify its         │
│ "spine" — the file(s) that drive the control flow:   │
│                                                      │
│  • apps/api/src/routes/*   → HTTP entry points       │
│  • packages/core/.../application/* → service seam    │
│  • packages/core/.../domain/*      → pure rules      │
│  • packages/core/.../ports/*       → port contracts  │
│  • packages/infra/db/src/repositories/* → persistence│
│  • apps/worker/src/*-activities.ts → temporal work   │
│  • migrations (*.sql)      → schema changes          │
│                                                      │
│ A workflow = the thread that crosses layers for ONE  │
│ user-facing behavior. Group HTTP → service → port →  │
│ repo together under one workflow heading.            │
│                                                      │
│ ELEVATION SIGNALS — any of these MUST get its own    │
│ workflow section, even if the LOC change is tiny:    │
│   • a new dedicated test file (*.e2e.* or            │
│     focused *.integration.test.*)                    │
│   • a new migration (*.sql under drizzle/migrations) │
│   • a new port (Context.Tag) or new adapter          │
│   • a new domain event type in events.ts             │
│   • a new middleware file                            │
│   • a new route handler file                         │
│                                                      │
│ Rationale: the author signalled a discrete concept   │
│ by giving it its own file. Burying it inside another │
│ workflow's prose robs a returning engineer of the    │
│ spine they need to resume that specific thread.      │
│                                                      │
│ DEMOTION: if a file only has a 1-2 line change AND   │
│ no elevation signal AND no related test landed,      │
│ demote it — it's likely incidental, not a workflow.  │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: TEST LANDING ZONE                            │
│                                                      │
│ New tests are the BEST specification of intent —     │
│ they tell you what the author believed the code      │
│ should do. Pull them out separately:                 │
│                                                      │
│   git log --diff-filter=A --name-only --pretty=      │
│     format: <merge-base>..<branch>                   │
│     -- '**/*.test.ts' '**/*.integration.test.ts'     │
│                                                      │
│ Also capture tests that were MODIFIED (an existing   │
│ test's expectation changing is a behavior change):   │
│                                                      │
│   git log --diff-filter=M --name-only ...            │
│     -- '**/*.test.ts'                                │
│                                                      │
│ For each added test file, extract the describe +     │
│ it() titles VERBATIM — they are the "intent          │
│ summary" of the work in one glance.                  │
│                                                      │
│ CRITICAL: quote titles verbatim. DO NOT paraphrase.  │
│ "full happy path + error cases" is a paraphrase and  │
│ loses the machine-precision that test names carry.   │
│ '@spec INV-BILLING-009 emits billing.usage_cap_      │
│  warning when increment crosses 80 percent' is       │
│ what the reader needs — copy it directly from the    │
│ `it(...)` string.                                    │
│                                                      │
│ Use `grep -E "^\s*(describe|it)\s*\('"` or the Grep  │
│ tool to extract the titles without opening the full  │
│ file.                                                │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: PULL CODE SNIPPETS (MANDATORY PER WORKFLOW)  │
│                                                      │
│ HARD RULE: every workflow section MUST contain at    │
│ least one code snippet quoted from a file read this  │
│ run, tagged with `file:line`. A workflow without a   │
│ snippet is a thin heading — demote it out of the     │
│ workflow list into the "Touched but not deep-dived"  │
│ appendix (see template below).                       │
│                                                      │
│ If this rule forces you to read 21 source files,     │
│ read 21 source files. That is the skill working as   │
│ designed — thin headings with no code-backed         │
│ deep-dive are a regression even if "everything got   │
│ a section".                                          │
│                                                      │
│ Snippet selection rules:                             │
│  • Prefer the biggest contiguous changed hunk in the │
│    spine file over many tiny ones.                   │
│  • Prefer added/new code over lines touched inside   │
│    a large pre-existing function (noise).            │
│  • Prefer code with non-trivial comments — the       │
│    author is explaining themselves for a reason.     │
│  • Cap each snippet at ~30 lines; use `// ...`       │
│    to elide uninteresting middle sections.           │
│  • Tag every snippet with `file:line` so the reader  │
│    can jump to the source. Never quote without a     │
│    location.                                         │
│  • If the spine file is huge, pick ONE hunk — don't  │
│    try to cover the whole file.                      │
│                                                      │
│ If --max-snippets is set AND you'd exceed it, keep   │
│ snippets on the HIGHEST resume-priority workflows    │
│ (see Step 5.5) and demote the rest to the appendix.  │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 5.5: ASSIGN RESUME PRIORITY                     │
│                                                      │
│ Before emitting, tag each workflow with a resume-    │
│ priority from {high, med, low}. A returning engineer │
│ uses this to decide what to read first.              │
│                                                      │
│ HIGH — any of:                                       │
│   • An uncommitted-work file touches this workflow's │
│     spine (author was mid-edit here).                │
│   • The workflow contains the HEAD commit or one of  │
│     the last 3 commits.                              │
│   • A new migration is part of the spine.            │
│   • The commit messages contain "WIP", "TODO",       │
│     "broken", "FIXME", "wip", "draft".               │
│                                                      │
│ MED — any of:                                        │
│   • Workflow contains 5+ commits.                    │
│   • A new port / event / middleware is added.        │
│   • A new dedicated test file is added.              │
│                                                      │
│ LOW — everything else (workflow touched only         │
│ incidentally; mainly relevant for full-history       │
│ readers, not for resuming work today).               │
│                                                      │
│ Sort the Workflow Index HIGH → MED → LOW so the      │
│ first screen of the briefing shows the sections      │
│ the reader is most likely resuming.                  │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: OPEN THREADS                                 │
│                                                      │
│ Scan the diff for:                                   │
│                                                      │
│  • `TODO`, `FIXME`, `XXX`, `HACK`, `NOTE:` comments  │
│    added in this work (not pre-existing)             │
│  • `Effect.logWarning` calls added — warnings        │
│    usually flag paths the author left deliberately   │
│    unfinished                                        │
│  • `@spec` or `@todo` tags added                     │
│                                                      │
│ Also check the branch working tree for modified-but- │
│ uncommitted files:                                   │
│                                                      │
│   git status --porcelain                             │
│                                                      │
│ These are usually the place the author WAS when they │
│ context-switched out — the most important thing to   │
│ look at.                                             │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: EMIT THE BRIEFING                            │
│                                                      │
│ Render the briefing using the template below.        │
│ Write to --out if provided, else stdout.             │
│                                                      │
│ There is NO line budget. A long branch earns a long  │
│ briefing — a 2000-line document is fine *if* every   │
│ workflow carries a code-backed deep-dive and the     │
│ reader can jump via the Workflow Index.              │
│                                                      │
│ The measure of success is SCANNABILITY, not length:  │
│   • TL;DR + commit spine + Workflow Index must fit   │
│     in the first ~100 lines (first screen is         │
│     orienting).                                      │
│   • Every workflow heading must be reachable from    │
│     the Workflow Index in one click / Ctrl-F.        │
│   • No padding — if a line doesn't earn its place,   │
│     cut it. But don't cut a real workflow to save    │
│     lines.                                           │
└─────────────────────────────────────────────────────┘
  │
  ▼
DONE
```

## Output Template

```markdown
# Recontextualization: `<branch>`

**Base**: `<base>` @ `<base-sha-short>`
**Branch**: `<branch>` @ `<head-sha-short>`
**Merge-base**: `<merge-base-sha-short>`
**Commit range**: `<N>` commits, `<author-count>` author(s), `<start-date>` → `<end-date>`
**Uncommitted changes**: `<clean | N files modified>`

## 60-second TL;DR

<3-5 bullets. Each bullet = one sentence, describing the branch's overall
arc and user-facing impact. No commit SHAs in the TL;DR — this is the
briefing, not the changelog.>

## Commit spine (chronological)

| # | SHA | Subject |
|---|-----|---------|
| 1 | `abc1234` | ... |

(Keep to ~15 rows for a short branch; for a 50+ commit branch, show
the first 5, last 10, and collapse the middle into a single
"... and N more commits in between" row. Never truncate the last
3 commits — those are the freshest state the author left.)

## Workflow Index

The reader's jump table. One line per workflow, tagged with resume
priority and sorted HIGH → MED → LOW. A reader should be able to scan
this and pick 2-3 sections to deep-read.

| # | Priority | Workflow | Spine file |
|---|----------|----------|------------|
| 1 | **HIGH** | `charge.refunded` webhook handler | `packages/core/.../billing-service.ts:1012` |
| 2 | **HIGH** | Per-org rate limit on session endpoints | `apps/api/src/middleware/billing-rate-limit.ts` |
| 3 | MED | Property-based tests for margin math | `packages/contracts/src/billing.properties.test.ts` |
| 4 | LOW | Credit-ledger cursor compound keyset | `packages/infra/db/src/repositories/credit-ledger.ts:459` |
| ... | | | |

## Critical workflows

### Workflow 1: <short descriptive name> `[priority: HIGH]`

**Spine**:
- `path/to/entry.ts:NN-MM` — HTTP entry
- `path/to/service.ts:NN-MM` — application logic
- `path/to/repo.ts:NN-MM` — persistence

**What changed and why**:
<2-4 sentences. Name the before state, the after state, the motivation.>

**Key snippet** (`path/to/file.ts:NN-MM`) — MANDATORY, one per workflow:

```ts
// ...quoted code with author's comments preserved...
```

**Covered by** (quote test titles verbatim, use `grep "\bit\s*(\s*'"`):
- `path/to/new.integration.test.ts`
  - `describe('billing outbox emission')`
    - `it('@spec INV-BILLING-009 emits billing.usage_cap_warning when increment crosses 80 percent')`
    - `it('is idempotent on duplicate delivery')`

### Workflow 2: ... `[priority: HIGH]`

(repeat — every workflow MUST have a snippet; no thin headings)

## Touched but not deep-dived

Files that changed on this branch but don't merit their own workflow
section — incidental edits, config bumps, typo fixes, lockfile churn,
generated code. One line each, NO snippets.

- `pnpm-lock.yaml` — dep bump for `fast-check@3.23.2`
- `apps/api/src/routes/teams.ts:44` — typo fix in error message
- `specs/index.md` — table of contents regen

(If this section is longer than the "Critical workflows" section, you
probably over-demoted — promote the most substantive files back up.)

## Data paths touched

Short list of the domain types / ports / events that moved. Example:

- **Domain events**: `billing.credits_refunded` (new), `billing.dispute_resolved` (payload extended)
- **Ports**: `CreditLedgerStorePort.append` signature widened with `failIfSuspended`
- **Schema**: migration 0043 — partial unique index on `auto_recharge_attempts`
- **Shared types**: `StripeWebhookEvent.data.previousAttributes` (new field)

(Keep this under 12 bullets. It's a lookup key, not a changelog.)

## Tests added or modified

For each NEW test file, list the verbatim `describe` + `it` titles. A
paraphrased "what it pins" column is a trap — it tempts you to write
generic prose instead of quoting the real test names. If a file has
more than ~8 it() titles, group by describe block and keep the most
representative 5-6 titles verbatim; note "…and N more" for the tail.

```
path/to/file.test.ts (N added)
  describe('<verbatim describe>')
    - it('<verbatim it>')
    - it('<verbatim it>')
```

## Open threads

- **Uncommitted work**: <the files the author was mid-edit on, if any>
- **TODO/FIXME added this branch**: <file:line — short note>
- **Deliberate warning logs**: <file:line — what it's signalling>
- **Known follow-ups**: <one-liner per item from the commit messages or report>

## Where to look first

Ordered list of files to read in sequence to rebuild your mental model
end-to-end. 3-5 files, no more.

1. `path/to/spine-file.ts` — start here, it's the nerve center
2. `path/to/new.integration.test.ts` — confirms what "working" means
3. `path/to/migration.sql` — the data shape that everything else assumes
```

## Subsystem Layer Map

Use this to bucket files in Step 2. When a file matches multiple buckets,
pick the *most specific* one (deepest path wins).

| Bucket | Glob pattern | Layer |
|---|---|---|
| Contracts | `packages/contracts/src/**` | shared types/schemas |
| Domain — billing | `packages/core/src/domains/billing/**` | core |
| Domain — assets | `packages/core/src/domains/assets/**` | core |
| Domain — <other> | `packages/core/src/domains/<name>/**` | core |
| Repos | `packages/infra/db/src/repositories/**` | persistence |
| Migrations | `packages/infra/db/drizzle/migrations/**` | schema |
| Stripe adapter | `packages/infra/stripe/src/**` | external |
| API routes | `apps/api/src/routes/**` | HTTP |
| API middleware | `apps/api/src/middleware/**` | HTTP |
| API integration tests | `apps/api/src/**.integration.test.ts` | tests |
| Worker activities | `apps/worker/src/*-activities.ts` | temporal |
| Worker workflows | `apps/worker/src/workflows.ts` | temporal |
| Web pages | `apps/web/src/app/**` | frontend |
| Specs | `specs/**` | design docs |

## Rules

1. **Go DEEP — this is a massive-recontextualization skill, not a summary skill.** A returning engineer needs enough context to resume non-trivial work without re-reading the diff. That means thorough code-backed deep-dives per workflow, verbatim test titles, full spine listings, and genuine before/after/motivation prose. A 2000-line briefing with a jumpable Workflow Index is better than a 250-line briefing that cut corners on the workflows you were actually working on.
2. **Every workflow MUST have a code snippet.** A prose-only workflow heading is a failed workflow — demote it to the "Touched but not deep-dived" appendix. If the mandatory-snippet rule forces you to read 20+ source files, read 20+ source files. That's the skill working as designed.
3. **Scannability is the real measure, not length.** The first ~100 lines (header + TL;DR + commit spine + Workflow Index) must orient the reader. Workflows must be reachable via the Index in one Ctrl-F. No padding — every line earns its place — but don't cut content to hit a line count.
4. **Snippets with line numbers, always.** A snippet without `file:line` is a receipt the reader can't verify. Always quote the location.
5. **Tests are the spec — quoted verbatim.** If an added integration test title answers "what did this work do", copy the it() string literally. Paraphrases lose the machine-precision that makes test names useful.
6. **Verify counts, verify algorithm names.** If you claim "N tests", run `grep -c "it('" <file>` and use that number. If you call something a "token bucket", confirm it by reading the source — don't infer from feature names. Every count and every technical label must be grounded in a file you actually read this run.
7. **No invented history.** If a commit message says the fix was for bug X, quote the commit message — don't paraphrase into something stronger.
8. **Elevation signals override LOC heuristics.** A new test file, migration, port, event, middleware, or route handler *always* gets its own workflow section — even if the LOC change is tiny. The author's filesystem choice is the signal.
9. **Sort workflows by resume priority (Step 5.5).** HIGH → MED → LOW. The reader's first screen should surface the things they're most likely picking back up today.
10. **Surface the uncommitted state.** The author was almost certainly in the middle of something when they stopped. `git status --porcelain` is the *most valuable* data point in a recontextualization.
11. **Don't run tests or linters.** This skill is read-only observation. It should never touch the repo state.
12. **One pass, not two.** This skill is cheap only if you run it in a single shot. Don't loop on "maybe I should also look at...". Emit the briefing from what Step 1-6 collected and stop.

## How to run

### Brief the current branch vs main
```
/recontextualize
```

### Brief a specific branch vs a different base
```
/recontextualize --base origin/main --branch feat/some-feature
```

### Brief only the billing subsystem on the current branch
```
/recontextualize --focus 'packages/core/src/domains/billing/**'
```

### Save the briefing to disk for later reference
```
/recontextualize --out ~/Desktop/briefing-<branch>.md
```

### Use inside a larger task
The typical flow after a context break:

1. `/recontextualize --out /tmp/brief.md`
2. Read `/tmp/brief.md` end-to-end.
3. Open the files in the "Where to look first" section.
4. Resume work — now with a fresh mental model of the surface area.

## Anti-patterns

- ❌ **Thin workflow headings with no code snippet.** A workflow section that is just a spine list and a prose paragraph is a failure — every workflow must have at least one `file:line`-tagged snippet. If you can't find one to include, the workflow belongs in the "Touched but not deep-dived" appendix, not in the critical-workflows list.
- ❌ **Dumping a raw `git log --stat`.** The whole point is synthesis — not a reformatted changelog. Every workflow must have a "What changed and why" paragraph naming the before state, after state, and motivation.
- ❌ **Quoting entire files.** Individual snippets are ~30 lines max; use `// ...` to elide uninteresting middle sections. If you need more coverage, add a second snippet from a different hunk rather than one giant quote.
- ❌ **Padding.** No filler sentences that restate what the snippet already shows. No "this is a complex area" throat-clearing. Every line earns its place — but cut padding, not content.
- ❌ **Cutting real workflows to hit a line budget.** There is no line budget. A long branch earns a long briefing. The measure is scannability (Workflow Index + jump), not page count.
- ❌ **Re-running tests to "confirm things work".** This skill is read-only. If the reader wants that, they can run `pnpm test` themselves.
- ❌ **Editorialising** ("this is clearly a bad pattern"). State what changed and why the author said they changed it. Opinions are noise at recontextualization time.
- ❌ **Padding the TL;DR with commit SHAs.** The commit table has SHAs; the TL;DR is prose.
- ❌ **Paraphrasing test names.** "full happy path + error cases" is a paraphrase; `it('refuses a negative quantity')` is the real thing. Always quote verbatim — use `grep "\bit\s*(\s*'"` or `grep "\bdescribe\s*(\s*'"` to extract.
- ❌ **Burying an elevation-signal file inside another workflow's prose.** If `charge.refunded` has its own test file `billing-charge-refunded.e2e.integration.test.ts`, it gets its own workflow — not one sentence inside the broader Stripe-webhook paragraph.
- ❌ **Guessing at counts or algorithm names.** "8 tests" when `grep -c "it('"` says 7 is a credibility-killing error. "Token bucket" when the source is a sliding-window Map is the same error for technical labels. Verify by reading the file.
- ❌ **Using a "What it pins" column** in the tests table. It tempts paraphrase. Quote `describe`/`it` strings instead.
- ❌ **Emitting workflows in chronological or alphabetical order.** Sort by resume priority — the reader's first screen should surface the sections they're most likely picking back up.
