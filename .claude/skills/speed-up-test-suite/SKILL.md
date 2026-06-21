---
name: speed-up-test-suite
description: Reduce test-suite wall-clock (dev + CI) without losing coverage or telemetry. Measure the phase breakdown first, then apply proven levers (parallelize turbo, narrow imports vs barrels, lazy-load heavy graphs, pool/worker config, DB pool sizing) and capture the before/after delta. Use when tests are slow, CI time is high, or to set/check a perf baseline. Composes with the read-only test-perf and test-census skills.
metadata:
  short-description: Playbook to cut test wall-clock via measured, proven levers
---

# speed-up-test-suite

Playbook for reducing test wall-clock (dev + CI). Companion to `fix-test-flake`. Use `test-perf` (timing/phase measurement) and `test-census` (test-type pyramid) as the read-only tools this skill acts on.

## Golden rule: measure first
Run `test-perf` to get Vitest's phase breakdown (transform / setup / import / tests / environment), the slowest files, and CPU-vs-wall (parallelism headroom). Optimise the dominant cost, not a guess. Wall-clock is noisy on a shared/self-hosted machine - prefer the phase-summed metrics, which are change-attributable. Capture before/after for every change.

## Proven levers (ranked by the impact this repo measured)
- **Parallelize the unit suite**: one `turbo run test` with one `--filter` per package (DAG-parallel) instead of a per-package serial loop. ~3.3x (64s -> 18s).
- **Parallelize structural lint invariants**: run the independent `enforce-*.mjs` scripts concurrently (collect exit codes), not `&&`-chained. ~3x.
- **Cut per-file setup cost**: under `pool:'forks', isolate:true` the setup module graph re-evaluates PER FILE across all test files. Import the NARROW seam, not the barrel (e.g. `@tx-agent-kit/testkit/dist/db-auth-context.js`, not the whole `@tx-agent-kit/testkit` barrel which drags in redis + msw + every fixture). ~48% of web setup.
- **Reduce eager import cost**: lazy-load heavy graphs (the `@tx-agent-kit/core` domain graph, redis, msw) behind `import type` + an inner `await import(...)`, keeping the public signature. ~50% of testkit import; api import 36s -> 29s.
- **Pool/worker config**: threads vs forks, `isolate`, and worker counts differ for web (forks/isolate) vs api/worker (threads). Tune to the bottleneck.
- **DB pool sizing**: size the Effect PgClient request pool from `DB_POOL_MAX`; omitting `maxConnections` caps it at 10 and throttles throughput (also a flake source under load).
- **Push coverage DOWN the pyramid** (use `test-census`): demote integration -> unit where a pure function suffices; drop cases already covered by exhaustive unit tests.

## CI-specific cautions
- **On self-hosted runners, `actions/cache` can be SLOWER than a clean build.** The pnpm store already persists on the runner's local disk; uploading/downloading it + `.turbo` over the network to GitHub's cache service took ~5min (and a ~5min post-job save) versus ~36s for local install (~19s) + turbo build (~17s). Prefer LOCAL persistence (a stable on-runner `TURBO_CACHE_DIR`, keyed to avoid concurrent-run races) over network `actions/cache`.
- Repeated checkout+install+build across the serial jobs is real overhead - but address it with local caching, not network cache on a self-hosted runner.
- Leaked per-run Postgres schemas slow every run; keep the GC threshold tight (see `fix-test-flake`).
- If app Dockerfiles run `pnpm install` BEFORE `COPY . .`, a root `prepare` script that needs repo files (e.g. a git-hooks installer) fails the image build with "not found". Guard such scripts so they no-op when the file is absent: `"prepare": "test -f <script> && <script> || true"`.

## Hard rule
NEVER disable OTEL / Spotlight / tracing to make tests faster - telemetry overhead is a fixed, intended cost, not a perf knob.

## Verify
Run `test-perf` before and after each change and record the delta; the full suite stays green; no telemetry disabled. For CI changes, derive the critical-path saving from measured per-step timings (you usually cannot run `act` against the self-hosted env).
