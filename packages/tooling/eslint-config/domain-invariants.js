import { domainStructurePlugin } from './domain-structure-plugin.js'

const effectSchemaOnlyRestrictions = {
  paths: [
    {
      name: 'zod',
      message: 'Use `effect/Schema` only. Zod is not allowed in this repository.'
    },
    {
      name: 'valibot',
      message: 'Use `effect/Schema` only. Valibot is not allowed in this repository.'
    },
    {
      name: 'yup',
      message: 'Use `effect/Schema` only. Yup is not allowed in this repository.'
    },
    {
      name: 'joi',
      message: 'Use `effect/Schema` only. Joi is not allowed in this repository.'
    },
    {
      name: 'superstruct',
      message: 'Use `effect/Schema` only. Superstruct is not allowed in this repository.'
    }
  ],
  patterns: [
    {
      group: ['zod/*', 'valibot/*', 'yup/*', 'joi/*', 'superstruct/*'],
      message: 'Use `effect/Schema` only for validation and contracts.'
    }
  ]
}

const drizzleIsolationRestrictions = {
  patterns: [
    {
      group: ['drizzle-orm', 'drizzle-orm/*'],
      message: 'Only `packages/infra/db` may import Drizzle. Use repositories and Effect services elsewhere.'
    }
  ]
}

// ── Global restrictions that must be merged into every no-restricted-imports block ─
// ESLint flat config does NOT merge rule options — the last matching config
// object wins. Every block that sets no-restricted-imports must include
// the global restrictions or they silently disappear.
const globalPaths = [...effectSchemaOnlyRestrictions.paths]
const globalPatterns = [
  ...effectSchemaOnlyRestrictions.patterns,
  ...drizzleIsolationRestrictions.patterns
]

// Merge global restrictions into a rule config.
const withGlobalRestrictions = (config) => ({
  paths: [...globalPaths, ...(config.paths ?? [])],
  patterns: [...globalPatterns, ...(config.patterns ?? [])]
})

// Merge global restrictions but WITHOUT drizzle (for packages/infra/db).
const withSchemaOnlyRestrictions = (config) => ({
  paths: [...effectSchemaOnlyRestrictions.paths, ...(config.paths ?? [])],
  patterns: [...effectSchemaOnlyRestrictions.patterns, ...(config.patterns ?? [])]
})

// ── Shared web import restrictions ──────────────────────────────────────
// Extracted so they can be merged into every web no-restricted-imports
// config object (ESLint flat config does NOT merge rule options across
// config objects — the last matching object wins).
const webCorePaths = [
  ...globalPaths,
  {
    name: '@tx-agent-kit/db',
    message: 'Web must stay API-first. Call `apps/api` via typed client functions, never DB modules.'
  },
  {
    name: 'drizzle-orm',
    message: 'Web must stay API-first. Only the DB layer may import Drizzle.'
  },
  {
    name: 'effect',
    message:
      'apps/web is intentionally dumb. Keep Effect runtime usage in API/core/worker layers.'
  },
  {
    name: 'next/server',
    message:
      'apps/web is client-only. Server runtime imports (`next/server`) are forbidden.'
  },
  {
    name: 'next/headers',
    message:
      'apps/web is client-only. Request header/cookie APIs (`next/headers`) are forbidden.'
  },
  {
    name: 'next/navigation',
    importNames: ['useSearchParams'],
    message:
      'Avoid `useSearchParams` in apps/web; it introduces Suspense/prerender constraints in static client pages.'
  },
  {
    name: 'next/navigation',
    importNames: ['redirect', 'notFound'],
    message:
      'apps/web is client-only. `redirect`/`notFound` server navigation APIs are forbidden.'
  }
]

const webCorePatterns = [
  ...globalPatterns,
  {
    group: ['@tx-agent-kit/db/*', 'drizzle-orm/*'],
    message: 'Web must stay API-first. Keep persistence concerns behind API/core services.'
  },
  {
    group: ['effect/*'],
    message:
      'apps/web is intentionally dumb. Keep Effect runtime usage in API/core/worker layers.'
  },
  {
    group: ['next/server/*', 'next/headers/*'],
    message: 'apps/web is client-only. Server runtime imports are forbidden.'
  }
]

