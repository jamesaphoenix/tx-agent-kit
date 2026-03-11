const preservedResetTableNames = [
  '__tx_agent_migrations',
  'permissions',
  'role_permissions',
  'roles',
  'system_settings'
] as const

const preservedResetTableNameSet = new Set<string>(preservedResetTableNames)

const quoteSqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`

export const filterResettableTableNames = (
  tableNames: ReadonlyArray<string>
): ReadonlyArray<string> =>
  tableNames.filter((tableName) => !preservedResetTableNameSet.has(tableName))

export const renderResetSchemaSql = (schemaName: string): string => {
  const preservedTableSql = preservedResetTableNames
    .map((tableName) => quoteSqlLiteral(tableName))
    .join(', ')

  return `
DO $$
DECLARE
  truncate_sql text;
BEGIN
  SELECT CASE
    WHEN COUNT(*) = 0 THEN NULL
    ELSE 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' RESTART IDENTITY CASCADE'
  END
  INTO truncate_sql
  FROM pg_tables
  WHERE schemaname = ${quoteSqlLiteral(schemaName)}
    AND tablename <> ALL (ARRAY[${preservedTableSql}]);

  IF truncate_sql IS NOT NULL THEN
    EXECUTE truncate_sql;
  END IF;
END $$;
`.trimStart()
}
