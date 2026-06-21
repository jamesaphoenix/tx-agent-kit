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

## PR-B: Auto-fix subsystem (MERGED to main, e050cbb)

Ported as `apps/auto-fix-runner` (`@tx-agent-kit/auto-fix-runner`): a Sentry-issue webhook
(`POST /internal/sentry/new-issue`, HMAC + env-match + dedupe) → a scoped `@temporalio/client`
trigger (the api's first; ESLint exemption scoped to one file) → a host Temporal worker running a
pluggable codex|claude agent in a fresh worktree → draft PR. Migration `0053_auto_fix_runs_table`
(made idempotent for the shared local Postgres). Pragmatic first-port: kept `sentry` naming; only
de-coupling rename `needsCanaryAccount → needsManualInput` (contracts + JSON-schema mirror + prompt
in lock-step). Generic operator prompt; `AUTO_FIX_BASE_BRANCH` default `main`; `SENTRY_ORG_SLUG`
default empty; launchd plist + scripts shipped as generic templates.

Verified green: type-check + lint + unit (incl. 70 runner tests) + stub-mode webhook integration
(7/7) + full integration (762 passed / 0 failed). The merge also folded in the
`source_env_if_allowed` e2e CI-skip fix, which greens the pre-existing Web E2E op-env build failure.

Deferred (operator/host): real end-to-end needs a live Temporal cluster, authed codex|claude + gh,
pre-rendered env, and a real alert rule + `SENTRY_WEBHOOK_SECRET`; launchd install is documented in
`docs/auto-fix-infra.md`.
## Web E2E (browser) CI status — pre-existing-broken, substantially repaired

The Web E2E browser job has been red on `main` since 2026-05-26, long before this work (the
pre-merge commit failed the identical job). It is independent of the core gate: **"Run All
Integration Suites" is GREEN in CI** for both PR-A and PR-B (the ported code, incl. the auto-fix
subsystem's new Temporal client + migration in CI's parallel schemas, is verified).

This work fixed three layers of the E2E pipeline (all clean upstream ports):
1. `e2e:build` op-env failure -> `source_env_if_allowed` CI-skip (build now passes).
2. `apps/api` + `apps/worker` `dev` op-env failure -> `source_env_if_allowed` (start path no longer
   dies on op:// refs in CI).
3. E2E `Start api` step: `pnpm dev:api &` (turbo wrapper, no log capture) -> direct
   `pnpm --filter @tx-agent-kit/api dev` with stdout/stderr to a log file + `dump_service_logs` on
   readiness timeout.

**Remaining (deeper, pre-existing, NOT this work):** with the above fixed, the api now logs
`Starting API server (host 127.0.0.1 port 4100)` but never binds :4100 in the E2E `tsx watch`
start path -> it hangs during server-runtime launch and the readiness wait times out at 120s.
Confirmed NOT the auto-fix subsystem: `AutoFixTriggerLive` is `Layer.succeed` (lazy; connects
per-webhook), and the E2E job sets `AUTO_FIX_TRIGGER_MODE=stub`. The integration-test startup path
(testkit api-server-harness) does NOT hit this hang, which is why the core suite is green.

**Follow-up (out of scope for this infra port):** investigate the api `tsx watch` startup hang
under the E2E env. RULED OUT so far: the auto-fix trigger (`AutoFixTriggerLive` is `Layer.succeed`,
lazy + stub-gated) and eager OIDC discovery (`getGoogleOidcRuntime` is lazy/cached, byte-identical to
upstream whose E2E is green). The hang is SILENT (no error logged after "Starting API server"),
pointing at telemetry/OTEL init or server-runtime layer construction that the testkit api-server-harness
startup path does not exercise. Next step: add startup tracing or reproduce with the exact E2E env
(closed-port `GOOGLE_OIDC_ISSUER_URL`, full deploy-style env). The job is strictly closer to green than
before this work, with service logs now captured on failure.
