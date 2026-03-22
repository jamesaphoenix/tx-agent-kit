Agent-first starter for Effect HTTP + Temporal + Next.js + Drizzle.

This repository uses an agent-first workflow inspired by OpenAI's Harness Engineering post (February 11, 2026).

## Operating Model
- Humans steer intent and acceptance criteria.
- Agents implement, validate, and iterate with mechanical checks.
- If an agent fails repeatedly, improve scaffolding (docs, linters, tests, scripts).

## Repo Map

| Artifact | Path |
|----------|------|
| Architecture | `docs/ARCHITECTURE.md` |
| Quality invariants | `docs/QUALITY.md` |
| Command catalog | `docs/COMMANDS.md` |
| Runbooks | `docs/RUNBOOKS.md` |
| Deployment | `docs/DEPLOYMENT.md` |
| Rollback | `docs/ROLLBACK.md` |
| API contract | `apps/api/openapi.json` (generated via `pnpm openapi:generate`) |
| MCP servers | `.mcp.json` + `scripts/mcp/*` |
| Skills | `.claude/skills/*` |
| CRUD scaffold skill | `.claude/skills/golden-path-crud/SKILL.md` |

## tx CLI
Run `tx` in agent shells as `source ~/.zshrc >/dev/null 2>&1; eval 'tx <subcommand> ...'`.

## Stack
- `apps/web`: Client-only Next.js SPA (no SSR, no `app/api`)
- `apps/api`: Effect HttpApi server
- `apps/worker`: Temporal worker + workflows
- `apps/mobile`: Expo React Native
- `apps/docs`: Fumadocs documentation site
- `packages/core`: DDD domain logic (Effect services)
- `packages/contracts`: Shared schemas + event types + permissions
- `packages/temporal-client`: Temporal workflow types + event schemas
- `packages/infra/*`: DB, auth, logging, observability, AI
- `packages/testkit`: Test utilities + integration harness
- `packages/tooling/*`: ESLint configs, scaffold CLI, tsconfig, vitest configs

## DDD Structure

```txt
packages/core/src/domains/<domain>/
  domain/         # entities, value objects, pure rules, event payloads
  ports/          # capability contracts (repository seams)
  application/    # use-case orchestration
  adapters/       # external system adapters (optional)
  runtime/        # layer wiring (optional)
```

Dependency direction: inward only (`domain ← ports ← application ← adapters ← runtime`).
Full layer rules: `docs/ARCHITECTURE.md` + `docs/QUALITY.md`.

## Key Boundaries

All invariants are mechanically enforced via `pnpm lint`.
Read `docs/QUALITY.md` for the full list. Highlights:
- `apps/web` is client-only: no `effect`, no `drizzle-orm`, no `next/server`, no `app/api`.
- `drizzle-orm` only in `packages/infra/db`.
- `process.env` only through dedicated env modules.
- `as any`, `@ts-ignore`, `eslint-disable` forbidden in source.
- Temporal workflows must be deterministic.
- Domain events flow through transactional outbox; `apps/api/` must not import `@temporalio/*`.
- `usage_records`/`credit_ledger` are financial audit trails — no retention policies.

## New Feature Workflow

1. `pnpm scaffold:crud --domain <domain> --entity <entity> --dry-run`
2. Add contracts in `packages/contracts` with `effect/Schema`.
3. Add domain logic under `packages/core/src/domains/<domain>/`.
4. If persistence: update `packages/infra/db/src/schema.ts` + effect-schemas + factories.
5. Expose via `apps/api`, then `pnpm openapi:generate`.
6. Regenerate hooks: `pnpm api:client:generate`.
7. Validate: `pnpm lint && pnpm type-check && pnpm test`.

Full skill: `.claude/skills/golden-path-crud/SKILL.md`

## Quality Gates (prefer quiet runners)
- `pnpm lint:quiet` / `pnpm lint`
- `pnpm type-check:quiet` / `pnpm type-check`
- `pnpm test:quiet` / `pnpm test`
- `pnpm test:integration:quiet` / `pnpm test:integration`
- `pnpm test:db:pgtap` for database trigger contracts.

Full command catalog: `docs/COMMANDS.md`

## Langfuse
- Environment variables: `LANGFUSE_ENABLED`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.
- Enable export by setting `LANGFUSE_ENABLED=true`.
- Local vs Cloud switch requires only changing `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`.
- For AI integration test patterns and cassette workflows, use `.claude/skills/ai-vcr-test/SKILL.md`.

## Sentry Spotlight (Local Dev Observability)
- Starts automatically with `pnpm infra:ensure` (part of the `infra` Docker profile).
- Enabled by default: `SENTRY_SPOTLIGHT=true` in `.env.example`. Works without a real Sentry DSN (uses placeholder `https://spotlight@local/0`).
- Native desktop app alternative: download from https://spotlightjs.com/, then stop the Docker container to free port `8969`.
- All three app layers (web, api, worker) forward errors + traces to Spotlight when enabled.
- MCP server `spotlight-local` exposes `search_errors`, `search_logs`, `search_traces`, `get_traces` for AI-assisted debugging. Fails fast with a clear message if the sidecar is not running.
- `pnpm dev:open` opens the Spotlight UI alongside other dashboards.
- Full docs: `apps/docs/content/docs/observability/spotlight.mdx`.

## Mechanical Enforcement
- ESLint: `packages/tooling/eslint-config/` (modular configs)
- Structural: `scripts/lint/enforce-*.mjs` (7 invariant scripts)
- Shell: `scripts/check-shell-invariants.sh`
- DB contracts: pgTAP suites in `packages/infra/db/pgtap/`
- Duplication: `.jscpd.json` (5% threshold on api/core/scripts)
- Unused deps: `.knip.jsonc` (`pnpm lint:knip`)
- `pnpm lint` runs ESLint + structural + shell + jscpd.

## Repository Knowledge Discipline
- Keep this file short and map-like (~100 lines).
- Move durable decisions into versioned docs/code.
- Treat in-repo artifacts as the only reliable knowledge source for agents.
