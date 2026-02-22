#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const apiEnvPath = path.join(root, 'apps/api/src/config/env.ts')
const ciWorkflowPath = path.join(root, '.github/workflows/integration-tests.yml')

const extractRequiredApiEnv = (source) => {
  const shapeMatch = source.match(/const requiredApiEnvShape = \{([\s\S]*?)\} as const/)
  if (!shapeMatch || !shapeMatch[1]) {
    throw new Error('Could not find requiredApiEnvShape block in apps/api/src/config/env.ts')
  }

  const keys = []
  for (const match of shapeMatch[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)) {
    if (match[1]) {
      keys.push(match[1])
    }
  }

  return [...new Set(keys)]
}

const extractWorkflowEnv = (source) => {
  const keys = new Set()
  const lines = source.split('\n')

  const indentation = (line) => {
    const match = line.match(/^(\s*)/)
    return match?.[1]?.length ?? 0
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!/^\s*env:\s*$/.test(line)) {
      continue
    }

    const envIndent = indentation(line)

    for (let j = i + 1; j < lines.length; j += 1) {
      const envLine = lines[j]
      if (envLine.trim().length === 0 || envLine.trimStart().startsWith('#')) {
        continue
      }

      const currentIndent = indentation(envLine)
      if (currentIndent <= envIndent) {
        break
      }

      const keyMatch = envLine.match(/^\s*([A-Z][A-Z0-9_]*)\s*:/)
      if (keyMatch?.[1]) {
        keys.add(keyMatch[1])
      }
    }
  }

  return keys
}

const main = () => {
  if (!fs.existsSync(apiEnvPath)) {
    throw new Error(`Missing API env schema file: ${apiEnvPath}`)
  }

  if (!fs.existsSync(ciWorkflowPath)) {
    throw new Error(`Missing CI workflow file: ${ciWorkflowPath}`)
  }

  const apiEnvSource = fs.readFileSync(apiEnvPath, 'utf8')
  const workflowSource = fs.readFileSync(ciWorkflowPath, 'utf8')

  const requiredApiKeys = extractRequiredApiEnv(apiEnvSource)
  const ciKeys = extractWorkflowEnv(workflowSource)

  const missing = requiredApiKeys.filter((key) => !ciKeys.has(key))

  if (missing.length > 0) {
    console.error('CI env validation failed. Missing API env keys in .github/workflows/integration-tests.yml:')
    for (const key of missing) {
      console.error(`- ${key}`)
    }
    process.exit(1)
  }

  console.log(`CI env validation passed (${requiredApiKeys.length} required API env keys mapped).`)
}

main()
