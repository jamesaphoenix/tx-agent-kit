import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { combinedOutput, runCommand } from './command-entrypoints.js'

const repoRoot = resolve(import.meta.dirname, '../../..')
const artifactsDir = resolve(repoRoot, 'deploy/artifacts')

const shouldRunComposeE2E = process.env.RUN_COMPOSE_E2E === '1'

const composeConfigEnv = (() => {
  const dummyEnvPath = resolve(tmpdir(), 'tx-deploy-compose-test-dummy.env')
  writeFileSync(dummyEnvPath, 'NODE_ENV=test\n', { mode: 0o600 })
  return {
    DEPLOY_ENV_FILE: dummyEnvPath,
    API_IMAGE: 'test/api:latest',
    WORKER_IMAGE: 'test/worker:latest'
  }
})()

const findLatestArtifact = (): string | null => {
  if (!existsSync(artifactsDir)) {
    return null
  }

  const files = readdirSync(artifactsDir)
    .filter((f) => f.startsWith('images-') && f.endsWith('.env'))
    .sort()

  return files.length > 0 ? resolve(artifactsDir, files[files.length - 1]!) : null
}

describe.sequential('compose deploy integration', () => {
  it('validates the staging compose file is well-formed', () => {
    const result = runCommand(
      'docker',
      ['compose', '-f', 'docker-compose.staging.yml', 'config', '--quiet'],
      composeConfigEnv,
      30_000
    )

    expect(result.exitCode).toBe(0)
  })

  it('validates the prod compose file is well-formed', () => {
    const result = runCommand(
      'docker',
      ['compose', '-f', 'docker-compose.prod.yml', 'config', '--quiet'],
      composeConfigEnv,
      30_000
    )

    expect(result.exitCode).toBe(0)
  })

  it('validates tunnel reconcile rejects invalid mode', () => {
    const result = runCommand(
      'bash',
      ['scripts/deploy/tunnel/reconcile.sh', 'invalid'],
      {},
      15_000
    )
    const output = combinedOutput(result)

    expect(result.exitCode).not.toBe(0)
    expect(output).toContain('Usage:')
  })

  it('validates tunnel check rejects invalid mode', () => {
    const result = runCommand(
      'bash',
      ['scripts/deploy/tunnel/check.sh', 'invalid'],
      {},
      15_000
    )
    const output = combinedOutput(result)

    expect(result.exitCode).not.toBe(0)
    expect(output).toContain('Usage:')
  })

  it('validates deploy-compose.sh rejects invalid environment', () => {
    const result = runCommand(
      'bash',
      ['scripts/deploy/deploy-compose.sh', 'invalid'],
      {},
      15_000
    )
    const output = combinedOutput(result)

    expect(result.exitCode).not.toBe(0)
    expect(output).toContain("Invalid environment 'invalid'. Expected 'staging' or 'prod'.")
  })

  it('validates deploy-compose.sh requires API_IMAGE and WORKER_IMAGE', () => {
    const result = runCommand(
      'bash',
      ['scripts/deploy/deploy-compose.sh', 'staging'],
      { API_IMAGE: '', WORKER_IMAGE: '', PATH: '/usr/bin:/bin' },
      15_000
    )
    const output = combinedOutput(result)

    expect(result.exitCode).not.toBe(0)
    expect(output).toMatch(
      /API_IMAGE and WORKER_IMAGE must be provided|1Password CLI \(op\) is required/u
    )
  })

  it.skipIf(!shouldRunComposeE2E)(
    'builds Docker images for api and worker (E2E)',
    () => {
      const result = runCommand(
        'pnpm',
        ['deploy:build-images'],
        { PUSH_IMAGES: '0', IMAGE_PLATFORM: `linux/${process.arch === 'arm64' ? 'arm64' : 'amd64'}` },
        600_000
      )
      const output = combinedOutput(result)

      expect(result.exitCode).toBe(0)
      expect(output).toContain('Wrote deployment image artifact:')
      expect(output).toContain('API_IMAGE=')
      expect(output).toContain('WORKER_IMAGE=')

      const artifact = findLatestArtifact()
      expect(artifact).not.toBeNull()
    },
    660_000
  )

  it.skipIf(!shouldRunComposeE2E)(
    'starts compose stack, passes health check, and runs smoke (E2E)',
    () => {
      const artifact = findLatestArtifact()
      expect(artifact).not.toBeNull()

      const gcloudConfigDir = `${process.env.HOME}/.config/gcloud`
      const deploy = runCommand(
        'pnpm',
        ['deploy:staging', artifact!],
        {
          OP_VAULT: 'octospark-services',
          OP_ENV: 'staging',
          OTEL_COLLECTOR_GCLOUD_CONFIG_DIR: gcloudConfigDir,
          RUN_SMOKE: '0',
          RUN_TUNNEL_RECONCILE: '0',
          SKIP_PULL: '1'
        },
        300_000
      )
      const deployOutput = combinedOutput(deploy)

      try {
        expect(deploy.exitCode).toBe(0)
        expect(deployOutput).toContain('Deploying staging')
      } finally {
        runCommand(
          'docker',
          [
            'compose',
            '-f',
            'docker-compose.staging.yml',
            'down',
            '-v',
            '--remove-orphans'
          ],
          {},
          120_000
        )
      }
    },
    600_000
  )
})
