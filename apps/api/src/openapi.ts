import { OpenApi } from '@effect/platform'
import { createLogger } from '@tx-agent-kit/logging'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TxAgentApi } from './api.js'
import { getOpenApiEnv } from './config/openapi-env.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const apiRoot = resolve(__dirname, '..')
const outputPath = resolve(apiRoot, 'openapi.json')
const logger = createLogger('tx-agent-kit-api').child('openapi')

const DDD_INVARIANTS = {
  boundedContexts: [
    {
      name: 'IdentityAccess',
      owns: ['Sign up/sign in', 'Session token principal']
    },
    {
      name: 'Collaboration',
      owns: ['Workspaces', 'Invitations', 'Membership']
    },
    {
      name: 'WorkExecution',
      owns: ['Tasks']
    }
  ],
  closedInvariants: [
    {
      id: 'INV-AUTH-001',
      rule: 'Password must be at least 8 characters.'
    },
    {
      id: 'INV-WS-001',
      rule: 'Workspace members are the only actors allowed to read/create tasks in that workspace.'
    },
    {
      id: 'INV-INV-001',
      rule: 'Invitations can be accepted only when status is pending, not expired, and email matches authenticated principal.'
    },
    {
      id: 'INV-INV-002',
      rule: 'Invitation list visibility is scoped to invitations whose email matches the authenticated principal.'
    },
    {
      id: 'INV-ARCH-001',
      rule: 'Domain mutations are accepted only via API/application services; direct UI-to-DB writes are forbidden.'
    }
  ]
} as const

const OPERATION_INVARIANTS: Record<string, readonly string[]> = {
  'auth.signUp': ['INV-AUTH-001'],
  'auth.signIn': ['INV-AUTH-001'],
  'auth.deleteMe': ['INV-ARCH-001'],
  'workspaces.createInvitation': ['INV-WS-001'],
  'workspaces.listInvitations': ['INV-INV-002'],
  'workspaces.getInvitation': ['INV-INV-002'],
  'workspaces.getManyInvitations': ['INV-INV-002'],
  'workspaces.updateInvitation': ['INV-WS-001'],
  'workspaces.removeInvitation': ['INV-WS-001'],
  'workspaces.getManyWorkspaces': ['INV-WS-001'],
  'tasks.listTasks': ['INV-WS-001'],
  'tasks.getTask': ['INV-WS-001'],
  'tasks.getManyTasks': ['INV-WS-001'],
  'tasks.createTask': ['INV-WS-001'],
  'tasks.updateTask': ['INV-WS-001'],
  'tasks.removeTask': ['INV-WS-001'],
  'workspaces.acceptInvitation': ['INV-INV-001']
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const injectOperationInvariants = (spec: Record<string, unknown>): Record<string, unknown> => {
  const paths = spec.paths
  if (!isRecord(paths)) {
    return spec
  }

  for (const pathItem of Object.values(paths)) {
    if (!isRecord(pathItem)) {
      continue
    }

    for (const operation of Object.values(pathItem)) {
      if (!isRecord(operation)) {
        continue
      }

      const operationId = typeof operation.operationId === 'string' ? operation.operationId : null
      if (!operationId) {
        continue
      }

      const invariants = OPERATION_INVARIANTS[operationId]
      if (invariants) {
        operation['x-invariants'] = invariants
      }
    }
  }

  return spec
}

const generate = async (): Promise<void> => {
  const baseSpec = OpenApi.fromApi(TxAgentApi)
  const openApiEnv = getOpenApiEnv()
  const spec = injectOperationInvariants({
    ...baseSpec,
    info: {
      ...baseSpec.info,
      title: 'tx-agent-kit API',
      version: '0.1.0',
      summary: 'Effect-based API for auth, workspaces, invitations, and tasks.',
      description: 'Contract for apps/api. Domain behavior is modeled as closed invariants at API boundaries.'
    },
    servers: [
      {
        url: openApiEnv.OPENAPI_SERVER_URL,
        description: 'Local development API'
      }
    ],
    'x-ddd': DDD_INVARIANTS
  })

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8')
  logger.info('OpenAPI spec generated.', { outputPath })
}

void generate()
