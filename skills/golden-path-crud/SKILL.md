---
name: golden-path-crud
description: Scaffold a new CRUD slice in tx-agent-kit using the fixed layering domain -> ports -> repositories -> services -> routes -> tests with Effect Schema invariants and generated tests. Use this when asked to create or regenerate a CRUD domain/entity quickly and safely.
---

# Golden Path CRUD

## Workflow
1. Validate arguments are present: `--domain <name>` and `--entity <name>`.
2. Preview planned files first:
   - `./skills/golden-path-crud/scripts/scaffold-crud.sh --domain <domain> --entity <entity> --dry-run`
3. Apply scaffold:
   - `./skills/golden-path-crud/scripts/scaffold-crud.sh --domain <domain> --entity <entity>`
4. Regenerate over existing files only when requested:
   - add `--force`
5. Run verification commands:
   - `pnpm --filter @tx-agent-kit/scaffold test`
   - `pnpm api:client:generate`
   - `pnpm lint:quiet`
   - `pnpm type-check:quiet`

## Command contract
- The wrapper script must be run from the repository root.
- The scaffold command writes to:
  - `packages/core/src/domains/<domain>/...`
  - `apps/api/src/domains/<domain>/...`
- The scaffold always generates tests in both layers.

## Guardrails
- Keep generated code on `effect/Schema`; do not add Zod.
- Keep dependency direction unchanged. See `references/invariants.md`.
- Keep `crud` intent explicit:
  - repositories declare `export const <Name>RepositoryKind = 'crud' as const`
  - routes declare `export const <Name>RouteKind = 'crud' as const`
- Do not hand-edit generated files before first verification run.

## Output expectations
A successful run should produce:
- Domain entities/contracts
- Port interfaces
- Repository implementation stubs
- Service orchestration stubs
- API route adapters
- Layer barrels and root exports
- CRUD tests for core + api
