# Octospark Infrastructure Portability — 2026-06 Wave (target: tx-agent-kit)

> Repo role: **target**. Source/coordinator: `../octospark` (audit source-of-truth).
> Companion JSON in this repo: `octospark-infra-portability-2026-06.progress.json`.
> Canonical inventory: `../octospark/docs/goals/octospark-infra-portability-2026-06.inventory.json`.

## Objective

Port the generalizable infrastructure, observability (logging / traces / metrics), deployment,
test-harness, and bug-fix hardening that landed in the source repo between **2026-06-07 and
2026-06-21** into THIS repo, adapting to its layout, package scopes (`@tx-agent-kit/*`), ports,
env conventions, and deployment topology — WITHOUT importing product behavior.

This is **wave 2**. Wave 1 (May audit) already landed via `infra-port-from-octospark`. Only the
delta since that cutoff is in scope. Source-of-truth branch for diffs: `origin/staging`.

## Non-Goals

- No product logic: social publishing, billing/credits, composer, marketing/SEO, feature-board,
  asset/media product, provider business rules. No public CLI/MCP/SDK product packages or the
  product skill bundle.
- The literal source product token must NOT appear in committed file CONTENT (product-leak lint).
  `docs/goals/**` is exempt. Commit messages and branch names may reference it.
- No plaintext secrets, generated `.env`, browser auth state, or runtime artifacts in git.

## Approval

James approved broad implementation. Implement every inventory candidate whose `targets`
includes `tx-agent-kit` and whose `porting_decision` is `port_now` or `adapt_carefully`.
`verify_only` = confirm present, no change. `needs_follow_up` / `leave` = document only.

## Delivery

- Branch `infra-port-from-octospark-2026-06` off clean `main`.
- PR-A = core infra port (all slices except auto-fix); PR-B = auto-fix subsystem.
- Surgical commits (explicit `git add`, never `git add -A`); each references the source hash.
  Push → draft PR → `pnpm ci:check --watch` → resolve red → un-draft.

## Work Slices

See the coordinator goal doc / inventory for the full 14-slice list. Each slice ≈ one inventory
category; implement, validate with the ladder below, then update `.progress.json`.

## Validation Ladder (full gates — confirmed)

1. `pnpm --filter <pkg> type-check` + touched-file ESLint.
2. `pnpm lint` (ESLint + structural invariants + shell + jscpd) — full.
3. `pnpm type-check` — full.
4. `pnpm test` (unit) — full.
5. `pnpm infra:ensure` then full `pnpm test:integration` — real local infra.
6. Generated-artifact checks where touched; `pnpm test:db:pgtap` where DB.
7. `bash -n` + workflow syntax for touched shell/CI; compose health where deploy touched.
8. After push: `pnpm ci:check --watch`; resolve red. Deploy/CI items need real workflow evidence
   or are recorded as a remaining risk.

## Acceptance Criteria

- Approved candidates implemented, validated, documented, pushed; PR CI green or red explained.
- Changes are generic infra, or the adaptation is documented.
- Local dev startup reliable; integration tests run against full infra; generated files current;
  no plaintext secrets / runtime artifacts committed.
- `octospark-infra-portability-2026-06-migration-report.md` documents ported / intentionally-
  unported / adapted changes, validation + CI evidence, remaining risks, and follow-ups.

## Status

- Goal captured: 2026-06-21
- Branch: `infra-port-from-octospark-2026-06` created
- Implementation: not started
