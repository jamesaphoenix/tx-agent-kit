---
name: new-package
description: Scaffold a new package in the monorepo with correct workspace wiring, TypeScript config, and path aliases.
argument-hint: <category>/<package-name> (e.g. infra/queue, tooling/prettier-config)
---

# Create a New Package

Scaffold a new package in the monorepo. The argument format is `<category>/<name>` where category is one of `packages`, `infra`, or `tooling`.

## Package Categories

| Category | Directory | When to use |
|----------|-----------|-------------|
| `packages` | `packages/<name>` | Shared domain or cross-cutting packages (e.g. `contracts`, `core`, `testkit`) |
| `infra` | `packages/infra/<name>` | Infrastructure adapters — DB, auth, messaging, observability |
| `tooling` | `packages/tooling/<name>` | Dev tooling — linting, config, scaffolding |

All three globs are already declared in `pnpm-workspace.yaml` — no workspace config changes needed.

## Steps

### 1. Create the package directory

```bash
mkdir -p packages/<category-path>/<name>/src
```

Where `<category-path>` is empty for top-level (`packages/<name>`), `infra` for infra, or `tooling` for tooling.

### 2. Create `package.json`

**File:** `packages/<category-path>/<name>/package.json`

The package name is always `@tx-agent-kit/<name>` regardless of category.

```json
{
  "name": "@tx-agent-kit/<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "type-check": "tsc -b --pretty false",
    "lint": "eslint src --max-warnings=0",
    "test": "vitest run -c vitest.config.ts"
  },
  "devDependencies": {
    "@tx-agent-kit/vitest-config": "workspace:*"
  }
}
```

Add `dependencies` as needed (e.g. `"effect": "^3.19.16"`, other `workspace:*` packages).

### 3. Create `tsconfig.json`

**File:** `packages/<category-path>/<name>/tsconfig.json`

The `extends` path varies by depth:

| Category | `extends` value |
|----------|-----------------|
| `packages/<name>` | `"../../tsconfig.node.json"` |
| `packages/infra/<name>` | `"../../../tsconfig.node.json"` |
| `packages/tooling/<name>` | `"../../../tsconfig.node.json"` |

```json
{
  "extends": "<extends-path>",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

If the package depends on other workspace packages, add `references`:

```json
{
  "references": [{ "path": "<relative-path-to-dependency>" }]
}
```

### 4. Create `vitest.config.ts`

**File:** `packages/<category-path>/<name>/vitest.config.ts`

```typescript
import unitConfig from '@tx-agent-kit/vitest-config/unit'

export default unitConfig
```

### 5. Create `src/index.ts`

**File:** `packages/<category-path>/<name>/src/index.ts`

```typescript
// @tx-agent-kit/<name>
```

Empty barrel export — add real exports as the package develops.

### 6. Add path alias to `tsconfig.base.json`

**File:** `tsconfig.base.json`

Add to `compilerOptions.paths`:

```json
"@tx-agent-kit/<name>": ["packages/<category-path>/<name>/src/index.ts"]
```

Keep entries alphabetically sorted.

### 7. Run `pnpm install`

```bash
pnpm install
```

This wires the workspace dependency graph. Verify the new package appears in the workspace:

```bash
pnpm ls --depth 0 --filter @tx-agent-kit/<name>
```

### 8. Verify

```bash
pnpm type-check && pnpm lint && pnpm test
```

## Wiring Checklist

After creating the package, verify these commonly forgotten steps:

- [ ] `tsconfig.base.json` — path alias added for `@tx-agent-kit/<name>`
- [ ] `tsconfig.json` — `extends` path correct for category depth
- [ ] `tsconfig.json` — `references` added in consuming packages that depend on this one
- [ ] `pnpm install` — run after adding any `workspace:*` dependencies
- [ ] Barrel export — `src/index.ts` exists and re-exports public API

## Reference Files

| File | Role |
|------|------|
| `tsconfig.base.json` | Path alias registry |
| `tsconfig.node.json` | Base config for Node packages |
| `pnpm-workspace.yaml` | Workspace globs (covers `packages/*`, `packages/infra/*`, `packages/tooling/*`) |
| `packages/tooling/typescript-config/base.json` | Compiler options root |
| `packages/contracts/package.json` | Example top-level package |
| `packages/infra/auth/package.json` | Example infra package |
| `packages/tooling/scaffold/package.json` | Example tooling package |
