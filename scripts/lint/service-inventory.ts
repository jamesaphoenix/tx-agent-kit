#!/usr/bin/env -S npx tsx
/**
 * Service Inventory — ts-morph powered analysis of Effect Context.Tag services.
 *
 * Uses the TypeScript compiler API (via ts-morph) to:
 * 1. Discover all Context.Tag services and ports with full type information
 * 2. Auto-classify methods by signature shape (not name patterns)
 * 3. Cross-reference with API routes and integration tests
 * 4. Match services to design specs for context-rich test gap analysis
 * 5. Generate agent prompts for writing missing tests
 *
 * Test coverage detection uses a hybrid AST + string approach:
 * - AST: parses route handlers to build endpoint→service method mapping
 * - AST: parses test file imports for explicit service/factory references
 * - String: @covers annotations for explicit coverage declarations
 * - String: describe/it block names for method name mentions
 * - String: domain name in file path (lowest confidence, service-level only)
 *
 * Usage:
 *   npx tsx scripts/lint/service-inventory.ts              # Full report
 *   npx tsx scripts/lint/service-inventory.ts --json       # JSON output
 *   npx tsx scripts/lint/service-inventory.ts --gaps-only  # Missing tests/routes only
 *   npx tsx scripts/lint/service-inventory.ts --prompts    # Generate agent test prompts
 */

import { Project, SyntaxKind, type PropertySignature } from 'ts-morph'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { resolve, relative, basename } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const CORE_DOMAINS = resolve(REPO_ROOT, 'packages/core/src/domains')
const API_ROUTES = resolve(REPO_ROOT, 'apps/api/src/routes')
const API_TESTS = resolve(REPO_ROOT, 'apps/api/src')
const WEB_TESTS = resolve(REPO_ROOT, 'apps/web')
const SPECS_DIR = resolve(REPO_ROOT, 'specs/design')

// ── Allow list: methods exempt from integration test requirement ────
//
// Not every service method needs a dedicated integration test. Methods
// that are internal helpers, simple getters/setters, delegation-only,
// or implicitly covered by other tests can be allow-listed here.
//
// Agents should use judgment when deciding whether to add a method here
// vs writing a test. When in doubt, write the test. Good candidates:
//   - Internal methods called only by other tested service methods
//   - Simple property getters/setters with no business logic
//   - Methods whose behavior is fully exercised by testing callers
//   - Delegation-only methods that just forward to a port
//
// Format: ServiceClassName → { methods: [...], reason: '...' }
const ALLOWED_UNTESTED_METHODS: Record<string, { methods: string[]; reason: string }> = {
  // Example:
  // 'AuthService': {
  //   methods: ['getPrincipalFromToken'],
  //   reason: 'Internal middleware helper, tested indirectly through all authenticated endpoints'
  // },
}

function isMethodAllowListed(serviceName: string, methodName: string): boolean {
  return ALLOWED_UNTESTED_METHODS[serviceName]?.methods.includes(methodName) ?? false
}

// ── Types ────────────────────────────────────────────────────────────

interface MethodInfo {
  name: string
  params: ParamInfo[]
  returnType: string
  returnShape: 'single' | 'list' | 'paginated' | 'void' | 'boolean' | 'unknown'
  errorType: string | null
  dependencies: string[]
  classification: MethodClassification
}

interface ParamInfo {
  name: string
  type: string
  isOptional: boolean
}

type MethodClassification =
  | 'get-by-id'
  | 'get-many'
  | 'list'
  | 'create'
  | 'update'
  | 'remove'
  | 'auth'
  | 'membership'
  | 'webhook'
  | 'query'
  | 'mutation'
  | 'validation'
  | 'custom'

type CoverageConfidence = 'explicit' | 'high' | 'medium' | 'low'

interface MethodCoverage {
  method: string
  confidence: CoverageConfidence
  source: string
}

interface ServiceInfo {
  className: string
  tagString: string
  type: 'service' | 'port' | 'middleware'
  domain: string
  layer: string
  file: string
  methods: MethodInfo[]
  crudCompleteness: CrudCompleteness | null
  relatedSpec: string | null
  hasIntegrationTest: boolean
  testFiles: string[]
  untestedMethods: string[]
  methodCoverage: MethodCoverage[]
}

interface CrudCompleteness {
  get: string | null
  list: string | null
  create: string | null
  update: string | null
  remove: string | null
}

// ── ts-morph project setup ───────────────────────────────────────────

function createProject(): Project {
  return new Project({
    tsConfigFilePath: resolve(REPO_ROOT, 'packages/core/tsconfig.json'),
    skipAddingFilesFromTsConfig: true
  })
}

// ── Method classification by signature shape ─────────────────────────

