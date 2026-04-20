# GitHub Actions Todo

This folder stores imported workflow patterns from `tx-agent-kit-services` for adaptation.
They are intentionally not under `.github/workflows` yet.

## Imported
- `tx-agent-kit-services/lint-check.yml`
- `tx-agent-kit-services/type-check.yml`
- `tx-agent-kit-services/fast-tests.yml`
- `tx-agent-kit-services/integration-tests.yml`
- `tx-agent-kit-services/lockfile-check.yml`
- `tx-agent-kit-services/native-deps-check.yml`
- `tx-agent-kit-services/weekly-eslint-scan.yml`

## Next steps
1. Replace package filters with `@tx-agent-kit/*` package names.
2. Replace Supabase/tx-agent-kit-specific steps with `pnpm infra:ensure` and `pnpm db:test:reset`.
3. Move one workflow at a time into `.github/workflows` after validation.
