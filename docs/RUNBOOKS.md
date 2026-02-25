# Runbooks

## Configure local env files (idempotent)
`pnpm env:configure`

## Start local infra
`pnpm infra:ensure`
- Override startup wait window when needed: `INFRA_READY_TIMEOUT_SECONDS=300 pnpm infra:ensure`.

## Start/stop local Temporal CLI
- `pnpm temporal:dev:up`
- `pnpm temporal:dev:status`
- `pnpm temporal:dev:down`
- Runtime mode is controlled by `TEMPORAL_RUNTIME_MODE` (`cli` or `cloud`).

## Ensure shared infra from any worktree
`./scripts/worktree/ensure-shared-infra.sh`

## MCP setup (Claude Code + Codex)
1. `cp .env.example .env`
2. Fill required secrets in `.env` (`SUPABASE_ACCESS_TOKEN`; optional `CONTEXT7_API_KEY`).
3. Ensure Docker is running (Prometheus MCP uses container runtime).
4. Claude Code uses project `.mcp.json` automatically.
5. For Codex, run `pnpm mcp:codex-config`, then copy the output into `~/.codex/config.toml`.
6. Observability MCP notes:
   - `pnpm mcp:prometheus` runs in Docker and reads `PROMETHEUS_URL`.
   - Default is `PROMETHEUS_URL=http://host.docker.internal:9090` so the MCP container can reach host Prometheus.
   - On Linux, wrapper adds `--add-host=host.docker.internal:host-gateway`; override `PROMETHEUS_URL` if your target differs.
   - `pnpm mcp:jaeger` reads `JAEGER_URL`, `JAEGER_PROTOCOL`, and optional `JAEGER_PORT`.

## Run services
`pnpm dev`
- Runs `web + api + worker` as local processes.
- Docker infra is shared (`pnpm infra:ensure`) and local Temporal CLI is auto-started when `TEMPORAL_RUNTIME_MODE=cli`.

## Apply migrations
`pnpm db:migrate`

## Validate DB trigger contracts (pgTAP)
`pnpm test:db:pgtap`

## Add a custom DB trigger
1. Run `pnpm db:trigger:new --name <trigger-name> --table <table> [--timing BEFORE|AFTER] [--events INSERT,UPDATE] [--level ROW|STATEMENT]` (or `pnpm tx db trigger new ...`).
2. Implement trigger function logic in the generated migration under `packages/infra/db/drizzle/migrations/`.
3. Replace scaffold `fail(...)` assertion in the generated `packages/infra/db/pgtap/*.pgtap.sql` suite with concrete trigger assertions.
4. Run `pnpm db:migrate` and `pnpm test:db:pgtap`.

## Compute deterministic worktree ports
`pnpm worktree:ports feature-my-branch`
- Port assignment is deterministic per worktree and collision-aware against active worktrees in the same repo.

## Setup a worktree with isolated app ports
`scripts/worktree/setup.sh <worktree-path>`
- Writes worktree-local env keys:
  - `WORKTREE_PORT_OFFSET`
  - `WEB_PORT`
  - `API_PORT`
  - `MOBILE_PORT`
  - `WORKER_INSPECT_PORT`
  - `TEMPORAL_TASK_QUEUE`
  - `API_BASE_URL`
  - `NEXT_PUBLIC_API_BASE_URL`
  - `EXPO_PUBLIC_API_BASE_URL`

## Reset integration DB state (idempotent)
`pnpm db:test:reset`
- DB reset and integration runners use PID-aware lock files under `/tmp/tx-agent-kit-*.lock`; stale locks are reaped automatically.

