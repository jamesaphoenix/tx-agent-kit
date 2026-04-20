import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

import {
  listFilesRecursively,
  readUtf8,
  repoRoot,
  toPosix
} from './utils.mjs'

export const enforceColocatedTestConventions = (errors) => {
  const roots = [resolve(repoRoot, 'apps'), resolve(repoRoot, 'packages')]
  const testFileRegex = /\.(integration\.)?test\.tsx?$/u
  const specFileRegex = /\.spec\.tsx?$/u
  const legacyIntegrationRegex = /\.integration\.tsx?$/u
  // E2E tests cross multiple modules, so they have no single colocated source.
  // Signal the intent with a `.e2e.` filename segment and skip colocation.
  const e2eExemptionRegex = /\.e2e\.(integration\.)?test\.tsx?$/u

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const sourceFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(relative(repoRoot, filePath))
      if (!/\.(ts|tsx)$/u.test(normalized)) {
        return false
      }

      if (normalized.includes('/dist/') || normalized.includes('/node_modules/') || normalized.includes('/.next/')) {
        return false
      }

      return true
    })

    for (const sourceFile of sourceFiles) {
      const relativePath = toPosix(relative(repoRoot, sourceFile))
      const fileName = sourceFile.split(sep).pop() ?? ''

      if (relativePath.includes('/__tests__/')) {
        errors.push(
          `Test colocation invariant: legacy \`__tests__\` directories are forbidden. Move to colocated \`<file>.test.ts[x]\` or \`<file>.integration.test.ts[x]\`: \`${relativePath}\`.`
        )
      }

      if (specFileRegex.test(fileName)) {
        errors.push(
          `Test naming invariant: \`.spec.ts[x]\` files are forbidden. Use \`.test.ts[x]\` or \`.integration.test.ts[x]\`: \`${relativePath}\`.`
        )
      }

      if (legacyIntegrationRegex.test(fileName) && !testFileRegex.test(fileName)) {
        errors.push(
          `Test naming invariant: \`.integration.ts[x]\` is forbidden. Use \`.integration.test.ts[x]\`: \`${relativePath}\`.`
        )
      }

      if (!testFileRegex.test(fileName)) {
        continue
      }

      if (e2eExemptionRegex.test(fileName)) {
        continue
      }

      const baseName = fileName
        .replace(/\.integration\.test\.tsx?$/u, '')
        .replace(/\.test\.tsx?$/u, '')

      const sourceDir = dirname(sourceFile)
      const sourceTs = resolve(sourceDir, `${baseName}.ts`)
      const sourceTsx = resolve(sourceDir, `${baseName}.tsx`)

      if (!existsSync(sourceTs) && !existsSync(sourceTsx)) {
        errors.push(
          [
            'Test colocation invariant:',
            `\`${relativePath}\` has no colocated source module.`,
            `Expected one of \`${toPosix(relative(repoRoot, sourceTs))}\` or \`${toPosix(relative(repoRoot, sourceTsx))}\`.`
          ].join(' ')
        )
      }
    }
  }
}

