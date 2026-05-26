import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import {
  agentClientSurfaceExclusionPolicy,
  agentClientSurfaceProjectConfig
} from '../packages/contracts/src/agent-client-surface.policy.js'
import type {
  AgentClientOpenApiParameterLocation,
  AgentClientSurfaceExclusion,
  AgentClientSurfaceOpenApiParameter,
  AgentClientSurfaceOpenApiSchema,
  AgentClientSurfaceOperation
} from '../packages/contracts/src/agent-client-surface.js'

interface OpenApiOperation {
  readonly operationId: string
  readonly method: string
  readonly path: string
  readonly schema: AgentClientSurfaceOpenApiSchema
}

interface GeneratedSurfacePayload {
  readonly generatedFrom: {
    readonly openapi: string
    readonly policy: string
  }
  readonly operations: readonly AgentClientSurfaceOperation[]
  readonly exclusions: readonly AgentClientSurfaceExclusion[]
}

const repoRoot = resolve(import.meta.dirname, '..')
const openApiPath = resolve(repoRoot, 'apps/api/openapi.json')
const generatedTsPath = resolve(repoRoot, 'packages/contracts/src/agent-client-surface.generated.ts')
const generatedJsonPath = resolve(repoRoot, 'packages/contracts/src/agent-client-surface.generated.json')
const check = process.argv.includes('--check')

const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'])
const mutationMethods = new Set(['DELETE', 'PATCH', 'POST', 'PUT'])

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

const readArray = (value: Readonly<Record<string, unknown>>, key: string): readonly unknown[] =>
  Array.isArray(value[key]) ? value[key] : []

const readRecord = (
  value: Readonly<Record<string, unknown>>,
  key: string
): Readonly<Record<string, unknown>> | null => {
  const field = value[key]
  return isRecord(field) ? field : null
}

const readString = (value: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const field = value[key]
  return typeof field === 'string' ? field : undefined
}

const normalizeParameter = (value: unknown): AgentClientSurfaceOpenApiParameter | null => {
  if (!isRecord(value)) {
    return null
  }

  const name = readString(value, 'name')
  const location = readString(value, 'in')
  if (
    name === undefined ||
    (location !== 'path' && location !== 'query' && location !== 'header' && location !== 'cookie')
  ) {
    return null
  }

  const description = readString(value, 'description')
  return {
    name,
    in: location as AgentClientOpenApiParameterLocation,
    required: value.required === true,
    ...(description === undefined ? {} : { description })
  }
}

const normalizeOpenApiSchema = (
  pathItem: Readonly<Record<string, unknown>>,
  operation: Readonly<Record<string, unknown>>
): AgentClientSurfaceOpenApiSchema => {
  const parameters = [
    ...readArray(pathItem, 'parameters'),
    ...readArray(operation, 'parameters')
  ].flatMap((parameter) => {
    const normalized = normalizeParameter(parameter)
    return normalized === null ? [] : [normalized]
  })

  const requestBody = readRecord(operation, 'requestBody')
  const requestContent = requestBody === null ? null : readRecord(requestBody, 'content')
  const responses = readRecord(operation, 'responses')

  return {
    parameters: {
      path: parameters.filter((parameter) => parameter.in === 'path'),
      query: parameters.filter((parameter) => parameter.in === 'query'),
      header: parameters.filter((parameter) => parameter.in === 'header'),
      cookie: parameters.filter((parameter) => parameter.in === 'cookie')
    },
    requestBody: requestBody === null
      ? null
      : {
          required: requestBody.required === true,
          contentTypes: Object.keys(requestContent ?? {}).sort((left, right) => left.localeCompare(right))
        },
    responseStatuses: Object.keys(responses ?? {}).sort((left, right) => left.localeCompare(right))
  }
}

const collectOpenApiOperations = (): ReadonlyMap<string, OpenApiOperation> => {
  const document = readJson<{ readonly paths?: Record<string, Readonly<Record<string, unknown>>> }>(openApiPath)
  const operations = new Map<string, OpenApiOperation>()

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!httpMethods.has(method) || !isRecord(operation) || typeof operation.operationId !== 'string') {
        continue
      }

      operations.set(operation.operationId, {
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        schema: normalizeOpenApiSchema(pathItem, operation)
      })
    }
  }

  return operations
}

