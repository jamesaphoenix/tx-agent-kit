import {
  type AgentClientSurfaceOperation,
  agentClientSurfaceImplementedOperations,
  agentClientSurfaceOperations
} from '@tx-agent-kit/contracts'

import { CliUserError, parseFieldMask, selectFields } from './output.js'

export interface SurfaceListOptions {
  readonly includePlanned: boolean
  readonly fields?: string
}

export const listSurfaces = (
  options: SurfaceListOptions
): ReadonlyArray<unknown> => {
  const fieldMask = parseFieldMask(options.fields)
  const operations = options.includePlanned
    ? agentClientSurfaceOperations
    : agentClientSurfaceImplementedOperations

  return operations.map((operation) => selectFields(operation, fieldMask))
}

export const describeSurface = (value: string): AgentClientSurfaceOperation => {
  const safeValue = value.trim()
  if (safeValue.length === 0) {
    throw new CliUserError({
      code: 'surface/missing',
      message: 'A surface key, CLI command, or MCP tool name is required.'
    })
  }

  const operation = agentClientSurfaceOperations.find((candidate) =>
    candidate.key === safeValue ||
    candidate.cliCommand === safeValue ||
    candidate.mcpTool === safeValue
  )

  if (operation === undefined) {
    throw new CliUserError({
      code: 'surface/not-found',
      message: `Unknown agent client surface: ${safeValue}`,
      hint: 'Run surfaces list --fields key,cliCommand,mcpTool,apiStatus to discover valid surfaces.'
    })
  }

  return operation
}

export const buildSurfaceSchema = (operation: AgentClientSurfaceOperation) => ({
  key: operation.key,
  cliCommand: operation.cliCommand,
  mcpTool: operation.mcpTool,
  apiOperationId: operation.apiOperationId,
  apiStatus: operation.apiStatus,
  api: {
    method: operation.apiMethod,
    path: operation.apiPath
  },
  request: {
    acceptedInputModes: [
      'json-payload',
      'json-file',
      'stdin-json'
    ],
    requiresConfirmation: operation.requiresConfirmation,
    dryRunFlag: operation.mutating ? '--dry-run' : null,
    path: operation.schema.parameters.path,
    query: operation.schema.parameters.query,
    header: operation.schema.parameters.header,
    cookie: operation.schema.parameters.cookie,
    body: operation.schema.requestBody
  },
  response: {
    default: 'json',
    supportsFields: true,
    statuses: operation.schema.responseStatuses
  }
})
