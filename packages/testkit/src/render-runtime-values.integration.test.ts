import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCommand } from './command-entrypoints.js'

const tempRoots: string[] = []

const createTempRoot = (): string => {
  const root = mkdtempSync(resolve(tmpdir(), 'tx-agent-kit-render-values-'))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('render-runtime-values runtime env parsing integration', () => {
  it('renders escaped newline PEM values as multiline runtime env entries', () => {
    const root = createTempRoot()
    const envFile = resolve(root, 'runtime.env')
    const outputFile = resolve(root, 'runtime-values.yaml')

    writeFileSync(
      envFile,
      [
        'NODE_ENV=staging',
        'TEMPORAL_TLS_CA_CERT_PEM=-----BEGIN CERT-----\\nline-1\\nline-2\\n-----END CERT-----',
        'TEMPORAL_TLS_CLIENT_CERT_PEM="-----BEGIN CERT-----\\nline-a\\nline-b\\n-----END CERT-----"',
        "TEMPORAL_TLS_CLIENT_KEY_PEM='-----BEGIN KEY-----\\nline-x\\nline-y\\n-----END KEY-----'"
      ].join('\n'),
      'utf8'
    )

    const run = runCommand('node', [
      'scripts/deploy/render-runtime-values.mjs',
      '--env-file',
      envFile,
      '--api-image',
      'example.com/api@sha256:test',
      '--worker-image',
      'example.com/worker@sha256:test',
      '--output',
      outputFile
    ])

    expect(run.exitCode).toBe(0)

    const rendered = readFileSync(outputFile, 'utf8')
    expect(rendered).toContain("TEMPORAL_TLS_CA_CERT_PEM: '-----BEGIN CERT-----\nline-1\nline-2\n-----END CERT-----'")
    expect(rendered).toContain("TEMPORAL_TLS_CLIENT_CERT_PEM: '-----BEGIN CERT-----\nline-a\nline-b\n-----END CERT-----'")
    expect(rendered).toContain("TEMPORAL_TLS_CLIENT_KEY_PEM: '-----BEGIN KEY-----\nline-x\nline-y\n-----END KEY-----'")
  })
})
