import type { Tool } from '@modelcontextprotocol/sdk/types.js'

import { metaToolNames } from './tools.js'

const emptyInputSchema: Tool['inputSchema'] = {
  type: 'object',
  properties: {}
}

const surfaceInputSchema: Tool['inputSchema'] = {
  type: 'object',
  properties: {
    surface: { type: 'string' },
    key: { type: 'string' },
    toolName: { type: 'string' }
  }
}

export const buildMcpTools = (): readonly Tool[] => [
  {
    name: metaToolNames.list,
    description: 'List generated API-backed CLI and MCP surface metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        includePlanned: { type: 'boolean' },
        fields: { type: 'string' }
      }
    }
  },
  {
    name: metaToolNames.describe,
    description: 'Describe one generated agent client surface.',
    inputSchema: surfaceInputSchema
  },
  {
    name: metaToolNames.schema,
    description: 'Return the request/response schema metadata for one generated agent client surface.',
    inputSchema: surfaceInputSchema
  },
  {
    name: `${metaToolNames.list}_ping`,
    description: 'Health check for the agent MCP template package.',
    inputSchema: emptyInputSchema
  }
]
