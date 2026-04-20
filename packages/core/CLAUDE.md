# Core Package — Domain-Driven Design with Effect

## Domain Layer Rules

### Type Safety
- Domain records MUST extend their DB row shape (`extends TeamMediaAssetRowShape` or `type X = RowShape`)
- Standalone `interface` declarations are banned — ESLint enforces this
- Use `Omit<RowShape, 'field'>` to narrow JSONB or exclude internal fields
- Use `Pick<RowShape, ...>` for subsets

### Effect in Domain Layer
- **ALLOWED:** `Either`, `Option`, `pipe`, `Data`, `Match` (pure data utilities)
- **BLOCKED:** `Effect`, `Layer`, `Context`, `Fiber`, `Runtime` (DI/async — belongs in application layer)
- `throw` is banned — use Either for typed failures, Option for absence

### When to use Either vs Option vs plain return
- **Either** — operation can fail in multiple typed ways (validation, authorization)
- **Option** — value might not exist (computed fields, lookups)
- **Plain return** — always succeeds (deriveAssetType, normalizeEmail, boolean guards)
- **Boolean** — simple yes/no checks (isProcessing, canManageMembers)

### Example: Either for validation
```typescript
import { Either } from 'effect'

type ValidationError =
  | { code: 'EMPTY_NAME' }
  | { code: 'NAME_TOO_LONG'; maxLength: number }

const validateName = (name: string): Either.Either<string, ValidationError> => {
  const trimmed = name.trim()
  if (trimmed.length === 0) return Either.left({ code: 'EMPTY_NAME' })
  if (trimmed.length > 64) return Either.left({ code: 'NAME_TOO_LONG', maxLength: 64 })
  return Either.right(trimmed)
}
```

### Example: Option for nullable computed values
```typescript
import { Option } from 'effect'

const aspectRatio = (asset: MediaAssetRecord): Option.Option<string> => {
  const data = asset.assetTypeData
  if (!data || !('width' in data)) return Option.none()
  return Option.some(`${data.width}:${data.height}`)
}
```

### Aggregates — combining multiple tables

When a domain record needs data from multiple tables, use one of these strategies:

**Strategy A: Extends + extra fields** (one primary table with joined fields)
```typescript
// OrgMember is primarily from org_members, with joined user data
export interface OrgMemberRecord extends OrgMemberRowShape {
  userName?: string | null    // from users table (joined)
  userEmail?: string | null   // from users table (joined)
}
```

**Strategy B: Composition** (multiple independent records)
```typescript
// Dashboard combines multiple records — no single primary table
export interface TeamDashboard {
  team: TeamRecord
  assetCount: number
  memberCount: number
  recentAssets: ReadonlyArray<MediaAssetRecord>
}
```

**Strategy C: Intersection** (flat object from multiple tables)
```typescript
export type AssetWithOwner = MediaAssetRecord & {
  ownerName: string     // from users via team_members
  teamName: string      // from teams
}
```

Use **A** for "one table + a few joins", **B** for multi-table composites, **C** for flat denormalized views.

Aggregate type names should use suffixes: `Aggregate`, `View`, `Dashboard` (allowed by ESLint).

The **repository** handles the SQL joins — the service receives the fully assembled aggregate.
The **port** defines the aggregate return type — the adapter maps the joined query result.

### Application Layer (services)
- Uses full `Effect` runtime (`Effect.gen`, `yield*`, `Layer`)
- Bridges domain Either/Option to Effect: `Either.isLeft(result) → Effect.fail(...)`
- Depends on ports (abstract interfaces), never on adapters or repositories directly

### Adapter Layer
- Implements ports using real infrastructure (@tx-agent-kit/db, @tx-agent-kit/storage)
- Maps DB row shapes → domain records (via `as DomainRecord` cast since domain extends row shape)
- Maps domain types → DB types on write (JSONB narrowing)

### Ports
- Abstract interfaces defined as `Context.Tag`
- The contract between domain logic and infrastructure
- Swappable for testing — mock the port, not the database

### Cross-Domain Events (`events.ts`)
- Each domain's public contract lives at `domains/<domain>/events.ts` (at domain root, peer to `domain/`, `ports/`)
- Contains event type discriminants, typed payload shapes, version constants
- This is the **ONLY** file other domains may import from a sibling domain
- ESLint + structural lint enforce this — all other cross-domain imports are blocked
- Internal event payload definitions stay in `domain/*-events.ts`; `events.ts` re-exports them

### Error Boundaries
- **Domain errors** (rich typed ADTs) stay internal — never imported cross-domain
- **Port errors** are seam-specific: translate internal errors into what the consumer needs
- **Application layer** composes and remaps into `CoreError` (`packages/core/src/errors.ts`)
- **API layer** does final HTTP translation via `mapCoreError`
- If Domain B needs to handle a failure from Domain A, use a translated port error, not Domain A's internal error taxonomy

### Constants
- Centralized in `packages/contracts/src/constants.ts` (`@tx-agent-kit/contracts`)
- Magic numbers (timeouts, limits, batch sizes) go there, not inline in services
