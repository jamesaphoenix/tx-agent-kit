#!/usr/bin/env bash
#
# Safe wrappers for the 1Password CLI. Source this, then call `run_op` instead of `op`.
#
# `set -euo pipefail` is present because scripts/check-shell-invariants.sh requires it of
# every shell file, with no exemption for sourced libraries. That is safe here rather than
# merely tolerated: every caller (deploy-compose.sh, deploy-k8s.sh, migrate.sh,
# ci/verify-k3s-staging.sh, and the sibling repos' callers) already sets exactly these
# options at the top of the file, so sourcing this cannot change the shell they run under.
set -euo pipefail
#
# ── Why this file exists ────────────────────────────────────────────────────────────────
#
# `op` can block forever instead of failing. Traced with fs_usage against a live wedge on a
# self-hosted Mac Studio runner, op's credential path stats and then open()s the 1Password
# DESKTOP APP's settings file inside its group container:
#
#   ~/Library/Group Containers/2BUA8C4S2C.com.1password/Library/Application Support/
#     1Password/Data/settings/settings.json
#
# That path is TCC-protected. In a launchd session - which is what a self-hosted GitHub
# Actions runner and every launchd agent job execute in - macOS tries to raise a privacy
# consent prompt that nothing is there to answer, and the open() NEVER RETURNS. It was
# measured at 17.34 seconds and still blocked when SIGKILL finally interrupted it. Every
# other open op makes completes in microseconds; that single call is the entire bug.
#
# Over ssh, TCC denies immediately instead of prompting, so the identical command on the
# same host with the same token returns in ~1s. That asymmetry is why this presents as a
# CI-only mystery, and why the token, the vault scope, the cache daemon, the login keychain
# and the app-integration setting are all red herrings - op never gets far enough to use any
# of them. `op --version` is unaffected because it never reads that file.
#
# Two layers, in order of importance:
#
#   1. THE CURE - run op with HOME pointed at an empty directory, so the app container is
#      not in its search path and the protected open is never attempted. Verified in a
#      failing launchd session: default HOME wedges and must be killed, isolated HOME
#      returns in 0s. Authentication is unaffected; op simply recreates a throwaway
#      .config/op/config inside the temp HOME.
#
#   2. THE BACKSTOP - a deadline, so any FUTURE blocking variant is a named failure rather
#      than a silent one. This matters more than it looks: op calls typically sit before a
#      deploy script's first echo, so a wedge produces a step with zero output and no clue
#      where it stopped. One such wedge sat 11 minutes emitting not a single byte.
#
# ── Why the deadline is shaped this way ─────────────────────────────────────────────────
#
# The obvious spellings do not work:
#
#   - Not `timeout`: coreutils is not installed on the Mac Studio runner. A timeout-based
#     probe there died with "command not found: 75", silently running the wrong command.
#   - Not `perl -e 'alarm N; exec op ...'`, the usual coreutils-free substitute. `op` is a
#     Go binary, and the Go runtime treats SIGALRM as notify-only: with nothing listening
#     for it, the signal is SWALLOWED. Measured against a real wedged op - a 15s alarm had
#     still not fired at 75s. A naive wrapper is not a weak bound, it is no bound at all.
#   - So: fork, then SIGTERM and SIGKILL the child's process GROUP. SIGKILL cannot be
#     ignored by any runtime, and the group covers grandchildren. Both halves matter - a
#     command substitution reads until the pipe closes, so a surviving grandchild holding
#     stdout keeps `$(op ...)` blocked long after op itself is dead.

OP_CALL_TIMEOUT_SECONDS="${OP_CALL_TIMEOUT_SECONDS:-120}"

# Path to a throwaway HOME for op. Deterministic per shell PID rather than mktemp-per-call:
# these wrappers are routinely invoked inside `$(...)`, and a subshell cannot export state
# back to its parent, so a fresh mktemp on every call would leak one directory per op run.
op_cli_isolated_home() {
  local dir="${OP_CLI_ISOLATED_HOME:-${TMPDIR:-/tmp}/op-cli-home-$$}"
  if [[ ! -d "$dir" ]]; then
    mkdir -p "$dir"
    chmod 700 "$dir"
  fi
  printf '%s' "$dir"
}

# Best-effort cleanup, safe to call from an EXIT trap. Never fails the caller.
op_cli_cleanup_isolated_home() {
  local dir="${OP_CLI_ISOLATED_HOME:-${TMPDIR:-/tmp}/op-cli-home-$$}"
  [[ -d "$dir" ]] && rm -rf "$dir"
  return 0
}

# Run `op` with the isolated HOME, bounded by a hard deadline enforced with SIGKILL on the
# process group. Exits 142 if the deadline is hit.
op_with_deadline() {
  local isolated_home
  isolated_home="$(op_cli_isolated_home)"
  perl -e '
    my $timeout = shift;
    my $pid = fork();
    die "fork failed: $!" unless defined $pid;
    if ($pid == 0) { setpgrp(0, 0); exec { $ARGV[0] } @ARGV or exit 127; }
    $SIG{ALRM} = sub {
      kill("TERM", -$pid);
      select(undef, undef, undef, 0.5);
      kill("KILL", -$pid);
      exit 142;
    };
    alarm $timeout;
    waitpid($pid, 0);
    my $st = $?;
    alarm 0;
    exit($st & 127 ? 128 + ($st & 127) : $st >> 8);
  ' "$OP_CALL_TIMEOUT_SECONDS" env "HOME=$isolated_home" op "$@"
}

# `op_status`, not `status`: `status` is a read-only special variable in zsh, and this file
# may be sourced or extracted by tooling that does not always run under bash.
run_op() {
  # `|| op_status=$?`, not `if op_with_deadline; then ... fi; op_status=$?`. When an `if`
  # condition fails and there is no else branch, the compound command itself succeeds and
  # resets `$?` to 0, so the status read back would ALWAYS be 0 - every failure would look
  # like a success and neither the retry nor the error passthrough could ever fire.
  local op_status=0
  op_with_deadline "$@" || op_status=$?
  if [[ "$op_status" -eq 0 ]]; then
    return 0
  fi
  # 142 = 128 + SIGALRM(14): the call wedged. Any other status is a real op error and must
  # surface as-is rather than be retried into a second timeout.
  if [[ "$op_status" -ne 142 ]]; then
    return "$op_status"
  fi
  echo "1Password call 'op $1' exceeded ${OP_CALL_TIMEOUT_SECONDS}s. This is NOT a credential problem - every bad-credential path fails in under a second. Retrying once with the cache disabled." >&2
  op_with_deadline "$@" --cache=false
}
