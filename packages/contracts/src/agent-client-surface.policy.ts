import type {
  AgentClientSurfaceExclusionPolicy,
  AgentClientSurfaceProjectConfig
} from './agent-client-surface.js'

export const agentClientSurfaceProjectConfig = {
  displayName: 'tx-agent-kit',
  cliName: 'tx-agent-kit',
  mcpToolPrefix: 'tx_agent_kit'
} as const satisfies AgentClientSurfaceProjectConfig

export const agentClientSurfaceExclusionPolicy = [
  {
    category: 'healthcheck',
    rationale: 'Health probes are operational endpoints, not user-facing agent actions.',
    operationIdPattern: '^health\\.'
  },
  {
    category: 'browser-auth',
    rationale: 'Password, OAuth, refresh, reset, and destructive account routes are browser/web-app auth surfaces.',
    operationIdPattern: '^auth\\.(signUp|signIn|refreshSession|signOut|signOutAll|googleStart|googleCallback|forgotPassword|resetPassword|deleteMe)$'
  },
  {
    category: 'admin',
    rationale: 'Admin routes are control-plane surfaces and should not be exposed by generated agent clients by default.',
    pathPattern: '^/v1/admin/'
  },
  {
    category: 'webhook',
    rationale: 'Inbound webhooks are server-to-server callbacks, not CLI or MCP tools.',
    pathPattern: '^/v1/webhooks/'
  },
  {
    category: 'internal-webhook',
    rationale: 'Internal infra webhooks (e.g. the auto-fix new-issue receiver under /internal/) are server-to-server callbacks, not CLI or MCP tools.',
    pathPattern: '^/internal/'
  },
  {
    category: 'local-dev',
    rationale: 'Local development helpers should not be exposed by generated agent clients.',
    pathPattern: '^/v1/.*/dev(/|$)|^/v1/dev(/|$)'
  }
] as const satisfies ReadonlyArray<AgentClientSurfaceExclusionPolicy>
