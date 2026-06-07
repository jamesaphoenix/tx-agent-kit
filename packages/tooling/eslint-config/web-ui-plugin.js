const getLiteralValue = (node) => {
  if (!node) {
    return null
  }

  if (node.type === 'Literal') {
    return node.value
  }

  if (node.type === 'JSXExpressionContainer' && node.expression.type === 'Literal') {
    return node.expression.value
  }

  return null
}

const getStringishValue = (node) => {
  const literal = getLiteralValue(node)

  if (typeof literal === 'string') {
    return literal
  }

  if (node?.type === 'JSXExpressionContainer' && node.expression.type === 'TemplateLiteral' && node.expression.expressions.length === 0) {
    return node.expression.quasis.map((quasi) => quasi.value.cooked ?? '').join('')
  }

  return null
}

const normalizePath = (filePath) => filePath.replaceAll('\\', '/')

const isAppPageFile = (filePath) => {
  const normalized = normalizePath(filePath)

  return (
    (normalized.includes('/apps/web/app/') || normalized.startsWith('apps/web/app/'))
    && (normalized.endsWith('/page.tsx') || normalized.endsWith('/page.jsx'))
  )
}

const isApplicationRouteOrSharedComponentFile = (filePath) => {
  const normalized = normalizePath(filePath)

  return (
    normalized.includes('/apps/web/app/(application)/')
    || normalized.startsWith('apps/web/app/(application)/')
    || normalized.includes('/apps/web/components/')
    || normalized.startsWith('apps/web/components/')
  )
}

const isApplicationPageFile = (filePath) => {
  const normalized = normalizePath(filePath)

  return (
    (
      normalized.includes('/apps/web/app/(application)/')
      || normalized.startsWith('apps/web/app/(application)/')
    )
    && (normalized.endsWith('/page.tsx') || normalized.endsWith('/page.jsx'))
  )
}

const isApplicationRouteOrSharedComponentPageFile = (filePath) => (
  isApplicationPageFile(filePath) || isApplicationRouteOrSharedComponentFile(filePath)
)

const isApplicationLandingPageFile = (filePath) => {
  const normalized = normalizePath(filePath)

  return (
    normalized.endsWith('/apps/web/app/(application)/org/page.tsx')
    || normalized.endsWith('apps/web/app/(application)/org/page.tsx')
  )
}

const getJsxName = (name) => {
  if (!name) {
    return null
  }

  if (name.type === 'JSXIdentifier') {
    return name.name
  }

  if (name.type === 'JSXMemberExpression') {
    return getJsxName(name.property)
  }

  return null
}

const getAttributeValue = (openingElement, attributeName) => {
  const attribute = openingElement.attributes.find((candidate) => (
    candidate.type === 'JSXAttribute'
    && candidate.name.type === 'JSXIdentifier'
    && candidate.name.name === attributeName
  ))

  if (!attribute) {
    return null
  }

  return getStringishValue(attribute.value)
}

const classNameIncludes = (openingElement, ...tokens) => {
  const className = getAttributeValue(openingElement, 'className')

  return typeof className === 'string' && tokens.every((token) => className.includes(token))
}

const containsPageLoadingSpinner = (node, seen = new WeakSet()) => {
  if (!node || typeof node !== 'object') {
    return false
  }

  if (seen.has(node)) {
    return false
  }

  seen.add(node)

  if (node.type === 'JSXElement' && getJsxName(node.openingElement.name) === 'PageLoadingSpinner') {
    return true
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') {
      continue
    }

    if (Array.isArray(value)) {
      if (value.some((item) => containsPageLoadingSpinner(item, seen))) {
        return true
      }
    } else if (value && typeof value === 'object' && value.type !== undefined) {
      if (containsPageLoadingSpinner(value, seen)) {
        return true
      }
    }
  }

  return false
}

