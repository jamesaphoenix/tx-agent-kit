import { describe, expect, it } from 'vitest'

import { runCli } from './cli.js'

const run = (argv: readonly string[]) => {
  const stdout: string[] = []
  const stderr: string[] = []
  const exitCode = runCli({
    argv,
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) }
  })
  return {
    exitCode,
    stdout: stdout.join(''),
    stderr: stderr.join('')
  }
}

describe('agent CLI template', () => {
  it('lists generated surfaces with field masks', () => {
    const result = run(['surfaces', 'list', '--fields', 'key,cliCommand,mcpTool,apiStatus'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const payload = JSON.parse(result.stdout) as { readonly data: readonly Record<string, unknown>[] }
    expect(payload.data.length).toBeGreaterThan(0)
    expect(Object.keys(payload.data[0] ?? {})).toEqual(['key', 'cliCommand', 'mcpTool', 'apiStatus'])
  })

  it('describes and renders schema for a known surface', () => {
    const list = run(['surfaces', 'list', '--fields', 'key'])
    const firstKey = (JSON.parse(list.stdout) as { readonly data: readonly { readonly key: string }[] }).data[0]?.key
    expect(firstKey).toEqual(expect.any(String))

    const describe = run(['surfaces', 'describe', firstKey ?? 'missing'])
    expect(describe.exitCode).toBe(0)
    expect(JSON.parse(describe.stdout)).toMatchObject({
      ok: true,
      data: {
        key: firstKey
      }
    })

    const schema = run(['schema', firstKey ?? 'missing'])
    expect(schema.exitCode).toBe(0)
    const schemaPayload = JSON.parse(schema.stdout) as {
      readonly ok: boolean
      readonly data: {
        readonly key: string | undefined
        readonly api: {
          readonly method: string | undefined
          readonly path: string | undefined
        }
      }
    }
    expect(schemaPayload.ok).toBe(true)
    expect(schemaPayload.data.key).toBe(firstKey)
    expect(typeof schemaPayload.data.api.method).toBe('string')
    expect(typeof schemaPayload.data.api.path).toBe('string')
  })

  it('returns structured errors for unknown commands', () => {
    const result = run(['publish', 'now'])

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      error: {
        code: 'cli/unknown-command'
      }
    })
  })
})
