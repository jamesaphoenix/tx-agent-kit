# OctoSpark Mining Log

## Imported now
- Idempotent infra bootstrap script:
  - `scripts/start-dev-services.sh`
- Idempotent integration harness:
  - `scripts/test/reset-test-db.sh`
  - `scripts/test/run-integration.sh`
- Worktree helpers:
  - `scripts/worktree/ensure-shared-infra.sh`
  - `scripts/worktree/derive-ports.sh`
- Context-efficient runners:
  - `scripts/run-silent.sh`
  - `scripts/build-quiet.sh`
  - `scripts/lint-quiet.sh`
  - `scripts/type-check-quiet.sh`
  - `scripts/test-quiet.sh`
  - `scripts/test-integration-quiet.sh`
  - `scripts/test-run-silent.sh`
- Env bootstrap pattern:
  - `scripts/configure-local-env.sh`
- Shell invariant enforcement:
  - `scripts/check-shell-invariants.sh`

## Imported for later adaptation
- Workflow patterns copied to `todo/github-actions/octospark-services/*`.

## Next mining targets
1. Port stronger worktree lifecycle manager (`create/setup/remove/list`) with generated `.env.worktree` files.
2. Add file-lock/schema-mutex around integration DB reset for concurrent local runs.
3. Expand logger helpers to include contextual error/performance/event helpers.
4. Add docs-lint checks for freshness/cross-links (agent-legibility guardrails).