// ── Shared mobile import restrictions ───────────────────────────────────
const mobileCorePaths = [
  ...globalPaths,
  {
    name: '@tx-agent-kit/db',
    message: 'Mobile must stay API-first. Call `apps/api` via typed client functions, never DB modules.'
  },
  {
    name: 'drizzle-orm',
    message: 'Mobile must stay API-first. Only the DB layer may import Drizzle.'
  },
  {
    name: 'effect',
    message:
      'apps/mobile is a dumb API consumer. Keep Effect runtime usage in API/core/worker layers.'
  },
  {
    name: '@tx-agent-kit/core',
    message:
      'apps/mobile is a dumb API consumer. Import contracts only, not core domain modules.'
  },
  {
    name: '@tx-agent-kit/logging',
    message: 'Mobile must use `apps/mobile/lib/log.ts` for logging.'
  }
]

const mobileCorePatterns = [
  ...globalPatterns,
  {
    group: ['@tx-agent-kit/db/*', 'drizzle-orm/*'],
    message: 'Mobile must stay API-first. Keep persistence concerns behind API/core services.'
  },
  {
    group: ['effect/*'],
    message:
      'apps/mobile is a dumb API consumer. Keep Effect runtime usage in API/core/worker layers.'
  },
  {
    group: ['@tx-agent-kit/core/*'],
    message:
      'apps/mobile is a dumb API consumer. Import contracts only, not core domain modules.'
  },
  {
    group: ['@tx-agent-kit/logging/*'],
    message: 'Mobile must use `apps/mobile/lib/log.ts` for logging.'
  }
]

