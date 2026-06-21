# Auto-Fix Infra: new-issue webhook → headless coding agent → draft PR

When a genuinely new incident reaches the configured source (today: a Sentry
new-issue alert rule, but the pipeline is source-agnostic), a per-environment
alert rule fires a webhook at the API. The API dedupes on `sentry_issue_id` (an
opaque, stable incident id) and, only for a genuinely new incident, starts a
Temporal workflow directly (no domain outbox, no domain event). A single host
worker runs a headless coding agent (Codex or Claude) inside an isolated git
worktree with live credentials to reproduce and fix the bug, opens a draft PR
against the configured base branch, persists the agent's structured output per
incident, and (optionally) comments the link back on the source issue. A daily
cap and a once-per-incident rule keep cost bounded.

This document is the operator + implementer reference.

## Why this is NOT a domain event

The domain outbox (`domain_events`) is business-only and must stay clean and
shielded from incident webhook volume. Auto-fix is operational infra, not a
business fact, and the source can fire many webhooks. So:

- No `domainEventTypes` entry, no `domain_events` row, no `resolve-dispatch` case.
- The API starts the Temporal workflow **directly** via a dedicated neutral
  `AutoFixTriggerPort`, implemented inside the ONE ESLint-exempt API file allowed
  to import `@temporalio/client`: `apps/api/src/adapters/temporal-control.ts`.
- Dedupe happens **in the webhook route**, so a repeated incident id never reaches
  Temporal.

## Architecture

```
Source (groups by a deterministic fingerprint)
  |- Per-env alert rule: "A new issue is created" --> webhook
        POST /internal/sentry/new-issue            (apps/api, HMAC-verified)
          1. INSERT auto_fix_runs (sentry_issue_id) ON CONFLICT DO NOTHING   <= DEDUPE HERE
          2. if row already existed AND already dispatched => 200, stop (true duplicate)
          3. else => AutoFixTriggerPort.startAutoFixWorkflow(...) via temporal-control.ts adapter
                       workflowType: 'autoFixRequestedWorkflow'
                       workflowId:   auto-fix-<sentry_issue_id>   (REJECT_DUPLICATE => 2nd-layer single-flight)
                       taskQueue:    'auto-fix'
                     then UPDATE auto_fix_runs.status = 'dispatched'; return 200
                        |- HOST Temporal worker (apps/auto-fix-runner, serves 'auto-fix' queue,
                             maxConcurrentActivityTaskExecutions: 1)
                             activity runAutoFixAgent:
                               1. kill switch + agent auth check + Redis daily-cap
                               2. scripts/worktree/create.sh  (branch autofix/<issue> off AUTO_FIX_BASE_BRANCH)
                               3. render env: read pre-rendered deploy env (staging.env|prod.env)
                               4. run agent CLI (codex|claude) timeout-boxed (~25m default)
                               5. if fixed, git add/commit agent changes, then git push -u origin <branch>;
                                  gh pr create --draft --base <AUTO_FIX_BASE_BRANCH>
                               6. persist agent/agent_output/agent_jsonl_output/branch/pr_url/status;
                                  (optionally) comment branch/PR link on the source issue
```

**Self-healing without a poller.** The row is inserted `pending`, then the
workflow is started, then the row is marked `dispatched`. If the API crashes
between insert and start (or the trigger throws and returns 5xx so the source
retries), a later webhook for the same incident finds the row still `pending` and
**re-attempts the start** (idempotent via the fixed `auto-fix-<issue>` workflowId
plus `REJECT_DUPLICATE`). A truly-dispatched row is a no-op.

**Why a separate `auto-fix` queue + host worker.** The deployed Temporal worker
runs inside a container and cannot spawn `codex` / `claude` / `git` / `gh`. The
host worker is a plain Node process on a single host serving only the `auto-fix`
queue, single-flight (`maxConcurrentActivityTaskExecutions: 1`).

## Components and file locations

| Concern | Location |
|---------|----------|
| Contracts (literals, constants, schemas) | `packages/contracts/src/{literals,constants,auto-fix}.ts` |
| Neutral ports | `packages/core/src/ports/auto-fix-{trigger,run-store}-port.ts` |
| Run-store adapter | `packages/core/src/adapters/auto-fix-run-store-adapter.ts` |
| Table + repository + factory | `packages/infra/db/.../auto-fix-runs.*`, migration `0053_auto_fix_runs_table.sql` |
| Webhook route + HMAC verify | `apps/api/src/routes/sentry-webhooks.ts`, `apps/api/src/adapters/sentry-webhook-verification.ts` |
| Temporal trigger adapter (the ONLY `@temporalio/client` importer in api) | `apps/api/src/adapters/temporal-control.ts` |
| Test-only trigger stub | `apps/api/src/adapters/auto-fix-trigger-stub.ts` |
| Host worker | `apps/auto-fix-runner/` |
| Host entrypoint + launchd template | `scripts/auto-fix-runner.sh`, `scripts/launchd/com.tx-agent-kit.auto-fix-runner.plist` |

