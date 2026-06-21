---
name: fix-test-flake
description: Diagnose and durably eliminate flaky/intermittent test failures (passes locally but fails CI, rotates between tests, red only under load). Reproduce under contention, instrument the real state instead of guessing, root-cause by signal not duration, fix at the source, validate multi-run. Use when a test is flaky, CI is intermittently red, or fixing one flake unmasks others.
metadata:
  short-description: Playbook to reproduce, root-cause, and durably fix flaky tests
---

# fix-test-flake

Playbook for killing flaky tests for good. Companion to `speed-up-test-suite`; uses the read-only `test-perf` and `test-census` skills as tools.

## Golden rules (learned the hard way)
1. **Reproduce under LOAD, not in isolation.** Flake needs contention. A test that passes 12/12 in isolation can fail deterministically in the full suite. Repro = `CI=true pnpm test:integration:quiet` run 3-5x; the failing test rotates between siblings under saturation. Isolated runs lie.
2. **Instrument the real state; never guess.** Capture the ACTUAL HTTP status, DOM, server-side records, and session/admin state at the failure point - e.g. wrap the failing assertion: `try { await waitFor(...) } catch { const srv = await api.list(...); throw new Error(`[DIAG] serverRows=${srv.length} dialogOpen=${...} inviteBtn=${...}`) }`. Guessing (cookies, bcrypt) wastes hours; one diagnostic run ends it. Verify an agent's "validated" claim against the real merged diff (`gh pr diff`) / a real CI run before trusting it.
3. **Fix by signal, not by duration.** Bumping timeouts hides the bug; wait on the actual event. Fix at the SOURCE where possible (co-locate the gating query, deterministic focus), not just test-side waits.
4. **Validate multi-run + on CI.** Local-green != CI-green. Confirm 5+ consecutive full-suite runs before declaring it fixed.

## Root-cause catalog (web integration, jsdom)
- **Sync query on async-gated data.** `getByRole`/`querySelector` right after render, when the element is gated on a SEPARATE query (e.g. `isAdmin` from the memberships query) -> fast-fail. Fix: `findBy*`/`waitFor`. Source fix: co-locate the gate with the rows.
- **`user.type` of long inputs drops keystrokes** under background re-render churn -> truncated/empty value -> wrong submit. Fix: atomic `await user.click(field); await user.paste(value)` (and assert the value landed).
- **rAF autofocus race.** A dialog that autofocuses its input via `requestAnimationFrame` after open: `click+paste` can paste into nothing -> empty field. Fix: wait for focus, then paste, then verify-and-re-paste if blanked.
- **react-select portal timing.** Options render into a `document.body` portal from a query; menu-open or selection-commit can fail under load. Fix: `await screen.findByRole('option', { name })`, or poll until the selected value chip exists.
- **Shared singletons across tests.** A module-singleton session store, or a mock sidecar under `pool:'threads', isolate:false` (e.g. the fake OpenRouter): one test's request/clear bleeds into another. Fix: version-guard the clear (only act on the session the request was for); scope "no requests" assertions to THIS test's own requests; do not leave a stale session/cookie.
- **Auth session cleared on transient network error.** A token refresh that fails with no HTTP status (ERR_NETWORK) must NOT clear a valid session. Guard the clear by a session-version snapshot taken at request SEND time (not at 401-observe time).
- **Unnecessary setup that creates a hazard.** Pre-creating an invitee user via sign-up left the invitee's session cookie behind; the invite needs only an email. Drop setup the assertions do not need.
- **"Rotates between sibling tests under contention"** = a timeout/contention class, not one bug. Treat the file/contention, not the unlucky test.

## Infra-level causes (check before blaming test code)
- Leaked per-run Postgres schemas bloat the catalog and slow every run into timeouts -> GC leaked per-run Postgres schemas aggressively with a low age cutoff; a 24h GC cutoff is too lax for bursts.
- Concurrent CI runs on the self-hosted runner share ONE Postgres (compose project pinned) -> contention. The workflow `concurrency.group` keyed by `${{ github.ref }}` does NOT serialize across branches/PRs - opening several PRs at once self-inflicts a pile-up.
- bcrypt runs pure-JS ON the API event loop; the harness should use 4 rounds - verify the spawned API actually inherits it (a `??=` default loses to an ambient env value or a reused persistent server).
- The Effect PgClient request pool silently caps at 10 if `maxConnections` is omitted; size it from `DB_POOL_MAX`.

## Cascade
Fixing the dominant flake UNMASKS downstream jobs it was hiding (E2E `needs:` integration; the deploy `needs:` tests). Expect a chain of newly-revealed real issues (E2E breakages, a Docker prepare-script break) once the suite finally goes green.

## Guardrails (prevent regression)
- Add `eslint-plugin-testing-library` scoped to `*.test.{ts,tsx}`: `prefer-find-by`, `no-await-sync-queries`, `await-async-queries`/`await-async-utils` (error). This mechanically catches the "sync getBy on async data" class.
- Ban fixed sleeps (`setTimeout`/`new Promise(r => setTimeout)`) in tests via `no-restricted-syntax`.

## Verify
`pnpm lint:quiet && pnpm type-check:quiet`, then `CI=true pnpm test:integration:quiet` x5 (the treated files must be 5/5 green), then a green CI run through E2E. Remove all temporary `[DIAG]` instrumentation before merge.