export const domainInvariantConfig = [
  // ── Global: schema-only + drizzle isolation ────────────────────────
  // infra/ai is exempt from schema-only (uses its own validation).
  // infra/db is exempt from drizzle isolation (IS the drizzle layer).
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['packages/infra/ai/**/*.{ts,tsx}', 'packages/infra/db/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          ...effectSchemaOnlyRestrictions.paths
        ],
        patterns: [
          ...effectSchemaOnlyRestrictions.patterns,
          ...drizzleIsolationRestrictions.patterns
        ]
      }]
    }
  },
  {
    files: ['packages/infra/**/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        withSchemaOnlyRestrictions({
          paths: [
            {
              name: '@tx-agent-kit/core',
              message:
                'Infrastructure packages must not import from core. Dependency direction: core → infra, never infra → core.'
            }
          ],
          patterns: [
            {
              group: ['@tx-agent-kit/core/*'],
              message: 'Infrastructure packages must not import from core.'
            }
          ]
        })
      ]
    }
  },

  // ── Rule: Ban relative imports crossing package boundaries ──────────
  // Cross-package imports must use @tx-agent-kit/* aliases.
  // Relative paths bypass TypeScript project references and create fragile coupling.
  // IMPORTANT: This must come BEFORE DDD layer blocks so that more-specific
  // layer restrictions (domain/ports/adapters/application) override it.
  {
    files: ['packages/**/src/**/*.{ts,tsx}', 'apps/**/src/**/*.{ts,tsx}'],
    ignores: ['packages/infra/db/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        withGlobalRestrictions({
          patterns: [
            {
              group: [
                '**/packages/core/**',
                '**/packages/infra/**',
                '**/packages/contracts/**',
                '**/packages/temporal-client/**',
                '**/packages/testkit/**',
                '**/apps/api/**',
                '**/apps/web/**',
                '**/apps/worker/**',
                '**/apps/mobile/**'
              ],
              message:
                'Use @tx-agent-kit/* package aliases instead of relative cross-package imports.'
            }
          ]
        })
      ]
    }
  },

  // ── Rule: Service/application layer must not import domain-events repo ─
  // IMPORTANT: Must come BEFORE DDD application-layer block so the more
  // specific application restrictions override this one.
  {
    files: ['packages/core/**/application/**/*.{ts,tsx}', 'packages/core/**/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', withGlobalRestrictions({
        patterns: [{
          group: ['**/repositories/domain-events*', '@tx-agent-kit/db'],
          message: 'Service layer must not import domain events repository directly. Use port methods (e.g., createWithEvent) to write events transactionally.'
        }]
      })]
    }
  },

  {
    files: [
      'packages/**/src/domains/**/*.{ts,tsx}',
      'apps/**/src/domains/**/*.{ts,tsx}'
    ],
    plugins: {
      'domain-structure': domainStructurePlugin
    },
    rules: {
      'domain-structure/require-domain-structure': 'error',
      'domain-structure/enforce-layer-boundaries': 'error',
      'domain-structure/ports-no-layer-providers': 'error',
      'domain-structure/adapters-must-import-port': 'error',
      'domain-structure/pure-domain-no-effect-imports': 'error',
      'domain-structure/pure-domain-no-infra-imports': 'error',
      'domain-structure/no-throw-try-outside-adapters': 'error'
    }
  },
  {
    files: [
      'packages/core/src/domains/*/repositories/**/*.{ts,tsx}',
      'apps/api/src/domains/*/repositories/**/*.{ts,tsx}'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message:
            'Domain modules must not define `repositories/`. Use `ports/` for contracts and `adapters/` for implementations.'
        }
      ]
    }
  },
  {
    files: [
      'packages/infra/db/src/**/*.{ts,tsx}',
      'packages/contracts/src/**/*.{ts,tsx}',
      'apps/api/src/**/*.{ts,tsx}'
    ],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.integration.test.ts',
      '**/*.integration.test.tsx',
      'packages/contracts/src/literals.ts'
    ],
    plugins: {
      'domain-structure': domainStructurePlugin
    },
    rules: {
      'domain-structure/no-inline-string-union-enums': 'error'
    }
  },
  {
    files: [
      'packages/contracts/src/**/*.{ts,tsx}',
      'packages/infra/db/src/effect-schemas/**/*.{ts,tsx}',
      'apps/api/src/**/*.{ts,tsx}'
    ],
    ignores: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.integration.test.ts',
      '**/*.integration.test.tsx'
    ],
    plugins: {
      'domain-structure': domainStructurePlugin
    },
    rules: {
      'domain-structure/no-raw-schema-literal-enums': 'error'
    }
  },
  {
    files: ['packages/infra/db/src/schema.ts'],
    plugins: {
      'domain-structure': domainStructurePlugin
    },
    rules: {
      'domain-structure/no-inline-pgenum-array': 'error',
      'domain-structure/json-columns-require-explicit-drizzle-type': 'error'
    }
  },
  {
    files: ['packages/core/src/domains/*/adapters/**/*.{ts,tsx}'],
    plugins: {
      'domain-structure': domainStructurePlugin
    },
    rules: {
      'domain-structure/core-adapters-use-db-row-mappers': 'error'
    }
  },
  // ── Web: core import restrictions + use server ban ──────────────────
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: webCorePaths,
          patterns: webCorePatterns
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "ExpressionStatement[directive='use server']",
          message:
            "Server actions are forbidden in apps/web. Keep Next.js as a dumb client consumer."
        }
      ]
    }
  },
  // ── Web: axios centralization (ignores axios.ts itself) ───────────
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/lib/axios.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...webCorePaths,
            {
              name: 'axios',
              message: 'Use shared axios clients from `apps/web/lib/axios.ts` only.'
            }
          ],
          patterns: [
            ...webCorePatterns,
            {
              group: ['axios/*'],
              message: 'Use shared axios clients from `apps/web/lib/axios.ts` only.'
            }
          ]
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='axios'][callee.property.name='create']",
          message: 'Create axios clients only in `apps/web/lib/axios.ts`.'
        }
      ]
    }
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/lib/env.ts', 'apps/web/lib/api/generated/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Web must read environment variables via `apps/web/lib/env.ts` only.'
        }
      ]
    }
  },
  {
    files: ['apps/**/src/**/*.{ts,tsx}', 'packages/**/src/**/*.{ts,tsx}'],
    ignores: [
      '**/__tests__/**/*.{ts,tsx}',
      '**/*.test.ts',
      '**/*.spec.ts',
      'apps/api/src/config/env.ts',
      'apps/api/src/config/openapi-env.ts',
      'apps/worker/src/config/env.ts',
      'packages/infra/auth/src/env.ts',
      'packages/infra/db/src/env.ts',
      'packages/infra/logging/src/env.ts',
      'packages/infra/observability/src/env.ts',
      'packages/infra/ai/src/env.ts',
      'packages/testkit/src/env.ts'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Read runtime environment through dedicated env modules only.'
        }
      ]
    }
  },
  // ── Web: sonner centralization (ignores notify.tsx itself) ──────────
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/lib/notify.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...webCorePaths,
            {
              name: 'sonner',
              message:
                'Use `apps/web/lib/notify.tsx` as the single entry-point for toast notifications.'
            }
          ],
          patterns: [
            ...webCorePatterns,
            {
              group: ['sonner/*'],
              message:
                'Use `apps/web/lib/notify.tsx` as the single entry-point for toast notifications.'
            }
          ]
        }
      ]
    }
  },
  // ── Web: nuqs centralization (ignores url-state.tsx itself) ───────
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/lib/url-state.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...webCorePaths,
            {
              name: 'nuqs',
              message: 'Use `apps/web/lib/url-state.tsx` wrappers for URL query state.'
            }
          ],
          patterns: [
            ...webCorePatterns,
            {
              group: ['nuqs/*'],
              message: 'Use `apps/web/lib/url-state.tsx` wrappers for URL query state.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/lib/auth-token.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='window'][property.name='localStorage']",
          message:
            'Access browser session storage through `apps/web/lib/auth-token.ts` only.'
        },
        {
          selector: "MemberExpression[object.name='localStorage']",
          message:
            'Access browser session storage through `apps/web/lib/auth-token.ts` only.'
        }
      ]
    }
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='window'][property.name='location']",
          message:
            'Do not read window.location directly in apps/web. Use `apps/web/lib/url-state.tsx` wrappers.'
        }
      ]
    }
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: [
      'apps/web/lib/api/generated/**/*.{ts,tsx}',
      'apps/web/lib/api/orval-mutator.ts'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            'Direct fetch is forbidden in apps/web. Use typed client transport (`clientApi`/generated client).'
        }
      ]
    }
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: [
      'apps/web/lib/axios.ts',
      'apps/web/lib/client-api.ts',
      'apps/web/lib/api/orval-mutator.ts',
      'apps/web/lib/api/generated/**/*.{ts,tsx}',
      'apps/web/lib/react-admin/data-provider.ts'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='api'][callee.property.name=/^(get|post|put|patch|delete|request)$/]",
          message:
            'Use generated API hooks/functions (or `clientApi` transitional wrapper) instead of calling shared axios instances directly.'
        }
      ]
    }
  },
  {
    files: ['apps/web/app/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program',
          message:
            'Next API routes are forbidden in apps/web. Route all backend behavior through apps/api.'
        }
      ]
    }
  },
  {
    files: ['apps/api/src/**/*.integration.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        withGlobalRestrictions({
          paths: [
            {
              name: 'node:child_process',
              message:
                'API integration tests must use `createDbAuthContext(...)` from testkit and must not spawn processes manually.'
            },
            {
              name: '@tx-agent-kit/testkit',
              importNames: ['createSqlTestContext'],
              message:
                'API integration tests must use `createDbAuthContext(...)` (not direct `createSqlTestContext(...)`).'
            }
          ]
        })
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='spawn']",
          message:
            'API integration tests must use `createDbAuthContext(...)` from testkit and must not spawn processes manually.'
        }
      ]
    }
  },
  {
    files: ['apps/web/**/*.integration.test.ts', 'apps/web/**/*.integration.test.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ImportSpecifier[imported.name=/^(setupWebIntegrationSuite|resetWebIntegrationCase|teardownWebIntegrationSuite)$/]",
          message:
            'Web integration suites must use centralized lifecycle hooks from `apps/web/vitest.integration.setup.ts`.'
        }
      ]
    }
  },
  // NOTE: The former standalone drizzle-isolation config object was removed.
  // Its restrictions are now merged into every no-restricted-imports block
  // via globalPaths/globalPatterns/withGlobalRestrictions to prevent the
  // ESLint flat-config cascade from silently dropping earlier restrictions.
  {
    files: [
      'packages/**/src/domains/*/{domain,ports,application,adapters,runtime,ui}/**/*.{ts,tsx}',
      'apps/**/src/domains/*/{domain,ports,application,adapters,runtime,ui}/**/*.{ts,tsx}',
      'apps/api/src/routes/**/*.{ts,tsx}'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Use named exports only in domain and route layers.'
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'Inject time via domain ports (clock provider) instead of calling Date.now() directly.'
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'Inject time via domain ports (clock provider) instead of instantiating Date directly.'
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message:
            'Inject randomness/ID generation via domain ports instead of Math.random().'
        }
      ]
    }
  },
  {
    files: ['packages/**/src/domains/*/domain/**/*.{ts,tsx}', 'apps/**/src/domains/*/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Domain layer must stay pure. Read env through typed config modules and pass values into domain via ports/application.'
        }
      ],
      'no-restricted-imports': [
        'error',
        withGlobalRestrictions({
          paths: [
            {
              name: '@tx-agent-kit/auth',
              message:
                'Domain must stay infra-agnostic. Depend on auth capabilities via ports and provide implementations in adapters/application.'
            },
            {
              name: 'node:fs',
              message:
                'Domain layer must stay pure. Model filesystem capability as a port and implement it in adapters.'
            },
            {
              name: 'node:path',
              message:
                'Domain layer must stay pure. Compute path/infrastructure details in adapters, not domain.'
            },
            {
              name: 'node:child_process',
              message:
                'Domain layer must stay pure. Wrap process execution behind a port and implement it in outer layers.'
            }
          ],
          patterns: [
            {
              regex: '^@tx-agent-kit/contracts/(?!literals(?:\\.js)?$).*',
              message:
                'Domain must stay boundary-free. Only shared domain literals may be imported from contracts (`@tx-agent-kit/contracts/literals.js`).'
            },
            {
              group: ['@tx-agent-kit/auth/*'],
              message:
                'Domain must stay boundary-free. Use domain-native models and capability ports, then map in outer layers.'
            },
            {
              regex: '(^|/)(ports|application|adapters|runtime|ui)(/|$)',
              message: 'Domain layer is innermost and may only import from domain.'
            }
          ]
        })
      ]
    }
  },
  {
    files: ['packages/**/src/domains/*/ports/**/*.{ts,tsx}', 'apps/**/src/domains/*/ports/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSTypeReference[typeName.name=\"Promise\"]',
          message: 'Domain ports must return Effect types, never Promise types.'
        },
        {
          selector: 'ExportNamedDeclaration > TSInterfaceDeclaration',
          message:
            'Domain record interfaces must be defined in domain/ and imported by ports/. Use `type` for port-specific type aliases.'
        }
      ],
      'no-restricted-imports': [
        'error',
        withGlobalRestrictions({
          patterns: [
            {
              regex: '(^|/)(application|adapters|runtime|ui)(/|$)',
              message: 'Ports may depend only on domain/ports.'
            }
          ]
        })
      ]
    }
  },
  {
    files: [
      'packages/**/src/domains/*/adapters/**/*.{ts,tsx}',
      'apps/**/src/domains/*/adapters/**/*.{ts,tsx}'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        withGlobalRestrictions({
          patterns: [
            {
              regex: '(^|/)(application|runtime|ui)(/|$)',
              message: 'Adapters may depend on domain/ports only.'
            }
          ]
        })
      ]
    }
  },
  {
    files: ['packages/infra/db/src/repositories/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='then']",
          message:
            'Avoid `.then(...)` chains in DB repositories. Use `await`/`yield*` so control flow and errors stay explicit.'
        },
        {
          selector: "ExpressionStatement > CallExpression[callee.property.name='catch']",
          message:
            'Do not leave promise chains floating in DB repositories. Return the effect/promise or await it explicitly.'
        }
      ]
    }
  },
  {
    files: ['packages/**/src/domains/*/application/**/*.{ts,tsx}', 'apps/**/src/domains/*/application/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        withGlobalRestrictions({
          paths: [
            {
              name: '@tx-agent-kit/db',
              message: 'Application layer must depend on domain ports, never DB packages directly.'
            },
            {
              name: '@tx-agent-kit/contracts',
              message:
                'Domain application layer must stay transport-agnostic. Accept typed command objects from routes instead of importing API contract schemas/types.'
            },
            {
              name: '@tx-agent-kit/auth',
              message:
                'Domain application layer must depend on auth capability ports, not concrete auth implementations.'
            },
            {
              name: 'effect/Schema',
              message:
                'Decode/validate payloads at route boundaries. Application use-cases should receive already-typed command objects.'
            }
          ],
          patterns: [
            {
              regex: '(^|/)(adapters|runtime|ui)(/|$)',
              message: 'Application layer may only depend on domain and ports layers.'
            },
            {
              group: ['@tx-agent-kit/db/*'],
              message: 'Application layer must depend on domain ports, never DB packages directly.'
            },
            {
              group: ['@tx-agent-kit/contracts/*', '@tx-agent-kit/auth/*'],
              message:
                'Application layer must not couple to transport/infra packages. Use domain models and capability ports, then map in outer layers.'
            }
          ]
        })
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Domain application layer must receive config via ports/layers, not process.env.'
        },
        {
          selector:
            "CallExpression[callee.object.name='Effect'][callee.property.name=/^run(Promise|PromiseExit|Sync|Fork)$/]",
          message:
            'Domain application layer must stay declarative. Do not execute effects (run*) inside application/domain layers.'
        },
        {
          selector: "CallExpression[callee.object.name='Schema'][callee.property.name='decodeUnknown']",
          message:
            'Decode unknown payloads in route/API boundaries. Pass typed command objects into domain application use-cases.'
        }
      ]
    }
  },
  // ── Rule: API must not import Temporal ──────────────────────────────
  // IMPORTANT: Must come BEFORE the API routes block so that route-specific
  // restrictions override this broader apps/api/** block.
  {
    files: ['apps/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', withGlobalRestrictions({
        paths: [
          { name: '@temporalio/client', message: 'API must not import Temporal client. Write to the outbox table; the worker processes events.' },
          { name: '@temporalio/workflow', message: 'API must not import Temporal workflows.' },
          { name: '@temporalio/worker', message: 'API must not import Temporal worker.' }
        ],
        patterns: [{
          group: ['@temporalio/*'],
          message: 'API must not depend on Temporal. Events flow through the outbox pattern: API → domain_events table → worker.'
        }]
      })]
    }
  },
  {
    files: ['apps/api/src/routes/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        withGlobalRestrictions({
          paths: [
            {
              name: '@tx-agent-kit/db',
              message: 'API routes must call domain application use-cases, not DB modules directly.'
            }
          ],
          patterns: [
            {
              group: ['@tx-agent-kit/db/*'],
              message: 'API routes must call domain application use-cases, not DB modules directly.'
            },
            {
              regex: '(^|/)domains/[^/]+/adapters(/|$)',
              message: 'API routes must not depend on adapter implementations directly.'
            }
          ]
        })
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'API routes must read configuration from typed config modules, not process.env directly.'
        },
        {
          selector:
            "CallExpression[callee.object.name='Effect'][callee.property.name=/^run(Promise|PromiseExit|Sync|Fork)$/]",
          message: 'API routes must remain effectful and compositional. Do not call Effect.run* in route handlers.'
        }
      ]
    }
  },
  {
    files: ['apps/worker/src/workflows*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        withGlobalRestrictions({
          paths: [
            {
              name: '@tx-agent-kit/db',
              message: 'Temporal workflows must stay deterministic and must not import DB modules.'
            },
            {
              name: '@tx-agent-kit/logging',
              message: 'Temporal workflows must stay deterministic and must not import logging side effects.'
            },
            {
              name: '@tx-agent-kit/observability',
              message: 'Temporal workflows must stay deterministic and must not import observability side effects.'
            }
          ],
          patterns: [
            {
              group: ['@tx-agent-kit/db/*', 'node:*'],
              message: 'Temporal workflows must stay deterministic and must not import non-deterministic infrastructure.'
            }
          ]
        })
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Temporal workflows must stay deterministic. Read env in `apps/worker/src/config/env.ts` and pass values into workflow inputs.'
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'Temporal workflows must stay deterministic. Use Temporal workflow time APIs (for example `workflow.now`) or pass timestamps as inputs.'
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'Temporal workflows must stay deterministic. Use Temporal workflow time APIs or pass timestamps from activities/inputs.'
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message:
            'Temporal workflows must stay deterministic. Generate randomness/IDs in activities or inject deterministic values via workflow inputs.'
        },
        {
          selector: "CallExpression[callee.name='setTimeout']",
          message: 'Temporal workflows must not use setTimeout directly. Use Temporal workflow timers/APIs.'
        },
        {
          selector: "CallExpression[callee.name='setInterval']",
          message: 'Temporal workflows must not use setInterval directly. Use Temporal workflow timers/APIs.'
        },
        {
          selector: "CallExpression[callee.name='clearTimeout']",
          message: 'Temporal workflows must not manage timer handles directly.'
        },
        {
          selector: "CallExpression[callee.name='clearInterval']",
          message: 'Temporal workflows must not manage timer handles directly.'
        }
      ]
    }
  },
  {
    files: ['apps/worker/src/**/*.{ts,tsx}'],
    ignores: ['apps/worker/src/config/env.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Worker code must read environment variables through `apps/worker/src/config/env.ts` only.'
        }
      ]
    }
  },
  {
    files: ['packages/**/src/**/*.{ts,tsx}', 'apps/**/src/**/*.{ts,tsx}'],
    ignores: [
      '**/__tests__/**/*.{ts,tsx}',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.integration.test.ts',
      '**/*.integration.test.tsx',
      'apps/worker/src/activities.ts'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='Effect'][callee.property.name=/^run(Promise|PromiseExit|Sync|Fork)$/]",
          message:
            'Avoid Effect.run* in application source. Keep code declarative and execute effects only at explicit runtime boundaries.'
        }
      ]
    }
  },
  {
    files: ['packages/core/src/domains/**/*.{ts,tsx}', 'apps/api/src/routes/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Domain and route layers must read environment via typed config modules / ports, not process.env directly.'
        },
        {
          selector:
            "CallExpression[callee.object.name='Effect'][callee.property.name=/^run(Promise|PromiseExit|Sync|Fork)$/]",
          message:
            'Domain and route layers must stay declarative. Do not execute effects (run*) inside these layers.'
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'Inject time via domain ports (clock provider) instead of calling Date.now() directly.'
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'Inject time via domain ports (clock provider) instead of instantiating Date directly.'
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message:
            'Inject randomness/ID generation via domain ports instead of Math.random().'
        },
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message:
            'Domain and route layers should use typed Effect failures instead of throwing raw Error instances.'
        }
      ]
    }
  },
  {
    files: ['packages/**/src/**/*.{ts,tsx}', 'apps/**/src/**/*.{ts,tsx}', 'apps/mobile/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', 'packages/tooling/scaffold/src/index.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression[typeAnnotation.type="TSAnyKeyword"]',
          message: 'Avoid `as any` in application source. Fix boundary types instead.'
        },
        {
          selector: 'TSTypeAssertion[typeAnnotation.type="TSAnyKeyword"]',
          message: 'Avoid `<any>` assertions in application source. Fix boundary types instead.'
        },
        {
          selector: 'TSAsExpression[typeAnnotation.type="TSNeverKeyword"]',
          message: 'Avoid `as never` in application source. Fix types at the boundary instead.'
        },
        {
          selector: 'TSAsExpression > TSAsExpression',
          message: 'Avoid chained type assertions (`as unknown as ...`) in application source.'
        }
      ]
    }
  },
  // ── Mobile: core import restrictions ────────────────────────────────
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: mobileCorePaths,
          patterns: mobileCorePatterns
        }
      ]
    }
  },
  // ── Mobile: axios centralization (ignores axios.ts itself) ────────
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: ['apps/mobile/lib/axios.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...mobileCorePaths,
            {
              name: 'axios',
              message: 'Use shared axios clients from `apps/mobile/lib/axios.ts` only.'
            }
          ],
          patterns: [
            ...mobileCorePatterns,
            {
              group: ['axios/*'],
              message: 'Use shared axios clients from `apps/mobile/lib/axios.ts` only.'
            }
          ]
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='axios'][callee.property.name='create']",
          message: 'Create axios clients only in `apps/mobile/lib/axios.ts`.'
        }
      ]
    }
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: ['apps/mobile/lib/env.ts', 'apps/mobile/lib/api/generated/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Mobile must read environment variables via `apps/mobile/lib/env.ts` only.'
        }
      ]
    }
  },
  // ── Mobile: notify centralization (ignores notify.tsx itself) ───────
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: ['apps/mobile/lib/notify.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...mobileCorePaths,
            {
              name: 'react-native-toast-message',
              message:
                'Use `apps/mobile/lib/notify.tsx` as the single entry-point for toast notifications.'
            }
          ],
          patterns: [
            ...mobileCorePatterns,
            {
              group: ['react-native-toast-message/*'],
              message:
                'Use `apps/mobile/lib/notify.tsx` as the single entry-point for toast notifications.'
            }
          ]
        }
      ]
    }
  },
  // ── Mobile: url-state centralization (ignores url-state.tsx itself) ─
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: ['apps/mobile/lib/url-state.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...mobileCorePaths,
            {
              name: 'expo-router',
              importNames: ['useLocalSearchParams', 'useGlobalSearchParams'],
              message: 'Use `apps/mobile/lib/url-state.tsx` wrappers for URL search params.'
            }
          ],
          patterns: mobileCorePatterns
        }
      ]
    }
  },
  // ── Mobile: auth-token centralization (ignores auth-token.ts itself) ─
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: ['apps/mobile/lib/auth-token.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...mobileCorePaths,
            {
              name: 'expo-secure-store',
              message:
                'Access secure storage through `apps/mobile/lib/auth-token.ts` only.'
            }
          ],
          patterns: [
            ...mobileCorePatterns,
            {
              group: ['expo-secure-store/*'],
              message:
                'Access secure storage through `apps/mobile/lib/auth-token.ts` only.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: [
      'apps/mobile/lib/api/generated/**/*.{ts,tsx}',
      'apps/mobile/lib/api/orval-mutator.ts'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            'Direct fetch is forbidden in apps/mobile. Use typed client transport (`clientApi`/generated client).'
        }
      ]
    }
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: [
      'apps/mobile/lib/axios.ts',
      'apps/mobile/lib/axios.test.ts',
      'apps/mobile/lib/client-api.ts',
      'apps/mobile/lib/api/orval-mutator.ts',
      'apps/mobile/lib/api/generated/**/*.{ts,tsx}'
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='api'][callee.property.name=/^(get|post|put|patch|delete|request)$/]",
          message:
            'Use generated API hooks/functions (or `clientApi` transitional wrapper) instead of calling shared axios instances directly.'
        }
      ]
    }
  },
  {
    files: ['apps/mobile/lib/log.ts'],
    rules: {
      'no-console': 'off'
    }
  },
  // ── Rule: Enforce explicit return types on exported port functions ───
  // Ports are API contracts. Inferred return types can silently change.
  {
    files: ['packages/core/src/domains/*/ports/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true
        }
      ]
    }
  },

  // ── Rule: Ban instanceof in domain layer ────────────────────────────
  // Domain code should use discriminated unions (_tag) instead of instanceof.
  // Keeps domain logic serializable and testable.
  {
    files: [
      'packages/core/src/domains/*/domain/**/*.ts',
      'apps/**/src/domains/*/domain/**/*.ts'
    ],
    ignores: ['**/*.test.ts', '**/*.integration.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'BinaryExpression[operator="instanceof"]',
          message:
            'Use discriminated unions (_tag) instead of instanceof in domain layer. Keeps domain logic serializable and testable.'
        }
      ]
    }
  },

  // ── Rule: Ban Object.assign mutation in domain layer ────────────────
  // Domain entities should be immutable. Use spread { ...obj, ...overrides }.
  {
    files: [
      'packages/core/src/domains/*/domain/**/*.ts',
      'apps/**/src/domains/*/domain/**/*.ts'
    ],
    ignores: ['**/*.test.ts', '**/*.integration.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.object.name="Object"][callee.property.name="assign"]',
          message:
            'Use object spread { ...obj, ...overrides } instead of Object.assign in domain layer. Domain entities should be immutable.'
        }
      ]
    }
  }
]
