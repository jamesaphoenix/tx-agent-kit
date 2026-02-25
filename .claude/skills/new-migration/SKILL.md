# new-migration

Create additive SQL migrations for Postgres.

## Rules
- Never edit historical migrations.
- Add timestamp-prefixed file in `packages/infra/db/drizzle/migrations`.
- Add rollback notes in PR description.
