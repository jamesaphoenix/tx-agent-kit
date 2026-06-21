---
name: test-census
description: Census the repo's tests by TYPE, not by name. Classifies every tracked test file via content heuristics into unit / integration / react-component / e2e (plus a separate db pgTAP count), in precedence order so buckets are mutually exclusive. Use when the user asks "what kinds of tests do we have", "how many component vs integration tests", "what's our e2e coverage", or wants a per-area test-type breakdown.
metadata:
  short-description: Tracked tests bucketed by type (unit/integration/react/e2e), content-classified
---

# test-census

This skill is **for reporting only**. It runs a script and reports the numbers - it does not write, move, or delete tests, and it does not run any test suite. It reads file content to classify, nothing more. If the user wants to act on the report (e.g. an area with zero react-component tests, a backend package leaking UI tests), surface the observation in prose and let them decide.

It does **not** touch shared infra, Docker, Postgres, or Temporal - it is a pure `git ls-files` + `grep` census, safe to run during a release freeze.

## Run

The script lives at `.claude/skills/test-census/count.sh` and is repo-root-aware (`git rev-parse --show-toplevel`). It is bash 3.2 compatible (macOS default shell).

| Command | Output |
|---|---|
| `./.claude/skills/test-census/count.sh` | Summary: total test files + per-category counts and percentages (unit / integration / react-component / e2e), plus a separate db (pgtap) line |
| `./.claude/skills/test-census/count.sh --by-dir` | Summary + per-top-level-area breakdown (apps/api, apps/web, packages/core, ...) |
| `./.claude/skills/test-census/count.sh --files <category>` | List the files classified into a bucket so the classification is auditable: `unit`, `integration`, `react-component`, `e2e`, `db` |
| `./.claude/skills/test-census/count.sh --no-repos` | If this repo vendors a top-level `repos/` tree (another project's checked-in test suite), drop it from all counts. Harmless no-op when there is no such tree. Composable with any of the above (e.g. `--by-dir --no-repos`). |

## What it counts

Tracked test files matching these globs, after dropping `node_modules/`, `dist/`, `.next/`, `coverage/`, `build/`, `.turbo/`, `.vercel/`:

- `*.test.ts`, `*.test.tsx`, `*.test.mjs`, `*.test.js`
- `*.spec.ts`, `*.spec.tsx` (in scope if the repo adopts `.spec.*` naming)

## How tests are classified

Classification is by **content**, not filename alone, applied in this **precedence order** so every file lands in exactly one bucket:

1. **e2e** - real browser / end-to-end specs. A file qualifies if its path is under an `e2e/` directory, or its filename is `*.e2e.test.*` / `*.e2e.spec.*`, or its content imports `@playwright/test` or `playwright`. These are the specs behind a dedicated browser/prod-build CI job. The `playwright-cli` helper recordings under `.playwright-cli/` are not test files and are never counted.
   - Note: backend `*.e2e.integration.test.ts` workflow tests are **not** e2e here - they are node/vitest tests with no browser, do not sit under an `e2e/` dir, and do not import playwright. They match the `.integration.test.*` filename instead and fall through to **integration** (bucket 3). "e2e" in this skill means *browser* e2e.

2. **react-component** - renders React in jsdom. A file qualifies if its content imports `@testing-library/react` / `@testing-library/react-native`, uses `react-test-renderer`, calls `renderWithProviders` / `renderTeamScopedPage`, or imports from the local `integration/test-utils` module (which re-exports `@testing-library/react`). This is the repo's UI/component test surface: the `*.integration.test.tsx` page/component tests using `renderWithProviders`, the `*.test.tsx` component-unit tests, plus any `*.test.ts` hook tests that render via testing-library. Per the test policy, React component tests are predominantly `*.integration.test.tsx`; this content rule captures both kinds and the non-`.tsx` hook tests that a filename rule would miss.

3. **integration** - backend / API + DB integration tests. Anything whose filename is `*.integration.test.*` / `*.integration.spec.*` that was not already claimed as e2e or react-component. These run in the node env against a real Postgres schema and API child process. Includes the `*.e2e.integration.test.ts` backend workflow tests (Stripe webhook ordering, billing end-to-end, etc.).

4. **unit** - everything else among the test files (pure logic `*.test.ts` / `*.test.mjs` / `*.test.js`, plus any `.tsx` unit test that does not render React).

### db (pgtap) - reported separately

pgTAP DB-contract tests (`*.sql` under a `pgtap/` directory, e.g. `packages/infra/db/pgtap/`) are a distinct kind of test that `git ls-files` of the JS/TS globs does not pick up. Rather than silently drop them, the skill reports them as a separate `db` count below the main total (not folded into it, since mixing `.sql` row-counts with JS/TS file-counts would muddy the type census). `--no-repos` does not affect this bucket.

## Interpreting the output

| Pattern | What it means |
|---|---|
| A backend package (`packages/core`, `apps/api`) shows a non-zero `react-component` count | Likely a misplaced UI test, or a non-UI test importing testing-library by accident. Inspect via `--files react-component`. |
| `apps/web` / `apps/mobile` show near-zero `react-component` but many `unit` | UI surface is under-covered by rendering tests, or component logic was extracted into pure helpers tested as units. Worth a look. |
| `e2e` count drifts up materially | Browser specs are slow and run in the dedicated CI job - confirm new e2e tests are pulling their weight vs a cheaper react-component test (per the repo's test hierarchy, prefer `renderWithProviders` over Playwright). |
| `integration` dominates a package with no `unit` | Fine for thin API surfaces; for domain packages it can mean fast pure-logic paths are only covered indirectly. |

## Caveats

- `git ls-files` only sees tracked files. Uncommitted scratch tests are invisible by design.
- Classification reads file content with `grep`. If a new render helper or browser driver is adopted, add its signal to `REACT_RE` / `E2E_IMPORT_RE` in `count.sh`, or files will fall to the wrong bucket.
- The `db` bucket keys off the `pgtap/` path convention. A pgTAP file placed outside a `pgtap/` directory would be missed - add its path glob to `PGTAP` in `count.sh`.
- A `*.test.ts` in the `react-component` bucket is typically a React hook test (`@testing-library/react` `renderHook`) - correctly UI-rendering despite the `.ts` extension. Verify with `--files react-component`.
