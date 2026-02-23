---
name: worktree
description: Use git worktrees to isolate parallel agent tasks in tx-agent-kit.
metadata:
  short-description: Git worktree workflow
---

# worktree

Use git worktrees for parallel agent changes.

## Rules
- One task per worktree.
- Keep branch names short and task-oriented.
- Remove stale worktrees after merge.
