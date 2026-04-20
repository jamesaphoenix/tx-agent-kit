import { renderResetSchemaSql } from '../../packages/testkit/src/reset-plan.js'

// Reset the test schema for this checkout. Worktrees set DATABASE_SCHEMA to
// `wt_<name>` via setup.sh; the primary checkout leaves it unset and falls
// through to `public`. Without this, worktree integration tests accumulate
// data across runs and collide on hardcoded test fixtures (emails, org names).
const schemaName = process.env.DATABASE_SCHEMA ?? 'public'
process.stdout.write(renderResetSchemaSql(schemaName))
