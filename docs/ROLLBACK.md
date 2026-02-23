# Rollback

## Goal
Rollback deploys by promoting a previously known-good image artifact file.

## Prerequisites
- Keep historical image artifact files from `pnpm deploy:build-images`.
- Each artifact should include:
  - `API_IMAGE`
  - `WORKER_IMAGE`
- Prefer digest-pinned references for deterministic rollback.

## Rollback Steps
1. Select prior artifact:

```bash
ls deploy/artifacts/images-*.env
```

2. Re-deploy selected artifact:

```bash
pnpm deploy:staging deploy/artifacts/images-<previous-sha>.env
# or
pnpm deploy:prod deploy/artifacts/images-<previous-sha>.env
```

3. Verify smoke checks pass (automatic by default in deploy script).

4. If needed, run smoke manually:

```bash
API_BASE_URL=https://<api-host> pnpm deploy:smoke
```

## Migration Caveat
- Use additive/backward-compatible migrations for safe rollback.
- If rollback requires schema reversal, apply a dedicated backward migration before redeploying older images.
