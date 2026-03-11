import { renderResetSchemaSql } from '../../packages/testkit/src/reset-plan.js'

process.stdout.write(renderResetSchemaSql('public'))
