---
name: test-perf
description: Snapshot test-suite timings in this repo. Runs the unit and/or integration suites (or a single integration project) and reports wall-clock time, Vitest's own phase breakdown (transform/setup/import/tests/environment), and the slowest test files. Use when the user asks "how slow are the tests", "where does the test time go", wants a perf baseline, or wants to check the suite hasn't regressed.
metadata:
  short-description: Per-suite/per-project test timing + phase breakdown + slowest files
---

# test-perf

This skill is **for reporting only**. It runs the existing test entry points
with timing capture and prints numbers - per-suite wall clock, Vitest's phase
breakdown, and the slowest files. It never edits, deletes, splits, or
"optimises" tests. If the report suggests an action (split a slow file, demote
an integration test to a unit test, drop redundant coverage), surface the
suggestion in prose and let the human decide.

It is the perf analogue of the `lines-of-code` and `test-census` skills:
repo-root-aware, bash 3.2 compatible, safe to run during a release freeze
(it only reads what the suite already prints).

## Run

The script lives at `.claude/skills/test-perf/snapshot.sh` and is repo-root-aware.

| Command | Output |
|---|---|
| `./.claude/skills/test-perf/snapshot.sh` | Full integration suite: wall clock + phase line + slowest files |
| `./.claude/skills/test-perf/snapshot.sh --unit` | Unit suite wall clock + per-package timings |
| `./.claude/skills/test-perf/snapshot.sh --project web` | One integration project (`api`/`web`/`worker`/`testkit`/`observability`/...) |
| `./.claude/skills/test-perf/snapshot.sh --slowest 25` | Show the 25 slowest files (default 15) |
| `./.claude/skills/test-perf/snapshot.sh --runs 3` | Run the suite 3 times, report each + the best wall clock (factors out cold compile) |
| `./.claude/skills/test-perf/snapshot.sh --json` | Also emit a one-line JSON record for trend storage / regression checks |
| `./.claude/skills/test-perf/snapshot.sh --skip-infra` | Skip the `infra:ensure` preflight (infra already up - faster) |

Flags compose: `--project web --runs 2 --json --skip-infra`.

## What it measures

Vitest prints a phase line at the end of every run:

```
Duration  89.11s (transform 42.29s, setup 258.38s, import 154.39s, tests 329.25s, environment 45.22s)
```

The phase numbers are **summed across all workers**, so they exceed the wall
clock - that is expected and is exactly what makes them useful: they show where
the CPU-seconds go, independent of how many workers happen to be free.

| Phase | What it is | Typical lever |
|---|---|---|
| `transform` | esbuild/tsx transpiling source on first import | NODE_COMPILE_CACHE, fewer/lighter imports |
| `setup` | `setupFiles` + `beforeAll`/`beforeEach` hooks | per-test DB reset/TRUNCATE, shared fixtures via `beforeAll` |
| `import` | loading the module graph into each worker | barrel files, loading the whole API into web tests |
| `tests` | the actual `it()` bodies | real API/DB round-trips, `waitFor`, wall-clock `sleep` |
| `environment` | jsdom setup/teardown per file | only the web project pays this; node projects are 0ms |

Wall clock is captured separately (bash `SECONDS`, 1s granularity - plenty for a
multi-second suite).

## Interpreting the output

| Pattern | What it means |
|---|---|
| One project owns most of the wall clock | That is your refactor target. In this repo the **web** integration project dominates - it owns ~all of `setup` (per-test backend reset) and ~all of `environment` (jsdom). |
| `setup` is large | A `beforeEach` is doing expensive per-test work (DB reset, fixture rebuild). Move shared state to `beforeAll`, or gate the reset (`WEB_INTEGRATION_RESET_EACH_TEST=0` for read-only suites). |
| `import` is large relative to `tests` | Heavy top-level imports / barrel files / loading the whole API into a project that only needs a slice. |
| `tests` dominated by a few files | Open the slowest files. Look for wall-clock waits, N+1 setup queries, or coverage a faster unit test could give. |
| `environment` non-zero on a node project | A node project accidentally picked up `environment: 'jsdom'`. |

## Regression tracking

Append the `--json` line to a log and diff over time:

```bash
./.claude/skills/test-perf/snapshot.sh --json --skip-infra >> /tmp/test-perf-trend.jsonl
```

Each record is `{suite, project, wall_seconds, transform, setup, import, tests, environment, exit}`.
A CI step or a `loop` can snapshot this and flag when wall clock or a phase
drifts past a threshold. This is a baseline/trend tool, not a hard gate - the
hard wall-clock budget already lives in `scripts/test-integration-quiet.sh`
(120s local) and the pre-run hook that blocks `INTEGRATION_TIMEOUT_SECONDS`
overrides.

## Caveats

- **Integration runs need infra** (Postgres/Redis/OTEL/Temporal). The script
  calls `pnpm infra:ensure` itself unless `--skip-infra` is passed. Infra is
  shared across worktrees and is never torn down.
- **Numbers vary with machine load.** Running concurrently with other
  worktrees' suites inflates wall clock (shared CPU + Postgres). Use `--runs N`
  and read the best, or snapshot on a quiet machine for a clean baseline.
- The slowest-file extractor parses Vitest's default reporter (`<ms>ms` at end
  of each file line). If the reporter format changes, update
  `extract_slowest_files` in `snapshot.sh`.
- The unit path shells out to `pnpm test:quiet`, which runs each package
  serially via turbo; its wall clock reflects that orchestration, not raw test
  time. The per-package timings it prints are the useful signal there.
