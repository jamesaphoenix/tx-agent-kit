# Deployment

## Deployment Model
- Local development uses shared Docker infra (`postgres`, observability, `redis`) and runs app processes locally.
- Temporal local runtime is host CLI-managed (`TEMPORAL_RUNTIME_MODE=cli`); staging/prod use Temporal Cloud (`TEMPORAL_RUNTIME_MODE=cloud`).
- Staging/production deploy immutable container images for:
  - `api`
  - `worker`
- `web` and `mobile` are not deployed through these Compose files.
  - `web` is configured via `NEXT_PUBLIC_API_BASE_URL` at its own runtime/platform.
  - `mobile` is built per environment and consumes `API_BASE_URL` from Expo config.
- Kubernetes deploys use one Helm chart with three target overlays:
  - Mac Studio `k3s` staging (`tx-staging` namespace, `<domain>-staging` release)
  - Mac Studio `k3s` prod (`tx-prod` namespace, `<domain>-prod` release)
  - Optional GKE load/cost test (`<domain>-loadtest` namespace by default)

## Assumptions and Defaults
- Mac Studio runner has `k3s`, `kubectl`, `helm`, `op`, and `cloudflared`.

## Secrets and Env Policy
- Secrets are sourced from 1Password CLI (`op`) via env templates:
  - `deploy/env/staging.env.template`
  - `deploy/env/prod.env.template`
- Templates use `op://...` references only for runtime values.
- Never commit rendered env files with plaintext secrets.
- Deployment compose files:
  - `docker-compose.staging.yml`
  - `docker-compose.prod.yml`
- Optional worker error reporting:
  - `WORKER_SENTRY_DSN` can be provided via env template to enable errors-only Sentry.
  - Leave blank/unset to disable.
- Staging/prod OTEL collector backend selection:
  - `OTEL_COLLECTOR_BACKEND=gcp` (default)
  - `OTEL_COLLECTOR_BACKEND=oss`
- Mac Studio/self-host override for GCP credentials:
  - Key-file mode: set `OTEL_COLLECTOR_GCP_CREDENTIALS_DIR` to a host directory containing key JSON and set `GOOGLE_APPLICATION_CREDENTIALS` to `/var/secrets/google/<key-file-name>`.
  - ADC mode: set `OTEL_COLLECTOR_GCLOUD_CONFIG_DIR` to your host gcloud config path (for example `$HOME/.config/gcloud`) and leave `GOOGLE_APPLICATION_CREDENTIALS` empty.

## Build Immutable Images
Build images and emit an artifact env file with image references:

```bash
pnpm deploy:build-images
```

With push enabled:

```bash
PUSH_IMAGES=1 pnpm deploy:build-images
```

Artifact output:
- `deploy/artifacts/images-<git-sha>.env`
- Contains `API_IMAGE` and `WORKER_IMAGE`
- When pushed, references are digest-pinned (`repo@sha256:...`).
- Default registry path is Google Artifact Registry:
  - `${ARTIFACT_REGISTRY_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REGISTRY_REPOSITORY}/api|worker`

## Run Migrations
Run migrations against staging/prod DB URL (resolved from 1Password):

```bash
pnpm deploy:migrate:staging
pnpm deploy:migrate:prod
```

## Deploy Compose Stack
Deploy staging/prod using rendered env + pinned images:

```bash
pnpm deploy:staging
pnpm deploy:prod
```

With explicit image artifact:

```bash
pnpm deploy:staging deploy/artifacts/images-<git-sha>.env
pnpm deploy:prod deploy/artifacts/images-<git-sha>.env
```

The deploy script:
1. Renders env from `op inject`
2. Injects `API_IMAGE` and `WORKER_IMAGE`
3. Runs `docker compose pull` and `up -d --remove-orphans`
4. Runs smoke checks when `RUN_SMOKE=1` (default)

## Deploy Kubernetes (Mac `k3s` + Optional GKE)
Deploy from the same image artifact used by Compose:

```bash
pnpm deploy:k8s:mac:staging deploy/artifacts/images-<git-sha>.env
pnpm deploy:k8s:mac:prod deploy/artifacts/images-<git-sha>.env
pnpm deploy:k8s:gke deploy/artifacts/images-<git-sha>.env
pnpm deploy:k8s:verify:staging deploy/artifacts/images-<git-sha>.env
```

Behavior:
1. Render env from `op inject` (`deploy/env/<env>.env.template`).
2. Render Helm runtime values from the env + image artifact.
3. `helm upgrade --install` into the target context/namespace/release.
4. Wait for rollout (`api`, `worker`, optional `otel-collector`).
5. For Mac targets, reconcile/check Cloudflare tunnel host routing.
6. Run smoke checks against `API_EXTERNAL_BASE_URL` when configured.

Mac tunnel-check controls for deploy scripts:
- `RUN_TUNNEL_RECONCILE=0` skips tunnel reconcile/check.
- `RUN_TUNNEL_CHECK=0` reconciles tunnel but skips health check.
- `RUN_TUNNEL_CHECK_SOFT_FAIL=1` keeps deploy green when tunnel health check fails.

Status and rollback:

```bash
pnpm deploy:k8s:status mac-staging
pnpm deploy:k8s:status mac-prod
pnpm deploy:k8s:status gke
pnpm deploy:k8s:rollback mac-staging <revision>
pnpm deploy:k8s:rollback mac-prod <revision>
pnpm deploy:k8s:rollback gke <revision>
```

## Cloudflare Tunnel for Mac-hosted API
Cloudflare tunnel is managed at the Mac host level (outside Kubernetes pods).

