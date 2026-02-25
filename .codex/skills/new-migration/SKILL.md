---
name: new-migration
description: Create additive Postgres migrations for tx-agent-kit database changes.
metadata:
  short-description: Database migration workflow
---

# new-migration

Create additive SQL migrations for Postgres.

## Rules
- Never edit historical migrations.
- Add timestamp-prefixed file in `packages/infra/db/drizzle/migrations`.
- Add rollback notes in PR description.
