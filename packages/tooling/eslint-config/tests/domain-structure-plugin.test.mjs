import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { domainStructurePlugin } from '../domain-structure-plugin.js'

const runRule = async ({ ruleName, code, filePath }) => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    ignore: false,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx,mts,cts}'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
          }
        },
        plugins: {
          'domain-structure': domainStructurePlugin
        },
        rules: {
          [`domain-structure/${ruleName}`]: 'error'
        }
      }
    ]
  })

  const [result] = await eslint.lintText(code, { filePath })
  return result.messages
}

const withDomainRoots = async (roots, run) => {
  const previous = process.env.TX_DOMAIN_STRUCTURE_ROOTS
  process.env.TX_DOMAIN_STRUCTURE_ROOTS = roots.join(delimiter)

  try {
    return await run()
  } finally {
    if (typeof previous === 'string') {
      process.env.TX_DOMAIN_STRUCTURE_ROOTS = previous
    } else {
      delete process.env.TX_DOMAIN_STRUCTURE_ROOTS
    }
  }
}

const makeTempDomainRoot = ({ includeFolders, applicationFiles }) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'tx-domain-structure-'))
  const domainRoot = join(sandbox, 'domains')
  const domainPath = join(domainRoot, 'sample')

  mkdirSync(domainPath, { recursive: true })

  for (const folder of includeFolders) {
    mkdirSync(join(domainPath, folder), { recursive: true })
  }

  if (includeFolders.includes('application')) {
    for (const fileName of applicationFiles) {
      writeFileSync(join(domainPath, 'application', fileName), 'export const noop = 1\n')
    }
  }

  return {
    domainRoot,
    cleanup: () => rmSync(sandbox, { recursive: true, force: true })
  }
}

test('require-domain-structure allows valid folder shape with a concrete use-case file', async () => {
  const fixture = makeTempDomainRoot({
    includeFolders: ['domain', 'ports', 'application', 'adapters'],
    applicationFiles: ['create-sample.ts']
  })

  try {
    const messages = await withDomainRoots([fixture.domainRoot], () =>
      runRule({
        ruleName: 'require-domain-structure',
        filePath: 'packages/core/src/domains/task/domain/example.ts',
        code: 'export const x = 1\n'
      })
    )

    assert.equal(messages.length, 0)
  } finally {
    fixture.cleanup()
  }
})

