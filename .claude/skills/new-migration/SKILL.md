# new-migration

Create additive SQL migrations for Postgres.

## Rules
- Never edit historical migrations.
- Add a sequentially numbered `NNNN_snake_case.sql` file in
  `packages/infra/db/drizzle/migrations` (use `pnpm --filter @tx-agent-kit/db db:generate`).
- Migration numbers must be unique. If a merge produces two files with the same number
  (two branches both took `0050_*.sql`), renumber one - the migrator hard-errors on a
  collision (`assertUniqueMigrationPrefixes` in `packages/infra/db/src/sql-admin.ts`), and
  `pnpm lint` flags it too.
- Add rollback notes in PR description.
