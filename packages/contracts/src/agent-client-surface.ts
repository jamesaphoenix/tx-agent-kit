export const agentClientSurfaceStatuses = [
  'implemented',
  'planned'
] as const

export type AgentClientSurfaceStatus = typeof agentClientSurfaceStatuses[number]

import type { AgentClientOpenApiParameterLocation } from './literals.js'

export type { AgentClientOpenApiParameterLocation } from './literals.js'

export interface AgentClientSurfaceOpenApiParameter {
  readonly name: string
  readonly in: AgentClientOpenApiParameterLocation
  readonly required: boolean
  readonly description?: string
}

export interface AgentClientSurfaceOpenApiSchema {
  readonly parameters: {
    readonly path: readonly AgentClientSurfaceOpenApiParameter[]
    readonly query: readonly AgentClientSurfaceOpenApiParameter[]
    readonly header: readonly AgentClientSurfaceOpenApiParameter[]
    readonly cookie: readonly AgentClientSurfaceOpenApiParameter[]
  }
  readonly requestBody: {
    readonly required: boolean
    readonly contentTypes: readonly string[]
  } | null
  readonly responseStatuses: readonly string[]
}

export interface AgentClientSurfaceOperation {
  readonly key: string
  readonly apiOperationId: string | null
  readonly apiMethod: string
  readonly apiPath: string
  readonly schema: AgentClientSurfaceOpenApiSchema
  readonly apiStatus: AgentClientSurfaceStatus
  readonly admin: boolean
  readonly cliCommand: string
  readonly mcpTool: string
  readonly mutating: boolean
  readonly requiresConfirmation: boolean
  readonly notes?: string
}

export interface AgentClientSurfaceExclusionPolicy {
  readonly category: string
  readonly rationale: string
  readonly operationIdPattern?: string
  readonly pathPattern?: string
}

export interface AgentClientSurfaceExclusion extends AgentClientSurfaceExclusionPolicy {
  readonly matchedOperationIds: readonly string[]
}

export interface AgentClientSurfaceProjectConfig {
  readonly displayName: string
  readonly cliName: string
  readonly mcpToolPrefix: string
}

export {
  agentClientSurfaceOperations,
  agentClientSurfaceParityExclusions
} from './agent-client-surface.generated.js'

export { agentClientSurfaceProjectConfig } from './agent-client-surface.policy.js'

import { agentClientSurfaceOperations } from './agent-client-surface.generated.js'

const allAgentClientSurfaceOperations: ReadonlyArray<AgentClientSurfaceOperation> =
  agentClientSurfaceOperations

export const agentClientSurfaceImplementedOperations =
  allAgentClientSurfaceOperations.filter((operation) => operation.apiStatus === 'implemented')

export const agentClientSurfacePlannedOperations =
  allAgentClientSurfaceOperations.filter((operation) => operation.apiStatus === 'planned')