test('require-domain-structure reports missing required folders', async () => {
  const fixture = makeTempDomainRoot({
    includeFolders: ['domain', 'ports', 'application'],
    applicationFiles: ['create-sample.ts']
  })

  try {
    const messages = await withDomainRoots([fixture.domainRoot], () =>
      runRule({
        ruleName: 'require-domain-structure',
        filePath: 'packages/core/src/domains/task/domain/example.ts',
        code: 'export const x = 1\n'
      })
    )

    assert.equal(messages.length, 1)
    assert.match(messages[0].message, /missing required folder `adapters\//)
  } finally {
    fixture.cleanup()
  }
})

test('require-domain-structure reports empty application use-case folder', async () => {
  const fixture = makeTempDomainRoot({
    includeFolders: ['domain', 'ports', 'application', 'adapters'],
    applicationFiles: ['index.ts']
  })

  try {
    const messages = await withDomainRoots([fixture.domainRoot], () =>
      runRule({
        ruleName: 'require-domain-structure',
        filePath: 'packages/core/src/domains/task/domain/example.ts',
        code: 'export const x = 1\n'
      })
    )

    assert.equal(messages.length, 1)
    assert.match(messages[0].message, /must define at least one use-case module/)
  } finally {
    fixture.cleanup()
  }
})

test('enforce-layer-boundaries reports invalid domain -> adapters import', async () => {
  const messages = await runRule({
    ruleName: 'enforce-layer-boundaries',
    filePath: 'packages/core/src/domains/task/domain/task.ts',
    code: "import { x } from '../adapters/task-adapter.js'\nexport const y = x\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /Invalid domain-layer dependency/)
})

test('enforce-layer-boundaries allows domain -> domain import', async () => {
  const messages = await runRule({
    ruleName: 'enforce-layer-boundaries',
    filePath: 'packages/core/src/domains/task/domain/task.ts',
    code: "import { x } from './task-types.js'\nexport const y = x\n"
  })

  assert.equal(messages.length, 0)
})

test('enforce-layer-boundaries blocks cross-domain imports unless shared', async () => {
  const messages = await runRule({
    ruleName: 'enforce-layer-boundaries',
    filePath: 'packages/core/src/domains/task/application/task-service.ts',
    code: "import { x } from '../../workspace/domain/workspace-types.js'\nexport const y = x\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /Cross-domain import detected/)
})

test('enforce-layer-boundaries allows cross-domain shared imports', async () => {
  const messages = await runRule({
    ruleName: 'enforce-layer-boundaries',
    filePath: 'packages/core/src/domains/task/application/task-service.ts',
    code: "import { x } from '../../shared/domain-shared/value.js'\nexport const y = x\n"
  })

  assert.equal(messages.length, 0)
})

test('enforce-layer-boundaries allows external package imports', async () => {
  const messages = await runRule({
    ruleName: 'enforce-layer-boundaries',
    filePath: 'packages/core/src/domains/task/application/task-service.ts',
    code: "import { randomUUID } from 'node:crypto'\nexport const y = randomUUID\n"
  })

  assert.equal(messages.length, 0)
})

test('ports-no-layer-providers reports Layer.succeed usage in ports', async () => {
  const messages = await runRule({
    ruleName: 'ports-no-layer-providers',
    filePath: 'packages/core/src/domains/task/ports/task-ports.ts',
    code: "import { Layer } from 'effect'\nexport const p = Layer.succeed('x', {})\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /Ports must stay declarative contracts only/)
})

test('ports-no-layer-providers reports aliased Layer.effect usage in ports', async () => {
  const messages = await runRule({
    ruleName: 'ports-no-layer-providers',
    filePath: 'packages/core/src/domains/task/ports/task-ports.ts',
    code: "import { Layer as FxLayer } from 'effect'\nexport const p = FxLayer.effect('x', {})\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /Layer\.succeed.*Layer\.effect/)
})

test('ports-no-layer-providers allows non-layer imports in ports', async () => {
  const messages = await runRule({
    ruleName: 'ports-no-layer-providers',
    filePath: 'packages/core/src/domains/task/ports/task-ports.ts',
    code: "import { Effect } from 'effect'\nexport type X = Effect.Effect<string>\n"
  })

  assert.equal(messages.length, 0)
})

test('adapters-must-import-port reports adapters without port dependency', async () => {
  const messages = await runRule({
    ruleName: 'adapters-must-import-port',
    filePath: 'packages/core/src/domains/task/adapters/task-adapters.ts',
    code: 'export const adapter = 1\n'
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /must import at least one domain port contract/)
})

test('adapters-must-import-port allows explicit ports path imports', async () => {
  const messages = await runRule({
    ruleName: 'adapters-must-import-port',
    filePath: 'packages/core/src/domains/task/adapters/task-adapters.ts',
    code: "import type { TaskRepositoryPort } from '../ports/task-ports.js'\nexport type X = TaskRepositoryPort\n"
  })

  assert.equal(messages.length, 0)
})

test('adapters-must-import-port allows imported *Port symbol names', async () => {
  const messages = await runRule({
    ruleName: 'adapters-must-import-port',
    filePath: 'packages/core/src/domains/task/adapters/task-adapters.ts',
    code: "import type { TaskStorePort } from '../../shared/contracts.js'\nexport type X = TaskStorePort\n"
  })

  assert.equal(messages.length, 0)
})

test('pure-domain-no-effect-imports reports Effect imports in domain layer', async () => {
  const messages = await runRule({
    ruleName: 'pure-domain-no-effect-imports',
    filePath: 'packages/core/src/domains/task/domain/task-domain.ts',
    code: "import { Effect } from 'effect'\nexport const x = Effect.succeed(1)\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /must stay pure/)
})

test('pure-domain-no-effect-imports reports deep effect/* imports in domain layer', async () => {
  const messages = await runRule({
    ruleName: 'pure-domain-no-effect-imports',
    filePath: 'packages/core/src/domains/task/domain/task-domain.ts',
    code: "import * as Effect from 'effect/Effect'\nexport const x = Effect.succeed(1)\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /must stay pure/)
})

test('pure-domain-no-effect-imports allows effect imports outside domain layer', async () => {
  const messages = await runRule({
    ruleName: 'pure-domain-no-effect-imports',
    filePath: 'packages/core/src/domains/task/application/task-service.ts',
    code: "import { Effect } from 'effect'\nexport const x = Effect.succeed(1)\n"
  })

  assert.equal(messages.length, 0)
})

test('pure-domain-no-infra-imports reports db imports in domain layer', async () => {
  const messages = await runRule({
    ruleName: 'pure-domain-no-infra-imports',
    filePath: 'packages/core/src/domains/task/domain/task-domain.ts',
    code: "import { tasksRepository } from '@tx-agent-kit/db'\nexport const x = tasksRepository\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /must not import infrastructure modules/)
})

test('pure-domain-no-infra-imports reports drizzle imports in domain layer', async () => {
  const messages = await runRule({
    ruleName: 'pure-domain-no-infra-imports',
    filePath: 'packages/core/src/domains/task/domain/task-domain.ts',
    code: "import { eq } from 'drizzle-orm'\nexport const x = eq\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /must not import infrastructure modules/)
})

test('pure-domain-no-infra-imports reports node IO imports in domain layer', async () => {
  const messages = await runRule({
    ruleName: 'pure-domain-no-infra-imports',
    filePath: 'packages/core/src/domains/task/domain/task-domain.ts',
    code: "import { readFileSync } from 'node:fs'\nexport const x = readFileSync\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /must not import infrastructure modules/)
})

test('pure-domain-no-infra-imports allows db imports in adapters layer', async () => {
  const messages = await runRule({
    ruleName: 'pure-domain-no-infra-imports',
    filePath: 'packages/core/src/domains/task/adapters/task-adapters.ts',
    code: "import { tasksRepository } from '@tx-agent-kit/db'\nexport const x = tasksRepository\n"
  })

  assert.equal(messages.length, 0)
})

test('no-throw-try-outside-adapters reports throw statements in application layer', async () => {
  const messages = await runRule({
    ruleName: 'no-throw-try-outside-adapters',
    filePath: 'packages/core/src/domains/task/application/task-service.ts',
    code: "export const x = () => { throw new Error('nope') }\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /Avoid `throw`/)
})

test('no-throw-try-outside-adapters reports try/catch in domain layer', async () => {
  const messages = await runRule({
    ruleName: 'no-throw-try-outside-adapters',
    filePath: 'packages/core/src/domains/task/domain/task-domain.ts',
    code: "export const x = () => { try { return 1 } catch { return 0 } }\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /Avoid `try\/catch`/)
})

test('no-throw-try-outside-adapters allows throw in adapters layer', async () => {
  const messages = await runRule({
    ruleName: 'no-throw-try-outside-adapters',
    filePath: 'packages/core/src/domains/task/adapters/task-adapters.ts',
    code: "export const x = () => { throw new Error('adapter') }\n"
  })

  assert.equal(messages.length, 0)
})

test('no-throw-try-outside-adapters allows try/catch in runtime layer', async () => {
  const messages = await runRule({
    ruleName: 'no-throw-try-outside-adapters',
    filePath: 'packages/core/src/domains/task/runtime/live.ts',
    code: "export const x = () => { try { return 1 } catch { return 0 } }\n"
  })

  assert.equal(messages.length, 0)
})

test('no-inline-string-union-enums reports inline literal unions outside literals module', async () => {
  const messages = await runRule({
    ruleName: 'no-inline-string-union-enums',
    filePath: 'packages/contracts/src/any-domain.ts',
    code: "export type Status = 'todo' | 'done'\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /Inline string-literal union enums are disallowed/)
})

test('no-inline-string-union-enums allows literals module', async () => {
  const messages = await runRule({
    ruleName: 'no-inline-string-union-enums',
    filePath: 'packages/contracts/src/literals.ts',
    code: "export type Status = 'todo' | 'done'\n"
  })

  assert.equal(messages.length, 0)
})

test('no-inline-string-union-enums ignores non-string unions', async () => {
  const messages = await runRule({
    ruleName: 'no-inline-string-union-enums',
    filePath: 'apps/api/src/types.ts',
    code: 'type X = 1 | 2\n'
  })

  assert.equal(messages.length, 0)
})

test('no-inline-string-union-enums ignores mixed unions with null', async () => {
  const messages = await runRule({
    ruleName: 'no-inline-string-union-enums',
    filePath: 'apps/api/src/routes/list-query.ts',
    code: "const x: 'asc' | 'desc' | null = null\n"
  })

  assert.equal(messages.length, 0)
})

test('no-raw-schema-literal-enums reports raw Schema.Literal enum tuples', async () => {
  const messages = await runRule({
    ruleName: 'no-raw-schema-literal-enums',
    filePath: 'apps/api/src/example.ts',
    code: "import * as Schema from 'effect/Schema'\nconst s = Schema.Literal('a', 'b')\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /Raw multi-value `Schema\.Literal/)
})

test('no-raw-schema-literal-enums reports local spread tuple constants', async () => {
  const messages = await runRule({
    ruleName: 'no-raw-schema-literal-enums',
    filePath: 'apps/api/src/example.ts',
    code: "import * as Schema from 'effect/Schema'\nconst values = ['a', 'b'] as const\nconst s = Schema.Literal(...values)\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /shared literal imports/)
})

test('no-raw-schema-literal-enums allows spread tuples imported from contracts', async () => {
  const messages = await runRule({
    ruleName: 'no-raw-schema-literal-enums',
    filePath: 'apps/api/src/example.ts',
    code: [
      "import * as Schema from 'effect/Schema'",
      "import { taskStatuses } from '@tx-agent-kit/contracts'",
      'const s = Schema.Literal(...taskStatuses)'
    ].join('\n')
  })

  assert.equal(messages.length, 0)
})

test('no-raw-schema-literal-enums allows namespace import tuples from contracts', async () => {
  const messages = await runRule({
    ruleName: 'no-raw-schema-literal-enums',
    filePath: 'apps/api/src/example.ts',
    code: [
      "import * as Schema from 'effect/Schema'",
      "import * as literals from '@tx-agent-kit/contracts/literals'",
      'const s = Schema.Literal(...literals.taskStatuses)'
    ].join('\n')
  })

  assert.equal(messages.length, 0)
})

test('no-raw-schema-literal-enums allows single-value Schema.Literal', async () => {
  const messages = await runRule({
    ruleName: 'no-raw-schema-literal-enums',
    filePath: 'apps/api/src/example.ts',
    code: "import * as Schema from 'effect/Schema'\nconst s = Schema.Literal('healthy')\n"
  })

  assert.equal(messages.length, 0)
})

test('no-inline-pgenum-array reports inline pgEnum arrays', async () => {
  const messages = await runRule({
    ruleName: 'no-inline-pgenum-array',
    filePath: 'packages/db/src/schema.ts',
    code: "import { pgEnum } from 'drizzle-orm/pg-core'\nconst e = pgEnum('status', ['a', 'b'])\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /Inline `pgEnum/)
})

test('no-inline-pgenum-array reports local tuple constants', async () => {
  const messages = await runRule({
    ruleName: 'no-inline-pgenum-array',
    filePath: 'packages/db/src/schema.ts',
    code: "import { pgEnum } from 'drizzle-orm/pg-core'\nconst values = ['a', 'b'] as const\nconst e = pgEnum('status', values)\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /must come from shared imports/)
})

test('no-inline-pgenum-array allows tuples imported from contracts', async () => {
  const messages = await runRule({
    ruleName: 'no-inline-pgenum-array',
    filePath: 'packages/db/src/schema.ts',
    code: [
      "import { pgEnum } from 'drizzle-orm/pg-core'",
      "import { invitationStatuses } from '@tx-agent-kit/contracts'",
      "const e = pgEnum('status', invitationStatuses)"
    ].join('\n')
  })

  assert.equal(messages.length, 0)
})

test('no-inline-pgenum-array allows namespace-imported tuples from contracts', async () => {
  const messages = await runRule({
    ruleName: 'no-inline-pgenum-array',
    filePath: 'packages/db/src/schema.ts',
    code: [
      "import { pgEnum } from 'drizzle-orm/pg-core'",
      "import * as literals from '@tx-agent-kit/contracts'",
      "const e = pgEnum('status', literals.invitationStatuses)"
    ].join('\n')
  })

  assert.equal(messages.length, 0)
})

test('core-adapters-use-db-row-mappers reports adapters that import db without centralized mappers', async () => {
  const messages = await runRule({
    ruleName: 'core-adapters-use-db-row-mappers',
    filePath: 'packages/core/src/domains/task/adapters/task-adapters.ts',
    code: "import { tasksRepository } from '@tx-agent-kit/db'\nexport const x = tasksRepository\n"
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /must centralize row->record mapping/)
})

test('core-adapters-use-db-row-mappers allows adapters that import db-row-mappers', async () => {
  const messages = await runRule({
    ruleName: 'core-adapters-use-db-row-mappers',
    filePath: 'packages/core/src/domains/task/adapters/task-adapters.ts',
    code: [
      "import { tasksRepository } from '@tx-agent-kit/db'",
      "import { toTaskRecord } from '../../../adapters/db-row-mappers.js'",
      'export const x = [tasksRepository, toTaskRecord]'
    ].join('\n')
  })

  assert.equal(messages.length, 0)
})

test('core-adapters-use-db-row-mappers ignores files without db imports', async () => {
  const messages = await runRule({
    ruleName: 'core-adapters-use-db-row-mappers',
    filePath: 'packages/core/src/domains/task/adapters/task-adapters.ts',
    code: 'export const x = 1\n'
  })

  assert.equal(messages.length, 0)
})

test('core-adapters-use-db-row-mappers ignores index barrel files', async () => {
  const messages = await runRule({
    ruleName: 'core-adapters-use-db-row-mappers',
    filePath: 'packages/core/src/domains/task/adapters/index.ts',
    code: "import { tasksRepository } from '@tx-agent-kit/db'\nexport const x = tasksRepository\n"
  })

  assert.equal(messages.length, 0)
})
