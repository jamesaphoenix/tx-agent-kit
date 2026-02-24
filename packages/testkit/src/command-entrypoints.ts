import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { getTestkitProcessEnv } from './env.js'

export interface CommandRunResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface CommandProbeResult {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export interface CommandReadyProbeResult extends CommandProbeResult {
  readonly readinessMatched: boolean
}

const repoRoot = resolve(import.meta.dirname, '../../..')

export const runCommand = (
  command: string,
  args: string[],
  envOverrides: Readonly<NodeJS.ProcessEnv> = {},
  timeoutMs = 120_000,
  cwd = repoRoot
): CommandRunResult => {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...getTestkitProcessEnv(),
      ...envOverrides
    },
    encoding: 'utf8',
    timeout: timeoutMs
  })

  if (result.error) {
    const error = result.error as NodeJS.ErrnoException
    if (error.code === 'ETIMEDOUT') {
      return {
        exitCode: 124,
        stdout: result.stdout ?? '',
        stderr: `${result.stderr ?? ''}\n${error.message}`.trim()
      }
    }

    throw result.error
  }

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

export const combinedOutput = (result: CommandRunResult): string =>
  `${result.stdout}\n${result.stderr}`

const readProcessGroupId = (pid: number): number | null => {
  try {
    const output = execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim()
    const parsed = Number.parseInt(output, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  } catch (error) {
    void error
    return null
  }
}

const listDescendantProcessIds = (rootPid: number): number[] => {
  try {
    const output = execFileSync('ps', ['-Ao', 'pid=,ppid='], {
      encoding: 'utf8',
      stdio: 'pipe'
    })
    const childMap = new Map<number, number[]>()

    for (const rawLine of output.split('\n')) {
      const line = rawLine.trim()
      if (line.length === 0) {
        continue
      }

      const [pidToken, ppidToken] = line.split(/\s+/u)
      if (!pidToken || !ppidToken) {
        continue
      }

      const pid = Number.parseInt(pidToken, 10)
      const ppid = Number.parseInt(ppidToken, 10)
      if (!Number.isFinite(pid) || !Number.isFinite(ppid) || pid <= 0 || ppid <= 0) {
        continue
      }

      const existing = childMap.get(ppid)
      if (existing) {
        existing.push(pid)
      } else {
        childMap.set(ppid, [pid])
      }
    }

    const descendants: number[] = []
    const queue: number[] = [rootPid]
    const seen = new Set<number>(queue)

    while (queue.length > 0) {
      const current = queue.shift()
      if (typeof current !== 'number') {
        break
      }

      const children = childMap.get(current) ?? []
      for (const childPid of children) {
        if (seen.has(childPid)) {
          continue
        }
        seen.add(childPid)
        descendants.push(childPid)
        queue.push(childPid)
      }
    }

    return descendants
  } catch (error) {
    void error
    return []
  }
}

const killProcessGroup = (pid: number, signal: NodeJS.Signals): void => {
  const processGroupId = readProcessGroupId(pid)
  if (processGroupId) {
    try {
      process.kill(-processGroupId, signal)
      return
    } catch (error) {
      void error
    }
  }

  try {
    // Negative pid targets the spawned process group on POSIX systems.
    process.kill(-pid, signal)
    return
  } catch (error) {
    void error
  }

  try {
    process.kill(pid, signal)
  } catch (error) {
    void error
  }
}

const killProcessTree = (pid: number, signal: NodeJS.Signals): void => {
  killProcessGroup(pid, signal)

  const descendants = listDescendantProcessIds(pid)
  for (const descendantPid of descendants) {
    try {
      process.kill(descendantPid, signal)
    } catch (error) {
      void error
    }
  }
}

export const probeLongRunningCommand = (
  command: string,
  args: string[],
  envOverrides: Readonly<NodeJS.ProcessEnv> = {},
  timeoutMs = 12_000,
  cwd = repoRoot
): Promise<CommandProbeResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...getTestkitProcessEnv(),
        ...envOverrides
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let resolved = false

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    const finalize = (result: CommandProbeResult): void => {
      if (resolved) {
        return
      }
      resolved = true
      clearTimeout(timeoutHandle)
      clearTimeout(forceFinalizeHandle)
      resolve(result)
    }

    const timeoutHandle = setTimeout(() => {
      timedOut = true
      if (child.pid) {
        killProcessTree(child.pid, 'SIGTERM')
        setTimeout(() => {
          killProcessTree(child.pid!, 'SIGKILL')
        }, 2_000).unref()
      }
    }, timeoutMs)

    const forceFinalizeHandle = setTimeout(() => {
      if (resolved) {
        return
      }

      if (child.pid) {
        killProcessTree(child.pid, 'SIGKILL')
      }

      finalize({
        exitCode: child.exitCode,
        signal: child.signalCode ?? 'SIGKILL',
        stdout,
        stderr,
        timedOut
      })
    }, timeoutMs + 8_000)
    forceFinalizeHandle.unref()

    child.on('error', (error) => {
      clearTimeout(timeoutHandle)
      clearTimeout(forceFinalizeHandle)
      reject(error)
    })

    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle)
      clearTimeout(forceFinalizeHandle)
      finalize({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut
      })
    })
  })

export const probeLongRunningCommandUntilReady = (
  command: string,
  args: string[],
  readinessPattern: RegExp,
  envOverrides: Readonly<NodeJS.ProcessEnv> = {},
  timeoutMs = 30_000,
  cwd = repoRoot
): Promise<CommandReadyProbeResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...getTestkitProcessEnv(),
        ...envOverrides
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let readinessMatched = false
    let resolved = false
    let shutdownTriggered = false

    const readinessPatternWithoutGlobal = new RegExp(
      readinessPattern.source,
      readinessPattern.flags.replace(/g/gu, '')
    )

    const triggerShutdown = (): void => {
      if (shutdownTriggered || !child.pid) {
        return
      }

      shutdownTriggered = true
      killProcessTree(child.pid, 'SIGTERM')
      setTimeout(() => {
        if (child.pid) {
          killProcessTree(child.pid, 'SIGKILL')
        }
      }, 2_000).unref()
    }

    const maybeMarkReady = (): void => {
      if (readinessMatched) {
        return
      }

      const combined = `${stdout}\n${stderr}`
      if (readinessPatternWithoutGlobal.test(combined)) {
        readinessMatched = true
        triggerShutdown()
      }
    }

    const finalize = (result: CommandReadyProbeResult): void => {
      if (resolved) {
        return
      }
      resolved = true
      clearTimeout(timeoutHandle)
      clearTimeout(forceFinalizeHandle)
      resolve(result)
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
      maybeMarkReady()
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
      maybeMarkReady()
    })

    const timeoutHandle = setTimeout(() => {
      timedOut = true
      triggerShutdown()
    }, timeoutMs)

    const forceFinalizeHandle = setTimeout(() => {
      if (resolved) {
        return
      }

      triggerShutdown()
      finalize({
        exitCode: child.exitCode,
        signal: child.signalCode ?? 'SIGKILL',
        stdout,
        stderr,
        timedOut,
        readinessMatched
      })
    }, timeoutMs + 8_000)
    forceFinalizeHandle.unref()

    child.on('error', (error) => {
      clearTimeout(timeoutHandle)
      clearTimeout(forceFinalizeHandle)
      reject(error)
    })

    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle)
      clearTimeout(forceFinalizeHandle)
      finalize({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut,
        readinessMatched
      })
    })
  })