const toRegExp = (pattern: string | undefined): RegExp | undefined =>
  pattern === undefined ? undefined : new RegExp(pattern, 'u')

const matchesExclusion = (
  operation: OpenApiOperation,
  exclusion: {
    readonly operationIdPattern?: string
    readonly pathPattern?: string
  }
): boolean => {
  const operationPattern = toRegExp(exclusion.operationIdPattern)
  const pathPattern = toRegExp(exclusion.pathPattern)
  return (operationPattern?.test(operation.operationId) ?? false) ||
    (pathPattern?.test(operation.path) ?? false)
}

const camelToSnake = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toLowerCase()

const snakeToKebab = (value: string): string => value.replaceAll('_', '-')

const operationIdToKey = (operationId: string): string =>
  operationId.split('.').map(camelToSnake).join('.')

const operationIdToCliCommand = (operationId: string): string => {
  const [group, action] = operationId.split('.')
  return [group, action]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .map((part) => snakeToKebab(camelToSnake(part)))
    .join(' ')
}

const operationIdToMcpTool = (operationId: string): string =>
  `${agentClientSurfaceProjectConfig.mcpToolPrefix}_${operationIdToKey(operationId).replaceAll('.', '_')}`

const toGeneratedOperation = (operation: OpenApiOperation): AgentClientSurfaceOperation => {
  const mutating = mutationMethods.has(operation.method)
  return {
    key: operationIdToKey(operation.operationId),
    apiOperationId: operation.operationId,
    apiMethod: operation.method,
    apiPath: operation.path,
    schema: operation.schema,
    apiStatus: 'implemented',
    admin: operation.path.startsWith('/v1/admin/'),
    cliCommand: operationIdToCliCommand(operation.operationId),
    mcpTool: operationIdToMcpTool(operation.operationId),
    mutating,
    requiresConfirmation: mutating
  }
}

const normalizeExclusions = (
  openApiOperations: ReadonlyMap<string, OpenApiOperation>
): readonly AgentClientSurfaceExclusion[] =>
  agentClientSurfaceExclusionPolicy.map((exclusion) => {
    if (exclusion.operationIdPattern === undefined && exclusion.pathPattern === undefined) {
      throw new Error(`Agent surface exclusion ${exclusion.category} must define operationIdPattern or pathPattern.`)
    }

    const matchedOperationIds = Array.from(openApiOperations.values())
      .filter((operation) => matchesExclusion(operation, exclusion))
      .map((operation) => operation.operationId)
      .sort((left, right) => left.localeCompare(right))

    return {
      ...exclusion,
      matchedOperationIds
    } satisfies AgentClientSurfaceExclusion
  })

const normalizeOperations = (
  openApiOperations: ReadonlyMap<string, OpenApiOperation>,
  exclusions: readonly AgentClientSurfaceExclusion[]
): readonly AgentClientSurfaceOperation[] =>
  Array.from(openApiOperations.values())
    .filter((operation) => !exclusions.some((exclusion) => matchesExclusion(operation, exclusion)))
    .map(toGeneratedOperation)
    .sort((left, right) => left.key.localeCompare(right.key))

const assertGeneratedOpenApiCoverage = (
  openApiOperations: ReadonlyMap<string, OpenApiOperation>,
  operations: readonly AgentClientSurfaceOperation[],
  exclusions: readonly AgentClientSurfaceExclusion[]
): void => {
  const registeredOperationIds = new Set(
    operations
      .map((operation) => operation.apiOperationId)
      .filter((operationId): operationId is string => operationId !== null)
  )
  const excludedOperationIds = new Set(exclusions.flatMap((exclusion) => [...exclusion.matchedOperationIds]))
  const missing = Array.from(openApiOperations.values())
    .filter((operation) => !registeredOperationIds.has(operation.operationId))
    .filter((operation) => !excludedOperationIds.has(operation.operationId))

  if (missing.length > 0) {
    const formatted = missing
      .map((operation) => `${operation.operationId} (${operation.method} ${operation.path})`)
      .join(', ')
    throw new Error(`OpenAPI operations missing generated agent client surfaces or exclusions: ${formatted}`)
  }
}

