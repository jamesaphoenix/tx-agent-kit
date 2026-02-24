#!/usr/bin/env bash
# Ensure every CLAUDE.md has a sibling AGENTS.md symlink (and vice versa).
# Run via: pnpm sync:agent-docs
#
# Rules:
#   1. If CLAUDE.md exists and AGENTS.md is missing → create AGENTS.md -> CLAUDE.md
#   2. If AGENTS.md exists and CLAUDE.md is missing → create CLAUDE.md -> AGENTS.md
#   3. If both exist as regular files → warn (manual merge needed)
#   4. If one is already a correct symlink → skip
#
# Skips: node_modules, .next, .turbo, dist, .git, .source, .data

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SKIP_DIRS="-path */node_modules -o -path */.next -o -path */.turbo -o -path */dist -o -path */.git -o -path */.source -o -path */.data -o -path */.vercel"

changed=0
warnings=0

sync_pair() {
  local dir="$1"
  local claude="$dir/CLAUDE.md"
  local agents="$dir/AGENTS.md"

  local has_claude=false has_agents=false
  local claude_is_link=false agents_is_link=false

  [[ -e "$claude" ]] && has_claude=true
  [[ -e "$agents" ]] && has_agents=true
  [[ -L "$claude" ]] && claude_is_link=true
  [[ -L "$agents" ]] && agents_is_link=true

  # Already a correct symlink pair — skip
  if $agents_is_link && [[ "$(readlink "$agents")" == "CLAUDE.md" ]]; then
    return
  fi
  if $claude_is_link && [[ "$(readlink "$claude")" == "AGENTS.md" ]]; then
    return
  fi

  # Both are regular files — warn
  if $has_claude && $has_agents && ! $claude_is_link && ! $agents_is_link; then
    echo "  WARN  $dir — both CLAUDE.md and AGENTS.md exist as regular files (merge manually, then delete one)"
    warnings=$((warnings + 1))
    return
  fi

  # CLAUDE.md exists, AGENTS.md missing → symlink AGENTS.md -> CLAUDE.md
  if $has_claude && ! $has_agents; then
    ln -s CLAUDE.md "$agents"
    echo "  LINK  $agents -> CLAUDE.md"
    changed=$((changed + 1))
    return
  fi

  # AGENTS.md exists, CLAUDE.md missing → symlink CLAUDE.md -> AGENTS.md
  if $has_agents && ! $has_claude; then
    ln -s AGENTS.md "$claude"
    echo "  LINK  $claude -> AGENTS.md"
    changed=$((changed + 1))
    return
  fi
}

# Find all directories containing either file (excluding skipped dirs)
dirs=$(find "$PROJECT_ROOT" \
  \( $SKIP_DIRS \) -prune -o \
  \( -name "CLAUDE.md" -o -name "AGENTS.md" \) -print \
  | xargs -I{} dirname {} | sort -u)

if [[ -z "$dirs" ]]; then
  echo "No CLAUDE.md or AGENTS.md files found."
  exit 0
fi

echo "Syncing CLAUDE.md <-> AGENTS.md symlinks..."
echo

while IFS= read -r dir; do
  sync_pair "$dir"
done <<< "$dirs"

echo
echo "Done. $changed symlink(s) created, $warnings warning(s)."

if [[ "$warnings" -gt 0 ]]; then
  exit 1
fi
