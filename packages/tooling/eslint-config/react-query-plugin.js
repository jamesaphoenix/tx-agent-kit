/**
 * Custom ESLint rules that keep the apps/web React Query layer smooth and
 * consistent:
 *
 * - `no-zero-staletime`        — `staleTime: 0` forces a refetch on every mount,
 *                                which is the navigation-flicker anti-pattern.
 * - `require-query-key-factory`— endpoint-style query keys must come from the
 *                                generated `get*QueryKey()` factories so cache
 *                                reads and writes can never drift.
 */

const normalizePath = (filePath) => (filePath ?? '').replaceAll('\\', '/')

const getFilename = (context) =>
  normalizePath(
    typeof context.getFilename === 'function' ? context.getFilename() : context.filename
  )

const isGeneratedFile = (filePath) => filePath.includes('/lib/api/generated/')

const isEndpointStringLiteral = (node) =>
  node?.type === 'Literal' && typeof node.value === 'string' && node.value.startsWith('/v1')

// Cache-mutating QueryClient methods whose key argument should come from a factory.
const QUERY_CLIENT_KEY_METHODS = new Set([
  'setQueryData',
  'getQueryData',
  'setQueriesData',
  'getQueriesData',
  'removeQueries'
])

// Returns true when an ArrayExpression is being used as a React Query key:
// as a `queryKey:` property value, a `*QueryKey` variable initializer, or the
// first argument to a cache-mutating QueryClient method.
const isQueryKeyContext = (arrayNode) => {
  const parent = arrayNode.parent

  if (!parent) {
    return false
  }

  if (parent.type === 'Property') {
    const keyName = parent.key?.type === 'Identifier' ? parent.key.name : parent.key?.value
    return keyName === 'queryKey'
  }

  if (parent.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
    return /querykey$/i.test(parent.id.name)
  }

  if (parent.type === 'CallExpression' && parent.callee?.type === 'MemberExpression') {
    const methodName =
      parent.callee.property?.type === 'Identifier' ? parent.callee.property.name : null
    return methodName !== null && QUERY_CLIENT_KEY_METHODS.has(methodName) && parent.arguments[0] === arrayNode
  }

  return false
}

export const reactQueryPlugin = {
  rules: {
    'no-zero-staletime': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Forbid staleTime: 0, which refetches on every mount and causes navigation flicker.'
        },
        messages: {
          noZeroStaleTime:
            'Avoid staleTime: 0 — it refetches on every mount and flickers between pages. Use a positive staleTime or the NAVIGATION_QUERY_OPTIONS preset from lib/query-config.ts.'
        },
        schema: []
      },
      create(context) {
        return {
          Property(node) {
            const keyName =
              node.key?.type === 'Identifier'
                ? node.key.name
                : node.key?.type === 'Literal'
                  ? node.key.value
                  : null

            if (keyName !== 'staleTime') {
              return
            }

            if (node.value?.type === 'Literal' && node.value.value === 0) {
              context.report({ node, messageId: 'noZeroStaleTime' })
            }
          }
        }
      }
    },

    'require-query-key-factory': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Endpoint-style query keys must come from the generated get*QueryKey() factories, not hand-written array literals.'
        },
        messages: {
          useFactory:
            'Build this query key from the generated get*QueryKey() factory in lib/api/generated/* instead of a hand-written array literal, so cache reads and writes cannot drift.'
        },
        schema: []
      },
      create(context) {
        const filePath = getFilename(context)

        if (isGeneratedFile(filePath)) {
          return {}
        }

        return {
          ArrayExpression(node) {
            const first = node.elements?.[0]
            if (isEndpointStringLiteral(first) && isQueryKeyContext(node)) {
              context.report({ node, messageId: 'useFactory' })
            }
          }
        }
      }
    }
  }
}
