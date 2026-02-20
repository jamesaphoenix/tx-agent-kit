# Architecture

- `apps/web`: Next.js UI + auth pages.
- `apps/api`: Effect HttpApi server for auth/tasks/workspaces/invitations.
- `apps/worker`: Temporal worker + workflows.
- `packages/db`: Drizzle schema, client, repositories, migrations.
- `packages/db/src/effect-schemas`: Table-aligned Effect schemas (one schema per table).
- `packages/core`: Effect services composing db/auth behavior.
- `packages/core/src/domains/*`: DDD slices (`domain -> ports -> repositories/adapters -> services -> runtime/ui`).
- `packages/auth`: Password and JWT primitives.
- `packages/logging`: Structured JSON logger helpers (mandatory over `console.*`).
- `packages/contracts`: Shared API schemas and types.
- `packages/observability`: OpenTelemetry bootstrap helpers.
- `apps/api/openapi.json`: generated API contract + closed DDD invariants for auth/workspaces/invitations/tasks.
