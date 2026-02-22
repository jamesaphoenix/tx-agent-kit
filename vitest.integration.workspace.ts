import { defineConfig } from 'vitest/config'

const integrationProjects = {
  api: 'apps/api/vitest.integration.config.ts',
  testkit: 'packages/testkit/vitest.integration.config.ts',
  web: 'apps/web/vitest.integration.config.ts',
  worker: 'apps/worker/vitest.integration.config.ts'
}

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
  const requestedIds = parseRequestedProjectIds()
  if (requestedIds.length === 0) {
    return Object.values(integrationProjects)
  }

  const selectedPaths: string[] = []
  for (const requestedId of requestedIds) {
    const projectPath =
      integrationProjects[requestedId as keyof typeof integrationProjects]
    if (!projectPath) {
      const knownIds = Object.keys(integrationProjects).join(', ')
      throw new Error(
        `Unknown integration project '${requestedId}'. Known projects: ${knownIds}.`
      )
    }
    selectedPaths.push(projectPath)
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
