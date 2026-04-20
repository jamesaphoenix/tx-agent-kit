---
name: spec-to-implementation
description: End-to-end spec implementation with agent swarms. Analyzes a design spec, identifies gaps, implements with TDD, then runs adversarial review-fix loops until clean.
metadata:
  short-description: Spec-driven implementation pipeline with adversarial review
---

# Spec to Implementation

Automated spec-driven implementation pipeline. Takes a design doc, analyzes gaps, builds with
TDD, then adversarial-reviews until no bugs remain. Never merges — produces clean worktrees.

## Pipeline

```
Phase 1: Gap Analysis        →  5-10 sub-agents compare spec vs codebase
Phase 2: TDD                 →  Write failing tests for all gaps
Phase 3: Implementation      →  Build code in worktrees to pass tests
Phase 4: Adversarial Review  →  10-15 reviewers per worktree, fix loop
Phase 5: Prevention          →  Surface ESLint rules + test strategies
```

**No merge phase.** This skill produces clean worktrees. Merging is human-initiated.

## Loop Behavior

Designed for multi-pass `/loop` usage. Each invocation is idempotent:
1. Check current state, identify remaining gaps/bugs
2. Fix them, re-review
3. **When zero criticals remain → report CLEAN → stop the loop**
4. Maximum runtime: 1-1.5 hours (hard cap)

### Multi-Pass Trust Model

Don't trust the first pass:
```
Pass 1: Gap analysis + TDD + implement
Pass 2: Adversarial review → find bugs
Pass 3: Fix bugs → re-review → find more bugs
Pass 4: Fix remaining → re-review → zero criticals → STOP
```

## For Codex (ralph.sh)

```bash
# Decompose spec into task graph
tx decompose specs/design/<name>.md

# Run Ralph — each task gets spec context injected
./scripts/ralph.sh --design-doc <name> --runtime codex

# Multi-pass: run Ralph again after first pass completes
./scripts/ralph.sh --design-doc <name> --runtime codex
```
