---
name: deploy-dual-release
description: Deploy this repository to Mac Studio k3s (staging/prod) and optional GKE from the same image artifact, with Cloudflare tunnel reconcile/check on Mac deploys.
metadata:
  short-description: Dual Kubernetes release workflow
---

# deploy-dual-release

Use this skill when a request involves build/deploy/release operations for Mac k3s and optional GKE.

## Preconditions
- Mac Studio runner has `k3s`, `kubectl`, `helm`, `op`, and `cloudflared`.
- 1Password env templates are configured in `deploy/env/*.env.template`.
- Build target can push to Artifact Registry.

## Commands
1. Build and publish images, then capture artifact:
   - `PUSH_IMAGES=1 pnpm deploy:build-images`
2. Deploy Mac staging:
   - `pnpm deploy:k8s:mac:staging deploy/artifacts/images-<sha>.env`
3. Deploy Mac prod:
   - `pnpm deploy:k8s:mac:prod deploy/artifacts/images-<sha>.env`
4. Optional GKE deploy from same artifact:
   - `pnpm deploy:k8s:gke deploy/artifacts/images-<sha>.env`

## Tunnel operations
- Reconcile tunnel config:
  - `pnpm deploy:tunnel:reconcile staging|prod|both`
- Verify tunnel health endpoint:
  - `pnpm deploy:tunnel:check staging|prod|both`

## Operations
- Status:
  - `pnpm deploy:k8s:status mac-staging|mac-prod|gke`
- Rollback:
  - `pnpm deploy:k8s:rollback mac-staging|mac-prod|gke <revision>`

## CI workflow mapping
- Build jobs: `build_images_locally` or `build_images_google_cloud`
- Deploy jobs: `deploy_k3s_local`, optional `deploy_gke`
