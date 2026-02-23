#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , scriptName] = process.argv

if (!scriptName) {
  console.error('Usage: discover-packages-with-script.mjs <script-name>')
  process.exit(1)
}

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

const discovered = new Set()

const parseJsonFile = (filePath) => {
  try {
    const content = readFileSync(filePath, 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

const walk = (dirPath) => {
  const entries = readdirSync(dirPath, { withFileTypes: true })
  const packageJson = entries.find((entry) => entry.isFile() && entry.name === 'package.json')

  if (packageJson) {
    const packageJsonPath = resolve(dirPath, packageJson.name)
    const manifest = parseJsonFile(packageJsonPath)
    const packageName = typeof manifest?.name === 'string' ? manifest.name : null
    const hasScript =
      manifest?.scripts &&
      typeof manifest.scripts === 'object' &&
      Object.prototype.hasOwnProperty.call(manifest.scripts, scriptName)

    if (packageName && hasScript) {
      discovered.add(packageName)
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

for (const packageName of [...discovered].sort()) {
  process.stdout.write(`${packageName}\n`)
}
