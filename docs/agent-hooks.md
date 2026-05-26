# Agent command hooks

Agent command hooks block shortcuts that bypass repository invariants before a
Claude Code or Codex shell command runs.

Current hooks:

- `block-raw-git-worktree-add.sh` blocks raw `git worktree add` so agents use
  `./scripts/worktree/create.sh`, which also runs `setup.sh` for env, ports,
  task queue, and schema setup.
- `block-integration-timeout-bump.sh` blocks `INTEGRATION_TIMEOUT_SECONDS=` so
  agents cannot hide slow integration tests by raising the harness budget.

## Raw Worktree Creation Hook

Raw `git worktree add` is blocked because it skips repository setup. The setup
helper gives each worktree:

- secrets seeded from the primary checkout `.env`
- a deterministic `WORKTREE_PORT_OFFSET`
- worktree-specific API, web, mobile, and worker ports
- a worktree-specific `DATABASE_SCHEMA` and `DATABASE_URL`
- a worktree-specific Temporal task queue
- OTEL endpoint defaults
- `run-migrations.sh` and `reset-worktree-schema.sh`

Allowed:

```bash
./scripts/worktree/create.sh feat/my-feature main
./scripts/worktree/setup.sh .worktrees/existing-feature
git worktree list
git worktree remove .worktrees/old-feature
```

Blocked:

```bash
git worktree add .worktrees/my-feature main
git -C /path/to/repo worktree add .worktrees/my-feature main
```

There is a recovery escape hatch only for unusual broken states:

```bash
ALLOW_RAW_GIT_WORKTREE_ADD=1 git worktree add .worktrees/recovery main
```

If that escape hatch is used, run `./scripts/worktree/setup.sh <path>`
immediately afterwards.

## Integration Test-Budget Hook

Agents are blocked from bumping `INTEGRATION_TIMEOUT_SECONDS=` to silence slow
integration tests.

The harness budgets integration tests at 120 seconds locally and 300 seconds in
CI. Bumping the budget hides slow tests that should be refactored. Use a direct
single-file Vitest command for debugging a hang instead of changing the harness
budget.

There is no escape hatch for this hook.

## Shared Shell Scripts

Both Claude Code and Codex use the same PreToolUse JSON envelope:
`hookSpecificOutput.permissionDecision: "deny"` with a
`permissionDecisionReason`. Rejection logic lives in these scripts:

```text
.claude/hooks/block-raw-git-worktree-add.sh
.claude/hooks/block-integration-timeout-bump.sh
```

## Claude Code Wiring

Enabled via `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/block-raw-git-worktree-add.sh"
          },
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/block-integration-timeout-bump.sh"
          }
        ]
      }
    ]
  }
}
```

## Codex Wiring

Enabled via `.codex/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./.claude/hooks/block-raw-git-worktree-add.sh",
            "statusMessage": "Checking command for raw git worktree creation"
          },
          {
            "type": "command",
            "command": "./.claude/hooks/block-integration-timeout-bump.sh",
            "statusMessage": "Checking command for INTEGRATION_TIMEOUT_SECONDS bypass"
          }
        ]
      }
    ]
  }
}
```

Codex resolves the relative `./` path against the cwd Codex was launched in.

## Manual Smoke Tests

Worktree hook:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git worktree list"}}' \
  | bash .claude/hooks/block-raw-git-worktree-add.sh

echo '{"tool_name":"Bash","tool_input":{"command":"./scripts/worktree/create.sh feat/example main"}}' \
  | bash .claude/hooks/block-raw-git-worktree-add.sh

echo '{"tool_name":"Bash","tool_input":{"command":"git worktree add .worktrees/example main"}}' \
  | bash .claude/hooks/block-raw-git-worktree-add.sh

echo '{"tool_name":"Bash","tool_input":{"command":"git -C /tmp/repo worktree add .worktrees/example main"}}' \
  | bash .claude/hooks/block-raw-git-worktree-add.sh
```

Integration timeout hook:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"pnpm test:integration:quiet api"}}' \
  | bash .claude/hooks/block-integration-timeout-bump.sh

echo '{"tool_name":"Bash","tool_input":{"command":"INTEGRATION_TIMEOUT_SECONDS=180 pnpm test"}}' \
  | bash .claude/hooks/block-integration-timeout-bump.sh

echo '{"tool_name":"Bash","tool_input":{"command":"CI=true INTEGRATION_TIMEOUT_SECONDS=300 ./scripts/test-integration-quiet.sh"}}' \
  | bash .claude/hooks/block-integration-timeout-bump.sh
```

The shell exit code is `0` for hook handling; the JSON `permissionDecision`
field carries the allow or deny verdict to the agent.