## The host worker (apps/auto-fix-runner)

A single-flight Temporal worker on the `auto-fix` queue. The activity:

1. **Kill switch** — `AUTO_FIX_ENABLED` must be true, else the run is `skipped`.
2. **Agent auth** — OAuth-only. Codex must be ChatGPT-OAuth (`~/.codex/auth.json`,
   `auth_mode=chatgpt`); Claude must have a logged-in subscription session. The
   child env strips `OPENAI_API_KEY` / `CODEX_API_KEY` (and `ANTHROPIC_API_KEY`
   for claude) so it can never silently fall back to API-key billing.
3. **Redis daily cap** (`AUTO_FIX_DAILY_QUOTA`, default 5) — surplus issues are
   marked `rate_limited` and NOT retried.
4. **Worktree** via `scripts/worktree/create.sh autofix/<issue> origin/<base>`.
   A numeric incident id is prefixed `issue-<id>` (the worktree validator rejects
   names starting with a digit).
5. **Env** — read the PRE-RENDERED deploy env file from `AUTO_FIX_RESOLVED_ENV_DIR`
   (`staging.env` / `prod.env`). The host worker NEVER runs `op inject`.
6. **Run** the agent CLI, timeout-boxed (default 25m, override via `AGENT_TIMEOUT_MS`,
   clamped below the Temporal activity timeout). MCP is disabled for codex
   (`-c mcp_servers={}`); the prompt is positional; stdin is `/dev/null`; the
   process is detached and group-killed on timeout.
7. **Finalize** — commit (only if outcome=fixed), push the branch, open a draft PR
   against `AUTO_FIX_BASE_BRANCH`, record the structured result, comment back.

The activity NEVER throws on a logic failure (it records a status and returns), so
a bad fix never triggers a Temporal retry / double-bills the agent. The one retry
(`maximumAttempts: 2`) only fires on a true infra failure.

## Environment knobs

| Var | Default | Purpose |
|-----|---------|---------|
| `AUTO_FIX_ENABLED` | `false` | Master kill switch. |
| `AUTO_FIX_AGENT` | `codex` | `codex` or `claude`. |
| `AGENT_MODEL` | unset | Pin a model; unset → the CLI's default. |
| `AUTO_FIX_BASE_BRANCH` | `main` | Branch the fix targets / branches off. |
| `AUTO_FIX_RESOLVED_ENV_DIR` | `$HOME/.local/state/tx-agent-kit/deploy` | Pre-rendered deploy env dir. |
| `AGENT_TIMEOUT_MS` | `1500000` (25m) | Agent wall-clock budget (clamped). |
| `SENTRY_AUTH_TOKEN` | unset | Comment-back token; unset → no-op. |
| `SENTRY_ORG_SLUG` | unset (empty) | Org slug for the comment-back endpoint; empty → no-op. |
| `SENTRY_WEBHOOK_SECRET` | unset | (API) HMAC secret; unset → the webhook 500s (presence-gated). |
| `SENTRY_DEPLOYMENT_ENVIRONMENT` | derived from `NODE_ENV` | (API) `staging` or `production`; gates the env cross-check. |
| `AUTO_FIX_TRIGGER_MODE` | unset | Test-only: `stub` swaps the live Temporal trigger for an in-process recorder. Never set in a deployment. |

## Host setup (operator)

Not in code — perform on the single host worker:

1. Populate `AUTO_FIX_RESOLVED_ENV_DIR` with the pre-rendered `staging.env` /
   `prod.env` (the same cache deploys use — never live `op inject`).
2. Authenticate the host CLIs: `codex login` (ChatGPT OAuth) or `claude login`,
   and `gh auth login`.
3. Install the launchd job from
   `scripts/launchd/com.tx-agent-kit.auto-fix-runner.plist` (replace
   `__PROJECT_DIR__` with the repo root).
4. Set `AUTO_FIX_ENABLED=true` and the source's `SENTRY_WEBHOOK_SECRET`.

## Verification

- Unit: `pnpm --filter @tx-agent-kit/auto-fix-runner test` (fakes, no real CLI/git/Temporal).
- Webhook integration (stub mode): the `sentry-webhooks.integration.test.ts` suite
  asserts dedupe (exactly one start per new incident, none on duplicate) over HTTP
  with no live Temporal (`AUTO_FIX_TRIGGER_MODE=stub`).
- Real end-to-end (a genuine new incident → worktree → agent edits → draft PR →
  comment) requires a running Temporal cluster, an authed codex/claude CLI, an
  authed `gh`, the pre-rendered env files, and a real alert rule + webhook secret
  on the source. These are host/operator steps, not CI.
