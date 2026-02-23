#!/usr/bin/env bash
# Enforce shell script hygiene for agent-maintained scripts.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

MISSING_STRICT_MODE=()
NOT_EXECUTABLE=()
INVALID_GITATTRIBUTES_LINES=()

while IFS= read -r script_file; do
  if ! grep -Eq "^set -euo pipefail$" "$script_file"; then
    MISSING_STRICT_MODE+=("$script_file")
  fi

  if [[ ! -x "$script_file" ]]; then
    NOT_EXECUTABLE+=("$script_file")
  fi
done < <(find scripts -type f -name '*.sh' | sort)

if [[ ${#MISSING_STRICT_MODE[@]} -gt 0 ]]; then
  echo "Shell invariant failed: missing 'set -euo pipefail'"
  printf '%s\n' "${MISSING_STRICT_MODE[@]}"
  exit 1
fi

if [[ ${#NOT_EXECUTABLE[@]} -gt 0 ]]; then
  echo "Shell invariant failed: scripts not executable"
  printf '%s\n' "${NOT_EXECUTABLE[@]}"
  exit 1
fi

if [[ -f .gitattributes ]]; then
  while IFS= read -r invalid_line; do
    INVALID_GITATTRIBUTES_LINES+=("$invalid_line")
  done < <(
    awk '
      /^[[:space:]]*#/ { next }
      {
        for (i = 1; i <= NF; i += 1) {
          if ($i ~ /\.js$/ || $i == "*.js") {
            printf "%d:%s\n", NR, $0
            next
          }
        }
      }
    ' .gitattributes
  )
fi

if [[ ${#INVALID_GITATTRIBUTES_LINES[@]} -gt 0 ]]; then
  echo "Shell invariant failed: .gitattributes must not include .js patterns"
  printf '%s\n' "${INVALID_GITATTRIBUTES_LINES[@]}"
  exit 1
fi

echo "Shell invariants passed."
