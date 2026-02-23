# Deployment

## Deployment Model
- Local development uses shared Docker infra (`postgres`, `temporal`, observability, `redis`) and runs app processes locally.
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

## Smoke Checks
Manual smoke run:

```bash
API_BASE_URL=https://<api-host> pnpm deploy:smoke
```

Covers:
- `/health`
- auth sign-up + `/v1/auth/me`
- workspace create/list
- task create/list
- invitation create/list

## Worktree Strategy
- Worktrees share infra containers.
- Worktree-local app ports are deterministic via `pnpm worktree:ports <name>` and `scripts/worktree/setup.sh`.
- `scripts/worktree/setup.sh` now writes:
  - `API_BASE_URL`
  - `NEXT_PUBLIC_API_BASE_URL`
  - `EXPO_PUBLIC_API_BASE_URL`
