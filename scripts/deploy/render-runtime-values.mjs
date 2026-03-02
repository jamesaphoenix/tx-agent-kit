#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

const args = process.argv.slice(2)

const usage = () => {
  console.error(
    [
      'Usage: render-runtime-values.mjs',
      '  --env-file <path>',
      '  --api-image <ref>',
      '  --worker-image <ref>',
      '  --output <path>',
      '  [--otel-endpoint <url>]'
    ].join('\\n')
  )
}

const readArg = (flag) => {
  const index = args.indexOf(flag)
  if (index === -1) {
    return null
  }

  if (index + 1 >= args.length) {
    throw new Error(`Missing value for ${flag}`)
  }

  return args[index + 1]
}

const envFile = readArg('--env-file')
const apiImage = readArg('--api-image')
const workerImage = readArg('--worker-image')
const outputPath = readArg('--output')
const otelEndpoint = readArg('--otel-endpoint')

if (!envFile || !apiImage || !workerImage || !outputPath) {
  usage()
  process.exit(1)
}

const envSource = readFileSync(envFile, 'utf8')
const runtimeEnv = {}

const normalizeQuotedValue = (value) => {
  if (value.length < 2) {
    return value
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/gu, '\n')
      .replace(/\\"/gu, '"')
      .replace(/\\\\/gu, '\\')
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/gu, "'").replace(/\\n/gu, '\n')
  }

  return value
}

const envLines = envSource.split(/\r?\n/u)
for (let index = 0; index < envLines.length; index += 1) {
  const rawLine = envLines[index]
  const line = rawLine.trim()
  if (line.length === 0 || line.startsWith('#')) {
    continue
  }

  const separatorIndex = rawLine.indexOf('=')
  if (separatorIndex <= 0) {
    throw new Error(`Invalid env line in ${envFile} at ${index + 1}: ${rawLine}`)
  }

  const key = rawLine.slice(0, separatorIndex).trim()
  if (!/^[A-Z0-9_]+$/u.test(key)) {
    throw new Error(`Invalid env key '${key}' in ${envFile} at ${index + 1}`)
  }

  let value = rawLine.slice(separatorIndex + 1)
  const startsWithDoubleQuote = value.startsWith('"')
  const startsWithSingleQuote = value.startsWith("'")
  if (startsWithDoubleQuote || startsWithSingleQuote) {
    const quote = startsWithDoubleQuote ? '"' : "'"
    while (!value.endsWith(quote) && index + 1 < envLines.length) {
      index += 1
      value = `${value}\n${envLines[index]}`
    }
  }

  let normalizedValue = normalizeQuotedValue(value)
  if (key.endsWith('_PEM')) {
    normalizedValue = normalizedValue.replace(/\\n/gu, '\n')
  }

  runtimeEnv[key] = normalizedValue
}

if (otelEndpoint) {
  runtimeEnv.OTEL_EXPORTER_OTLP_ENDPOINT = otelEndpoint
}

const yamlQuote = (value) => `'${String(value).replace(/'/g, "''")}'`

const yamlLines = [
  'images:',
  `  api: ${yamlQuote(apiImage)}`,
  `  worker: ${yamlQuote(workerImage)}`,
  'runtimeEnv:'
]

for (const key of Object.keys(runtimeEnv).sort((left, right) => left.localeCompare(right))) {
  yamlLines.push(`  ${key}: ${yamlQuote(runtimeEnv[key])}`)
}

yamlLines.push('')
writeFileSync(outputPath, yamlLines.join('\n'))
