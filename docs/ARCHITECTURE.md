# Architecture

- `apps/web`: Next.js UI + auth pages.
- `apps/api`: Effect HttpApi server for auth/tasks/workspaces/invitations.
- `apps/worker`: Temporal worker + workflows.
- `packages/db`: Drizzle schema, client, repositories, migrations.
- `packages/db/src/effect-schemas`: Table-aligned Effect schemas (one schema per table).
- `packages/core`: Effect services composing db/auth behavior.
- `packages/auth`: Password and JWT primitives.
- `packages/contracts`: Shared API schemas and types.
- `packages/observability`: OpenTelemetry bootstrap helpers.
- `OpenAPI.yml`: API contract + closed DDD invariants for auth/workspaces/invitations/tasks.
