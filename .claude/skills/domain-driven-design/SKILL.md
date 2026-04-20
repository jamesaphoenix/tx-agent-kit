# Domain-Driven Design Skill

Guide for implementing domain entities, services, and ports following the project's DDD conventions.

## When to use
- Creating a new domain entity
- Adding domain validation logic
- Implementing a new application service
- Adding ports and adapters

## Domain Record Pattern
Domain records extend their DB row shape:
```typescript
// CORRECT — extends row shape
import type { TeamMediaAssetRowShape } from '@tx-agent-kit/db'
export interface MediaAssetRecord extends Omit<TeamMediaAssetRowShape, 'assetTypeData'> {
  readonly assetTypeData: AssetTypeData | null
}

// WRONG — standalone interface (ESLint will block this)
export interface MediaAssetRecord {
  id: string
  teamId: string
  // ... manually listing all fields
}
```

## Domain Functions
- Use `Either` for validation with typed errors
- Use `Option` for computed values that might not exist
- Use plain returns for boolean guards and string transforms
- Never `throw` — failures are values

## New Entity Checklist
1. Add table to `packages/infra/db/src/schema.ts`
2. Add migration SQL
3. Add effect-schema for runtime row validation
4. Add factory for tests
5. Add domain record that extends row shape in `packages/core/src/domains/<domain>/domain/`
6. Add ports in `packages/core/src/domains/<domain>/ports/`
7. Add application service in `packages/core/src/domains/<domain>/application/`
8. Add adapter in `packages/core/src/domains/<domain>/adapters/`
9. Add API mapper in `apps/api/src/mappers/`
10. Add route handlers in `apps/api/src/routes/`
11. Add contract schemas in `packages/contracts/src/`
12. Wire into `apps/api/src/server-lib.ts`
13. Export from `packages/core/src/index.ts`
14. Run `pnpm type-check && pnpm lint:quiet && pnpm test:quiet`

## Aggregates (multi-table records)
- **Extends + extra fields** — one primary table with optional joined fields (`OrgMemberRecord extends OrgMemberRowShape { userName?: string }`)
- **Composition** — multiple records wrapped in a container type (`TeamDashboard { team: TeamRecord; assetCount: number }`)
- **Intersection** — flat union of multiple row shapes (`AssetWithOwner = MediaAssetRecord & { ownerName: string }`)
- Use suffixes: `Aggregate`, `View`, `Dashboard` (allowed by ESLint for standalone interfaces)
- The repository writes the SQL joins; the service receives the assembled aggregate

## Cross-Domain Boundaries

**Events are public nouns. Ports are public verbs. Errors are private semantics.**

### Event contracts
- Each domain has a public `events.ts` at its root: `packages/core/src/domains/<domain>/events.ts`
- This is the **ONLY** file other domains may import from a sibling domain
- Contains: event type discriminants, typed payload shapes, version constants
- Internal payload definitions stay in `domain/*-events.ts`; `events.ts` re-exports them
- ESLint + structural lint enforce this — all other cross-domain imports are blocked

### Error architecture
- Rich typed ADT errors inside a domain (use `Either`): **yes**
- Cross-domain import of another domain's errors: **no**
- Translate errors at seams — ports define their own consumer-facing error types
- Application layer composes domain errors into `CoreError`

```typescript
// BAD — cross-domain error coupling:
import { OrganizationNotFoundError } from '../../organization/domain/organization-errors.js'

// GOOD — translated at the port seam:
type LoadOrganizationForAssetError =
  | { _tag: 'OrganizationMissing' }
  | { _tag: 'OrganizationUnavailable' }
```

## Constants
Centralized in `packages/contracts/src/constants.ts` (import from `@tx-agent-kit/contracts`).
Never hardcode magic numbers in services — import from contracts.

## Full domain layer guide
See `packages/core/CLAUDE.md` for detailed rules, examples, and patterns.
