#!/usr/bin/env bash

set -euo pipefail

preferred_node_dir="/opt/homebrew/opt/node@22/bin"
if [[ -x "$preferred_node_dir/node" ]]; then
  export PATH="$preferred_node_dir:$PATH"
  if [[ -n "${GITHUB_PATH:-}" ]]; then
    echo "$preferred_node_dir" >> "$GITHUB_PATH"
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required on the Mac runner."
  exit 1
fi

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$node_major" != "22" ]]; then
  echo "Node.js 22 is required on the Mac runner; found $(node --version)."
  echo "Install node@22 with Homebrew or update preferred_node_dir in this script."
  exit 1
fi

corepack enable
corepack prepare pnpm@10.28.0 --activate
pnpm --version
