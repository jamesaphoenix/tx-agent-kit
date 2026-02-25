#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

const roots = ['apps', 'packages']
const ignoredDirs = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  'coverage',
  'dist',
  'node_modules',
  'out'
])
const integrationConfigName = 'vitest.integration.config.ts'
const packageJsonName = 'package.json'

const parseJsonFile = (filePath) => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

const records = []

const walk = (dirPath) => {
  const entries = readdirSync(dirPath, { withFileTypes: true })
  const packageJsonEntry = entries.find(
    (entry) => entry.isFile() && entry.name === packageJsonName
  )
  const integrationConfigEntry = entries.find(
    (entry) => entry.isFile() && entry.name === integrationConfigName
  )

  if (packageJsonEntry && integrationConfigEntry) {
    const packageJsonPath = resolve(dirPath, packageJsonEntry.name)
    const manifest = parseJsonFile(packageJsonPath)
    const packageName = typeof manifest?.name === 'string' ? manifest.name : null
    if (packageName) {
      records.push({
        packageName,
        projectId: basename(dirPath).toLowerCase(),
        configPath: relative(repoRoot, resolve(dirPath, integrationConfigEntry.name))
      })
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    if (ignoredDirs.has(entry.name)) {
      continue
    }

    walk(resolve(dirPath, entry.name))
  }
}

for (const root of roots) {
  const rootPath = resolve(repoRoot, root)
  if (!existsSync(rootPath)) {
    continue
  }

  walk(rootPath)
}

for (const record of records.sort((left, right) =>
  left.packageName.localeCompare(right.packageName)
)) {
  process.stdout.write(
    `${record.packageName}\t${record.projectId}\t${record.configPath}\n`
  )
}
