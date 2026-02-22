import { v7 as uuidv7, validate as validateUuid, version as uuidVersion } from 'uuid'

const defaultDatabaseUrl = 'postgres://postgres:postgres@localhost:5432/tx_agent_kit'

export const createTestRunId = (): string => uuidv7()

export const isValidTestRunId = (value: string): boolean =>
  validateUuid(value) && uuidVersion(value) === 7

export const compactTestRunId = (testRunId: string): string =>
  testRunId.toLowerCase().replace(/[^a-z0-9]/g, '')

export const createTestCaseId = (testRunId: string, caseName: string): string => {
  const normalizedCase = caseName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const fallbackCaseName = normalizedCase.length > 0 ? normalizedCase : 'case'
  return `${testRunId}:${fallbackCaseName}`
}

export const buildSchemaName = (
  testRunId: string,
  prefix = 'test'
): string => {
  const sanitizedPrefix = prefix.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  const sanitizedRunId = compactTestRunId(testRunId)
  const candidate = `${sanitizedPrefix}_${sanitizedRunId}`
  return candidate.slice(0, 63)
}

export const buildSchemaDatabaseUrl = (
  baseDatabaseUrl: string,
  schemaName: string
): string => {
  const url = new URL(baseDatabaseUrl || defaultDatabaseUrl)
  // Use `-csearch_path=...` (no space) for compatibility across pg connection-string parsers.
  const searchPathFlag = `-csearch_path=${schemaName},public`
  const existingOptions = url.searchParams.get('options')

  if (!existingOptions || existingOptions.trim().length === 0) {
    url.searchParams.set('options', searchPathFlag)
    return url.toString()
  }

  const searchPathPattern = /(?:-c\s*search_path=[^\s]+|-csearch_path=[^\s]+)/
  if (searchPathPattern.test(existingOptions)) {
    url.searchParams.set('options', existingOptions.replace(searchPathPattern, searchPathFlag))
    return url.toString()
  }

  url.searchParams.set('options', `${existingOptions.trim()} ${searchPathFlag}`)
  return url.toString()
}

export const defaultTestDatabaseUrl = defaultDatabaseUrl
