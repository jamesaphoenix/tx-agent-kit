# GitHub Actions Todo

This folder stores imported workflow patterns from `octospark-services` for adaptation.
They are intentionally not under `.github/workflows` yet.

## Imported
- `octospark-services/lint-check.yml`
- `octospark-services/type-check.yml`
- `octospark-services/fast-tests.yml`
- `octospark-services/integration-tests.yml`
- `octospark-services/lockfile-check.yml`
- `octospark-services/native-deps-check.yml`
- `octospark-services/weekly-eslint-scan.yml`

## Next steps
1. Replace package filters with `@tx-agent-kit/*` package names.
2. Replace Supabase/OctoSpark-specific steps with `pnpm infra:ensure` and `pnpm db:test:reset`.
3. Move one workflow at a time into `.github/workflows` after validation.
