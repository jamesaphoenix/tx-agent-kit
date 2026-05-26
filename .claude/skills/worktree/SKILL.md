# worktree

Use git worktrees for parallel agent changes. Each agent task gets an isolated copy of the repo.

## When to use
- Parallel feature work (multiple agents building different features simultaneously)
- Risky or experimental changes you want to isolate from main
- Any task where file conflicts with other agents are likely

## Branch naming convention

```
<type>/<domain>-<short-description>
```

| Type | When |
|------|------|
| `feat/` | New feature, route, page, or domain entity |
| `fix/` | Bug fix |
| `refactor/` | Restructure without behavior change |
| `test/` | Test-only changes |
| `chore/` | Config, tooling, CI, docs |

**Examples:**
- `feat/tenancy-team-members-api`
- `feat/tenancy-role-store-port`
- `fix/tenancy-auth-middleware-wiring`
- `refactor/billing-credit-service`
- `test/tenancy-inv-ten-003-disabled-member`

Keep names under 50 chars. Use the spec domain as prefix when working from a design doc.

## Worktree lifecycle

### 1. Create (single command)
```bash
# Runnable from the primary checkout OR from inside any existing worktree
./scripts/worktree/create.sh feat/tenancy-team-members-api
# Optional second arg: base branch (defaults to main)
./scripts/worktree/create.sh fix/billing-refund main
```

`create.sh` resolves the primary checkout via `git rev-parse --git-common-dir`,
runs `git worktree add` from there, and then calls `setup.sh` against the new
worktree. That single invocation gives you:

- A unique `WORKTREE_PORT_OFFSET` so every port (dev server, integration API,
  web slots) is offset from its default.
- Secrets seeded from the primary checkout's `.env` (R2, Sentry, Resend,
  etc.), with empty values healed on re-run. Non-empty worktree-local
  overrides are preserved.
- Worktree-scoped `DATABASE_URL`, `DATABASE_SCHEMA`, `API_PORT`, `WEB_PORT`,
  `MOBILE_PORT`, `WORKER_INSPECT_PORT`, `TEMPORAL_TASK_QUEUE`,
  `API_CORS_ORIGIN`, `API_BASE_URL`.
- `SENTRY_SPOTLIGHT=true`, `LOG_LEVEL=debug`.
- A dedicated Postgres schema.
- Helper scripts: `run-migrations.sh`, `reset-worktree-schema.sh`.

**Raw `git worktree add` is blocked.** The project-scoped Claude and Codex
hooks call `.claude/hooks/block-raw-git-worktree-add.sh`, including commands
like `git -C <repo> worktree add`, and deny them with instructions to use
`create.sh` instead. Other `git worktree` subcommands (`list`, `remove`,
`prune`, `lock`, `unlock`, `move`, `repair`) pass through untouched. If you
genuinely need the raw command for a recovery scenario, set
`ALLOW_RAW_GIT_WORKTREE_ADD=1` in the environment.

**Agent tool `isolation: "worktree"`:** Claude Code's internal
worktree creation on the Agent tool does NOT go through Bash, so the hook
doesn't see it. Those agent-scoped worktrees still skip `setup.sh` and
therefore can't run integration tests or `pnpm dev`. Use them only for
short self-contained tasks (research, a single file edit) that don't
need secrets or a shared API server. For anything that needs tests,
spawn the agent with a working directory from `create.sh` instead.

### 1b. Re-run setup against an existing worktree (idempotent heal)
```bash
# Re-applies port allocations and pulls fresh secrets from the primary
./scripts/worktree/setup.sh .worktrees/team-members-api
```
`setup.sh` refuses to run against the primary checkout — that path uses
base ports and sources its `.env` via `cp .env.example .env`.

### 2. Work
- Run `pnpm type-check` freely — no shared state conflicts.
- **`pnpm dev` works** after running `setup.sh` — unique ports prevent conflicts with other worktrees.
- **`pnpm test:integration` works in parallel across worktrees.** The
  shared API server in `scripts/test/vitest-global-setup.ts` binds to
  `4100 + WORKTREE_PORT_OFFSET`, and each worktree gets its own Postgres
  schema, so multiple worktrees can run integration tests at the same
  time without stepping on each other. No lock file is involved.
- **Do NOT modify Docker infrastructure** — shared across all worktrees via the `tx-agent-kit` project name.

### 3. Quality gate before signaling done
```bash
pnpm type-check:quiet   # must pass — zero errors
```

### 4. Merge back
```bash
# From main worktree
git merge feat/tenancy-team-members-api
# Or cherry-pick specific commits
git cherry-pick <sha>
```

### 5. Cleanup
```bash
git worktree remove .worktrees/team-members-api
git branch -d feat/tenancy-team-members-api
```

## Rules
- **One task per worktree.** Don't mix unrelated changes.
- **Branch from `main`** unless explicitly told otherwise.
- **Run `setup.sh` before `pnpm dev`.** It allocates unique ports and creates the worktree `.env`.
- **Commit before signaling done.** The orchestrating agent needs commits to merge.
- **Remove stale worktrees after merge.** Don't leave orphan worktrees around.
- **TDD applies in worktrees too.** Write failing tests first, then implement.

## Port allocation reference

Every port-scoped service uses `base + WORKTREE_PORT_OFFSET`, where the
offset is derived deterministically from the worktree name by
`scripts/worktree/lib/ports.sh`. The primary checkout has offset `0`.

| Service | Base (primary) | Worktree | Shared? |
|---------|----------------|----------|---------|
| Postgres | 5432 | 5432 | Yes — all worktrees share (separate schemas) |
| Redis | 6379 | 6379 | Yes |
| API dev server | 4000 | `4000 + offset` | No — unique per worktree |
| Web dev server | 3000 | `3000 + offset` | No — unique per worktree |
| Worker inspect | 9229 | `9229 + offset` | No — unique per worktree |
| Shared integration API | 4100 | `4100 + offset` | No — unique per worktree |

## Worktree `.env` variables set by `setup.sh`

`WORKTREE_PORT_OFFSET`, `DATABASE_URL` (with schema), `DATABASE_SCHEMA`,
`API_PORT`, `PORT`, `WEB_PORT`, `MOBILE_PORT`, `WORKER_INSPECT_PORT`,
`TEMPORAL_TASK_QUEUE`, `API_CORS_ORIGIN`, `API_BASE_URL`,
`NEXT_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_API_BASE_URL`,
`SENTRY_SPOTLIGHT`, `LOG_LEVEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`.

Non-worktree-scoped secrets (R2, Sentry DSNs, Resend, Temporal Cloud,
etc.) are seeded from the primary checkout's `.env`.

## Agent swarm pattern

When an orchestrator launches multiple agents in parallel worktrees:

1. Each agent gets a unique worktree + branch with a descriptive name
2. Agents run `pnpm type-check`, `pnpm lint`, `pnpm test`, and
   `pnpm test:integration` freely in parallel — the `WORKTREE_PORT_OFFSET`
   mechanism isolates each worktree's shared API server and Postgres schema
3. Orchestrator merges branches sequentially, resolving conflicts
4. Orchestrator re-runs `pnpm test:integration` on the merged result as a
   post-merge sanity check
5. Orchestrator cleans up worktrees
