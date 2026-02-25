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

if (errors.length > 0) {
  console.error('Compose runtime placement check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Compose runtime placement check passed.')
