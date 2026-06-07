import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the tx-agent-kit web core browser E2E.
 *
 * A deliberately SMALL, high-value E2E suite (1-2 specs) layered on top of the
 * web/api integration tests. It drives the REAL Next.js UI against the REAL
 * API.
 *
 * Target: a Next.js PRODUCTION build, NOT the dev server.
 *
 * The dev server (webpack) lazy-compiles each route on first hit; under the
 * parallel suite those cold compiles serialise and can blow the per-test cap.
 * A production build has no lazy compilation and serves a small hashed bundle,
 * so the suite is first-attempt green.
 *
 *   - web  served by `next start` on http://localhost:${WEB_PORT:-3000}
 *          (the `webServer` block below — runs `pnpm e2e:serve`). The PROD BUILD
 *          (`pnpm e2e:build`) is a SEPARATE prerequisite step, NOT counted
 *          against the 120s test-run budget (CI runs build, then start+poll,
 *          then the bounded test:e2e step).
 *   - api  on http://localhost:${API_PORT:-4000}. Started by the worktree stack
 *          / CI before the test step.
 *
 * The smoke specs do NOT seed the database: they assert on the public auth form
 * and on the unauthenticated redirect of a protected route, both of which are
 * deterministic against the prod build with no DB state.
 *
 * Set PLAYWRIGHT_WEB_BASE_URL to override the target (e.g. to attach to an
 * already-running prod server) — `reuseExistingServer` then skips spawning.
 */

const webPort = process.env.WEB_PORT ?? process.env.PORT ?? '3000'
const baseURL = process.env.PLAYWRIGHT_WEB_BASE_URL ?? `http://localhost:${webPort}`

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.e2e\.test\.ts$/u,
  // HARD 120s budget (layer 1 of 3 — see enforce-e2e-budget.mjs + the test:e2e
  // process-kill wrapper + CI timeout-minutes). globalTimeout caps the WHOLE run:
  // if the combined suite ever exceeds 120s the run FAILS rather than dragging on.
  // The guard refuses to let this be widened past 120000 without changing the
  // guard itself + a written justification.
  globalTimeout: 120_000,
  // Per-test cap: any single spec that wedges dies at 30s, well inside the run
  // budget so a hung test surfaces fast instead of starving the others.
  timeout: 30_000,
  // Per-assertion cap: explicit visible/enabled/networkidle waits resolve fast on
  // a warm stack; 10s is generous headroom without letting a single expect eat the
  // run budget.
  expect: { timeout: 10_000 },
  // File-level parallelism: independent specs run concurrently. Each spec is
  // parallel-safe: it asserts only on public, unauthenticated states.
  //
  // WORKERS = 2: keeps the suite fast while staying well within the budget.
  fullyParallel: true,
  workers: 2,
  // First-attempt deterministic: specs wait on explicit visible/enabled/URL
  // states (no fixed sleeps), so the suite passes on the FIRST try locally with
  // retries 0. CI keeps a single-retry net for the occasional cold-runner hiccup;
  // a local run uses 0 so flakiness is caught at the source, not masked.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  // Serve the Next.js PRODUCTION build. This runs `next start` only — the build
  // (`pnpm e2e:build`) is a SEPARATE prerequisite (CI builds in its own step;
  // locally run `pnpm --filter @tx-agent-kit/web e2e:build` once first), so the
  // build is NOT counted against the 120s test-run budget. Playwright waits for
  // a 200 on baseURL before any spec runs. `reuseExistingServer: true` attaches
  // to an already-running prod server (e.g. when PLAYWRIGHT_WEB_BASE_URL points
  // at a long-lived stack) instead of spawning a second one. The api is started
  // independently (worktree stack / CI step) on :4000.
  webServer: {
    command: 'pnpm e2e:serve',
    url: baseURL,
    reuseExistingServer: true,
    // Starting a prebuilt prod server is fast; this is NOT the test budget —
    // the 120s wall-clock is enforced by globalTimeout + the test:e2e wrapper.
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
