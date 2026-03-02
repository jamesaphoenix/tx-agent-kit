# Commands

## Core Development
- `pnpm env:configure`: idempotently configure `.env` for local development.
- `pnpm infra:ensure`: idempotently start shared Docker infra and wait for health.
- `INFRA_READY_TIMEOUT_SECONDS=300 pnpm infra:ensure`: override infra readiness timeout window (default `120` seconds).
- `pnpm temporal:dev:up`: start local Temporal CLI server (no-op when `TEMPORAL_RUNTIME_MODE != cli`).
- `pnpm temporal:dev:down`: stop local Temporal CLI server managed by repo scripts.
- `pnpm temporal:dev:status`: inspect Temporal runtime mode + local CLI health.
- `pnpm dev`: run web + api + worker locally with hot reload (auto-runs infra ensure + local Temporal CLI in `cli` mode). When `DEV_CLOUDFLARE_TUNNEL_ENABLED=true`, starts a Cloudflare tunnel for local API exposure and stops it on shutdown.
- `DEV_CLOUDFLARE_TUNNEL_ENABLED=true pnpm dev`: enable local API tunnel during dev. Tunnel ownership is lock-guarded across worktrees; if another worktree owns the tunnel lock, dev continues and tunnel startup is skipped.
- `pnpm dev:tunnel:status`: inspect local dev tunnel lock ownership (`active|stale|unlocked`) and owner metadata.
- Optional tunnel overrides: `DEV_CLOUDFLARE_TUNNEL_URL`, `DEV_CLOUDFLARE_TUNNEL_TOKEN`, `DEV_CLOUDFLARE_TUNNEL_LOG_FILE`, `DEV_CLOUDFLARE_TUNNEL_LOCK_DIR`, `DEV_CLOUDFLARE_TUNNEL_STALE_TIMEOUT_SECONDS`, `DEV_CLOUDFLARE_TUNNEL_MISSING_PID_GRACE_SECONDS`.
- `pnpm dev:mobile:web`: run Expo web preview intentionally on the mobile dev port.
- `pnpm dev:open`: open local app/dev dashboards in Brave Browser (fallback: Google Chrome).
- `pnpm openapi:generate`: regenerate `apps/api/openapi.json` from API definitions.
- `pnpm api:client:generate`: regenerate `apps/api/openapi.json` and web Orval hooks in `apps/web/lib/api/generated`.
- `pnpm tx <command> [args]`: invoke the repo command dispatcher (tx-style entrypoint for tooling commands).
- `pnpm scaffold:crud --domain <domain> --entity <entity> [--plural <plural>] [--dry-run] [--force] [--with-db]`: generate `domain -> ports -> application/adapters -> routes -> tests` scaffold (and optional DB artifacts).

