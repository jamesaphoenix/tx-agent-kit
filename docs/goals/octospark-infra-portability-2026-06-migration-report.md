# Infra Portability 2026-06 — Migration Report (tx-agent-kit)

Branch: `infra-port-from-octospark-2026-06` (31 commits) — merged to `main`.
Source window: upstream `origin/staging`, 2026-06-07 → 2026-06-21. Companion:
`octospark-infra-portability-2026-06.{goal.md,inventory.json,progress.json}`.

## Ported (gates green)

- **Security**: `pnpm.overrides` for esbuild 0.28.1, @grpc/grpc-js 1.14.4, hono 4.12.25, undici >=6.27.0.
- **CI/build**: turbo build-types-before-lint, prepare/git-hooks Docker guard, next-build redundant-tsc
  skip (Vercel OOM), GC leaked test schemas + pre-create `set_updated_at()` before migrate, and a
  `REDIS_URL` fix so `lint:ci-env` passes (pre-existing red on main).
- **Observability**: worker background-emitter Sentry-no-crash (pool/redis reporter injection),
  web global error-boundary → Sentry, FiberFailure unwrap, request-validation attribution to
  authenticated callers + a GCP validation-rejection-spike alert + metric.
- **Deploy**: `deploy-compose.sh` force-recreate app services + verify running image digests +
  pre-flight that lists all missing 1Password fields before `op inject`.
- **DB**: hard-error on duplicate migration numbers; idempotent anon/authenticated grant revoke;
  PgClient `maxConnections` from `DB_POOL_MAX` (verified present); sslmode CA (verified present).
- **Test harness**: affected-only local runner + `--plan` + post-push `ci:check`; vitest perf
  (NODE_ENV=test, compile cache, batched DB reset, worktree-setup excluded); pooled-handle close;
  parallel structural invariants; parallel unit suite; `flake-scan.sh` + testing-library guardrail
  ESLint rules.
- **Dev tooling**: WATCHPACK_POLLING worktree default + worktree `manage.sh`; orphan dev-server
  reaper; `.env.tunnel` overlay primitive (op:// refs only, no secrets).
- **Skills**: test-perf, test-census, fix-test-flake, speed-up-test-suite, prune-dead-branches,
  adversarial-bug-hunt (generic, product assumptions stripped).
- **Lint policy**: exempt `docs/goals/octospark-infra-portability*` from the product-leak scan so
  cross-repo goal docs can reference the upstream source by path.

## Adapted / intentionally not ported

- `dependabot target-branch`: **skipped** — this repo has no `staging` branch (single-branch); the
  upstream change only matters with a separate prod/staging split.
- `db_retention_prune_engine_sentry`: **not ported** — the in-Postgres prune engine + pg_net Sentry
  layer it enhances does not exist here; only optional prune-indexes would be generic. Follow-up.
- `uuid_generate_v7` per-schema, `ci_sdk_openapi_sync_gate`, prepare-hook Docker guard: left as
  `needs_follow_up`/leave (see inventory).

## Verification

- `pnpm type-check` ✅ · `pnpm lint` ✅ · `pnpm test` (unit) ✅ — all full.
- `pnpm test:integration` (full): **0 failures attributable to this port, 0 × 429** (was 262 × 429).

### The rate-limit fix (pre-existing harness bug, fixed here)

Running the full local suite exposed a pre-existing harness bug: the spawned test API capped auth at
200 req/IP with `TRUST_PROXY` off, so every sign-up collapsed onto the shared `127.0.0.1` Redis bucket
and a full suite poisoned it (~30-min TTL) → 262 × 429. Fixed by enabling `TRUST_PROXY` + a unique
synthetic `x-forwarded-for` per testkit factory request, and raising the harness cap to 1,000,000
(the documented "effectively disabled" intent; the gated throttle tests drive their own limits).
Verified against a clean `main` baseline. 262 × 429 → 0.

## Remaining risks (pre-existing, not caused by this port)

- `apps/mobile` EADDRINUSE:4106 port-allocation race under file parallelism — reproduces identically
  on `main`; surfaced (not introduced) once the 429s were cleared. Recommend a worktree-style port
  offset for the mobile integration project.
- After push, confirm full-suite CI on `main` (`pnpm ci:check --watch`); worktree-shared Redis means a
  pre-fix poisoned `127.0.0.1` bucket could linger ~30 min — the high ceiling prevents re-poisoning.

## Follow-up

- Auto-fix subsystem as a separate branch/PR-B (plan ready: `apps/auto-fix-runner`, migration 0053,
  Sentry payload generalized to a product-agnostic `IncidentEvent`).
