#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const errors = []

const toPosix = (value) => value.split(sep).join('/')
const fail = (message) => {
  errors.push(message)
}
const readUtf8 = (path) => readFileSync(path, 'utf8')

const extractEnvTemplateKeys = (source) =>
  new Set(
    Array.from(source.matchAll(/^([A-Z][A-Z0-9_]*)=/gm), (match) => match[1])
  )

const extractApiEnvShapeKeys = (source) => {
  const shapeMatch = source.match(/const requiredApiEnvShape = \{([\s\S]*?)\n\} as const/)
  if (!shapeMatch) {
    fail('Unable to find `requiredApiEnvShape` in `apps/api/src/config/env.ts`.')
    return new Set()
  }

  return new Set(
    Array.from(shapeMatch[1].matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm), (match) => match[1])
  )
}

const extractProcessEnvKeys = (source) =>
  new Set(
    Array.from(source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g), (match) => match[1])
  )

const extractAiEnvKeys = (source) => {
  const interfaceMatch = source.match(/export interface AiEnv \{([\s\S]*?)\n\}/)
  if (!interfaceMatch) {
    fail('Unable to find `AiEnv` in `packages/infra/ai/src/env.ts`.')
    return new Set()
  }

  return new Set(
    Array.from(interfaceMatch[1].matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm), (match) => match[1])
  )
}

const unionSets = (...sets) => new Set(sets.flatMap((set) => Array.from(set)))

// Runtime keys that are intentionally absent from the deployment templates
// (deploy/env/{staging,prod}.env.template). Each entry is either a tuning knob
// with a safe code default, an optional feature surface, or a value supplied at
// runtime (workflow secret / vault field) rather than the rendered env file.
const deployRuntimeEnvExemptions = new Set([
  // Auth rate-limit tuning knobs (code defaults apply when unset).
  'AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS',
  'AUTH_RATE_LIMIT_MAX_REQUESTS',
  'AUTH_RATE_LIMIT_WINDOW_MS',
  // Outbox dispatcher tuning knobs (code defaults apply when unset).
  'OUTBOX_POLL_BATCH_SIZE',
  'OUTBOX_PRUNE_RETENTION_DAYS',
  'OUTBOX_STUCK_THRESHOLD_MINUTES',
  'RESERVATION_RECLAIM_MAX_AGE_SECONDS',
  // AI routing has built-in OpenRouter defaults; only the API key is required.
  'OPENROUTER_BASE_URL',
  'OPENROUTER_EMBEDDING_MODEL',
  'OPENROUTER_MODEL',
  // Feature toggles with safe defaults.
  'SUBSCRIPTION_GUARD_ENABLED',
  'TRUST_PROXY',
  'TURNSTILE_VERIFY_URL',
  'WORKER_ENABLE_SCHEDULES',
  // Optional plan IDs (billing tiers may not be provisioned per environment).
  'STRIPE_AGENCY_PRICE_ID',
  'STRIPE_PRO_PRICE_ID',
  'STRIPE_TRY_ME_PRICE_ID',
  // Optional task queue override (derived from the default task queue).
  'EMAIL_CAMPAIGNS_TASK_QUEUE',
  // Optional Sentry DSNs (left commented in the templates until enabled).
  'API_SENTRY_DSN',
  'WORKER_SENTRY_DSN',
  // Local dev observability only.
  'SENTRY_SPOTLIGHT',
  // Optional Temporal TLS PEM material (supplied at runtime / vault field).
  'TEMPORAL_TLS_CA_CERT_PEM',
  'TEMPORAL_TLS_CLIENT_CERT_PEM',
  'TEMPORAL_TLS_CLIENT_KEY_PEM'
])

// Runtime keys that are intentionally absent from the local template
// (.env.example). Same classification as above, scoped to local dev defaults.
const localRuntimeEnvExemptions = new Set([
  // Auth rate-limit tuning knobs (code defaults apply when unset).
  'AUTH_RATE_LIMIT_BYPASS_TOKEN',
  'AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS',
  'AUTH_RATE_LIMIT_MAX_REQUESTS',
  'AUTH_RATE_LIMIT_WINDOW_MS',
  // Outbox dispatcher tuning knobs (code defaults apply when unset).
  'OUTBOX_POLL_BATCH_SIZE',
  'OUTBOX_PRUNE_RETENTION_DAYS',
  'OUTBOX_STUCK_THRESHOLD_MINUTES',
  'RESERVATION_RECLAIM_MAX_AGE_SECONDS',
  // AI routing has built-in OpenRouter defaults; only the API key is required.
  'OPENROUTER_BASE_URL',
  'OPENROUTER_EMBEDDING_MODEL',
  'OPENROUTER_MODEL',
  // Feature toggles with safe defaults.
  'SUBSCRIPTION_GUARD_ENABLED',
  'TRUST_PROXY',
  'TURNSTILE_VERIFY_URL',
  'WORKER_ENABLE_SCHEDULES',
  // Optional task queue override (derived from the default task queue).
  'EMAIL_CAMPAIGNS_TASK_QUEUE',
  // Optional Temporal TLS PEM material (supplied at runtime / vault field).
  'TEMPORAL_TLS_CA_CERT_PEM',
  'TEMPORAL_TLS_CLIENT_CERT_PEM',
  'TEMPORAL_TLS_CLIENT_KEY_PEM'
])