## Quality Gates
- `pnpm lint`: full lint gate (`eslint` + structural/runtime invariants + shell invariants).
- `pnpm type-check`: workspace TypeScript checks.
- `pnpm test`: workspace unit tests.
- `pnpm test:integration`: single Vitest workspace integration run with global setup (infra + DB reset + pgTAP once).
- `INTEGRATION_SKIP_INFRA_ENSURE=1 pnpm test:integration`: skip infra bootstrap when stack is already healthy (observability health check still runs).
- `INTEGRATION_SKIP_OBSERVABILITY=1 pnpm test:integration`: skip observability health preflight when debugging unrelated integration failures.
- `INTEGRATION_DRY_RUN=1 pnpm test:integration -- --filter api --dry-run`: print resolved runner config without executing tests.
- `pnpm test:boilerplate`: run the parallel-worktree boilerplate meta-test lane (shared integration harness preflight + dedicated boilerplate suite).
- `BOILERPLATE_DRY_RUN=1 pnpm test:boilerplate -- --dry-run`: print resolved boilerplate runner wiring without executing tests.
- `pnpm test:temporal:integration`: opt-in Temporal integration lane (real Temporal backend, excluded from default integration suite).
- `RUN_TEMPORAL_CLOUD_INTEGRATION=1 TEMPORAL_CLOUD_TEST_ADDRESS=... TEMPORAL_CLOUD_TEST_NAMESPACE=... TEMPORAL_CLOUD_TEST_API_KEY=... pnpm test:temporal:cloud:integration`: opt-in Temporal Cloud lane.
- `RUN_TEMPORAL_CLOUD_INTEGRATION=1 RUN_TEMPORAL_MTLS_INTEGRATION=1 TEMPORAL_CLOUD_TEST_ADDRESS=... TEMPORAL_CLOUD_TEST_NAMESPACE=... TEMPORAL_CLOUD_TEST_API_KEY=... TEMPORAL_CLOUD_TEST_TLS_CA_CERT_PEM=... TEMPORAL_CLOUD_TEST_TLS_CLIENT_CERT_PEM=... TEMPORAL_CLOUD_TEST_TLS_CLIENT_KEY_PEM=... pnpm test:temporal:cloud:integration`: opt-in Temporal Cloud mTLS success/failure lane.
- `pnpm test:dev:hot-reload`: opt-in hot-reload smoke checks for `web/api/mobile/worker`.
- `pnpm test:integration:live:k3s`: opt-in live Mac `k3s` staging deployment integration (real deploy, no mocks).
- `pnpm test:integration:live:tunnel`: opt-in live Cloudflare tunnel reconcile/check integration (real tunnel, no mocks).
- `pnpm test:integration:live:tunnel:negative`: opt-in live negative-path tunnel check (fails when required host config is missing).
- `pnpm test:integration:live:deploy`: run both live deploy integration lanes.
- `pnpm test:db:pgtap`: run pgTAP database contract suites (triggers/invariants).
- `GRAFANA_PORT=13001 pnpm test:integration:quiet`: run integration tests when local `3001` is occupied.

## Quiet Runners (Agent-Optimized)
- `pnpm build:quiet`
- `pnpm lint:quiet`
- `pnpm type-check:quiet`
- `pnpm test:quiet`
- `pnpm test:integration:quiet`
- `INTEGRATION_SKIP_OBSERVABILITY=1 pnpm test:integration:quiet`: skip observability health preflight in quiet mode.
- `pnpm test:boilerplate:quiet`
- Integration workspace runners use a shared lock (`/tmp/<domain>-integration.lock`) with PID-aware stale-lock reaping.
- `TEST_MAX_WORKERS=8 pnpm test`: cap workspace unit-test workers (defaults to host CPU parallelism).
- `INTEGRATION_PROJECTS=web pnpm test:integration`: run selected integration project(s) (`api,mobile,observability,testkit,web,worker`).
- `INTEGRATION_MAX_WORKERS=4 pnpm test:integration`: cap non-web integration workers (defaults to host CPU parallelism).
- `WEB_INTEGRATION_MAX_WORKERS=2 pnpm --filter @<domain>/web test:integration`: override web integration workers (defaults to `INTEGRATION_MAX_WORKERS`, then host CPU parallelism).
- `pnpm test:integration --skip-pgtap`: skip pgTAP in global setup for faster local red/green loops.
- Web integration uses one warm API+DB harness per Vitest pool slot (instead of booting per file).

## DB + Worktrees
- `pnpm db:migrate`: run Drizzle migrations.
- `pnpm db:trigger:new --name <trigger-name> --table <table> [--timing BEFORE|AFTER] [--events INSERT,UPDATE] [--level ROW|STATEMENT]`: scaffold migration + pgTAP contract for a custom trigger.
- `pnpm tx db trigger new --name <trigger-name> --table <table> ...`: equivalent CLI form through the shared dispatcher.
- `pnpm db:test:reset`: idempotently reset integration DB state without tearing down containers.
- `pnpm worktree:ports <name>`: derive collision-aware deterministic local ports for a worktree (`WEB_PORT`, `API_PORT`, `MOBILE_PORT`, `WORKER_INSPECT_PORT`, observability UI ports).

