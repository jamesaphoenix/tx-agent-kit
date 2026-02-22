# Domain Invariants

Use this map when generating or reviewing CRUD slices.

## Layering
- `domain/`: entities, value objects, and pure rules only.
- `ports/`: capability interfaces only.
- `repositories/`: persistence adapters implementing ports.
- `services/`: use-case orchestration.
- `routes/`: transport binding from API layer.
- `__tests__/`: core + api behavioral tests.

## Validation + types
- Keep boundary validation in `effect/Schema` only.
- Keep IDs branded in schema files.

## Safety checks
- Prefer `--dry-run` before writes.
- Use `--force` only when replacing an existing scaffold intentionally.
