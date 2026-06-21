---
name: prune-dead-branches
description: Safely prune dead local branches, git worktrees, and remote branches in this repo. Use when asked to "prune dead branches", "clean up worktrees", "delete merged branches", "tidy up git", or after a batch of PRs has merged. Knows this repo merges via squash, so it verifies death by PR state, not just git ancestry.
metadata:
  short-description: Prune merged branches and stale worktrees
---

# Prune Dead Branches and Worktrees

Remove branches and worktrees whose work has already landed, without ever
destroying live work. Covers local branches, git worktrees, and remote
(`origin`) branches in one pass. Pairs with the `worktree` skill (which creates
them).

## What "dead" means in THIS repo (read first)

PRs are **squash-merged**, which makes the naive `git branch --merged main`
check wrong here: a squash-merged branch is NOT an ancestor of its base, so
`git branch --merged` will not list it and `git branch -d` will refuse it. The
reliable death signals are:

- The branch's PR shows `state=MERGED` (`gh pr list`), OR
- The local branch's upstream is `[origin/...: gone]` (remote was deleted by the
  maintainer after merge) and it has no open PR, OR
- The branch is a true git ancestor of `origin/main`.

`main` is the single permanent integration branch. Never delete it.

## When to use
- "Prune the dead branches", "clean up worktrees", "delete merged branches".
- Housekeeping after several PRs merge.
- The local branch/worktree list has grown noisy.

## Never delete (hard rules)
- Any branch with an **open PR** (pull `gh pr list --state open` and exclude
  every head branch, especially `dependabot/*` and `autofix/*`).
- Any worktree with **uncommitted or untracked work** (`git status --porcelain`
  is non-empty with real content). The one exception is a *broken* worktree
  whose tracked files are all shown as deleted (`D`) and whose branch is already
  merged: its files are already gone, so `--force` removal loses nothing.
- A **detached-HEAD** worktree that has local changes (flag it, do not guess).
- The **currently checked-out** branch (git refuses anyway). Flag it; offer to
  switch to `main` first if it is merged.
- `main`, and anything you cannot prove is dead. When unsure, leave it and list
  it for the human.

## Procedure

### 1. Sync and inventory
```bash
git fetch --prune                        # drop stale remote-tracking refs
git branch -vv                           # local branches + tracking + [: gone]
git worktree list                        # worktrees (+ detached HEADs)
git branch -r | grep -v 'origin/HEAD'    # remote branches
git branch --merged origin/main
git branch -r --merged origin/main
```

### 2. Pull PR state (the source of truth for squash merges)
```bash
gh pr list --state merged --limit 60 \
  --json number,headRefName,mergedAt -q '.[] | "\(.number)\t\(.headRefName)\t\(.mergedAt)"'
gh pr list --state open --limit 60 \
  --json number,headRefName -q '.[] | "\(.number)\t\(.headRefName)"'
```
Build two sets: `MERGED_HEADS` and `OPEN_HEADS`. A branch is dead if it is in
`MERGED_HEADS`, OR is a git-ancestor of main, OR is `[: gone]` with no open PR.
A branch is protected if it is in `OPEN_HEADS`.

### 3. Check worktree cleanliness BEFORE removing anything
```bash
for p in .worktrees/*; do
  echo "$p: $(git -C "$p" status --porcelain | wc -l | tr -d ' ') change(s)"
done
```
Inspect the non-zero ones (`git -C <path> status --porcelain | awk '{print $1}' | sort | uniq -c`).
All `D` with no `??` means a broken/abandoned tree (safe to `--force` if the
branch is merged). Any `M`/`??`/`A` means real work: leave it.

### 4. Remove dead worktrees (a worktree pins its branch, so do this first)
```bash
git worktree remove .worktrees/<clean-merged-one>
git worktree remove --force .worktrees/<broken-tree-merged-branch>   # only when files already gone
git worktree prune -v
```

### 5. Delete dead local branches
```bash
# True ancestors of main: safe delete (errors loudly if you were wrong)
git branch -d <ancestor-merged-branches...>
# Squash-merged or [: gone]+no-open-PR: force delete (you have verified via PR state)
git branch -D <squash-merged-or-gone-branches...>
```
Prefer `-d`; fall back to `-D` only for branches you confirmed merged in step 2.

### 6. Prune dead remote branches
```bash
git push origin --delete <merged-head-1> <merged-head-2> ...   # batch in one push
```
Only branches whose PR is `MERGED` (or that are ancestors of `origin/main`) and
have no open PR. Deleting a remote branch does not affect any local checkout that
tracks it (it just becomes `[: gone]`), so it is safe to delete the remote of
your current branch.

### 7. Verify and report
```bash
git fetch --prune
git branch -vv; git branch -r | grep -v 'origin/HEAD'; git worktree list
```
Report three groups: **deleted** (branches/worktrees/remotes, with the reason
per item, e.g. "#146 merged"), **kept** (open PRs / active worktrees), and
**left for you to decide** (local-only branches with no PR and no merge, dirty
or detached-HEAD worktrees, the current merged branch). Do not delete the
"decide" group; surface it.

## Recoverability
Branch deletion is recoverable: the commits live on in main, `git reflog` keeps
the old tips, and a deleted remote ref can be recreated from a merged PR. The
only irreversible step is `git worktree remove --force` on a tree with
uncommitted work, which is exactly why step 3's cleanliness gate exists. When a
deletion would be unrecoverable, stop and ask.

## Quick filter cheatsheet
| Signal | Meaning | Action |
|--------|---------|--------|
| PR `state=MERGED` | landed (squash) | delete local + remote |
| ancestor of `origin/main` | landed | delete (`-d` works) |
| `[origin/...: gone]`, no open PR | remote deleted after merge/close | delete local (`-D`) |
| open PR (`dependabot/*`, `autofix/*`, feature) | live | keep |
| worktree clean + branch merged | done | `git worktree remove` then delete branch |
| worktree all-`D`, branch merged | broken, files gone | `remove --force` |
| worktree `M`/`??`, or detached + changes | real work | keep, flag |
| local-only, no PR, not merged | unknown | keep, list for human |
| `main` | permanent | never delete |
