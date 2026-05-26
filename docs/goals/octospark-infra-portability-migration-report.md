# Octospark Infra Portability Migration Report

Status: local implementation validated; CI follow-up fix pending push
Last updated: 2026-05-26

## What Was Ported

- Observability: browser `traceparent` propagation, API trace-context extraction, `Server-Timing`/duration response headers, OTLP env header/resource support, legacy Temporal span normalization, and Effect OTel helper exports.
- Local infrastructure: worktree-safe Compose port adoption, generated `.artifacts/local-infra.env` handoff, Loki memberlist pinning, op-aware env loading, repo-scoped stale service cleanup, Redis runtime package, Redis testkit namespace helpers, and API/worker Redis shutdown.
- Database and test reliability: Postgres `sslmode` URL normalization, Effect DB runtime reuse/disposal, schema-isolated test context preservation, HTTP VCR tooling, fake OpenRouter integration setup, AI base URL/test hooks, createUser retry/recovery, worker failure-reason formatting, storage test fallback, and Stripe failed-payment safety helpers.
- CI, lint, and generated surfaces: actionlint config, lockfile workflow, self-hosted Node/pnpm setup helper, product-leak/plaintext-secret scanner, generated CLI/MCP/OpenAPI agent-surface checks, generic standalone CLI and MCP template packages, jscpd test-file narrowing, and current package/runtime dependency alignment.
- Web reliability/performance: API resource hints, serialized auth refresh result preservation, auth principal bootstrap/cache, permission initialData seeding, shared query cache defaults, production-like web env defaults, bootstrap skip without API URL, accessible loading boundary, and protected route loading fallback consolidation.
- Agent workflow docs: worktree hook wiring, `.worktrees/<name>` helper convention, generalized skill reference examples, AGENTS guidance updates, and source-product token cleanup in imported specs/todos.

## Intentionally Not Ported

- `social_product_observability_flow`: Octospark social publishing telemetry smoke flow; rejected as product-specific.
- Octospark public CLI/MCP product operations, auth/device-login flows, upload/social/billing shortcuts, and social-domain skill content; only target-owned boilerplate templates and generated surface introspection were ported.
- Global fake OIDC sidecar wiring; tx-agent-kit already has target-owned OIDC test topology, so the provider fake work was adapted to OpenRouter and existing auth test helpers.
- Direct product overlay copy from Octospark; only audited, allowlisted generic infrastructure patterns were ported. See `docs/goals/octospark-infra-portability-overlay-assessment.md`.
- Direct deployment release execution; local workflow files and deploy hardening were ported, but staging/prod proof still requires target deployment credentials and real workflow runs.

## Verification Evidence

- Focused package checks passed for changed packages: `@tx-agent-kit/api`, `@tx-agent-kit/web`, `@tx-agent-kit/core`, `@tx-agent-kit/contracts`, `@tx-agent-kit/db`, `@tx-agent-kit/observability`, `@tx-agent-kit/redis`, `@tx-agent-kit/storage`, `@tx-agent-kit/stripe`, `@tx-agent-kit/worker`, `@tx-agent-kit/testkit`, `@tx-agent-kit/cli`, `@tx-agent-kit/mcp`, `@tx-agent-kit/ai`, and `@tx-agent-kit/http-vcr`.
- Real local infra checks passed for `pnpm infra:ensure`, observability health, Redis integration testkit, and targeted API health integration.
- Generated checks passed for `pnpm agent-surfaces:generate`, `pnpm agent-surfaces:check`, generated contract tests, and package lockfile sync.
- Product-leak/plaintext-secret policy passed after the latest slices.
- `pnpm lint:jscpd` passes after narrowing test-file duplication scope.
- Full local gates passed after the latest slices: `pnpm lint:quiet`, `pnpm type-check:quiet`, `pnpm test:quiet`, `pnpm lint:invariants`, and `pnpm lint:jscpd`.
- Full real-infra integration passed: `TX_FORCE_FRESH_INTEGRATION_SETUP=1 INTEGRATION_MAX_WORKERS=6 INTEGRATION_TEST_TIMEOUT_MS=60000 pnpm test:integration:quiet` completed 119 passed files / 741 passed tests in 77s under the 120s local budget.
- One members-page web integration flake passed on immediate isolated rerun; the subsequent full suite also passed.
- Storage/testkit/API harness fixes were revalidated with focused storage integration, testkit unit checks, API lint/type-check, and global setup ESLint.
- Generated OpenAPI/Orval clients were refreshed with `pnpm api:client:generate`; agent surfaces rechecked clean after generation.
- Product-leak/plaintext-secret scanner passed in both standalone and invariant-gate runs.
- `git diff --check` and progress JSON parsing passed after the latest updates.
- CI env-source follow-up passed locally: `bash -n scripts/start-dev-services.sh scripts/test/run-integration.sh`, `pnpm lint:shell`, and `CI=true TX_SOURCE_ENV_IN_CI=0 pnpm infra:ensure`.
- The CI-mode infra check skipped local `.env` sourcing, reproducing the fixed GitHub Actions boundary where `.env` contains `op://` refs but `op` is not on PATH.

## Remaining Risks

- The first post-push GitHub Actions integration run failed during `Ensure infrastructure` because `.env` contains `op://` refs and `op` is not on PATH; the CI env-source guard is locally validated and needs a post-fix rerun after push.
- Deployment changes are locally validated but not proven by a real tx-agent-kit staging release run yet.
- The overlay/rebaseline path remains documentation-only; using it still requires a separate product-leak-gated approval and isolated branch.
- jscpd still reports existing clone candidates below the configured failure threshold; no new blocking duplication remains.

## Follow-Up Tasks

- Capture real GitHub Actions/deployment evidence once pushed.
- Keep `docs/goals/octospark-infra-portability.progress.json` updated with final validation results and any residual failures.