const deriveRuntimeEnvKeys = () => {
  const apiEnvSource = readUtf8(resolve(repoRoot, 'apps/api/src/config/env.ts'))
  const workerEnvSource = readUtf8(resolve(repoRoot, 'apps/worker/src/config/env.ts'))
  const aiEnvSource = readUtf8(resolve(repoRoot, 'packages/infra/ai/src/env.ts'))

  return unionSets(
    extractApiEnvShapeKeys(apiEnvSource),
    extractProcessEnvKeys(workerEnvSource),
    extractAiEnvKeys(aiEnvSource)
  )
}

const enforceRuntimeEnvTemplateParityContracts = () => {
  const runtimeEnvKeys = deriveRuntimeEnvKeys()
  const localTemplatePath = '.env.example'
  const localTemplateKeys = extractEnvTemplateKeys(readUtf8(resolve(repoRoot, localTemplatePath)))

  for (const key of Array.from(runtimeEnvKeys).sort()) {
    if (!localTemplateKeys.has(key) && !localRuntimeEnvExemptions.has(key)) {
      fail(
        `Local env template \`${localTemplatePath}\` must define runtime env key \`${key}\`, or classify it in localRuntimeEnvExemptions.`
      )
    }
  }

  for (const relativePath of ['deploy/env/staging.env.template', 'deploy/env/prod.env.template']) {
    const templatePath = resolve(repoRoot, relativePath)
    if (!existsSync(templatePath) || !statSync(templatePath).isFile()) {
      fail(`Missing deployment env template: \`${relativePath}\`.`)
      continue
    }

    const templateKeys = extractEnvTemplateKeys(readUtf8(templatePath))
    for (const key of Array.from(runtimeEnvKeys).sort()) {
      if (!templateKeys.has(key) && !deployRuntimeEnvExemptions.has(key)) {
        fail(
          `Deployment env template \`${relativePath}\` must define runtime env key \`${key}\`, or classify it in deployRuntimeEnvExemptions.`
        )
      }
    }
  }
}

const enforceComposeRuntimePlacementContracts = () => {
  const localComposePath = resolve(repoRoot, 'docker-compose.yml')
  if (!existsSync(localComposePath) || !statSync(localComposePath).isFile()) {
    fail('Missing local Docker Compose file: `docker-compose.yml`.')
    return
  }

  const localComposeSource = readUtf8(localComposePath)
  const localDisallowedServices = ['api', 'worker']
  for (const serviceName of localDisallowedServices) {
    const serviceRegex = new RegExp(`^\\s{2}${serviceName}:\\s*$`, 'mu')
    if (serviceRegex.test(localComposeSource)) {
      fail(
        [
          `Local compose must remain infra-only: found \`${serviceName}\` service in \`docker-compose.yml\`.`,
          'Run API/Web/Worker as local hot-reloading processes in development.'
        ].join(' ')
      )
    }
  }

  const deploymentComposeFiles = [
    'docker-compose.staging.yml',
    'docker-compose.prod.yml'
  ]

  for (const relativePath of deploymentComposeFiles) {
    const composePath = resolve(repoRoot, relativePath)
    if (!existsSync(composePath) || !statSync(composePath).isFile()) {
      fail(`Missing deployment compose file: \`${relativePath}\`.`)
      continue
    }

    const source = readUtf8(composePath)
    for (const requiredService of ['api', 'worker']) {
      const serviceRegex = new RegExp(`^\\s{2}${requiredService}:\\s*$`, 'mu')
      if (!serviceRegex.test(source)) {
        fail(
          `Deployment compose \`${relativePath}\` must include \`${requiredService}\` service.`
        )
      }
    }
  }
}

enforceComposeRuntimePlacementContracts()
enforceRuntimeEnvTemplateParityContracts()

if (errors.length > 0) {
  console.error('Compose runtime placement check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Compose runtime placement check passed.')
