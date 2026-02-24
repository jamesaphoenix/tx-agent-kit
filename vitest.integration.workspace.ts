import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const integrationConfigName = 'vitest.integration.config.ts'
// Static marker list retained for lint invariant checks that verify expected integration project coverage.
const requiredIntegrationConfigMarkers = [
  'apps/api/vitest.integration.config.ts',
  'apps/mobile/vitest.integration.config.ts',
  'apps/web/vitest.integration.config.ts',
  'packages/observability/vitest.integration.config.ts',
  'packages/testkit/vitest.integration.config.ts',
  'apps/worker/vitest.integration.config.ts'
] as const
const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  'coverage',
  'dist',
  'node_modules',
  'out'
])

interface IntegrationProjectRecord {
  readonly packageName: string
  readonly projectId: string
  readonly configPath: string
}

const repoRoot = resolve(import.meta.dirname)

const parsePackageManifest = (
  packageJsonPath: string
): { name: string } | null => {
  try {
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      readonly name?: unknown
    }

    if (typeof manifest.name !== 'string') {
      return null
    }

    return { name: manifest.name }
  } catch {
    return null
  }
}

const discoverIntegrationProjects = (): ReadonlyArray<IntegrationProjectRecord> => {
  const records: IntegrationProjectRecord[] = []

  const walk = (directoryPath: string): void => {
    const entries = readdirSync(directoryPath, { withFileTypes: true })
    const packageJsonEntry = entries.find(
      (entry) => entry.isFile() && entry.name === 'package.json'
    )
    const integrationConfigEntry = entries.find(
      (entry) => entry.isFile() && entry.name === integrationConfigName
    )

    if (packageJsonEntry && integrationConfigEntry) {
      const manifest = parsePackageManifest(resolve(directoryPath, packageJsonEntry.name))
      if (manifest) {
        records.push({
          packageName: manifest.name,
          projectId: basename(directoryPath).toLowerCase(),
          configPath: relative(
            repoRoot,
            resolve(directoryPath, integrationConfigEntry.name)
          )
        })
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      if (ignoredDirectories.has(entry.name)) {
        continue
      }

      walk(resolve(directoryPath, entry.name))
    }
  }

  for (const root of ['apps', 'packages']) {
    const rootPath = resolve(repoRoot, root)
    if (!existsSync(rootPath)) {
      continue
    }

    walk(rootPath)
  }

  return records.sort((left, right) =>
    left.packageName.localeCompare(right.packageName)
  )
}

const integrationProjects = discoverIntegrationProjects()

const parseRequestedProjectIds = (): string[] => {
  const raw = process.env.INTEGRATION_PROJECTS
  if (!raw || raw.trim().length === 0) {
    return []
  }

  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index)
}

const resolveProjectPaths = (): string[] => {
  if (integrationProjects.length === 0) {
    throw new Error(
      'No integration projects discovered. Add `vitest.integration.config.ts` in package/app roots.'
    )
  }

  const requestedIds = parseRequestedProjectIds()
  if (requestedIds.length === 0) {
    const discoveredPaths = integrationProjects.map((record) => record.configPath)
    for (const marker of requiredIntegrationConfigMarkers) {
      if (!discoveredPaths.includes(marker)) {
        throw new Error(`Expected integration project config to be present: ${marker}`)
      }
    }
    return discoveredPaths
  }

  const selectedPaths: string[] = []
  for (const requestedId of requestedIds) {
    const match = integrationProjects.find((record) => record.projectId === requestedId)
    if (!match) {
      const knownIds = integrationProjects.map((record) => record.projectId).join(', ')
      throw new Error(
        `Unknown integration project '${requestedId}'. Known projects: ${knownIds}.`
      )
    }
    selectedPaths.push(match.configPath)
  }

  return selectedPaths
}

export default defineConfig({
  test: {
    projects: resolveProjectPaths(),
    globalSetup: ['./scripts/test/vitest-global-setup.ts'],
    passWithNoTests: true
  }
})
