---
name: data-retention
description: Manage data retention policies for database tables. Use when adding a new table to automated pruning, modifying retention periods, or understanding which tables are excluded.
argument-hint: <table-name>
---

# Data Retention Policy Management

Manage the automated data retention system that prunes expired/terminal rows from database tables on a Temporal schedule.

## Architecture

The retention system has four layers:

1. **Contract registry** -- `packages/contracts/src/literals.ts` exports `retentionTableNames`, the single source of truth for which tables participate in retention.
2. **Migration seed** -- `packages/infra/db/drizzle/migrations/0027_system_settings.sql` seeds the `system_settings` table with a `retention_settings` JSON key containing per-table `{ enabled, retention_days }` config.
3. **Repository prune methods** -- Each participating table's repository exposes a `prune*` method (e.g. `pruneExpired`, `pruneProcessed`, `pruneTerminal`, `prunePublished`) that deletes rows older than a given date.
4. **Temporal schedule + workflow** -- The worker registers a `dataRetentionWorkflow` on a 24-hour Temporal schedule (`ensureDataRetentionSchedule` in `apps/worker/src/schedules.ts`). The workflow reads `retention_settings` from `system_settings` at runtime and calls each table's prune activity.

### Runtime config

The `system_settings` table stores retention config as JSONB under the key `retention_settings`:

```json
{
  "auth_login_sessions": { "enabled": true, "retention_days": 90 },
  "auth_refresh_tokens": { "enabled": true, "retention_days": 90 },
  "auth_oidc_states": { "enabled": true, "retention_days": 7 },
  "auth_password_reset_tokens": { "enabled": true, "retention_days": 30 },
  "auth_login_audit_events": { "enabled": true, "retention_days": 365 },
  "subscription_events": { "enabled": true, "retention_days": 90 },
  "domain_events": { "enabled": true, "retention_days": 30 },
  "invitations": { "enabled": true, "retention_days": 180 }
}
```

Operators can change `enabled` or `retention_days` at runtime via a direct `UPDATE` to `system_settings` without redeployment.

### Enforcement

Rule 11 in `scripts/lint/enforce-domain-event-contracts.mjs` verifies every table listed in `retentionTableNames` has a matching `"<table_name>"` entry in the migration seed. Running `pnpm lint` will catch mismatches.

## Steps -- Adding a New Table to Retention

### 1. Register the table in contracts

**File:** `packages/contracts/src/literals.ts`

Add the table name to the `retentionTableNames` array:

```typescript
export const retentionTableNames = [
  'auth_login_sessions',
  // ... existing entries ...
  '$ARGUMENTS'
] as const
```

### 2. Add entry to the migration seed

**File:** `packages/infra/db/drizzle/migrations/0027_system_settings.sql`

Add a new line inside the `retention_settings` JSON value with appropriate defaults:

```json
"$ARGUMENTS": { "enabled": true, "retention_days": 90 }
```

Choose `retention_days` based on the data's lifecycle:
- Short-lived tokens/states: 7--30 days
- Session/transactional data: 90 days
- Audit trails: 365 days
- Terminal/completed records: 180 days

### 3. Add a prune method to the repository

**File:** `packages/infra/db/src/repositories/<table-name>.ts`

Add a method following the existing pattern. The method name convention is:

| Data type | Method name |
|-----------|-------------|
| Rows with `expiresAt` | `pruneExpired(olderThan: Date)` |
| Rows with terminal status | `pruneTerminal(olderThan: Date)` |
| Rows with `processedAt` | `pruneProcessed(olderThan: Date)` |
| Published outbox events | `prunePublished(olderThan: Date)` |

Example:

```typescript
pruneExpired: (olderThan: Date) =>
  provideDB(
    Effect.gen(function* () {
      const db = yield* DB
      const rows = yield* db
        .delete(<tableName>)
        .where(lt(<tableName>.expiresAt, olderThan))
        .returning({ id: <tableName>.id })
        .execute()

      return rows.length
    })
  ).pipe(Effect.mapError((error) => toDbError('Failed to prune expired <table>', error)))
```

### 4. Wire the prune call in worker activities

**File:** `apps/worker/src/activities.ts`

Add a new activity that imports the repository and calls the prune method:

```typescript
prune<PascalTableName>: async (retentionDays: number): Promise<number> => {
  const olderThan = new Date(Date.now() - retentionDays * 24 * 60 * 60_000)
  const result = await runEffect(
    <tableRepository>.prune<Method>(olderThan)
  )
  if (result > 0) {
    logger.info('Pruned old <table-name> rows.', { deleted: result, retentionDays })
  }
  return result
}
```

### 5. Call the activity from the retention workflow

**File:** `apps/worker/src/workflows.ts`

Add the activity proxy and call it inside `dataRetentionWorkflow`:

```typescript
const { prune<PascalTableName> } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3, initialInterval: '1 second' }
})
```

Inside `dataRetentionWorkflow`, call the new activity for the table.

### 6. Verify

```bash
pnpm lint        # Rule 11 checks contract-to-migration parity
pnpm type-check  # types pass
pnpm test        # unit tests pass
```

## Steps -- Modifying Retention Periods

### At deployment time (default for new environments)

Edit the JSON in `packages/infra/db/drizzle/migrations/0027_system_settings.sql`. The seed uses `ON CONFLICT (key) DO NOTHING`, so it only applies to fresh databases.

### At runtime (existing environments)

```sql
UPDATE system_settings
SET value = jsonb_set(
  value,
  '{"auth_login_sessions", "retention_days"}',
  '180'
),
updated_at = now()
WHERE key = 'retention_settings';
```

The next scheduled `dataRetentionWorkflow` run will pick up the new value.

### Disabling retention for a table

```sql
UPDATE system_settings
SET value = jsonb_set(
  value,
  '{"auth_login_sessions", "enabled"}',
  'false'
),
updated_at = now()
WHERE key = 'retention_settings';
```

## Tables Excluded from Retention

The following tables are **never** pruned and must **not** be added to `retentionTableNames`:

| Table | Reason |
|-------|--------|
| `usage_records` | Financial audit trail -- required for billing reconciliation and dispute resolution |
| `credit_ledger` | Financial audit trail -- immutable ledger of credit transactions |

The migration seed description explicitly states: *"Tables not listed (usage_records, credit_ledger) are financial audit trails and must never be pruned."*

If you need to archive old financial data, implement a separate archive-to-cold-storage strategy rather than deletion.

## Reference Files

| File | Role |
|------|------|
| `packages/contracts/src/literals.ts` | `retentionTableNames` registry |
| `packages/infra/db/drizzle/migrations/0027_system_settings.sql` | Retention config seed |
| `packages/infra/db/src/repositories/system-settings.ts` | `getRetentionSettings()` reader |
| `packages/infra/db/src/repositories/*.ts` | Per-table `prune*` methods |
| `apps/worker/src/activities.ts` | Prune activity implementations |
| `apps/worker/src/workflows.ts` | `dataRetentionWorkflow` orchestration |
| `apps/worker/src/schedules.ts` | `ensureDataRetentionSchedule` registration |
| `packages/infra/db/src/schema.ts` | Table definitions |
| `scripts/lint/enforce-domain-event-contracts.mjs` | Rule 11 enforcement |