export const enforceApiIntegrationHarnessContracts = (errors) => {
  // API integration tests are split into co-located route test files under apps/api/src/routes/
  // with shared helpers in apps/api/src/routes/test-helpers.ts
  const apiRouteTestFiles = [
    'apps/api/src/routes/auth.integration.test.ts',
    'apps/api/src/routes/billing.integration.test.ts',
    'apps/api/src/routes/health.integration.test.ts',
    'apps/api/src/routes/organizations.integration.test.ts',
    'apps/api/src/routes/permissions.integration.test.ts',
    'apps/api/src/routes/teams.integration.test.ts'
  ]

  const testHelperPath = resolve(repoRoot, 'apps/api/src/routes/test-helpers.ts')
  if (!existsSync(testHelperPath) || !statSync(testHelperPath).isFile()) {
    errors.push('Missing API integration test helpers: `apps/api/src/routes/test-helpers.ts`.')
    return
  }

  const helperSource = readUtf8(testHelperPath)
  if (!/\bcreateDbAuthContext\b/u.test(helperSource)) {
    errors.push(
      'API integration test helpers must import `createDbAuthContext` from `@tx-agent-kit/testkit` for idempotent shared setup.'
    )
  }

  for (const relativePath of apiRouteTestFiles) {
    const absolutePath = resolve(repoRoot, relativePath)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      errors.push(`Missing required API route integration test: \`${relativePath}\`.`)
      continue
    }

    const source = readUtf8(absolutePath)

    if (!/\bcreateDbAuthContext\s*\(/u.test(source) && !/\bcreateTestFixture\s*\(/u.test(source)) {
      errors.push(
        `API integration suite \`${relativePath}\` must use \`createDbAuthContext(...)\` or \`createTestFixture(...)\` for idempotent shared setup.`
      )
    }

    if (/\bcreateSqlTestContext\s*\(/u.test(source)) {
      errors.push(
        `API integration suite \`${relativePath}\` must not use \`createSqlTestContext(...)\" directly. Use \`createDbAuthContext(...)\`.`
      )
    }

    if (/from\s+['"]node:child_process['"]/u.test(source) || /\bspawn\s*\(/u.test(source)) {
      errors.push(
        `API integration suite \`${relativePath}\` must not spawn child processes directly. Use shared testkit harness APIs.`
      )
    }
  }
}

export const enforceApiHarnessPathResolutionContracts = (errors) => {
  const harnessCallerFiles = [
    'apps/api/src/routes/test-helpers.ts',
    'packages/testkit/src/db-auth-context.integration.test.ts',
    'apps/web/integration/support/web-integration-context.ts'
  ]

  for (const relativePath of harnessCallerFiles) {
    const absolutePath = resolve(repoRoot, relativePath)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      errors.push(`Missing API harness caller file: \`${relativePath}\`.`)
      continue
    }

    const source = readUtf8(absolutePath)
    if (!/\bcreateDbAuthContext\s*\(/u.test(source)) {
      errors.push(`API harness caller must instantiate \`createDbAuthContext(...)\`: \`${relativePath}\`.`)
    }

    if (/\bapiCwd\s*:\s*(?:process\.cwd\s*\(|resolve\s*\(\s*process\.cwd\s*\()/u.test(source)) {
      errors.push(
        [
          `API harness caller \`${relativePath}\` must not resolve \`apiCwd\` from \`process.cwd()\`.`,
          'Use `fileURLToPath(import.meta.url)` + `resolve(...)` to be workspace-safe.'
        ].join(' ')
      )
    }

    if (!/\bfileURLToPath\s*\(\s*import\.meta\.url\s*\)/u.test(source)) {
      errors.push(
        `API harness caller \`${relativePath}\` must resolve paths from \`fileURLToPath(import.meta.url)\` for workspace-safe execution.`
      )
    }
  }
}

export const enforceCriticalIntegrationCoverage = (errors) => {
  // API integration tests are split into co-located route test files
  const apiRouteTestDir = resolve(repoRoot, 'apps/api/src/routes')
  const apiRouteTestMap = {
    'health.integration.test.ts': ['/health'],
    'auth.integration.test.ts': ['/v1/auth/sign-in', '/v1/auth/me'],
    'organizations.integration.test.ts': ['/v1/organizations', '/v1/invitations']
  }

  for (const [fileName, requiredPaths] of Object.entries(apiRouteTestMap)) {
    const filePath = resolve(apiRouteTestDir, fileName)
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      errors.push(`Missing required API route integration test: \`apps/api/src/routes/${fileName}\`.`)
      continue
    }

    const source = readUtf8(filePath)
    for (const apiPath of requiredPaths) {
      if (!source.includes(apiPath)) {
        errors.push(
          `Critical API flow coverage missing in \`apps/api/src/routes/${fileName}\`: expected path \`${apiPath}\`.`
        )
      }
    }
  }

  // sign-up coverage
  const authTestPath = resolve(apiRouteTestDir, 'auth.integration.test.ts')
  if (existsSync(authTestPath) && statSync(authTestPath).isFile()) {
    const authSource = readUtf8(authTestPath)
    const coversSignUpPath = authSource.includes('/v1/auth/sign-up')
    const coversSignUpViaFactory = /\bcreateUser\s*\(/u.test(authSource)
    if (!coversSignUpPath && !coversSignUpViaFactory) {
      errors.push(
        'Critical API flow coverage missing in `apps/api/src/routes/auth.integration.test.ts`: expected sign-up flow via `/v1/auth/sign-up` or `createUser(...)` factory helper.'
      )
    }
  }

  // idempotency coverage
  const orgsTestPath = resolve(apiRouteTestDir, 'organizations.integration.test.ts')
  if (existsSync(orgsTestPath) && statSync(orgsTestPath).isFile()) {
    const orgsSource = readUtf8(orgsTestPath)
    if (!/idempotent/u.test(orgsSource)) {
      errors.push(
        'Critical API flow coverage missing: invitation acceptance idempotency scenario was not detected in organizations integration suite.'
      )
    }
  }

  // health endpoint readiness/performance assertion coverage
  const healthTestPath = resolve(apiRouteTestDir, 'health.integration.test.ts')
  const testHelperPath = resolve(apiRouteTestDir, 'test-helpers.ts')
  if (existsSync(healthTestPath) && statSync(healthTestPath).isFile()) {
    const healthSource = readUtf8(healthTestPath)
    const helperSource = existsSync(testHelperPath) ? readUtf8(testHelperPath) : ''
    const combinedSource = healthSource + helperSource

    const hasHealthEndpointCaseName = /health-endpoint/u.test(healthSource)
    const hasLiteralHealthLatencyBudgetAssertion = /toBeLessThan\((?:1500|1_500)\)/u.test(
      healthSource
    )
    const hasNamedHealthLatencyBudget =
      (
        /const\s+healthReadinessLatencyBudgetMs\s*=\s*(?:1500|1_500)/u.test(combinedSource) ||
        /const\s+healthReadinessLatencyBudgetMs\s*=\s*parsePositiveInt\s*\(/u.test(combinedSource)
      ) &&
      /toBeLessThan\(healthReadinessLatencyBudgetMs\)/u.test(healthSource)

    if (
      !hasHealthEndpointCaseName ||
      (!hasLiteralHealthLatencyBudgetAssertion && !hasNamedHealthLatencyBudget)
    ) {
      errors.push(
        'Critical API flow coverage missing: health endpoint readiness/performance assertion was not detected in health integration suite.'
      )
    }
  }

  const requiredWebIntegrationSuites = [
    'apps/web/app/dashboard/page.integration.test.tsx',
    'apps/web/app/invitations/page.integration.test.tsx',
    'apps/web/app/organizations/page.integration.test.tsx',
    'apps/web/components/AuthForm.integration.test.tsx',
    'apps/web/components/CreateOrganizationForm.integration.test.tsx',
    'apps/web/components/CreateInvitationForm.integration.test.tsx',
    'apps/web/components/AcceptInvitationForm.integration.test.tsx',
    'apps/web/components/SignOutButton.integration.test.tsx',
    'apps/web/lib/client-auth.test.ts'
  ]

  for (const requiredPath of requiredWebIntegrationSuites) {
    const absolutePath = resolve(repoRoot, requiredPath)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      errors.push(`Critical web integration coverage missing: \`${requiredPath}\`.`)
    }
  }

  // Note: we intentionally do NOT assert upfront-redirect behavior for the
  // dashboard/invitations/organizations pages. The current design is lazy —
  // pages render a "loading profile..." default state while auth bootstraps,
  // and only redirect on a real 401 via `handleUnauthorizedApiError`. The
  // invitations page additionally supports unauth auto-accept from a `?token=`
  // query param. Those lazy flows are covered by `apps/web/lib/client-auth.test.ts`.

  const invitationsPageSuitePath = resolve(repoRoot, 'apps/web/app/invitations/page.integration.test.tsx')
  if (existsSync(invitationsPageSuitePath) && statSync(invitationsPageSuitePath).isFile()) {
    const invitationsSource = readUtf8(invitationsPageSuitePath)

    if (!/\bcreateUser\s*\(/u.test(invitationsSource) || !/\bcreateOrganization\s*\(/u.test(invitationsSource)) {
      errors.push(
        'Invitations page integration suite must cover authenticated data flow setup via `createUser(...)` and `createOrganization(...)`.'
      )
    }

    if (!/\bclientApi\.createInvitation\s*\(/u.test(invitationsSource)) {
      errors.push(
        'Invitations page integration suite must cover invitation listing flow seeded through `clientApi.createInvitation(...)`.'
      )
    }
  }

  const organizationsPageSuitePath = resolve(repoRoot, 'apps/web/app/organizations/page.integration.test.tsx')
  if (existsSync(organizationsPageSuitePath) && statSync(organizationsPageSuitePath).isFile()) {
    const organizationsSource = readUtf8(organizationsPageSuitePath)

    if (!/\bcreateUser\s*\(/u.test(organizationsSource) || !/\bcreateOrganization\s*\(/u.test(organizationsSource)) {
      errors.push(
        'Organizations page integration suite must cover authenticated data flow setup via `createUser(...)` and `createOrganization(...)`.'
      )
    }
  }

  const clientAuthSuitePath = resolve(repoRoot, 'apps/web/lib/client-auth.test.ts')
  if (existsSync(clientAuthSuitePath) && statSync(clientAuthSuitePath).isFile()) {
    const clientAuthSource = readUtf8(clientAuthSuitePath)
    if (!/handleUnauthorizedApiError/u.test(clientAuthSource)) {
      errors.push(
        'Client auth integration suite must cover `handleUnauthorizedApiError(...)` behavior.'
      )
    }
  }

  const workerActivitiesSuitePath = resolve(repoRoot, 'apps/worker/src/activities.integration.test.ts')
  if (!existsSync(workerActivitiesSuitePath) || !statSync(workerActivitiesSuitePath).isFile()) {
    errors.push('Critical worker integration coverage missing: `apps/worker/src/activities.integration.test.ts`.')
  } else {
    const workerActivitiesSource = readUtf8(workerActivitiesSuitePath)

    if (/\bTRUNCATE\s+TABLE\b/u.test(workerActivitiesSource) || /\bresetPublicTables\s*\(/u.test(workerActivitiesSource)) {
      errors.push(
        'Worker activities integration suite must not truncate shared tables; rely on unique fixtures to avoid cross-project clobbering.'
      )
    }

    if (!/\bactivities\.ping\s*\(/u.test(workerActivitiesSource)) {
      errors.push(
        'Worker activities integration suite must execute `activities.ping(...)` as a baseline smoke test.'
      )
    }

    if (!/\bpingWorkflow\b/u.test(workerActivitiesSource)) {
      errors.push(
        'Worker activities integration suite must execute the `pingWorkflow` end-to-end.'
      )
    }
  }

  const observabilitySuitePath = resolve(repoRoot, 'packages/infra/observability/src/stack.integration.test.ts')
  if (!existsSync(observabilitySuitePath) || !statSync(observabilitySuitePath).isFile()) {
    errors.push('Critical observability integration coverage missing: `packages/infra/observability/src/stack.integration.test.ts`.')
  } else {
    const observabilitySource = readUtf8(observabilitySuitePath)
    const requiredObservabilityMarkers = [
      'tx-agent-kit-api',
      'tx-agent-kit-worker',
      'tx-agent-kit-web',
      'tx-agent-kit-mobile',
      'clientRequestTotalSeriesQuery',
      'nodeServiceStartupSeriesQuery',
      'queryJaegerTraceCount'
    ]

    for (const marker of requiredObservabilityMarkers) {
      if (!observabilitySource.includes(marker)) {
        errors.push(
          `Critical observability flow coverage missing in \`packages/infra/observability/src/stack.integration.test.ts\`: expected marker \`${marker}\`.`
        )
      }
    }

    const hasDbAuthHarness = /\bcreateDbAuthContext\s*\(/u.test(observabilitySource)
    const hasInlineApiHarness = /\bstartApiHarness\s*=\s*async/u.test(observabilitySource)
    if (!hasDbAuthHarness && !hasInlineApiHarness) {
      errors.push(
        'Critical observability coverage missing: stack integration suite must include a real API harness flow (either `createDbAuthContext(...)` or `startApiHarness(...)`).'
      )
    }
  }
}

export const enforceWebIntegrationHarnessContracts = (errors) => {
  const setupPath = resolve(repoRoot, 'apps/web/vitest.integration.setup.ts')
  if (!existsSync(setupPath) || !statSync(setupPath).isFile()) {
    errors.push('Missing required web integration setup file: `apps/web/vitest.integration.setup.ts`.')
    return
  }

  const setupSource = readUtf8(setupPath)
  const requiredSetupMarkers = [
    'setupWebIntegrationSuite',
    'resetWebIntegrationCase',
    'teardownWebIntegrationSuite',
    'beforeAll',
    'beforeEach',
    'afterAll'
  ]

  for (const marker of requiredSetupMarkers) {
    if (!setupSource.includes(marker)) {
      errors.push(
        `Web integration setup must include \`${marker}\` in \`apps/web/vitest.integration.setup.ts\`.`
      )
    }
  }

  const webRoot = resolve(repoRoot, 'apps/web')
  if (!existsSync(webRoot) || !statSync(webRoot).isDirectory()) {
    return
  }

  const integrationTests = listFilesRecursively(webRoot).filter((filePath) =>
    /\.(integration\.test\.ts|integration\.test\.tsx)$/u.test(filePath)
  )

  for (const integrationTestPath of integrationTests) {
    const relativePath = toPosix(relative(repoRoot, integrationTestPath))
    if (relativePath === 'apps/web/vitest.integration.setup.ts') {
      continue
    }

    const source = readUtf8(integrationTestPath)
    if (
      /setupWebIntegrationSuite|resetWebIntegrationCase|teardownWebIntegrationSuite/u.test(source)
    ) {
      errors.push(
        [
          `Web integration test \`${relativePath}\` must not call suite lifecycle functions directly.`,
          'Use centralized lifecycle hooks in `apps/web/vitest.integration.setup.ts`.'
        ].join(' ')
      )
    }
  }
}

export const enforceGlobalIntegrationWorkspaceContracts = (errors) => {
  const workspaceConfigPath = resolve(repoRoot, 'vitest.integration.workspace.ts')
  if (!existsSync(workspaceConfigPath) || !statSync(workspaceConfigPath).isFile()) {
    errors.push('Missing required integration workspace config: `vitest.integration.workspace.ts`.')
    return
  }

  const workspaceConfigSource = readUtf8(workspaceConfigPath)
  const requiredWorkspaceMarkers = [
    'scripts/test/vitest-global-setup.ts',
    'apps/api/vitest.integration.config.ts',
    'apps/web/vitest.integration.config.ts',
    'packages/testkit/vitest.integration.config.ts',
    'apps/worker/vitest.integration.config.ts'
  ]

  for (const marker of requiredWorkspaceMarkers) {
    if (!workspaceConfigSource.includes(marker)) {
      errors.push(`Integration workspace config must include \`${marker}\` in \`vitest.integration.workspace.ts\`.`)
    }
  }

  const globalSetupPath = resolve(repoRoot, 'scripts/test/vitest-global-setup.ts')
  if (!existsSync(globalSetupPath) || !statSync(globalSetupPath).isFile()) {
    errors.push('Missing required integration global setup file: `scripts/test/vitest-global-setup.ts`.')
  }

  const runIntegrationScriptPath = resolve(repoRoot, 'scripts/test/run-integration.sh')
  if (!existsSync(runIntegrationScriptPath) || !statSync(runIntegrationScriptPath).isFile()) {
    errors.push('Missing integration runner script: `scripts/test/run-integration.sh`.')
  } else {
    const runIntegrationSource = readUtf8(runIntegrationScriptPath)
    if (!runIntegrationSource.includes('vitest.integration.workspace.ts')) {
      errors.push(
        'Integration runner must execute root Vitest workspace config (`vitest.integration.workspace.ts`) in `scripts/test/run-integration.sh`.'
      )
    }
  }

  const quietIntegrationScriptPath = resolve(repoRoot, 'scripts/test-integration-quiet.sh')
  if (!existsSync(quietIntegrationScriptPath) || !statSync(quietIntegrationScriptPath).isFile()) {
    errors.push('Missing quiet integration runner script: `scripts/test-integration-quiet.sh`.')
  } else {
    const quietIntegrationSource = readUtf8(quietIntegrationScriptPath)
    if (!quietIntegrationSource.includes('vitest.integration.workspace.ts')) {
      errors.push(
        'Quiet integration runner must execute root Vitest workspace config (`vitest.integration.workspace.ts`) in `scripts/test-integration-quiet.sh`.'
      )
    }
  }

  const disallowLocalGlobalSetupPaths = [
    'apps/api/vitest.integration.config.ts',
    'apps/web/vitest.integration.config.ts',
    'packages/testkit/vitest.integration.config.ts',
    'apps/worker/vitest.integration.config.ts'
  ]

  for (const relativePath of disallowLocalGlobalSetupPaths) {
    const absolutePath = resolve(repoRoot, relativePath)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      errors.push(`Missing integration project config: \`${relativePath}\`.`)
      continue
    }

    const source = readUtf8(absolutePath)
    if (/\bglobalSetup\s*:/u.test(source)) {
      errors.push(
        `Integration project config \`${relativePath}\` must not define local \`globalSetup\`. Use root workspace global setup instead.`
      )
    }
  }

  const integrationProjectConfigPaths = [
    'apps/api/vitest.integration.config.ts',
    'apps/web/vitest.integration.config.ts',
    'packages/testkit/vitest.integration.config.ts',
    'apps/worker/vitest.integration.config.ts'
  ]

  for (const relativePath of integrationProjectConfigPaths) {
    const absolutePath = resolve(repoRoot, relativePath)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      errors.push(`Missing integration project config: \`${relativePath}\`.`)
      continue
    }

    const source = readUtf8(absolutePath)
    if (/\bgroupOrder\s*:/u.test(source)) {
      errors.push(
        `Integration project config \`${relativePath}\` must not pin \`sequence.groupOrder\`; allow workspace-level parallel scheduling.`
      )
    }

    if (/maxWorkers:\s*1/u.test(source)) {
      errors.push(
        `Integration project config \`${relativePath}\` must not force \`maxWorkers: 1\`; use shared env-driven worker policy.`
      )
    }

    if (/fileParallelism:\s*false/u.test(source)) {
      errors.push(
        `Integration project config \`${relativePath}\` must not disable \`fileParallelism\`; use shared env-driven worker policy.`
      )
    }
  }

  const rootVitestConfigPath = resolve(repoRoot, 'vitest.config.ts')
  if (!existsSync(rootVitestConfigPath) || !statSync(rootVitestConfigPath).isFile()) {
    errors.push('Missing root unit workspace config: `vitest.config.ts`.')
  } else {
    const rootVitestConfigSource = readUtf8(rootVitestConfigPath)
    if (/maxWorkers:\s*1/u.test(rootVitestConfigSource)) {
      errors.push(
        'Root unit workspace config must not force `maxWorkers: 1`; use shared env-driven worker policy.'
      )
    }

    if (/fileParallelism:\s*false/u.test(rootVitestConfigSource)) {
      errors.push(
        'Root unit workspace config must not disable `fileParallelism`; use shared env-driven worker policy.'
      )
    }
  }
}

export const enforceTestFilesImportVitest = (errors) => {
  const roots = [
    resolve(repoRoot, 'apps'),
    resolve(repoRoot, 'packages')
  ]

  const vitestMarkers = [
    'from \'vitest\'',
    'from "vitest"',
    'vi.',
    'describe(',
    'it(',
    'test(',
    'expect(',
    'beforeAll(',
    'beforeEach(',
    'afterAll(',
    'afterEach('
  ]

  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      continue
    }

    const testFiles = listFilesRecursively(root).filter((filePath) => {
      const normalized = toPosix(relative(repoRoot, filePath))
      if (!/\.(test|integration\.test)\.(ts|tsx)$/u.test(normalized)) {
        return false
      }
      if (normalized.includes('/node_modules/') || normalized.includes('/.next/') || normalized.includes('/dist/')) {
        return false
      }
      return true
    })

    for (const testFile of testFiles) {
      const source = readUtf8(testFile)
      const hasVitestMarker = vitestMarkers.some((marker) => source.includes(marker))

      if (!hasVitestMarker) {
        errors.push(
          `Test file \`${toPosix(relative(repoRoot, testFile))}\` does not appear to use vitest (no describe/it/test/expect/vi found). Ensure it is a real test file with assertions.`
        )
      }
    }
  }
}

export const enforcePgTapTriggerCoverage = (errors) => {
  const migrationsDir = resolve(repoRoot, 'packages/infra/db/drizzle/migrations')
  const pgtapDir = resolve(repoRoot, 'packages/infra/db/pgtap')

  if (!existsSync(migrationsDir) || !statSync(migrationsDir).isDirectory()) {
    errors.push('Missing migrations directory: `packages/infra/db/drizzle/migrations`.')
    return
  }

  if (!existsSync(pgtapDir) || !statSync(pgtapDir).isDirectory()) {
    errors.push('Missing pgTAP directory: `packages/infra/db/pgtap`.')
    return
  }

  const migrationFiles = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .map((fileName) => resolve(migrationsDir, fileName))
    .sort()

  const triggerNames = new Set()
  const triggerRegex = /CREATE\s+TRIGGER\s+([A-Za-z0-9_]+)/giu

  for (const migrationPath of migrationFiles) {
    const source = readUtf8(migrationPath)
    for (const match of source.matchAll(triggerRegex)) {
      triggerNames.add(match[1])
    }
  }

  if (triggerNames.size === 0) {
    errors.push('No database triggers were detected in migrations; expected trigger coverage contracts.')
    return
  }

  const pgtapFiles = readdirSync(pgtapDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .map((fileName) => resolve(pgtapDir, fileName))
    .sort()

  if (pgtapFiles.length === 0) {
    errors.push('No pgTAP SQL suites found in `packages/infra/db/pgtap`.')
    return
  }

  const pgtapSource = pgtapFiles.map((filePath) => readUtf8(filePath)).join('\n')

  for (const triggerName of triggerNames) {
    const triggerReferenceRegex = new RegExp(`\\b${triggerName}\\b`, 'u')
    if (!triggerReferenceRegex.test(pgtapSource)) {
      errors.push(
        `Missing pgTAP coverage marker for trigger \`${triggerName}\`. Reference this trigger in \`packages/infra/db/pgtap/*.sql\`.`
      )
    }
  }
}
