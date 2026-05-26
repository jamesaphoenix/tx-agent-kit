import {
  buildSurfaceSchema,
  describeSurface,
  listSurfaces
} from '@tx-agent-kit/cli'
import { agentClientSurfaceProjectConfig } from '@tx-agent-kit/contracts'

export interface AgentMcpTextResult {
  readonly [key: string]: unknown
  readonly content: [
    {
      readonly type: 'text'
      readonly text: string
    }
  ]
  readonly isError?: boolean
}

export const metaToolNames = {
  list: `${agentClientSurfaceProjectConfig.mcpToolPrefix}_surfaces_list`,
  describe: `${agentClientSurfaceProjectConfig.mcpToolPrefix}_surface_describe`,
  schema: `${agentClientSurfaceProjectConfig.mcpToolPrefix}_surface_schema`
} as const

const toTextResult = (value: unknown, isError = false): AgentMcpTextResult => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(value, null, 2)
    }
  ],
  isError: isError ? true : undefined
})

const readSurfaceValue = (input: Readonly<Record<string, unknown>> | undefined): string => {
  const value = input?.surface ?? input?.key ?? input?.toolName
  return typeof value === 'string' ? value : ''
}

export const listMcpSurfaces = (input?: Readonly<Record<string, unknown>>): AgentMcpTextResult => {
  const fields = typeof input?.fields === 'string' ? input.fields : 'key,cliCommand,mcpTool,apiStatus,mutating,requiresConfirmation'
  return toTextResult(listSurfaces({
    includePlanned: input?.includePlanned === true,
    fields
  }))
}

export const describeMcpSurface = (input?: Readonly<Record<string, unknown>>): AgentMcpTextResult =>
  toTextResult(describeSurface(readSurfaceValue(input)))

export const schemaMcpSurface = (input?: Readonly<Record<string, unknown>>): AgentMcpTextResult =>
  toTextResult(buildSurfaceSchema(describeSurface(readSurfaceValue(input))))

export const callMcpTool = (
  name: string,
  input?: Readonly<Record<string, unknown>>
): AgentMcpTextResult => {
  try {
    if (name === metaToolNames.list) {
      return listMcpSurfaces(input)
    }
    if (name === metaToolNames.describe) {
      return describeMcpSurface(input)
    }
    if (name === metaToolNames.schema) {
      return schemaMcpSurface(input)
    }

    return toTextResult({
      ok: false,
      error: {
        code: 'mcp/tool-not-found',
        message: `Unknown MCP tool: ${name}`,
        hint: `Call ${metaToolNames.list} to discover generated surfaces.`
      }
    }, true)
  } catch (error) {
    return toTextResult({
      ok: false,
      error: {
        code: error instanceof Error && error.name === 'CliUserError' ? 'surface/not-found' : 'mcp/internal-error',
        message: error instanceof Error ? error.message : 'Unknown MCP failure.'
      }
    }, true)
  }
}
