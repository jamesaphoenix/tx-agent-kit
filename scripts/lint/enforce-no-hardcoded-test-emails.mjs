#!/usr/bin/env node

/**
 * Structural lint: ban hardcoded `email:` literals on `createUser(...)`
 * call sites in `*.integration.test.ts` files.
 *
 * Why: the integration test harness runs in shared-server mode (no per-test
 * schema reset — see `packages/testkit/src/db-auth-context.ts`). Hardcoded
 * literals like `email: 'permissions-owner@example.com'` collide on the
 * SECOND test run with a 409 Conflict, because the previous run's row is
 * still in the `users` table.
 *
 * The right fix is to let the testkit factory generate a unique email per
 * call: `createUserFactory` already defaults to
 * `email: options.email ?? generateEmail('user')`. Tests that need to
 * read the email value back use `result.credentials.email`. Only tests
 * that exercise the email-uniqueness CONSTRAINT itself need a literal —
 * those can opt in via the `// eslint-disable-next-line` style escape
 * (or in this script's case, the `ALLOW_HARDCODED_TEST_EMAIL` marker
 * comment placed on the line above the literal).
 *
 * What's blocked:
 *   await createUser(ctx, {
 *     email: 'foo@example.com',
 *     ...
 *   })
 *
 * What's allowed:
 *   await createUser(ctx, { name: 'Alice' })            // no email passed
 *   await createUser(ctx, {                              // explicit opt-in
 *     // ALLOW_HARDCODED_TEST_EMAIL: testing uniqueness constraint
 *     email: 'collision@example.com'
 *   })
 *   await createUser(ctx, {
 *     email: `${prefix}-${randomUUID()}@example.com`     // template literal
 *   })
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const errors = []
const toPosix = (value) => value.split(sep).join('/')
const readUtf8 = (path) => readFileSync(path, 'utf8')

const listFilesRecursively = (rootDir) => {
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    return []
  }
  const out = []
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = resolve(rootDir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFilesRecursively(fullPath))
      continue
    }
    out.push(fullPath)
  }
  return out
}

const isIntegrationTestFile = (normalizedPath) => {
  if (!/\.integration\.test\.tsx?$/u.test(normalizedPath)) {
    return false
  }
  if (normalizedPath.includes('/node_modules/') || normalizedPath.includes('/dist/')) {
    return false
  }
  return true
}

// Capture three consecutive lines to give a clear error message.
// Pattern: a line that opens a string literal `email: '...'@example.com` or
// a line that opens with `email: "...@example.com"`.
const HARDCODED_EMAIL_REGEX = /(^|\s)email\s*:\s*['"][^'"`]*@[^'"`]*['"]/

const ALLOW_MARKER = 'ALLOW_HARDCODED_TEST_EMAIL'

const sourceRoots = [resolve(repoRoot, 'apps'), resolve(repoRoot, 'packages')]

for (const root of sourceRoots) {
  if (!existsSync(root)) continue
  const files = listFilesRecursively(root).filter((file) =>
    isIntegrationTestFile(toPosix(file))
  )

  for (const filePath of files) {
    const source = readUtf8(filePath)
    const lines = source.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!HARDCODED_EMAIL_REGEX.test(line)) {
        continue
      }

      // Allow if the line above carries the explicit opt-in marker.
      const previousLine = i > 0 ? lines[i - 1] : ''
      if (previousLine.includes(ALLOW_MARKER)) {
        continue
      }

      const relPath = toPosix(relative(repoRoot, filePath))
      errors.push(
        `${relPath}:${i + 1} hardcoded \`email:\` literal in an integration test.\n` +
          `    ${line.trim()}\n` +
          `    Drop the field — \`createUserFactory\` defaults to a unique\n` +
          `    \`generateEmail('user')\`. Read it back via \`result.credentials.email\`\n` +
          `    if you need the value. The shared-server harness has no per-test\n` +
          `    schema reset, so hardcoded literals collide on the second test run\n` +
          `    with a 409 Conflict from \`createUser\`.\n` +
          `    If you genuinely need a literal (e.g. testing the uniqueness\n` +
          `    constraint), add the comment marker on the line above:\n` +
          `        // ${ALLOW_MARKER}: <reason>\n` +
          `        email: 'literal@example.com'\n`
      )
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(
    'Hardcoded email literals in integration tests:\n\n' +
      errors.map((message) => `  - ${message}`).join('\n') +
      '\n'
  )
  process.exit(1)
}

process.stdout.write('No hardcoded email literals found in integration tests.\n')