## Run integration tests (idempotent, no container teardown)
`pnpm test:integration`
- Integration runs through a single Vitest workspace with one global setup (`vitest.integration.workspace.ts`).
- Select subsets with `INTEGRATION_PROJECTS=web` or `INTEGRATION_PROJECTS=api,testkit pnpm test:integration`.
- Unit suites default to host CPU parallelism; cap with `TEST_MAX_WORKERS=<n>`.
- Integration suites default to host CPU parallelism; cap with `INTEGRATION_MAX_WORKERS=<n>`.
- Override web suite workers with `WEB_INTEGRATION_MAX_WORKERS=<n>` (defaults to `INTEGRATION_MAX_WORKERS`).
- For faster local iteration, skip pgTAP during integration setup with `pnpm test:integration --skip-pgtap` (keep pgTAP enabled in CI).
- Skip infra bootstrap when already warm: `INTEGRATION_SKIP_INFRA_ENSURE=1 pnpm test:integration`.
- Observability health validation is still mandatory during integration runs (skip bootstrap does not skip health checks).
- Validate resolved integration runner wiring without executing tests: `INTEGRATION_DRY_RUN=1 pnpm test:integration -- --filter api --dry-run`.
- Observability timing knobs: `OBSERVABILITY_RETRY_ATTEMPTS`, `OBSERVABILITY_RETRY_SLEEP_SECONDS`, `OBSERVABILITY_CURL_CONNECT_TIMEOUT_SECONDS`, `OBSERVABILITY_CURL_MAX_TIME_SECONDS`.
- Web integration keeps one API+DB harness per worker slot warm across files and performs per-test resets.
- Integration setup auto-runs `pnpm temporal:dev:up` when `TEMPORAL_RUNTIME_MODE=cli`.

## Run boilerplate parallel-worktree meta-tests (manual, opt-in)
- `pnpm test:boilerplate`
- Uses the same integration-style preflight harness (`infra:ensure`, optional Temporal CLI bootstrap, mandatory observability health).
- Validates two synthetic worktrees can run real migrations in isolated schemas and boot isolated API/web/mobile/worker stacks.
- Dry-run wiring check: `BOILERPLATE_DRY_RUN=1 pnpm test:boilerplate -- --dry-run`.
- Skip infra bootstrap when already warm: `BOILERPLATE_SKIP_INFRA_ENSURE=1 pnpm test:boilerplate`.

## Run Temporal-only integration lanes (manual, opt-in)
- Local Temporal lane:
  - `pnpm test:temporal:integration`
- Cloud Temporal lane:
  - `RUN_TEMPORAL_CLOUD_INTEGRATION=1 TEMPORAL_CLOUD_TEST_ADDRESS=<address> TEMPORAL_CLOUD_TEST_NAMESPACE=<namespace> TEMPORAL_CLOUD_TEST_API_KEY=<api-key> pnpm test:temporal:cloud:integration`
- These lanes are intentionally excluded from normal `pnpm test:integration`.

## Run dev hot-reload smoke checks (manual, opt-in)
- `pnpm test:dev:hot-reload`
- Validates hot-reload behavior for `apps/web`, `apps/api`, `apps/mobile`, and `apps/worker` with real dev processes.

## Check run-silent behavior
`pnpm test:run-silent`

## Shutdown infra
`pnpm infra:down`

## Staging/Production deployment
1. Build/push images and capture artifact:
   - `PUSH_IMAGES=1 pnpm deploy:build-images`
2. Run migrations:
   - `pnpm deploy:migrate:staging` or `pnpm deploy:migrate:prod`
3. Deploy:
   - `pnpm deploy:staging deploy/artifacts/images-<sha>.env`
   - `pnpm deploy:prod deploy/artifacts/images-<sha>.env`
4. Smoke verification:
   - `API_BASE_URL=https://<api-host> pnpm deploy:smoke`

## Optional GCP telemetry E2E (manual only)
- External-cost, opt-in validation path. Not part of default integration runs.
- Required guard and billing account:
  - `RUN_GCP_E2E=1`
  - `GCP_BILLING_ACCOUNT_ID=<billing-account-id>`
- Run full E2E:
  - `RUN_GCP_E2E=1 GCP_BILLING_ACCOUNT_ID=<billing-account-id> pnpm test:gcp:e2e`
- Keep project for investigation:
  - `KEEP_GCP_TOY_PROJECT=1 RUN_GCP_E2E=1 GCP_BILLING_ACCOUNT_ID=<billing-account-id> pnpm test:gcp:e2e`
- Teardown manually:
  - `RUN_GCP_E2E=1 pnpm deploy:gcp:toy:teardown`