## Deployment
- `PUSH_IMAGES=1 pnpm deploy:build-images`: build and push API/worker images, then emit image artifact env file in `deploy/artifacts/`.
- `pnpm deploy:migrate:staging`: run DB migrations with staging secrets from 1Password template.
- `pnpm deploy:migrate:prod`: run DB migrations with production secrets from 1Password template.
- `pnpm deploy:staging [deploy/artifacts/images-<sha>.env]`: render staging env with `op inject`, deploy compose services, run smoke checks.
- `pnpm deploy:prod [deploy/artifacts/images-<sha>.env]`: render production env with `op inject`, deploy compose services, run smoke checks.
- `pnpm deploy:k8s:mac:staging [deploy/artifacts/images-<sha>.env]`: deploy the image artifact to Mac Studio `k3s` staging namespace/release, reconcile tunnel, and run smoke checks.
- `pnpm deploy:k8s:mac:prod [deploy/artifacts/images-<sha>.env]`: deploy the image artifact to Mac Studio `k3s` production namespace/release, reconcile tunnel, and run smoke checks.
- `pnpm deploy:k8s:gke [deploy/artifacts/images-<sha>.env]`: deploy the same image artifact to the optional GKE target (`GKE_ENVIRONMENT=staging|prod`, default `staging`).
- `pnpm deploy:k8s:verify:staging [deploy/artifacts/images-<sha>.env]`: dedicated Mac `k3s` staging verification lane (deploy + status), intentionally separate from standard integration suites.
  - Verification includes k3s bootstrap/context checks, Helm idempotency (double apply), runtime Secret/ConfigMap checks, pod readiness, and real `/health` probes.
- Tunnel-check controls for Mac deploy commands:
  - `RUN_TUNNEL_RECONCILE=0`
  - `RUN_TUNNEL_CHECK=0`
  - `RUN_TUNNEL_CHECK_SOFT_FAIL=1`
- `pnpm deploy:k8s:status <mac-staging|mac-prod|gke>`: show Helm release status and core Kubernetes resources.
- `pnpm deploy:k8s:rollback <mac-staging|mac-prod|gke> <revision>`: rollback a Helm release to a previous revision and wait for rollout.
- `pnpm deploy:tunnel:reconcile [dev|staging|prod|both|all]`: render Cloudflare tunnel ingress config for Mac-hosted API exposure and optionally refresh DNS/restart cloudflared.
- `pnpm deploy:tunnel:check [dev|staging|prod|both|all]`: verify Cloudflare tunnel health endpoints (`/health`) for exposed API hostnames.
- `API_BASE_URL=https://<api-host> pnpm deploy:smoke`: run API critical-flow smoke checks.
- `RUN_GCP_E2E=1 GCP_BILLING_ACCOUNT_ID=<billing-account> pnpm deploy:gcp:toy:bootstrap`: create a toy GCP project and OTEL service account for telemetry validation.
- `RUN_GCP_E2E=1 pnpm deploy:gcp:toy:teardown`: delete the toy GCP project from the most recent bootstrap output.
- `RUN_GCP_E2E=1 GCP_BILLING_ACCOUNT_ID=<billing-account> pnpm test:gcp:e2e`: run isolated GCP telemetry E2E validation (traces + metrics + logs). This command is manual/opt-in and not part of normal integration suites.
- `RUN_GCP_E2E=1 GCP_BILLING_ACCOUNT_ID=<billing-account> pnpm test:gcp:e2e:gke`: extend the OTEL GCP E2E lane with optional GKE cluster setup, deploy validation, and teardown.
  - The command fails when teardown cannot remove temporary GKE/project resources.

## MCP Servers
- `pnpm mcp:prometheus`: start Prometheus MCP (containerized server).
- `pnpm mcp:jaeger`: start Jaeger MCP.
- `pnpm mcp:context7`: start Context7 MCP.
- `pnpm mcp:supabase`: start Supabase MCP (requires `SUPABASE_ACCESS_TOKEN`).
- `pnpm playwright:auth:bootstrap`: create/sign-in bootstrap user via real auth API and write Playwright storage state.
- `op run --env-file=.env -- pnpm playwright:auth:bootstrap`: recommended 1Password-backed auth bootstrap flow.
- `pnpm mcp:codex-config`: print Codex MCP TOML blocks wired to local wrappers.
- `PROMETHEUS_URL=http://host.docker.internal:9090 pnpm mcp:prometheus`: point containerized Prometheus MCP at host Prometheus (default).
- `JAEGER_URL=http://localhost JAEGER_PORT=16686 pnpm mcp:jaeger`: host-mode Jaeger MCP defaults (use either host+port or URL with embedded port).

## Diagnostics
- `pnpm test:run-silent`: verify `scripts/run-silent.sh` behavior.
