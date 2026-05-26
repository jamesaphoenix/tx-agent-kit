import { describe, expect, it } from 'vitest'

import {
  agentClientSurfaceImplementedOperations,
  agentClientSurfaceOperations
} from './agent-client-surface.js'
import { agentClientSurfaceProjectConfig } from './agent-client-surface.policy.js'

describe('agent client surface contract', () => {
  it('generates unique keys, CLI commands, and MCP tool names', () => {
    const keys = new Set(agentClientSurfaceOperations.map((operation) => operation.key))
    const cliCommands = new Set(agentClientSurfaceOperations.map((operation) => operation.cliCommand))
    const mcpTools = new Set(agentClientSurfaceOperations.map((operation) => operation.mcpTool))

    expect(keys.size).toBe(agentClientSurfaceOperations.length)
    expect(cliCommands.size).toBe(agentClientSurfaceOperations.length)
    expect(mcpTools.size).toBe(agentClientSurfaceOperations.length)
  })

  it('uses the target-owned MCP tool prefix', () => {
    for (const operation of agentClientSurfaceOperations) {
      expect(operation.mcpTool.startsWith(`${agentClientSurfaceProjectConfig.mcpToolPrefix}_`)).toBe(true)
    }
  })

  it('keeps implemented operations backed by OpenAPI ids', () => {
    expect(agentClientSurfaceImplementedOperations.length).toBeGreaterThan(0)
    for (const operation of agentClientSurfaceImplementedOperations) {
      expect(operation.apiOperationId).toEqual(expect.any(String))
    }
  })
})
