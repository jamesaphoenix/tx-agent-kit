#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

const readJson = (path) => JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'))

const rootPackage = readJson('package.json')
const generated = readJson('packages/contracts/src/agent-client-surface.generated.json')

const requiredScripts = [
  'agent-surfaces:generate',
  'agent-surfaces:check'
]

for (const scriptName of requiredScripts) {
  if (typeof rootPackage.scripts?.[scriptName] !== 'string') {
    throw new Error(`package.json is missing ${scriptName}.`)
  }
}

if (!Array.isArray(generated.operations) || generated.operations.length === 0) {
  throw new Error('Generated agent surface registry has no operations.')
}

const assertUnique = (values, label) => {
  const unique = new Set(values)
  if (unique.size !== values.length) {
    throw new Error(`Generated agent surface registry has duplicate ${label}.`)
  }
}

assertUnique(generated.operations.map((operation) => operation.key), 'keys')
assertUnique(generated.operations.map((operation) => operation.cliCommand), 'CLI commands')
assertUnique(generated.operations.map((operation) => operation.mcpTool), 'MCP tools')

const missingCli = generated.operations.filter((operation) => typeof operation.cliCommand !== 'string' || operation.cliCommand.length === 0)
if (missingCli.length > 0) {
  throw new Error(`Generated agent surface registry has operations without CLI commands: ${missingCli.map((operation) => operation.key).join(', ')}`)
}

const missingMcp = generated.operations.filter((operation) => typeof operation.mcpTool !== 'string' || operation.mcpTool.length === 0)
if (missingMcp.length > 0) {
  throw new Error(`Generated agent surface registry has operations without MCP tools: ${missingMcp.map((operation) => operation.key).join(', ')}`)
}

console.log(`Agent client surface sync passed for ${generated.operations.length} operations.`)