function classifyMethod(name: string, params: ParamInfo[], returnShape: string): MethodClassification {
  const hasIdParam = params.some(
    (p) => (p.name === 'id' && p.type === 'string') ||
           (p.name.endsWith('Id') && p.type === 'string' && !p.name.includes('organization') && !p.name.includes('team'))
  )
  const hasInputParam = params.some(
    (p) => p.name === 'input' || p.name === 'command' || p.name === 'data'
  )
  const hasListParams = params.some((p) => p.type.includes('ListParams') || p.name === 'params')

  // Auth operations
  if (/^(?:sign|refresh|reset|authenticate|authorize|start|complete|getPrincipal)/.test(name)) {
    return 'auth'
  }

  // Membership operations
  if (/(?:Member|Ownership)/.test(name) && /^(?:add|remove|list|transfer|disable|enable|update|get|count)/.test(name)) {
    return 'membership'
  }

  // Webhook/event processing
  if (/^(?:process|handle)/.test(name) && /(?:Webhook|Event)/.test(name)) {
    return 'webhook'
  }

  // Validation
  if (/^(?:validate|verify|check|is)/.test(name)) {
    return 'validation'
  }

  // Classify by signature shape
  if (returnShape === 'paginated' || (returnShape === 'list' && hasListParams)) {
    return 'list'
  }

  if (returnShape === 'void' && hasIdParam && !hasInputParam) {
    return 'remove'
  }

  if (name.startsWith('remove') || name.startsWith('delete') || name.startsWith('revoke')) {
    return 'remove'
  }

  if (hasIdParam && hasInputParam && returnShape === 'single') {
    return 'update'
  }

  if (name.startsWith('update')) {
    return 'update'
  }

  if (hasInputParam && !hasIdParam && returnShape === 'single') {
    return 'create'
  }

  if (name.startsWith('create')) {
    return 'create'
  }

  if (hasIdParam && returnShape === 'single' && !hasInputParam) {
    return 'get-by-id'
  }

  if (name.startsWith('getMany') || name.startsWith('getManyBy')) {
    return 'get-many'
  }

  if (name.startsWith('get') && returnShape === 'single') {
    return 'get-by-id'
  }

  if (name.startsWith('list') || name.startsWith('find')) {
    return 'list'
  }

  // Mutations that modify state
  if (name.startsWith('record') || name.startsWith('accept') || name.startsWith('claim') || name.startsWith('adjust')) {
    return 'mutation'
  }

  // Read-only queries
  if (name.startsWith('get') || name.startsWith('summarize') || name.startsWith('count')) {
    return 'query'
  }

  return 'custom'
}

function inferReturnShape(returnTypeText: string): MethodInfo['returnShape'] {
  if (/PaginatedResult/.test(returnTypeText)) return 'paginated'
  if (/ReadonlyArray|Array</.test(returnTypeText)) return 'list'
  if (/\{\s*deleted:\s*true\s*\}|void/.test(returnTypeText)) return 'void'
  if (/boolean/.test(returnTypeText)) return 'boolean'
  if (/Effect\.Effect<[^,]+,/.test(returnTypeText)) return 'single'
  return 'unknown'
}

// ── Extract services using ts-morph ──────────────────────────────────

