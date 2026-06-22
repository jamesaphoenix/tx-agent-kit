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
  // Test-only: swaps the live Temporal-backed AutoFixTriggerPort for an
  // in-process recording stub (see isAutoFixTriggerStubMode). Never set in a
  // real deployment, so it must not appear in the deploy env templates.
  'AUTO_FIX_TRIGGER_MODE',
  // Auth rate-limit tuning knobs (code defaults apply when unset).
  'AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS',
  'AUTH_RATE_LIMIT_MAX_REQUESTS',
  'AUTH_RATE_LIMIT_WINDOW_MS',
  // Outbox dispatcher tuning knobs (code defaults apply when unset).
  'OUTBOX_POLL_BATCH_SIZE',
  'OUTBOX_PRUNE_RETENTION_DAYS',
  'OUTBOX_STUCK_THRESHOLD_MINUTES',
  'RESERVATION_RECLAIM_MAX_AGE_SECONDS',
  // Lifecycle drip-sweep + activity-scan cadence/sizing tuning knobs (code
  // defaults apply when unset: 5m sweep, 100/batch, 50 batches/run, 24h scan).
  'DRIP_SWEEP_INTERVAL_MINUTES',
  'DRIP_SWEEP_BATCH_SIZE',
  'DRIP_SWEEP_MAX_BATCHES',
  'LIFECYCLE_SCAN_INTERVAL_HOURS',
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
  // Test-only stub toggle for the auto-fix Temporal trigger; never wired in a
  // normal local .env (see isAutoFixTriggerStubMode).
  'AUTO_FIX_TRIGGER_MODE',
  // Auto-fix webhook controls are deployment-only and presence-gated; local dev
  // does not wire the alert rule (see getSentryWebhookConfig).
  'SENTRY_DEPLOYMENT_ENVIRONMENT',
  'SENTRY_WEBHOOK_SECRET',
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

const enforceK3sRuntimeParityContracts = () => {
  // Chart deployments must wire imagePullSecrets so private-registry pulls work
  // on self-hosted k3s/k3d nodes.
  const chartTemplatesWithPullSecrets = [
    'deploy/k8s/chart/templates/api-deployment.yaml',
    'deploy/k8s/chart/templates/worker-deployment.yaml',
    'deploy/k8s/chart/templates/otel-deployment.yaml'
  ]

  for (const relativePath of chartTemplatesWithPullSecrets) {
    const templatePath = resolve(repoRoot, relativePath)
    if (!existsSync(templatePath) || !statSync(templatePath).isFile()) {
      fail(`Missing chart template: \`${relativePath}\`.`)
      continue
    }

    const source = readUtf8(templatePath)
    for (const fragment of ['{{- with .Values.imagePullSecrets }}', 'imagePullSecrets:']) {
      if (!source.includes(fragment)) {
        fail(
          `Chart template \`${relativePath}\` must wire \`${fragment}\` so private-registry image pulls work.`
        )
      }
    }
  }

  // render-runtime-values must support private-registry pulls and pin the
  // in-container API port so pods listen on the chart port, not the external
  // host/NodePort carried in the deploy env.
  const renderRuntimePath = resolve(repoRoot, 'scripts/deploy/render-runtime-values.mjs')
  if (!existsSync(renderRuntimePath) || !statSync(renderRuntimePath).isFile()) {
    fail('Missing `scripts/deploy/render-runtime-values.mjs`.')
  } else {
    const source = readUtf8(renderRuntimePath)
    for (const fragment of [
      '--image-pull-secret-name',
      "runtimeEnv.API_PORT = '4000'",
      "runtimeEnv.API_HOST = '0.0.0.0'"
    ]) {
      if (!source.includes(fragment)) {
        fail(
          `\`scripts/deploy/render-runtime-values.mjs\` must include \`${fragment}\` for k3s runtime parity.`
        )
      }
    }
  }

  // Deployment compose must probe OTEL via the otel-healthcheck sidecar (the
  // upstream collector image has no shell/wget), and pin the in-container API
  // port so it matches the chart and rendered Kubernetes values.
  for (const relativePath of ['docker-compose.staging.yml', 'docker-compose.prod.yml']) {
    const composePath = resolve(repoRoot, relativePath)
    if (!existsSync(composePath) || !statSync(composePath).isFile()) {
      fail(`Missing deployment compose file: \`${relativePath}\`.`)
      continue
    }

    const source = readUtf8(composePath)
    for (const fragment of [
      'otel-healthcheck:',
      "test: ['CMD', 'curl', '-fsS', 'http://otel-collector:13133/health/status']",
      "API_PORT: '4000'"
    ]) {
      if (!source.includes(fragment)) {
        fail(
          `Deployment compose \`${relativePath}\` must include \`${fragment}\` for k3s/compose runtime parity.`
        )
      }
    }

    if (source.includes("'http://127.0.0.1:13133/health/status'")) {
      fail(
        `Deployment compose \`${relativePath}\` must not probe OTEL with wget inside the collector image; use the otel-healthcheck sidecar instead.`
      )
    }
  }
}

enforceComposeRuntimePlacementContracts()
enforceRuntimeEnvTemplateParityContracts()
enforceK3sRuntimeParityContracts()

if (errors.length > 0) {
  console.error('Compose runtime placement check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Compose runtime placement check passed.')