const assertPolicyInvariants = (
  operations: readonly AgentClientSurfaceOperation[],
  exclusions: readonly AgentClientSurfaceExclusion[]
): void => {
  const keys = new Set<string>()
  const cliCommands = new Set<string>()
  const mcpTools = new Set<string>()
  const mcpPrefixPattern = new RegExp(`^${agentClientSurfaceProjectConfig.mcpToolPrefix}_[a-z0-9_]+$`, 'u')

  for (const operation of operations) {
    if (keys.has(operation.key)) {
      throw new Error(`Duplicate agent surface key: ${operation.key}`)
    }
    keys.add(operation.key)

    if (cliCommands.has(operation.cliCommand)) {
      throw new Error(`Duplicate agent CLI command: ${operation.cliCommand}`)
    }
    cliCommands.add(operation.cliCommand)

    if (mcpTools.has(operation.mcpTool)) {
      throw new Error(`Duplicate agent MCP tool: ${operation.mcpTool}`)
    }
    mcpTools.add(operation.mcpTool)

    if (!/^[a-z0-9]+(?:[._][a-z0-9]+)*$/u.test(operation.key)) {
      throw new Error(`Agent surface key must be lower snake/dot case: ${operation.key}`)
    }

    if (!mcpPrefixPattern.test(operation.mcpTool)) {
      throw new Error(`Agent surface ${operation.key} has invalid MCP tool name ${operation.mcpTool}.`)
    }

    const pathParamNames = Array.from(operation.apiPath.matchAll(/\{([^}]+)\}/gu)).map((match) => match[1])
    for (const pathParamName of pathParamNames) {
      if (
        pathParamName === undefined ||
        !operation.schema.parameters.path.some((parameter) => parameter.name === pathParamName && parameter.required)
      ) {
        throw new Error(`Agent surface ${operation.key} is missing required OpenAPI path parameter metadata for {${pathParamName ?? 'unknown'}}.`)
      }
    }
  }

  if (operations.length === 0) {
    throw new Error('Generated agent surface contract must contain at least one operation.')
  }

  for (const exclusion of exclusions) {
    if (exclusion.category.trim().length === 0 || exclusion.rationale.trim().length === 0) {
      throw new Error('Every agent surface exclusion must have category and rationale.')
    }
  }
}

const renderJson = (payload: GeneratedSurfacePayload): string =>
  `${JSON.stringify(payload, null, 2)}\n`

const renderTs = (payload: GeneratedSurfacePayload): string =>
  [
    '// Generated by scripts/generate-agent-client-surfaces.ts. Do not edit manually.',
    "import type { AgentClientSurfaceExclusion, AgentClientSurfaceOperation } from './agent-client-surface.js'",
    '',
    `export const agentClientSurfaceOperations = ${JSON.stringify(payload.operations, null, 2)} as const satisfies ReadonlyArray<AgentClientSurfaceOperation>`,
    '',
    `export const agentClientSurfaceParityExclusions = ${JSON.stringify(payload.exclusions, null, 2)} as const satisfies ReadonlyArray<AgentClientSurfaceExclusion>`,
    ''
  ].join('\n')

const assertFileMatches = (path: string, expected: string): void => {
  const actual = readFileSync(path, 'utf8')
  if (actual !== expected) {
    throw new Error(`${path} is stale. Run pnpm agent-surfaces:generate.`)
  }
}

const openApiOperations = collectOpenApiOperations()
const exclusions = normalizeExclusions(openApiOperations)
const operations = normalizeOperations(openApiOperations, exclusions)
assertPolicyInvariants(operations, exclusions)
assertGeneratedOpenApiCoverage(openApiOperations, operations, exclusions)

const payload: GeneratedSurfacePayload = {
  generatedFrom: {
    openapi: 'apps/api/openapi.json',
    policy: 'packages/contracts/src/agent-client-surface.policy.ts'
  },
  operations,
  exclusions
}

const generatedJson = renderJson(payload)
const generatedTs = renderTs(payload)

if (check) {
  assertFileMatches(generatedJsonPath, generatedJson)
  assertFileMatches(generatedTsPath, generatedTs)
} else {
  writeFileSync(generatedJsonPath, generatedJson)
  writeFileSync(generatedTsPath, generatedTs)
}