function extractServicesFromFile(project: Project, filePath: string): ServiceInfo[] {
  const sourceFile = project.addSourceFileAtPath(filePath)
  const services: ServiceInfo[] = []

  const domain = filePath.match(/domains\/([^/]+)\//)?.[1] ?? 'unknown'
  const layer = filePath.includes('/application/') ? 'application' : filePath.includes('/ports/') ? 'ports' : 'other'

  for (const cls of sourceFile.getClasses()) {
    const className = cls.getName()
    if (!className) continue

    // Check if it extends Context.Tag
    const extendsExpr = cls.getExtends()
    if (!extendsExpr) continue

    const extendsText = extendsExpr.getText()
    if (!extendsText.includes('Context.Tag')) continue

    // Extract tag string
    const tagMatch = extendsText.match(/Context\.Tag\s*\(\s*['"]([^'"]+)['"]\s*\)/)
    const tagString = tagMatch?.[1] ?? className

    // Determine type
    const type: ServiceInfo['type'] = className.endsWith('Middleware')
      ? 'middleware'
      : className.endsWith('Service')
        ? 'service'
        : className.endsWith('Port')
          ? 'port'
          : 'service'

    // Extract methods from the type parameter
    // Pattern: Context.Tag('X')<X, { method1: ..., method2: ... }>()
    // The TypeLiteral with method signatures is a descendant of the heritage clause
    const methods: MethodInfo[] = []

    const heritageClause = cls.getHeritageClauseByKind(SyntaxKind.ExtendsKeyword)
    if (heritageClause) {
      // Find the service interface TypeLiteral — it's the one whose properties
      // have FunctionType values (method signatures), not the nested inline types
      // inside parameter/return positions.
      const typeLiterals = heritageClause.getDescendantsOfKind(SyntaxKind.TypeLiteral)

      // The service interface is the largest TypeLiteral whose direct children
      // are PropertySignatures with FunctionType values
      const serviceTypeLiteral = typeLiterals.find((tl) => {
        const members = tl.getMembers()
        if (members.length === 0) return false
        // At least half the properties should have FunctionType values
        const funcProps = members.filter(
          (m) => m.getKind() === SyntaxKind.PropertySignature &&
            (m as PropertySignature).getTypeNode()?.getKind() === SyntaxKind.FunctionType
        )
        return funcProps.length >= members.length * 0.5
      })

      if (serviceTypeLiteral) {
      for (const member of serviceTypeLiteral.getMembers()) {
          if (member.getKind() !== SyntaxKind.PropertySignature) continue

          const prop = member as PropertySignature
          const methodName = prop.getName()
          const typeNode = prop.getTypeNode()

          if (!typeNode) continue

          const typeText = typeNode.getText()
          const params: ParamInfo[] = []

          // Extract parameters from function type
          if (typeNode.getKind() === SyntaxKind.FunctionType) {
            const funcType = typeNode.asKindOrThrow(SyntaxKind.FunctionType)
            for (const param of funcType.getParameters()) {
              params.push({
                name: param.getName(),
                type: param.getTypeNode()?.getText() ?? 'unknown',
                isOptional: param.hasQuestionToken()
              })
            }
          }

          // Parse return type for Effect.Effect<T, E, R>
          const effectMatch = typeText.match(/Effect\.Effect<([^,>]+)(?:,\s*([^,>]+))?(?:,\s*([^>]+))?>/)
          const returnTypeStr = effectMatch?.[1]?.trim() ?? 'unknown'
          const errorType = effectMatch?.[2]?.trim() ?? null
          const depsStr = effectMatch?.[3]?.trim() ?? ''
          const dependencies = depsStr
            ? depsStr.split('|').map((d) => d.trim()).filter(Boolean)
            : []

          const returnShape = inferReturnShape(returnTypeStr)
          const classification = classifyMethod(methodName, params, returnShape)

          methods.push({
            name: methodName,
            params,
            returnType: returnTypeStr,
            returnShape,
            errorType,
            dependencies,
            classification
          })
        }
      }
    }

    // Find related spec
    const relatedSpec = findRelatedSpec(domain)

    services.push({
      className,
      tagString,
      type,
      domain,
      layer,
      file: relative(REPO_ROOT, filePath),
      methods,
      crudCompleteness: computeCrudCompleteness(methods),
      relatedSpec,
      hasIntegrationTest: false,
      testFiles: [],
      untestedMethods: [],
      methodCoverage: []
    })
  }

  // Remove the source file to avoid conflicts
  project.removeSourceFile(sourceFile)
  return services
}

function computeCrudCompleteness(methods: MethodInfo[]): CrudCompleteness | null {
  const crud: CrudCompleteness = {
    get: methods.find((m) => m.classification === 'get-by-id')?.name ?? null,
    list: methods.find((m) => m.classification === 'list')?.name ?? null,
    create: methods.find((m) => m.classification === 'create')?.name ?? null,
    update: methods.find((m) => m.classification === 'update')?.name ?? null,
    remove: methods.find((m) => m.classification === 'remove')?.name ?? null
  }

  const hasCrud = Object.values(crud).some(Boolean)
  return hasCrud ? crud : null
}

function findRelatedSpec(domain: string): string | null {
  if (!existsSync(SPECS_DIR)) return null

  const specs = readdirSync(SPECS_DIR).filter((f) => f.endsWith('-design.md'))
  // Match domain to spec: "team" → "tenancy-model-design.md", "billing" → "billing-and-pricing-design.md"
  const domainLower = domain.toLowerCase()
  const match = specs.find((s) => {
    const specName = s.replace('-design.md', '')
    return specName.includes(domainLower) || domainLower.includes(specName.split('-')[0])
  })

  return match ? `specs/design/${match}` : null
}

// ── Hybrid test coverage analysis ───────────────────────────────────
//
// Combines multiple signal sources with confidence levels:
//
// 1. @covers annotations (explicit confidence)
//    Format: // @covers ServiceName.methodName
//    Parsed from single-line comments in test files.
//
// 2. Route endpoint → service method mapping (high confidence)
//    Parses route handler files to build: endpoint → { service, method }
//    Then matches test HTTP paths/fetch calls to endpoints.
//
// 3. describe/it block strings referencing method names (medium confidence)
//    Extracts the first argument of describe()/it()/test() calls
//    and checks for service method names in those strings.
//
// 4. Import analysis (medium confidence)
//    Checks if a test file imports the service class name from domain modules.
//
// 5. Domain name in file path (low confidence, service-level only)
//    If the test file path includes the service's domain name.

/** Mapping from a route endpoint name to the service class + method it calls. */
interface EndpointMapping {
  endpoint: string
  serviceClass: string
  serviceMethod: string
  routeFile: string
}

/**
 * Parse route handler files to build endpoint → service method mappings.
 *
 * Extracts from patterns like:
 *   .handle('createOrganization', ...)
 *     const service = yield* OrganizationService
 *     yield* service.createForUser(...)
 */
function buildEndpointMappings(): EndpointMapping[] {
  if (!existsSync(API_ROUTES)) return []

  const mappings: EndpointMapping[] = []

  for (const file of readdirSync(API_ROUTES).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))) {
    const content = readFileSync(resolve(API_ROUTES, file), 'utf-8')
    const routeFile = `apps/api/src/routes/${file}`

    // Split content into .handle()/.handleRaw() blocks.
    // Each block starts at .handle('name' or .handleRaw('name' and ends at the next one or end of file.
    const handleBlockRe = /\.handle(?:Raw)?\(\s*['"](\w+)['"]/g
    const handlePositions: { endpoint: string; start: number }[] = []

    for (const match of content.matchAll(handleBlockRe)) {
      handlePositions.push({ endpoint: match[1], start: match.index })
    }

    for (let i = 0; i < handlePositions.length; i++) {
      const { endpoint, start } = handlePositions[i]
      const end = i + 1 < handlePositions.length ? handlePositions[i + 1].start : content.length
      const block = content.slice(start, end)

      // Find `yield* ServiceName` — the service being resolved
      const serviceResolveRe = /yield\*\s+(\w+Service(?:\w*))/g
      const serviceClasses: string[] = []
      for (const serviceMatch of block.matchAll(serviceResolveRe)) {
        serviceClasses.push(serviceMatch[1])
      }

      // Find `service.methodName(` — the method being called
      // Also match `yield* service.methodName(` pattern
      const methodCallRe = /(?:yield\*\s+)?service\.(\w+)\s*\(/g
      const methodCalls: string[] = []
      for (const methodMatch of block.matchAll(methodCallRe)) {
        methodCalls.push(methodMatch[1])
      }

      // Also match variable names like `memberService.methodName(`
      const namedServiceCallRe = /(?:yield\*\s+)?\w+Service\w*\.(\w+)\s*\(/g
      for (const methodMatch of block.matchAll(namedServiceCallRe)) {
        // Avoid duplicates with the generic `service.` pattern
        if (!methodCalls.includes(methodMatch[1])) {
          methodCalls.push(methodMatch[1])
        }
      }

      // Also detect the variable binding pattern:
      //   const memberService = yield* OrganizationMemberService
      //   yield* memberService.listOrgMembers(...)
      const namedBindingRe = /const\s+(\w+)\s*=\s*yield\*\s+(\w+Service\w*)/g
      for (const bindingMatch of block.matchAll(namedBindingRe)) {
        const varName = bindingMatch[1]
        const serviceClass = bindingMatch[2]
        // Find method calls on this named binding
        const namedCallRe = new RegExp(`(?:yield\\*\\s+)?${varName}\\.(\\w+)\\s*\\(`, 'g')
        for (const callMatch of block.matchAll(namedCallRe)) {
          mappings.push({
            endpoint,
            serviceClass,
            serviceMethod: callMatch[1],
            routeFile
          })
        }
      }

      // Create mappings for each service class + method pair
      for (const serviceClass of serviceClasses) {
        for (const method of methodCalls) {
          mappings.push({ endpoint, serviceClass, serviceMethod: method, routeFile })
        }
      }
    }
  }

  return mappings
}

/** Structured analysis of a single test file. */
interface TestFileAnalysis {
  file: string
  content: string
  /** Explicit @covers annotations: @covers ServiceName.methodName */
  coversAnnotations: { service: string; method: string | null }[]
  /** Service/factory class names found in import statements */
  importedServiceNames: Set<string>
  /** Method names found inside describe()/it()/test() string arguments */
  testBlockMethodRefs: Set<string>
  /** HTTP endpoint paths found in fetch/requestJson calls */
  httpPaths: Set<string>
}

/**
 * Parse a test file using a hybrid of targeted regex patterns.
 *
 * Unlike the previous pure-string approach, this extracts structured signals
 * from specific syntactic positions (imports, @covers comments, describe blocks)
 * rather than searching the entire file content for any occurrence of a word.
 */
function analyzeTestFile(filePath: string): TestFileAnalysis {
  const content = readFileSync(filePath, 'utf-8')
  const file = relative(REPO_ROOT, filePath)

  // ── 1. @covers annotations ────────────────────────────────────────
  // Format: // @covers ServiceName.methodName
  //         // @covers ServiceName
  const coversAnnotations: TestFileAnalysis['coversAnnotations'] = []
  const coversRe = /\/\/\s*@covers\s+(\w+?)(?:\.(\w+))?\s*$/gm
  for (const match of content.matchAll(coversRe)) {
    coversAnnotations.push({
      service: match[1],
      method: match[2] ?? null
    })
  }

  // ── 2. Import analysis ────────────────────────────────────────────
  // Extract imported symbol names from import statements.
  // We look for service class names (ending in Service/Port/Middleware)
  // and factory function names (createUser, createOrganization, etc.)
  const importedServiceNames = new Set<string>()
  const importRe = /import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/g
  for (const match of content.matchAll(importRe)) {
    const symbols = match[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!.trim())
    for (const sym of symbols) {
      if (/(?:Service|Port|Middleware)$/.test(sym)) {
        importedServiceNames.add(sym)
      }
    }
  }

  // ── 3. describe/it/test block string arguments ────────────────────
  // Extract the first string argument from describe(), it(), test() calls.
  // These often contain method names or invariant IDs.
  const testBlockMethodRefs = new Set<string>()

  // Match describe('string'), it('string'), test('string') — including template literals
  const testBlockRe = /(?:describe|it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g
  for (const match of content.matchAll(testBlockRe)) {
    const blockName = match[1]
    // Extract words that look like method names (camelCase identifiers)
    const methodLikeRe = /\b([a-z][a-zA-Z0-9]{2,})\b/g
    for (const wordMatch of blockName.matchAll(methodLikeRe)) {
      testBlockMethodRefs.add(wordMatch[1])
    }
  }

  // ── 4. HTTP endpoint paths ────────────────────────────────────────
  // Match fetch/requestJson calls to extract URL paths.
  // Pattern: fetch(`${...}/v1/organizations/...`)
  //          requestJson<T>('/v1/organizations/...')
  const httpPaths = new Set<string>()
  const httpPathRe = /(?:fetch|requestJson\s*(?:<[^>]*>)?)\s*\(\s*(?:`[^`]*`|'[^']*'|"[^"]*")/g
  for (const match of content.matchAll(httpPathRe)) {
    // Extract the path portion: /v1/something
    const pathInUrl = match[0].match(/\/v\d+\/[\w/{}$-]+/)
    if (pathInUrl) {
      // Normalize: strip template variable interpolations to get the base path shape
      const normalizedPath = pathInUrl[0].replace(/\$\{[^}]+\}/g, ':id')
      httpPaths.add(normalizedPath)
    }
  }

  return { file, content, coversAnnotations, importedServiceNames, testBlockMethodRefs, httpPaths }
}

function collectTestFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) return []
  const results: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walk(full)
      } else if (entry.name.endsWith('.integration.test.ts') || entry.name.endsWith('.integration.test.tsx')) {
        results.push(full)
      }
    }
  }
  walk(rootDir)
  return results
}

/**
 * Build a mapping from HTTP path patterns to service methods.
 *
 * Uses the OpenAPI spec (if available) or route file analysis to map
 * URL paths like /v1/organizations to endpoint names like 'listOrganizations',
 * then chains to the endpoint→service method mapping.
 */
function buildHttpPathToMethodMap(endpointMappings: EndpointMapping[]): Map<string, EndpointMapping[]> {
  const pathMap = new Map<string, EndpointMapping[]>()

  // Build a simple resource → endpoint mapping.
  // Routes follow a convention: the route group name (e.g., 'organizations')
  // appears in the URL path as /v1/organizations/...
  for (const mapping of endpointMappings) {
    // Derive the resource name from the route file: organizations.ts → organizations
    const resource = basename(mapping.routeFile, '.ts')
    // Also include the endpoint name as a matchable key
    const keys = [resource, mapping.endpoint.toLowerCase()]
    for (const key of keys) {
      const existing = pathMap.get(key) ?? []
      existing.push(mapping)
      pathMap.set(key, existing)
    }
  }

  return pathMap
}

function analyzeTestCoverage(services: ServiceInfo[]): void {
  const testFilePaths = [...collectTestFiles(API_TESTS), ...collectTestFiles(WEB_TESTS)]
  const endpointMappings = buildEndpointMappings()
  const httpPathMap = buildHttpPathToMethodMap(endpointMappings)

  // Analyze all test files once
  const testAnalyses = testFilePaths.map(analyzeTestFile)

  for (const service of services) {
    if (service.type !== 'service') continue

    const className = service.className
    const domain = service.domain
    const kebab = className.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    const methodNames = new Set(service.methods.map((m) => m.name))
    const methodCoverage: MethodCoverage[] = []
    const coveredMethods = new Set<string>()

    // Track which test files match this service (for any reason)
    const matchingTestFiles = new Set<string>()

    for (const analysis of testAnalyses) {
      let matchesService = false

      // ── Signal 1: @covers annotations (explicit confidence) ─────
      for (const annotation of analysis.coversAnnotations) {
        if (annotation.service === className) {
          matchesService = true
          if (annotation.method && methodNames.has(annotation.method)) {
            if (!coveredMethods.has(annotation.method)) {
              methodCoverage.push({
                method: annotation.method,
                confidence: 'explicit',
                source: `@covers in ${analysis.file}`
              })
              coveredMethods.add(annotation.method)
            }
          } else if (!annotation.method) {
            // @covers ServiceName without method — marks all methods as covered
            for (const m of methodNames) {
              if (!coveredMethods.has(m)) {
                methodCoverage.push({
                  method: m,
                  confidence: 'explicit',
                  source: `@covers ${className} in ${analysis.file}`
                })
                coveredMethods.add(m)
              }
            }
          }
        }
      }

      // ── Signal 2: Route endpoint → service method mapping (high confidence) ─
      // Check if test file's HTTP paths match routes that call this service
      for (const httpPath of analysis.httpPaths) {
        // Extract the resource segment from the path: /v1/organizations/... → organizations
        const resourceMatch = httpPath.match(/\/v\d+\/(\w+)/)
        if (!resourceMatch) continue

        const resource = resourceMatch[1]
        const relevantMappings = httpPathMap.get(resource)?.filter(
          (m) => m.serviceClass === className
        ) ?? []

        for (const mapping of relevantMappings) {
          if (methodNames.has(mapping.serviceMethod) && !coveredMethods.has(mapping.serviceMethod)) {
            matchesService = true
            methodCoverage.push({
              method: mapping.serviceMethod,
              confidence: 'high',
              source: `HTTP ${resource} → ${mapping.endpoint} → ${mapping.serviceMethod} in ${analysis.file}`
            })
            coveredMethods.add(mapping.serviceMethod)
          }
        }
      }

      // ── Signal 3: Import analysis (medium confidence, service-level) ─
      if (analysis.importedServiceNames.has(className)) {
        matchesService = true
      }

      // ── Signal 4: describe/it block method name mentions (medium confidence) ─
      if (matchesService || analysis.importedServiceNames.has(className) || analysis.content.includes(className)) {
        for (const methodName of methodNames) {
          if (coveredMethods.has(methodName)) continue

          // Check describe/it blocks for method name references
          if (analysis.testBlockMethodRefs.has(methodName)) {
            methodCoverage.push({
              method: methodName,
              confidence: 'medium',
              source: `describe/it block in ${analysis.file}`
            })
            coveredMethods.add(methodName)
            matchesService = true
          }
        }
      }

      // ── Signal 5: Domain name in file path (low confidence, service-level) ─
      if (!matchesService && analysis.file.includes(domain)) {
        matchesService = true
      }

      // ── Signal 5b: Service class name or kebab in file content ─
      if (!matchesService) {
        if (analysis.content.includes(className) || analysis.content.includes(kebab)) {
          matchesService = true
        }
      }

      if (matchesService) {
        matchingTestFiles.add(analysis.file)
      }
    }

    // ── For service-matched tests without method-level signals, ─────
    // use endpoint mappings to infer method coverage from the route layer.
    // If a test file hits ANY endpoint that calls this service, the methods
    // called by those endpoints are covered at high confidence.
    if (matchingTestFiles.size > 0) {
      const serviceEndpoints = endpointMappings.filter((m) => m.serviceClass === className)
      for (const mapping of serviceEndpoints) {
        if (methodNames.has(mapping.serviceMethod) && !coveredMethods.has(mapping.serviceMethod)) {
          // Check if any matching test file content contains the endpoint name
          for (const analysis of testAnalyses) {
            if (!matchingTestFiles.has(analysis.file)) continue
            if (analysis.content.includes(mapping.endpoint)) {
              methodCoverage.push({
                method: mapping.serviceMethod,
                confidence: 'high',
                source: `endpoint '${mapping.endpoint}' referenced in ${analysis.file}`
              })
              coveredMethods.add(mapping.serviceMethod)
              break
            }
          }
        }
      }
    }

    service.hasIntegrationTest = matchingTestFiles.size > 0
    service.testFiles = [...matchingTestFiles]
    service.methodCoverage = methodCoverage

    // Untested methods = methods not covered by any signal and not allow-listed
    service.untestedMethods = service.methods
      .map((m) => m.name)
      .filter((name) => !coveredMethods.has(name))
      .filter((name) => !isMethodAllowListed(className, name))
  }
}

// ── Route analysis ───────────────────────────────────────────────────

interface RouteEndpoint {
  resource: string
  endpoint: string
  file: string
}

function extractRouteEndpoints(): RouteEndpoint[] {
  if (!existsSync(API_ROUTES)) return []
  const endpoints: RouteEndpoint[] = []

  for (const file of readdirSync(API_ROUTES).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))) {
    const content = readFileSync(resolve(API_ROUTES, file), 'utf-8')
    const resource = basename(file, '.ts')

    for (const match of content.matchAll(/\.handle\s*\(\s*['"](\w+)['"]/g)) {
      endpoints.push({ resource, endpoint: match[1], file: `apps/api/src/routes/${file}` })
    }
  }

  return endpoints
}

function hasRouteFile(domain: string, endpoints: RouteEndpoint[]): boolean {
  const d = domain.toLowerCase()
  return endpoints.some((e) => {
    const r = e.resource.toLowerCase()
    return r === d || r === d + 's' || r.startsWith(d) || d.startsWith(r.replace(/s$/, ''))
  })
}

// ── Agent prompt generation ──────────────────────────────────────────

function generateTestPrompt(service: ServiceInfo): string {
  const specContext = service.relatedSpec
    ? `\n\nRELATED SPEC: Read \`${service.relatedSpec}\` for business context, invariants, and failure modes that should inform test scenarios.`
    : ''

  const methodDetails = service.untestedMethods.map((name) => {
    const method = service.methods.find((m) => m.name === name)
    if (!method) return `- ${name}`

    const paramStr = method.params.map((p) => `${p.name}: ${p.type}`).join(', ')
    const scenarios = generateTestScenarios(method)

    return `- \`${name}(${paramStr})\` → ${method.returnType}
    Classification: ${method.classification}
    Dependencies: ${method.dependencies.join(', ') || 'none'}
    Suggested test scenarios:
${scenarios.map((s) => `      - ${s}`).join('\n')}`
  }).join('\n')

  // Show allow-listed methods for context
  const allowListed = service.methods
    .map((m) => m.name)
    .filter((name) => isMethodAllowListed(service.className, name))
  const allowListNote = allowListed.length > 0
    ? `\nAllow-listed (no test needed): ${allowListed.join(', ')} — ${ALLOWED_UNTESTED_METHODS[service.className]?.reason ?? ''}`
    : ''

  // Show covered methods with confidence for context
  const coveredSummary = service.methodCoverage.length > 0
    ? `\n\n### Covered Methods (${service.methodCoverage.length}):\n${service.methodCoverage.map((c) => `- \`${c.method}\` [${c.confidence}] — ${c.source}`).join('\n')}`
    : ''

  return `## Missing Integration Tests for ${service.className}

Domain: ${service.domain}
File: ${service.file}
${service.testFiles.length > 0 ? `Existing tests: ${service.testFiles.join(', ')}` : 'No existing test file.'}
${specContext}${allowListNote}${coveredSummary}

### Untested Methods (${service.untestedMethods.length}):

${methodDetails}

### Instructions for agent:
1. Read the service implementation at \`${service.file}\` to understand the business logic
2. ${service.relatedSpec ? `Read \`${service.relatedSpec}\` for invariants and edge cases` : 'Check for related design specs in specs/design/'}
3. For each untested method, decide: write a test OR add to allow list with a reason
4. Write integration tests that exercise real API + DB interactions
5. Add \`// @covers ${service.className}.methodName\` annotations to each test for traceability
6. Think hard about failure modes: what happens with invalid input, unauthorized users, missing resources, concurrent operations?
7. Test permission boundaries: can a non-admin do this? Can a disabled member?
8. Test idempotency where relevant: what happens if the operation is called twice?
`
}

function generateTestScenarios(method: MethodInfo): string[] {
  const scenarios: string[] = []
  const hasPrincipal = method.params.some((p) => p.name === 'principal')

  // Universal scenarios based on classification
  switch (method.classification) {
    case 'get-by-id':
      scenarios.push('returns entity when it exists')
      scenarios.push('returns NotFound for non-existent ID')
      if (hasPrincipal) scenarios.push('returns Unauthorized for unauthenticated user')
      scenarios.push('returns Unauthorized for user without access')
      break

    case 'list':
      scenarios.push('returns empty list when no entities exist')
      scenarios.push('returns paginated results')
      scenarios.push('respects sort order')
      if (hasPrincipal) scenarios.push('only returns entities the user has access to')
      break

    case 'create':
      scenarios.push('creates entity with valid input')
      scenarios.push('rejects invalid input (missing required fields)')
      scenarios.push('rejects duplicate creation if applicable')
      if (hasPrincipal) scenarios.push('rejects unauthorized user')
      break

    case 'update':
      scenarios.push('updates entity with valid input')
      scenarios.push('returns NotFound for non-existent ID')
      scenarios.push('rejects invalid input')
      if (hasPrincipal) scenarios.push('rejects user without permission')
      break

    case 'remove':
      scenarios.push('removes entity successfully')
      scenarios.push('returns NotFound for non-existent ID')
      if (hasPrincipal) scenarios.push('rejects user without permission')
      scenarios.push('handles cascading deletions if applicable')
      break

    case 'auth':
      scenarios.push('succeeds with valid credentials')
      scenarios.push('fails with invalid credentials')
      scenarios.push('handles expired tokens/sessions')
      break

    case 'membership':
      scenarios.push('succeeds for authorized user')
      scenarios.push('rejects non-admin/non-owner')
      scenarios.push('prevents last-admin removal')
      scenarios.push('handles disabled member edge case')
      break

    case 'webhook':
      scenarios.push('processes valid webhook payload')
      scenarios.push('rejects invalid signature')
      scenarios.push('handles duplicate event idempotently')
      scenarios.push('handles unknown event type gracefully')
      break

    case 'validation':
      scenarios.push('returns true for valid input')
      scenarios.push('returns false for invalid input')
      scenarios.push('handles edge cases (expired, revoked, malformed)')
      break

    default:
      scenarios.push('succeeds with valid input')
      if (hasPrincipal) scenarios.push('rejects unauthorized user')
      scenarios.push('handles error cases')
  }

  return scenarios
}

// ── Main ─────────────────────────────────────────────────────────────

function collectAllServices(): ServiceInfo[] {
  const project = createProject()
  const allServices: ServiceInfo[] = []

  if (!existsSync(CORE_DOMAINS)) {
    console.error(`Domain root not found: ${CORE_DOMAINS}`)
    process.exit(1)
  }

  const domains = readdirSync(CORE_DOMAINS).filter((d) =>
    statSync(resolve(CORE_DOMAINS, d)).isDirectory()
  )

  for (const domain of domains) {
    for (const layer of ['application', 'ports']) {
      const layerDir = resolve(CORE_DOMAINS, domain, layer)
      if (!existsSync(layerDir)) continue

      for (const file of readdirSync(layerDir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))) {
        const services = extractServicesFromFile(project, resolve(layerDir, file))
        allServices.push(...services)
      }
    }
  }

  return allServices
}

// ── Output ───────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const gapsOnly = args.includes('--gaps-only')
const promptMode = args.includes('--prompts')

const services = collectAllServices()
const endpoints = extractRouteEndpoints()

// Enrich with test coverage
analyzeTestCoverage(services)

const onlyServices = services.filter((s) => s.type === 'service')
const untestedServices = onlyServices.filter((s) => !s.hasIntegrationTest)
const servicesWithUntestedMethods = onlyServices.filter((s) => s.untestedMethods.length > 0)

if (jsonMode) {
  console.log(JSON.stringify({ services, endpoints }, null, 2))
  process.exit(untestedServices.length > 0 ? 1 : 0)
}

// ── Allow-list guidance — always shown so agents know the option exists ──
const ALLOW_LIST_GUIDANCE = `
> **Allow List:** Not every service method needs a dedicated integration test.
> Internal helpers, simple getters/setters, delegation-only methods, and methods
> implicitly covered by other tests can be added to the allow list in
> \`scripts/lint/service-inventory.ts\` (ALLOWED_UNTESTED_METHODS) with a reason.
> Use your judgment — when in doubt, write the test.

> **@covers Annotations:** Add \`// @covers ServiceName.methodName\` comments to
> test files for explicit coverage tracking at the highest confidence level.
`

if (promptMode) {
  console.log(ALLOW_LIST_GUIDANCE)
  // Generate agent prompts for untested services/methods
  for (const service of servicesWithUntestedMethods) {
    console.log(generateTestPrompt(service))
    console.log('---\n')
  }
  process.exit(0)
}

if (gapsOnly) {
  let hasGaps = false

  if (untestedServices.length > 0 || servicesWithUntestedMethods.length > 0) {
    console.log(ALLOW_LIST_GUIDANCE)
  }

  if (untestedServices.length > 0) {
    hasGaps = true
    console.log(`\n  Untested Services (${untestedServices.length})\n`)
    for (const s of untestedServices) {
      console.log(`  ✗ ${s.className} (${s.domain})`)
      console.log(`    Methods: ${s.methods.map((m) => m.name).join(', ')}`)
    }
    console.log()
  }

  if (servicesWithUntestedMethods.length > 0) {
    console.log(`\n  Services with Untested Methods\n`)
    for (const s of servicesWithUntestedMethods) {
      if (s.untestedMethods.length === s.methods.length) continue // fully untested, already reported
      console.log(`  ${s.className}: ${s.untestedMethods.length}/${s.methods.length} methods untested`)
      for (const m of s.untestedMethods) {
        const method = s.methods.find((x) => x.name === m)
        console.log(`    - ${m} (${method?.classification ?? 'unknown'})`)
      }
    }
    console.log()
    hasGaps = true
  }

  if (!hasGaps) {
    console.log('No gaps found.')
  }
  process.exit(hasGaps ? 1 : 0)
}

// Full report
const serviceCount = onlyServices.length
const portCount = services.filter((s) => s.type === 'port').length
const domains = [...new Set(services.map((s) => s.domain))].sort()

console.log(`
  Service Inventory (ts-morph + hybrid coverage)
  ${'─'.repeat(50)}

  Domains:  ${domains.length} (${domains.join(', ')})
  Services: ${serviceCount}
  Ports:    ${portCount}
  Total:    ${services.length}
`)

console.log('  Services')
console.log('  ' + '─'.repeat(50))
for (const s of onlyServices) {
  const crud = s.crudCompleteness ? ' [CRUD]' : ''
  const testIcon = s.hasIntegrationTest ? '✓' : '✗'
  console.log(`  ${testIcon} ${s.className}${crud}`)
  console.log(`    Domain: ${s.domain} | File: ${s.file}`)
  if (s.relatedSpec) console.log(`    Spec: ${s.relatedSpec}`)

  // Group methods by classification
  const byClass: Record<string, string[]> = {}
  for (const m of s.methods) {
    const key = m.classification
    if (!byClass[key]) byClass[key] = []
    byClass[key].push(m.name)
  }

  console.log(`    Methods (${s.methods.length}):`)
  for (const [cls, names] of Object.entries(byClass)) {
    console.log(`      ${cls}: ${names.join(', ')}`)
  }

  if (s.crudCompleteness) {
    const missing = Object.entries(s.crudCompleteness)
      .filter(([, v]) => !v)
      .map(([k]) => k)
    if (missing.length > 0) {
      console.log(`    CRUD gaps: ${missing.join(', ')}`)
    }
  }

  // Show allow-listed methods
  const allowListed = s.methods
    .map((m) => m.name)
    .filter((name) => isMethodAllowListed(s.className, name))
  if (allowListed.length > 0) {
    const reason = ALLOWED_UNTESTED_METHODS[s.className]?.reason ?? ''
    console.log(`    Allow-listed (${allowListed.length}): ${allowListed.join(', ')}${reason ? ` — ${reason}` : ''}`)
  }

  if (s.hasIntegrationTest) {
    console.log(`    Tests: ${s.testFiles.join(', ')}`)

    // Show covered methods with confidence levels
    if (s.methodCoverage.length > 0) {
      const byConfidence = new Map<CoverageConfidence, string[]>()
      for (const c of s.methodCoverage) {
        const list = byConfidence.get(c.confidence) ?? []
        list.push(c.method)
        byConfidence.set(c.confidence, list)
      }
      const parts: string[] = []
      for (const [conf, methods] of byConfidence) {
        parts.push(`${conf}: ${methods.join(', ')}`)
      }
      console.log(`    Covered (${s.methodCoverage.length}): ${parts.join(' | ')}`)
    }

    if (s.untestedMethods.length > 0) {
      console.log(`    Untested methods (${s.untestedMethods.length}): ${s.untestedMethods.join(', ')}`)
    }
  } else {
    console.log(`    ! No integration test found`)
  }

  if (!hasRouteFile(s.domain, endpoints)) {
    console.log(`    ! No API route file for domain "${s.domain}"`)
  }

  console.log()
}

console.log('  Ports')
console.log('  ' + '─'.repeat(50))
for (const s of services.filter((s) => s.type === 'port')) {
  console.log(`  ${s.className} (${s.domain})`)
  console.log(`    Methods (${s.methods.length}): ${s.methods.map((m) => m.name).join(', ')}`)
}
console.log()

// Summary
const tested = onlyServices.filter((s) => s.hasIntegrationTest)
console.log(`  Coverage: ${tested.length}/${serviceCount} services tested`)
const totalMethods = onlyServices.reduce((sum, s) => sum + s.methods.length, 0)
const totalAllowListed = onlyServices.reduce((sum, s) =>
  sum + s.methods.filter((m) => isMethodAllowListed(s.className, m.name)).length, 0
)
const totalCovered = onlyServices.reduce((sum, s) => sum + s.methodCoverage.length, 0)

// Coverage by confidence
const byConfidence: Record<CoverageConfidence, number> = { explicit: 0, high: 0, medium: 0, low: 0 }
for (const s of onlyServices) {
  for (const c of s.methodCoverage) {
    byConfidence[c.confidence]++
  }
}
const confidenceParts = Object.entries(byConfidence)
  .filter(([, count]) => count > 0)
  .map(([conf, count]) => `${count} ${conf}`)
  .join(', ')

console.log(`  Methods: ${totalCovered}/${totalMethods} methods covered${totalAllowListed > 0 ? ` (${totalAllowListed} allow-listed)` : ''}`)
if (confidenceParts) {
  console.log(`  Confidence: ${confidenceParts}`)
}
console.log()

if (untestedServices.length > 0 || servicesWithUntestedMethods.length > 0) {
  console.log(ALLOW_LIST_GUIDANCE)
  process.exitCode = 1
}
