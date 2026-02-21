import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { once } from 'node:events'
import type { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const apiPort = Number.parseInt(process.env.API_INTEGRATION_TEST_PORT ?? '4100', 10)
const apiBaseUrl = `http://127.0.0.1:${apiPort}`
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/tx_agent_kit'

let apiProcess: ChildProcessByStdio<null, Readable, Readable> | undefined
const serverOutput: string[] = []

const recordOutput = (chunk: Buffer): void => {
  serverOutput.push(chunk.toString('utf8'))
}

const waitForHealth = async (timeoutMs: number): Promise<void> => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${apiBaseUrl}/health`)
      if (response.ok) {
        return
      }
    } catch {
      // Retry until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`API did not become healthy within ${timeoutMs}ms`)
}

const stopApiProcess = async (): Promise<void> => {
  const processRef = apiProcess
  if (!processRef || processRef.exitCode !== null) {
    return
  }

  const waitForExit = async (timeoutMs: number): Promise<boolean> => {
    const result = await Promise.race([
      once(processRef, 'exit').then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), timeoutMs)
      })
    ])
    return result
  }

  processRef.kill('SIGTERM')
  const exitedAfterTerm = await waitForExit(5000)

  if (!exitedAfterTerm && processRef.exitCode === null) {
    processRef.kill('SIGKILL')
    await waitForExit(2000)
  }
}

const requestJson = async <T>(path: string, init?: RequestInit): Promise<{ response: Response; body: T }> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  })

  const body = await response.json() as T
  return { response, body }
}

beforeAll(async () => {
  const spawned = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      API_HOST: '127.0.0.1',
      API_PORT: String(apiPort),
      AUTH_SECRET: 'integration-auth-secret-12345',
      DATABASE_URL: databaseUrl
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  apiProcess = spawned
  spawned.stdout.on('data', recordOutput)
  spawned.stderr.on('data', recordOutput)

  await waitForHealth(40000)
})

afterAll(async () => {
  try {
    await stopApiProcess()
  } catch (error) {
    const joinedOutput = serverOutput.join('')
    throw new Error(`Failed to stop API process: ${String(error)}\n\nServer output:\n${joinedOutput}`)
  }
})

describe('api integration', () => {
  it('supports auth + workspace + tasks flow end to end', async () => {
    const signUp = await requestJson<{ token: string; user: { id: string; email: string } }>('/v1/auth/sign-up', {
      method: 'POST',
      body: JSON.stringify({
        email: 'integration-user@example.com',
        password: 'strong-pass-12345',
        name: 'Integration User'
      })
    })

    expect(signUp.response.status).toBe(201)
    expect(signUp.body.user.email).toBe('integration-user@example.com')

    const token = signUp.body.token

    const me = await requestJson<{ userId: string; email: string; roles: string[] }>('/v1/auth/me', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`
      }
    })

    expect(me.response.status).toBe(200)
    expect(me.body.userId).toBeTruthy()

    const workspace = await requestJson<{ id: string; name: string }>('/v1/workspaces', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ name: 'Integration Workspace' })
    })

    expect(workspace.response.status).toBe(201)
    expect(workspace.body.name).toBe('Integration Workspace')

    const createTask = await requestJson<{ id: string; title: string; workspaceId: string }>('/v1/tasks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        workspaceId: workspace.body.id,
        title: 'First integration task',
        description: 'from integration test'
      })
    })

    expect(createTask.response.status).toBe(201)
    expect(createTask.body.title).toBe('First integration task')

    const listTasks = await requestJson<{ tasks: Array<{ id: string; title: string }> }>(`/v1/tasks?workspaceId=${workspace.body.id}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`
      }
    })

    expect(listTasks.response.status).toBe(200)
    expect(listTasks.body.tasks).toHaveLength(1)
    expect(listTasks.body.tasks[0]?.title).toBe('First integration task')
  })
})
