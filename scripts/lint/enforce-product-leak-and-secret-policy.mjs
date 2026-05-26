#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '../..')
const policyPath = resolve(scriptDir, 'product-leak-policy.json')

const toPosix = (value) => value.replaceAll('\\', '/')

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const loadPolicy = () =>
  JSON.parse(readFileSync(policyPath, 'utf8'))

const compilePatterns = (patterns = []) => patterns.map((pattern) => new RegExp(pattern, 'u'))

export const isAllowedPath = (filePath, prefixes = []) =>
  prefixes.some((prefix) => filePath === prefix || filePath.startsWith(prefix))

const shouldSkipPath = (filePath, policy) =>
  compilePatterns(policy.skipPathPatterns).some((pattern) => pattern.test(filePath))

const shouldScanSecrets = (filePath, policy) =>
  compilePatterns(policy.secretScanPathPatterns).some((pattern) => pattern.test(filePath))

const isProbablyBinary = (buffer) => buffer.includes(0)

export const scanFilePath = (filePath, policy) => {
  if (isAllowedPath(filePath, policy.allowedProductLeakPathPrefixes)) {
    return []
  }

  const findings = []
  for (const denyTerm of policy.denyTerms) {
    const termRegex = new RegExp(escapeRegExp(denyTerm.value), 'u')
    if (termRegex.test(filePath)) {
      findings.push({
        type: 'product-leak',
        id: denyTerm.id,
        file: filePath,
        line: 0,
        message: `Forbidden product/source token '${denyTerm.value}' found in path ${filePath}`
      })
    }
  }

  return findings
}

const normalizeSecretValue = (rawValue) => {
  let value = rawValue.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim()
  }
  return value
}

export const isAllowedSecretValue = (filePath, value, policy) => {
  const normalized = normalizeSecretValue(value)
  if (compilePatterns(policy.allowSecretValuePatterns).some((pattern) => pattern.test(normalized))) {
    return true
  }

  if (
    policy.localSecretDefaultPaths?.includes(filePath) &&
    policy.localSecretDefaultValues?.includes(normalized)
  ) {
    return true
  }

  return false
}

export const scanContent = (filePath, content, policy) => {
  const findings = []
  const allowedProductLeak = isAllowedPath(filePath, policy.allowedProductLeakPathPrefixes)
  const lines = content.split(/\r?\n/u)

  if (!allowedProductLeak) {
    for (const denyTerm of policy.denyTerms) {
      const termRegex = new RegExp(escapeRegExp(denyTerm.value), 'u')
      for (const [index, line] of lines.entries()) {
        if (termRegex.test(line)) {
          findings.push({
            type: 'product-leak',
            id: denyTerm.id,
            file: filePath,
            line: index + 1,
            message: `Forbidden product/source token '${denyTerm.value}' found in ${filePath}:${index + 1}`
          })
        }
      }
    }
  }

  if (shouldScanSecrets(filePath, policy)) {
    const assignmentRegex = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|WEBHOOK_SECRET|DSN)[A-Z0-9_]*)\s*[:=]\s*(.*?)\s*$/u
    for (const [index, line] of lines.entries()) {
      if (/^\s*#/u.test(line)) {
        continue
      }

      const match = assignmentRegex.exec(line)
      if (!match) {
        continue
      }

      const [, key, rawValue] = match
      const value = normalizeSecretValue(rawValue)
      if (isAllowedSecretValue(filePath, value, policy)) {
        continue
      }

      findings.push({
        type: 'plaintext-secret',
        id: key,
        file: filePath,
        line: index + 1,
        message: `Plaintext secret-like value for ${key} in ${filePath}:${index + 1}; use an op:// reference, GitHub secret expression, blank placeholder, or documented local-only default.`
      })
    }
  }

  return findings
}

export const listGitFiles = () =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(toPosix)

export const scanRepo = (policy = loadPolicy()) => {
  const findings = []
  for (const filePath of listGitFiles()) {
    if (shouldSkipPath(filePath, policy)) {
      continue
    }

    findings.push(...scanFilePath(filePath, policy))

    const absolutePath = resolve(repoRoot, filePath)
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      continue
    }

    const buffer = readFileSync(absolutePath)
    if (isProbablyBinary(buffer)) {
      continue
    }

    findings.push(...scanContent(filePath, buffer.toString('utf8'), policy))
  }

  return findings
}

const main = () => {
  const findings = scanRepo()
  if (findings.length === 0) {
    console.log('Product leak and plaintext secret policy passed.')
    return
  }

  console.error('Product leak and plaintext secret policy failed:')
  for (const finding of findings) {
    console.error(`- ${finding.message}`)
  }
  process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
