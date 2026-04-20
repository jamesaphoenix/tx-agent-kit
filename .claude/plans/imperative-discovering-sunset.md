# Duplication Audit: Full Stack Analysis (Research Only)

## Context

Deep audit of duplication across 8 layers of the Octospark monorepo conducted 2026-04-06. Research findings for future reference — no implementation planned yet.

## Architecture: Contracts as Source of Truth

The current setup is correct: `packages/contracts/src/literals.ts` defines all enum/literal types. Everything downstream imports from it:
- DB schema (`pgEnum` imports from contracts)
- Effect schemas (import same literals)
- API (Effect HttpApi uses contract schemas)
- Frontend (Orval generates from OpenAPI spec derived from contracts)

**Effect schema codegen (`@handfish/drizzle-effect`) was evaluated and rejected** — marginal gain, adds dependency, and 10/28 schemas have custom JSONB typing that still needs manual override.

## Priority-Ranked Findings

### 1. Repositories — BIGGEST WIN (40-50% boilerplate, ~1,400-2,000 LOC)
- 23 repo files, no base class or generic helpers
- Same `findById`, `create`, `update`, cursor pagination, soft-delete, prune patterns repeated 15+ times
- Fix: Create `repo-helpers.ts` with generic composable functions
- Estimated savings: 800-1,200 LOC

### 2. Frontend Hardcoded Enums (4+ files)
- `'admin' | 'member'` and `'pending' | 'accepted' | 'revoked' | 'expired'` hardcoded in client-api.ts, CreateInvitationForm.tsx, invitations/page.tsx
- `MyPermissionsResponse` interface duplicated (exists in contracts already)
- Fix: Import `InvitationAssignableRole`, `InvitationStatus` etc. from contracts

### 3. Route Handlers (~400-500 LOC boilerplate)
- ~70 handlers repeat auth + error mapping + service injection
- Pagination response shape repeated ~12 times
- Fix: `withAuth()`, `listResponse()`, `withTeamPermission()` helpers in `apps/api/src/route-helpers.ts`

### 4. Service Layer (40-45% boilerplate)
- 147 `Effect.mapError()` calls, 30+ null-check patterns, 17+ auth checks
- Fix: `requireFound()`, `requireOwnership()`, `requireRole()` in `packages/core/src/shared/effect-utils.ts`

### 5. Orval Hooks — Keep Generating (migration planned)
- 2,948 lines of React Query hooks generated but unused
- Custom `clientApi` Axios wrapper is current approach
- Decision: Will migrate to Orval hooks eventually, keep generating for now

### 6. API Mappers — DEFER
- 4/6 mappers are pure field passthrough + date-to-ISO
- Only auth-mapper and asset-mapper add real value
- Not worth refactoring — stable, low-churn files

### 7-9. Effect Schemas, Factories, Tests — SKIP
- Effect schemas: not worth automating (contracts is already SSOT)
- Factories: fix missing fields only (ownerUserId, usageCap, disabledAt, isSystem)
- Tests: testkit well-designed, minor improvements only
- Bug found: `storage-metering.ts` effect schema missing `highWaterMarkBytes` field