const containsJsxElementNamed = (node, names, seen = new WeakSet()) => {
  if (!node || typeof node !== 'object') {
    return false
  }

  if (seen.has(node)) {
    return false
  }

  seen.add(node)

  if (node.type === 'JSXElement' && names.has(getJsxName(node.openingElement.name))) {
    return true
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') {
      continue
    }

    if (Array.isArray(value)) {
      if (value.some((item) => containsJsxElementNamed(item, names, seen))) {
        return true
      }
    } else if (value && typeof value === 'object' && value.type !== undefined) {
      if (containsJsxElementNamed(value, names, seen)) {
        return true
      }
    }
  }

  return false
}

const getJsxAttribute = (openingElement, attributeName) => openingElement.attributes.find((candidate) => (
  candidate.type === 'JSXAttribute'
  && candidate.name.type === 'JSXIdentifier'
  && candidate.name.name === attributeName
)) ?? null

const referencesLoadingState = (node, seen = new WeakSet()) => {
  if (!node || typeof node !== 'object') {
    return false
  }

  if (seen.has(node)) {
    return false
  }

  seen.add(node)

  if (node.type === 'Identifier') {
    return /(?:^|[A-Z])loading$/iu.test(node.name)
      || node.name === 'isLoading'
      || node.name === 'isInitialLoading'
      || node.name === 'isPending'
  }

  if (node.type === 'MemberExpression') {
    const propertyName = node.property.type === 'Identifier' ? node.property.name : null
    if (propertyName === 'isLoading' || propertyName === 'isPending') {
      return true
    }
  }

  return Object.entries(node).some(([key, value]) => {
    if (key === 'parent' || key === 'loc' || key === 'range') {
      return false
    }

    if (Array.isArray(value)) {
      return value.some((item) => referencesLoadingState(item, seen))
    }

    return value && typeof value === 'object' && value.type !== undefined && referencesLoadingState(value, seen)
  })
}

const directReturnStatements = (node) => {
  if (!node) {
    return []
  }

  if (node.type === 'ReturnStatement') {
    return [node]
  }

  if (node.type === 'BlockStatement') {
    return node.body.filter((statement) => statement.type === 'ReturnStatement')
  }

  return []
}

const getImportSourceValue = (node) => {
  if (node.source.type !== 'Literal') {
    return null
  }

  return typeof node.source.value === 'string' ? node.source.value : null
}

const isBoneyardSkeletonImportSource = (source) => (
  source === 'boneyard-js/react'
  || source.endsWith('/boneyard-skeleton')
  || source.endsWith('/boneyard-page-skeleton')
  || source.endsWith('/page-boneyard-skeleton')
  || source.endsWith('/ui/boneyard-skeleton')
  || source.endsWith('/ui/boneyard-page-skeleton')
  || source.endsWith('/ui/page-boneyard-skeleton')
)

const getImportSpecifierName = (specifier) => {
  if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
    return specifier.local.name
  }

  if (specifier.type === 'ImportSpecifier') {
    return specifier.local.name
  }

  return null
}

const getImportedName = (specifier) => {
  if (specifier.type !== 'ImportSpecifier') {
    return null
  }

  if (specifier.imported.type === 'Identifier') {
    return specifier.imported.name
  }

  return specifier.imported.value
}

const getPropertyName = (node) => {
  if (!node) {
    return null
  }

  if (node.type === 'Identifier') {
    return node.name
  }

  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }

  return null
}

const isQueryConfigImportSource = (source) => (
  source === '@/lib/query-config'
  || source.endsWith('/lib/query-config')
  || source.endsWith('/query-config')
)

const getCallName = (callee) => {
  if (!callee) {
    return null
  }

  if (callee.type === 'Identifier') {
    return callee.name
  }

  if (callee.type === 'MemberExpression') {
    if (callee.property.type === 'Identifier' && !callee.computed) {
      return callee.property.name
    }

    if (callee.property.type === 'Literal' && typeof callee.property.value === 'string') {
      return callee.property.value
    }
  }

  return null
}

