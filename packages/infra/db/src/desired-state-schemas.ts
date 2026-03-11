import { renderPermissionReconcileSql } from '@tx-agent-kit/contracts'
import { renderSystemSettingsReconcileSql } from './system-settings-defaults.js'

export interface DesiredStateSchemaDefinition {
  readonly relativePath: string
  readonly renderSql: () => string
}

export const desiredStateSchemaDefinitions = [
  {
    relativePath: 'permissions/reconcile_role_permissions.sql',
    renderSql: renderPermissionReconcileSql
  },
  {
    relativePath: 'system-settings/reconcile_retention_settings.sql',
    renderSql: renderSystemSettingsReconcileSql
  }
] as const satisfies ReadonlyArray<DesiredStateSchemaDefinition>