```bash
pnpm deploy:tunnel:reconcile staging
pnpm deploy:tunnel:reconcile prod
pnpm deploy:tunnel:reconcile dev
pnpm deploy:tunnel:reconcile both
pnpm deploy:tunnel:reconcile all
pnpm deploy:tunnel:check staging
pnpm deploy:tunnel:check prod
pnpm deploy:tunnel:check dev
pnpm deploy:tunnel:check both
pnpm deploy:tunnel:check all
```

Required env variables on the Mac runner:
- `CLOUDFLARE_TUNNEL_ID`
- `CLOUDFLARE_TUNNEL_CREDENTIALS_FILE`
- `CLOUDFLARE_TUNNEL_HOST_DEV` (required when reconciling/checking `dev` or `all`)
- `CLOUDFLARE_TUNNEL_HOST_STAGING`
- `CLOUDFLARE_TUNNEL_HOST_PROD`

Optional controls:
- `CLOUDFLARE_TUNNEL_UPSTREAM_DEV` (default `http://127.0.0.1:4000`)
- `CLOUDFLARE_TUNNEL_UPSTREAM_STAGING` (default `http://127.0.0.1:32080`)
- `CLOUDFLARE_TUNNEL_UPSTREAM_PROD` (default `http://127.0.0.1:32081`)
- `CLOUDFLARE_TUNNEL_CONFIG_PATH`
- `CLOUDFLARED_RESTART_COMMAND`
- `CLOUDFLARE_TUNNEL_MANAGE_DNS=1`

Suggested host mapping for `<domain>`:
- `api-dev.<domain>` -> dev upstream
- `api-staging.<domain>` -> staging upstream
- `api.<domain>` -> prod upstream

## GitHub Actions Release Workflow
- Workflow: `.github/workflows/release-k8s.yml`
- Build jobs:
  - `build_images_locally`
  - `build_images_google_cloud`
- Deploy jobs:
  - `deploy_k3s_staging`
  - `deploy_k3s_prod`
  - `deploy_gke` (optional, includes OTEL + setup/teardown validation)
- Dedicated staging verification workflow (separate from standard integration suite):
  - `.github/workflows/verify-k3s-staging.yml`
  - Job: `verify_k3s_staging`
- Non-interactive 1Password support for GitHub Actions:
  - Set `OP_SERVICE_ACCOUNT_TOKEN` as an Actions secret.
  - Deploy jobs use this token when runner-level interactive `op` sign-in is unavailable.

## Observability Routing
- `api` and `worker` export traces/metrics/logs to OTEL collector (`OTEL_EXPORTER_OTLP_ENDPOINT`).
- `api` and `worker` connect to Temporal using env-driven settings:
  - `TEMPORAL_RUNTIME_MODE=cloud`
  - `TEMPORAL_ADDRESS`
  - `TEMPORAL_NAMESPACE`
  - `TEMPORAL_API_KEY`
  - `TEMPORAL_TLS_ENABLED=true`
  - Optional TLS material for namespace-specific cert auth:
    - `TEMPORAL_TLS_CA_CERT_PEM`
    - `TEMPORAL_TLS_CLIENT_CERT_PEM`
    - `TEMPORAL_TLS_CLIENT_KEY_PEM`
- Collector routes signals based on `OTEL_COLLECTOR_BACKEND`:
  - `gcp`: Cloud Trace + Cloud Monitoring + Cloud Logging.
  - `oss`: Jaeger + Prometheus OTLP receiver + Loki OTLP endpoint.

## Smoke Checks
Manual smoke run:

```bash
API_BASE_URL=https://<api-host> pnpm deploy:smoke
```

Covers:
- `/health`
- auth sign-up + `/v1/auth/me`
- organization create/list
- invitation create/list

## Optional External GCP E2E Validation
These commands are explicit/manual and not part of normal `test`/`test:integration` flows.

```bash
RUN_GCP_E2E=1 GCP_BILLING_ACCOUNT_ID=<billing-account-id> pnpm test:gcp:e2e
RUN_GCP_E2E=1 GCP_BILLING_ACCOUNT_ID=<billing-account-id> pnpm test:gcp:e2e:gke
```

The E2E workflow:
1. Creates a toy GCP project.
2. Enables required APIs.
3. Creates OTEL collector service account and key.
4. Runs collector in isolated compose (`docker-compose.gcp-e2e.yml`).
5. Emits smoke traces/metrics/logs and validates all three signals in GCP.
6. Deletes the toy project by default (set `KEEP_GCP_TOY_PROJECT=1` to keep it).

Optional GKE extension (enabled via `pnpm test:gcp:e2e:gke`):
1. Creates a temporary GKE cluster by default (`GKE_E2E_CREATE_CLUSTER=1`).
2. Builds/pushes images into the toy project Artifact Registry.
3. Deploys the chart to GKE (`pnpm deploy:k8s:gke`), validates status, then tears down.
4. Cleanup controls:
   - `KEEP_GKE_DEPLOYMENT=1` to keep the Helm release.
   - `KEEP_GKE_CLUSTER=1` to keep the cluster.
   - `KEEP_GCP_TOY_PROJECT=1` to keep the toy project.
5. Cleanup is strict:
   - GKE release uninstall, cluster delete, and toy-project teardown fail the command when cleanup fails.

## Worktree Strategy
- Worktrees share infra containers.
- Worktree-local app ports are deterministic via `pnpm worktree:ports <name>` and `scripts/worktree/setup.sh`.
- `scripts/worktree/setup.sh` now writes:
  - `WORKTREE_PORT_OFFSET`
  - `API_BASE_URL`
  - `NEXT_PUBLIC_API_BASE_URL`
  - `EXPO_PUBLIC_API_BASE_URL`
  - `TEMPORAL_TASK_QUEUE` (`<domain>-<worktree-name>`)