const MUTATION_HOOK_WORDS = /(?:Create|Update|Delete|Remove|Upload|Attach|Detach|Start|Stop|PostNow|Publish|Schedule|Cancel|Invite|Accept|Reject|Confirm|Connect|Disconnect|Refresh|Enable|Disable|Transfer|Finalize|Mutation)/u

const QUERY_HOOK_WORDS = /(?:List|Get|Read|Find|Search|Preview|Validate|Stats|Analytics|Usage|History|Balance|Permissions|Organization|Organizations|Workspace|Workspaces|Team|Teams|Billing|Assets|Media|Profile|Subscription|Members|Settings|Onboarding|Query)$/u

const SHARED_QUERY_OPTION_PRESETS = new Set([
  'APP_PAGE_QUERY_OPTIONS',
  'LIST_PAGE_QUERY_OPTIONS',
  'NAVIGATION_QUERY_OPTIONS'
])

const isClientQueryHookName = (name) => {
  if (!name) {
    return false
  }

  if (['useQuery', 'useQueries', 'useInfiniteQuery', 'useSuspenseQuery'].includes(name)) {
    return true
  }

  if (!/^use[A-Z]/u.test(name)) {
    return false
  }

  if (MUTATION_HOOK_WORDS.test(name)) {
    return false
  }

  return QUERY_HOOK_WORDS.test(name)
}

const CLIENT_API_QUERY_METHOD_WORDS = /^(?:get|list|read|find|search|preview|validate|stats|analytics|usage|history|balance|permissions)/u

const isClientDataFetchCall = (callee) => {
  const callName = getCallName(callee)

  if (callName === 'fetch' || callName === 'customInstance') {
    return true
  }

  if (callee?.type !== 'MemberExpression' || callee.computed) {
    return false
  }

  const objectName = callee.object.type === 'Identifier' ? callee.object.name : null

  return objectName === 'clientApi'
    && typeof callName === 'string'
    && CLIENT_API_QUERY_METHOD_WORDS.test(callName)
}

const referencesSharedQueryOptions = (node, sharedNames) => {
  if (!node) {
    return false
  }

  if (node.type === 'Identifier') {
    return sharedNames.has(node.name)
  }

  if (node.type === 'MemberExpression') {
    return referencesSharedQueryOptions(node.object, sharedNames)
  }

  return false
}

const findAncestor = (node, predicate) => {
  let current = node?.parent ?? null

  while (current) {
    if (predicate(current)) {
      return current
    }

    current = current.parent ?? null
  }

  return null
}

const isInsideClientQueryHookCall = (node) => Boolean(findAncestor(
  node,
  (ancestor) => ancestor.type === 'CallExpression'
    && isClientQueryHookName(getCallName(ancestor.callee))
))

