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

## Secrets and Env Policy
- Secrets are sourced from 1Password CLI (`op`) via env templates:
  - `deploy/env/staging.env.template`
  - `deploy/env/prod.env.template`
- Templates use `op://...` references only for runtime values.
- Never commit rendered env files with plaintext secrets.
- Deployment compose files:
  - `docker-compose.staging.yml`
  - `docker-compose.prod.yml`
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

## Observability Routing
- `api` and `worker` export traces/metrics/logs to OTEL collector (`OTEL_EXPORTER_OTLP_ENDPOINT`).
- `api` and `worker` connect to Temporal using env-driven settings:
  - `TEMPORAL_RUNTIME_MODE=cloud`
  - `TEMPORAL_ADDRESS`
  - `TEMPORAL_NAMESPACE`
  - `TEMPORAL_API_KEY`
  - `TEMPORAL_TLS_ENABLED=true`
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
```

The E2E workflow:
1. Creates a toy GCP project.
2. Enables required APIs.
3. Creates OTEL collector service account and key.
4. Runs collector in isolated compose (`docker-compose.gcp-e2e.yml`).
5. Emits smoke traces/metrics/logs and validates all three signals in GCP.
6. Deletes the toy project by default (set `KEEP_GCP_TOY_PROJECT=1` to keep it).

## Worktree Strategy
- Worktrees share infra containers.
- Worktree-local app ports are deterministic via `pnpm worktree:ports <name>` and `scripts/worktree/setup.sh`.
- `scripts/worktree/setup.sh` now writes:
  - `WORKTREE_PORT_OFFSET`
  - `API_BASE_URL`
  - `NEXT_PUBLIC_API_BASE_URL`
  - `EXPO_PUBLIC_API_BASE_URL`
  - `TEMPORAL_TASK_QUEUE` (`tx-agent-kit-<worktree-name>`)
