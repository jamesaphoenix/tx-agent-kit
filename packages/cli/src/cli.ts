#!/usr/bin/env node
import { agentClientSurfaceProjectConfig } from '@tx-agent-kit/contracts'

import { CliUserError, writeJsonLine } from './output.js'
import { buildSurfaceSchema, describeSurface, listSurfaces } from './surfaces.js'

export interface CliRuntime {
  readonly argv: readonly string[]
  readonly stdout: {
    readonly write: (chunk: string) => void
  }
  readonly stderr: {
    readonly write: (chunk: string) => void
  }
}

const readFlagValue = (
  argv: readonly string[],
  name: string
): string | undefined => {
  const equalsPrefix = `${name}=`
  const inline = argv.find((arg) => arg.startsWith(equalsPrefix))
  if (inline !== undefined) {
    return inline.slice(equalsPrefix.length)
  }

  const index = argv.indexOf(name)
  const next = index >= 0 ? argv[index + 1] : undefined
  return next !== undefined && !next.startsWith('--') ? next : undefined
}

const hasFlag = (argv: readonly string[], name: string): boolean => argv.includes(name)

const positionalArgs = (argv: readonly string[]): readonly string[] =>
  argv.filter((arg, index) => {
    if (arg.startsWith('--')) {
      return false
    }
    const previous = argv[index - 1]
    return previous !== '--fields' && previous !== '--format'
  })

const helpPayload = {
  name: agentClientSurfaceProjectConfig.cliName,
  summary: `${agentClientSurfaceProjectConfig.displayName} agent client template. The API remains the trusted business logic layer.`,
  commands: [
    {
      command: 'surfaces list',
      description: 'List generated API-backed CLI and MCP surface metadata.',
      example: `${agentClientSurfaceProjectConfig.cliName} surfaces list --fields key,cliCommand,mcpTool,apiStatus`
    },
    {
      command: 'surfaces describe <key|cli-command|mcp-tool>',
      description: 'Return one generated surface contract.',
      example: `${agentClientSurfaceProjectConfig.cliName} surfaces describe auth.me`
    },
    {
      command: 'schema <key|cli-command|mcp-tool>',
      description: 'Return the agent-facing request and response shape for one surface.',
      example: `${agentClientSurfaceProjectConfig.cliName} schema auth.me`
    }
  ]
} as const

const execute = (runtime: CliRuntime): unknown => {
  const args = positionalArgs(runtime.argv)

  if (args.length === 0 || hasFlag(runtime.argv, '--help') || hasFlag(runtime.argv, '-h')) {
    return helpPayload
  }

  if (args[0] === 'surfaces' && args[1] === 'list') {
    return {
      ok: true,
      data: listSurfaces({
        includePlanned: hasFlag(runtime.argv, '--include-planned'),
        fields: readFlagValue(runtime.argv, '--fields')
      })
    }
  }

  if (args[0] === 'surfaces' && args[1] === 'describe' && args[2] !== undefined) {
    return {
      ok: true,
      data: describeSurface(args.slice(2).join(' '))
    }
  }

  if (args[0] === 'schema' && args[1] !== undefined) {
    return {
      ok: true,
      data: buildSurfaceSchema(describeSurface(args.slice(1).join(' ')))
    }
  }

  throw new CliUserError({
    code: 'cli/unknown-command',
    message: `Unknown command: ${args.join(' ')}`,
    hint: `Run ${agentClientSurfaceProjectConfig.cliName} --help.`
  })
}

export const runCli = (runtime: CliRuntime): number => {
  try {
    writeJsonLine(runtime.stdout, execute(runtime))
    return 0
  } catch (error) {
    if (error instanceof CliUserError) {
      writeJsonLine(runtime.stderr, {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          hint: error.hint
        }
      })
      return 2
    }

    writeJsonLine(runtime.stderr, {
      ok: false,
      error: {
        code: 'cli/internal-error',
        message: error instanceof Error ? error.message : 'Unknown CLI failure.'
      }
    })
    return 1
  }
}

const entrypoint = process.argv[1]

if (entrypoint !== undefined && import.meta.url === `file://${entrypoint}`) {
  process.exitCode = runCli({
    argv: process.argv.slice(2),
    stdout: process.stdout,
    stderr: process.stderr
  })
}
