#!/usr/bin/env node
import * as McpServerModule from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult
} from '@modelcontextprotocol/sdk/types.js'
import { agentClientSurfaceProjectConfig } from '@tx-agent-kit/contracts'

import { buildMcpTools } from './manifest.js'
import { callMcpTool, metaToolNames } from './tools.js'

interface ProtocolServerLike {
  readonly setRequestHandler: (
    schema: object,
    handler: (request: {
      readonly params?: {
        readonly name?: unknown
        readonly arguments?: Readonly<Record<string, unknown>>
      }
    }) => unknown
  ) => void
  readonly connect: (transport: Transport) => Promise<void>
}

type ProtocolServerConstructor = new (
  serverInfo: { readonly name: string; readonly version: string },
  options: { readonly capabilities: { readonly tools: Record<string, never> } }
) => ProtocolServerLike

const protocolServerConstructor: unknown = Reflect.get(McpServerModule, 'Server')
const ProtocolServer = protocolServerConstructor as ProtocolServerConstructor

const pingResult: CallToolResult = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({ ok: true, package: '@tx-agent-kit/mcp' }, null, 2)
    }
  ]
}

const callTool = (
  name: string,
  input: Readonly<Record<string, unknown>> | undefined
): CallToolResult => {
  if (name === `${metaToolNames.list}_ping`) {
    return pingResult
  }
  return callMcpTool(name, input)
}

export const createAgentMcpServer = (): ProtocolServerLike => {
  const server = new ProtocolServer(
    {
      name: agentClientSurfaceProjectConfig.cliName,
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  )

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: buildMcpTools()
  }))

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const toolName = typeof request.params?.name === 'string' ? request.params.name : ''
    return callTool(toolName, request.params?.arguments)
  })

  return server
}

export const startStdioServer = async (): Promise<void> => {
  const server = createAgentMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

const entrypoint = process.argv[1]

if (entrypoint !== undefined && import.meta.url === `file://${entrypoint}`) {
  await startStdioServer()
}