export const webUiPlugin = {
  rules: {
    'no-raw-dialog-role': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Require web modals to use the shared Dialog primitive.'
        },
        messages: {
          useSharedDialog: 'Use apps/web/components/ui/dialog.tsx instead of hand-rolling role="dialog" so Escape and close behavior stay centralized.'
        },
        schema: []
      },
      create(context) {
        return {
          JSXAttribute(node) {
            if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'role') {
              return
            }

            if (getLiteralValue(node.value) !== 'dialog') {
              return
            }

            context.report({
              node,
              messageId: 'useSharedDialog'
            })
          }
        }
      }
    },
    'require-shared-page-loading-spinner': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Require route pages to use the shared page loading spinner for page-level loading states.'
        },
        messages: {
          useSharedSpinner: 'Use PageLoadingSpinner from apps/web/components/PageLoadingSpinner.tsx for page-level loading states instead of hand-rolled loading UI.'
        },
        schema: []
      },
      create(context) {
        const filePath = typeof context.getFilename === 'function'
          ? context.getFilename()
          : context.filename
        const appliesToFile = isAppPageFile(filePath ?? '')

        if (!appliesToFile) {
          return {}
        }

        return {
          IfStatement(node) {
            if (!referencesLoadingState(node.test)) {
              return
            }

            for (const returnStatement of directReturnStatements(node.consequent)) {
              if (!returnStatement.argument || containsPageLoadingSpinner(returnStatement.argument)) {
                continue
              }

              context.report({
                node: returnStatement.argument,
                messageId: 'useSharedSpinner'
              })
            }
          },
          JSXOpeningElement(node) {
            if (!classNameIncludes(node, 'h-8', 'w-8', 'animate-spin', 'rounded-full')) {
              return
            }

            context.report({
              node,
              messageId: 'useSharedSpinner'
            })
          }
        }
      }
    },
    'require-boneyard-skeleton-for-app-query': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Require application route/client query or fetch renderers to expose a Boneyard-backed skeleton migration path.'
        },
        messages: {
          requireBoneyardSkeleton: 'Application components that render query/custom-fetch backed data or Suspense loading fallbacks should use a Boneyard-backed skeleton with a stable name and fallback.'
        },
        schema: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              target: {
                enum: ['app-pages', 'app-pages-and-components']
              }
            }
          }
        ]
      },
      create(context) {
        const filePath = typeof context.getFilename === 'function'
          ? context.getFilename()
          : context.filename
        const target = context.options[0]?.target ?? 'app-pages-and-components'
        const appliesToFile = target === 'app-pages'
          ? isApplicationPageFile(filePath ?? '')
          : isApplicationRouteOrSharedComponentFile(filePath ?? '')
        const appliesToAppPage = isApplicationPageFile(filePath ?? '')

        if (!appliesToFile) {
          return {}
        }

        const boneyardSkeletonNames = new Set([
          'BoneyardSkeleton',
          'BoneyardPageSkeleton',
          'BoneyardSuspenseFallback',
          'BoneyardSkeletonBoundary',
          'PageBoneyardSkeleton'
        ])
        const nonBoneyardLoadingSurfaceNames = new Set(['PageLoadingSpinner', 'Skeleton'])
        let firstQueryHookNode = null
        let firstSuspenseFallbackLoadingNode = null
        let hasBoneyardSkeleton = false
        let hasComponentLoadingSurface = false

        return {
          ImportDeclaration(node) {
            const source = getImportSourceValue(node)

            if (!source || !isBoneyardSkeletonImportSource(source)) {
              return
            }

            for (const specifier of node.specifiers) {
              const importedName = getImportedName(specifier)
              const localName = getImportSpecifierName(specifier)

              if (!localName) {
                continue
              }

              if (source === 'boneyard-js/react' && importedName !== 'Skeleton') {
                continue
              }

              boneyardSkeletonNames.add(localName)
            }
          },
          CallExpression(node) {
            if (firstQueryHookNode) {
              return
            }

            if (isClientQueryHookName(getCallName(node.callee)) || isClientDataFetchCall(node.callee)) {
              firstQueryHookNode = node
            }
          },
          JSXOpeningElement(node) {
            const jsxName = getJsxName(node.name)

            if (jsxName && boneyardSkeletonNames.has(jsxName)) {
              hasBoneyardSkeleton = true
              return
            }

            if (jsxName === 'Suspense') {
              const fallbackAttribute = getJsxAttribute(node, 'fallback')

              if (fallbackAttribute?.value && containsJsxElementNamed(fallbackAttribute.value, boneyardSkeletonNames)) {
                hasBoneyardSkeleton = true
                return
              }

              if (
                !firstSuspenseFallbackLoadingNode
                && fallbackAttribute?.value
                && containsJsxElementNamed(fallbackAttribute.value, nonBoneyardLoadingSurfaceNames)
              ) {
                firstSuspenseFallbackLoadingNode = node
                hasComponentLoadingSurface = true
              }
            }

            if (jsxName === 'PageLoadingSpinner' || jsxName === 'Skeleton') {
              hasComponentLoadingSurface = true
            }
          },
          JSXText(node) {
            if (/\bLoading\b/u.test(node.value)) {
              hasComponentLoadingSurface = true
            }
          },
          'Program:exit'() {
            if (!firstQueryHookNode || hasBoneyardSkeleton) {
              if (!firstQueryHookNode && appliesToAppPage && firstSuspenseFallbackLoadingNode && !hasBoneyardSkeleton) {
                context.report({
                  node: firstSuspenseFallbackLoadingNode,
                  messageId: 'requireBoneyardSkeleton'
                })
              }
              return
            }

            if (!appliesToAppPage && !hasComponentLoadingSurface) {
              return
            }

            context.report({
              node: firstQueryHookNode,
              messageId: 'requireBoneyardSkeleton'
            })
          }
        }
      }
    },
    'require-shared-app-query-options': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Require application route pages/components to use shared React Query option presets instead of ad hoc inline query objects.'
        },
        messages: {
          requireSharedQueryOptions: 'Application query options should spread APP_PAGE_QUERY_OPTIONS, LIST_PAGE_QUERY_OPTIONS, or NAVIGATION_QUERY_OPTIONS so page/component data keeps the shared client-side caching behavior.'
        },
        schema: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              target: {
                enum: ['app-pages', 'app-pages-and-components']
              }
            }
          }
        ]
      },
      create(context) {
        const filePath = typeof context.getFilename === 'function'
          ? context.getFilename()
          : context.filename
        const target = context.options[0]?.target ?? 'app-pages-and-components'
        const appliesToFile = target === 'app-pages'
          ? isApplicationPageFile(filePath ?? '')
          : isApplicationRouteOrSharedComponentPageFile(filePath ?? '')

        if (!appliesToFile) {
          return {}
        }

        const sharedQueryOptionNames = new Set(SHARED_QUERY_OPTION_PRESETS)

        return {
          ImportDeclaration(node) {
            const source = getImportSourceValue(node)

            if (!source || !isQueryConfigImportSource(source)) {
              return
            }

            for (const specifier of node.specifiers) {
              const importedName = getImportedName(specifier)
              const localName = getImportSpecifierName(specifier)

              if (!localName || !importedName || !SHARED_QUERY_OPTION_PRESETS.has(importedName)) {
                continue
              }

              sharedQueryOptionNames.add(localName)
            }
          },
          VariableDeclarator(node) {
            if (node.id.type !== 'Identifier' || !referencesSharedQueryOptions(node.init, sharedQueryOptionNames)) {
              return
            }

            sharedQueryOptionNames.add(node.id.name)
          },
          Property(node) {
            if (getPropertyName(node.key) !== 'query' || node.value.type !== 'ObjectExpression') {
              return
            }

            if (!isInsideClientQueryHookCall(node)) {
              return
            }

            const hasSharedPreset = node.value.properties.some((property) => (
              property.type === 'SpreadElement'
              && referencesSharedQueryOptions(property.argument, sharedQueryOptionNames)
            ))

            if (hasSharedPreset) {
              return
            }

            context.report({
              node: node.value,
              messageId: 'requireSharedQueryOptions'
            })
          }
        }
      }
    },
    'no-page-loading-spinner-in-app-shell': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow page-level spinners for application routes after the initial app landing handoff.'
        },
        messages: {
          preferBoneyard: 'Use a Boneyard-backed skeleton for app-shell route loading states. Keep PageLoadingSpinner only for the first app landing/bootstrap handoff.'
        },
        schema: []
      },
      create(context) {
        const filePath = typeof context.getFilename === 'function'
          ? context.getFilename()
          : context.filename

        if (!isApplicationPageFile(filePath ?? '') || isApplicationLandingPageFile(filePath ?? '')) {
          return {}
        }

        return {
          JSXOpeningElement(node) {
            if (getJsxName(node.name) !== 'PageLoadingSpinner') {
              return
            }

            context.report({
              node,
              messageId: 'preferBoneyard'
            })
          }
        }
      }
    }
  }
}
