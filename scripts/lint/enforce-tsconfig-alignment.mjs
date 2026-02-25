#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const repoRoot = process.cwd()
const errors = []

const toPosix = (value) => value.split(sep).join('/')
const fail = (message) => {
  errors.push(message)
}
const readUtf8 = (path) => readFileSync(path, 'utf8')

const normalizeRelativePath = (value) => toPosix(value).replace(/^\.\/+/u, '').replace(/\/+$/u, '')

const parseTsConfig = (relativePath) => {
  const absolutePath = resolve(repoRoot, relativePath)
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    fail(`Missing required TS config: \`${relativePath}\`.`)
    return null
  }

  const source = readUtf8(absolutePath)
  const parsed = ts.parseConfigFileTextToJson(absolutePath, source)
  if (parsed.error) {
    const message = ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n')
    fail(`Failed to parse \`${relativePath}\`: ${message}`)
    return null
  }

  if (!parsed.config || typeof parsed.config !== 'object') {
    fail(`Parsed \`${relativePath}\` is empty or invalid JSON object.`)
    return null
  }

  return parsed.config
}

const resolvePackageRootFromAliasTarget = (aliasTarget) => {
  const normalized = normalizeRelativePath(aliasTarget)
  if (!normalized.startsWith('packages/') || normalized.includes('*')) {
    return null
  }

  const segments = normalized.split('/').filter(Boolean)
  for (let end = segments.length; end >= 2; end -= 1) {
    const candidate = segments.slice(0, end).join('/')
    if (!candidate.startsWith('packages/')) {
      continue
    }

    const candidateDir = resolve(repoRoot, candidate)
    const candidateTsconfig = resolve(candidateDir, 'tsconfig.json')
    if (existsSync(candidateDir) && statSync(candidateDir).isDirectory() && existsSync(candidateTsconfig)) {
      return candidate
    }
  }

  return null
}

const collectReferencedProjects = (rootConfig) => {
  if (!Array.isArray(rootConfig.references)) {
    fail('`tsconfig.json` must declare a `references` array.')
    return new Set()
  }

  const referencePaths = new Set()
  for (const reference of rootConfig.references) {
    if (!reference || typeof reference !== 'object' || typeof reference.path !== 'string') {
      fail('Each root `tsconfig.json` reference must be an object with a string `path`.')
      continue
    }

    const normalizedPath = normalizeRelativePath(reference.path)
    referencePaths.add(normalizedPath)

    const referenceDir = resolve(repoRoot, normalizedPath)
    if (!existsSync(referenceDir) || !statSync(referenceDir).isDirectory()) {
      fail(
        `Root tsconfig reference path does not exist: \`${reference.path}\` (resolved to \`${normalizedPath}\`).`
      )
      continue
    }

    const referenceTsconfig = resolve(referenceDir, 'tsconfig.json')
    if (!existsSync(referenceTsconfig) || !statSync(referenceTsconfig).isFile()) {
      fail(
        `Root tsconfig reference must point to a directory with \`tsconfig.json\`: \`${reference.path}\`.`
      )
    }
  }

  return referencePaths
}

const collectAliasedPackageProjects = (baseConfig) => {
  const paths = baseConfig?.compilerOptions?.paths
  if (!paths || typeof paths !== 'object') {
    fail('`tsconfig.base.json` must declare `compilerOptions.paths`.')
    return new Map()
  }

  const packageToAliases = new Map()

  for (const [aliasName, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) {
      fail(`Path alias \`${aliasName}\` in \`tsconfig.base.json\` must contain at least one target.`)
      continue
    }

    for (const target of targets) {
      if (typeof target !== 'string') {
        fail(`Path alias \`${aliasName}\` in \`tsconfig.base.json\` has a non-string target.`)
        continue
      }

      const packageRoot = resolvePackageRootFromAliasTarget(target)
      if (!packageRoot) {
        continue
      }

      if (!packageToAliases.has(packageRoot)) {
        packageToAliases.set(packageRoot, new Set())
      }
      packageToAliases.get(packageRoot).add(aliasName)
    }
  }

  return packageToAliases
}

const enforceTsconfigAlignment = () => {
  const baseConfig = parseTsConfig('tsconfig.base.json')
  const rootConfig = parseTsConfig('tsconfig.json')
  if (!baseConfig || !rootConfig) {
    return
  }

  const referencedProjects = collectReferencedProjects(rootConfig)
  const aliasedPackageProjects = collectAliasedPackageProjects(baseConfig)

  for (const [packagePath, aliasNames] of aliasedPackageProjects.entries()) {
    if (referencedProjects.has(packagePath)) {
      continue
    }

    const aliases = [...aliasNames].sort().map((alias) => `\`${alias}\``).join(', ')
    fail(
      [
        `Root \`tsconfig.json\` is missing project reference for aliased package \`${packagePath}\`.`,
        `Add \`{ \"path\": \"./${packagePath}\" }\` to root references to align with path alias(es): ${aliases}.`
      ].join(' ')
    )
  }
}

enforceTsconfigAlignment()

if (errors.length > 0) {
  console.error('TS config alignment check failed:\n')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('TS config alignment check passed.')
