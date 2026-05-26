# Octospark Infrastructure Portability Goal

## Objective

Port useful, generalizable infrastructure, reliability, deployment, and package-level hardening from Octospark into tx-agent-kit without importing Octospark product behavior.

Source audit repo:

- `/Users/jamesaphoenix/Desktop/projects/just-understanding-data/octospark`

Target repo:

- `/Users/jamesaphoenix/Desktop/projects/just-understanding-data/tx-agent-kit`

Also coordinate with the sibling Trace Learn target:

- `/Users/jamesaphoenix/Desktop/projects/just-understanding-data/trace-learn`

## Non-Goals

- Do not copy Octospark-specific product logic, social publishing logic, billing policy, launch-plan copy, product routes, provider business rules, or Octospark naming.
- Do not replace tx-agent-kit deployment paths or local startup behavior unless the existing path is demonstrably obsolete and the change is documented.
- Do not commit plaintext secrets, generated `.env` files, browser auth state, local runtime artifacts, logs, or Docker artifacts.

## Durable Artifacts

Maintain:

- `docs/goals/octospark-infra-portability-goal.md`
- `docs/goals/octospark-infra-portability.progress.json`

The source/coordinator copy lives in Octospark:

- `../octospark/docs/goals/octospark-infra-portability-goal.md`
- `../octospark/docs/goals/octospark-infra-portability.progress.json`
- `../octospark/docs/goals/octospark-infra-portability.inventory.json`

Update the progress JSON after each audit or implementation slice with status, touched files, validation commands, pass/fail evidence, workflow links if available, and follow-up risks.

## Phase 0: Investigation And Approval Gate

The first `/goal` run is investigation only. Do not migrate, copy, overlay, delete, refactor, or port tx-agent-kit implementation files until James has reviewed and approved the Octospark inventory.

The approval inventory lives in Octospark:

```text
../octospark/docs/goals/octospark-infra-portability.inventory.json
```

Allowed during Phase 0:

- read tx-agent-kit files
- compare tx-agent-kit against Octospark
- classify candidates for tx-agent-kit
- assess whether an Octospark overlay is cleaner than selective porting
- update goal/progress/inventory docs
- run read-only or non-mutating checks that help classify candidates
- run multiple parallel investigation agents against separate lanes, then merge their tx-agent-kit findings into the shared inventory

Not allowed during Phase 0:

- porting code
- applying an Octospark overlay
- creating product-removal changes
- changing tx-agent-kit workflows, package manifests, infra scripts, runtime code, generated clients, or tests
- copying Octospark files into tx-agent-kit

Only inventory items with `approval_status: "approved"` may be implemented later. If the overlay route is recommended, that recommendation must be approved before creating or applying an overlay branch.

## Implementation Approval Update

James has approved broad implementation. Port every source inventory candidate with `approval_status: "approved"` and `porting_decision: "port_now"` into tx-agent-kit where it is applicable, adapting it to tx-agent-kit's layout, package names, ports, env conventions, deployment topology, CLI/MCP/skills/docs, and product-neutral toolkit model.

The only excluded candidate is `social_product_observability_flow`. Product-shaped Octospark candidates must be generalized into tx-agent-kit-owned infrastructure, docs, tests, lint, CLI/MCP templates, skills, or guardrails. An Octospark overlay/rebaseline may be used only as an audited draft mechanism with quarantine and product-leak checks; do not land raw product-bearing overlay content.

### Parallel Investigation Agents

Use several parallel agents during Phase 0 to make the tx-agent-kit comparison and overlay assessment exhaustive. Keep agents read-only except for their own notes or the final coordinated inventory merge.

Recommended lanes:

- observability and telemetry
- Docker Compose, local infra, Redis, and startup ordering
- database reliability, migrations, pgTAP, and test isolation
- integration test harness, fixtures, auth helpers, VCR/cassettes, and reporters
- GitHub Actions, CI gates, deployment, and Docker cleanup
- package/runtime upgrades and version-pin rationale
- MCP templates, CLI templates, agent skills, hooks, and command wrappers
- lint/tooling, structural invariants, generated-file checks, and secret prevention
- frontend/API performance, DNS/resource hints, routing, caching, and auth bootstrap
- docs/runbooks and migration-report candidates
- tx-agent-kit overlay assessment and product-leak risk

Each agent should return candidate inventory entries with Octospark source evidence, tx-agent-kit applicability, risk, and recommended approval status. A coordinating pass must deduplicate findings, normalize categories/statuses, and update `../octospark/docs/goals/octospark-infra-portability.inventory.json`.

## Read First

In Octospark:

- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/QUALITY.md`
- `docs/COMMANDS.md`
- `docs/RUNBOOKS.md`
- `docs/DEPLOYMENT.md`
- `docs/ROLLBACK.md`
- `docs/INTEGRATION-TESTING.md`
- `docs/goal.md`
- `.github/workflows/*`
- Docker Compose and deploy files
- `deploy/**`
- `scripts/**`
- `packages/infra/**`
- `packages/testkit/**`
- `packages/tooling/**`
- `package.json`
- `pnpm-lock.yaml`
- env templates

In tx-agent-kit:

- `AGENTS.md`
- deployment, runbook, quality, command, and integration-test docs
- `.github/workflows/*`
- Docker Compose and deploy files
- infra packages
- testkit/integration harness packages
- package manifests and lockfiles
- env templates and gitignore rules

## Candidate Areas To Audit

Build a tx-agent-kit-specific inventory grouped into `port_now`, `adapt_carefully`, `leave_octospark_specific`, and `needs_follow_up`:

- OpenTelemetry setup, exporters, span processors, trace/log correlation, Sentry, Spotlight, Jaeger, Prometheus, Loki, malformed legacy span fixes, and local observability docs.
- Docker Compose infrastructure for Postgres, Redis, OTEL collector, Jaeger, Prometheus, Grafana, Loki, Sentry Spotlight, health checks, shared infra behavior, port conventions, and worktree-safe startup.
- Database reliability: migrations, schema generation, migration checks, Drizzle/Postgres fixes, pgTAP coverage, isolated schemas, reset behavior, pooling, timeouts, and connection handling.
- Redis and runtime infrastructure: local service wiring, env handling, health checks, integration test boot, queue/cache behavior, and startup ordering.
- Frontend/API performance and routing: DNS prefetch/preconnect hints, route-level caching, TanStack Query shell caching, auth bootstrap round-trip reduction, API connection warmup, response timing headers, redundant fetch removal, navigation latency fixes, and other speed improvements that are not product-specific.
- Deployment: GitHub Actions self-hosted runner assumptions, local image build, Compose staging/prod release flow, CI gates before release, staging verification, fallback k3s/GKE docs if relevant, and Docker image/layer cleanup scripts.
- Package/runtime upgrades: Node, pnpm, Bun, Effect, Drizzle, OpenTelemetry, Temporal, Vitest, Docker tooling, and any pinned versions that solved concrete bugs.
- GitHub Actions: reusable workflow structure, path filtering, concurrency, self-hosted runner labels, required gates, generated-artifact checks, deployment prerequisites, workflow validation, and failure-reporting patterns.
- CI/test hardening: quiet runners, integration test budgets, flaky test fixes, generated artifact checks, shell invariants, OpenAPI/client generation checks, and workflow path filtering.
- MCP templates: generic `.mcp.json` or equivalent MCP server templates, config examples, documentation, and validation checks that can be adapted without copying Octospark-specific server names, secrets, or product assumptions.
- CLI templates: reusable CLI command structure, command wrappers, help text conventions, env loading, 1Password integration, agent-safe non-interactive modes, and local executable installation patterns that can be adapted to target repo names.
- Lint/tooling rules: useful ESLint, structural lint, shell lint, Knip, jscpd, generated-file, package-boundary, no-plaintext-secret, and no-product-leak checks that enforce generic repository health.
- Agent workflow assets: new or improved repo-local skills, agent instructions, hooks, MCP/tooling config, tx workflow docs, progress tracker patterns, and agent-safe command wrappers.
- Fresh documentation: new or materially improved architecture docs, deployment docs, runbooks, rollback docs, command catalogs, troubleshooting guides, quality docs, and migration notes that describe generic infrastructure behavior.
- Test harness changes beyond database setup: shared fixtures, factory helpers, auth/session helpers, browser/test utilities, API server boot helpers, worker/queue harnesses, VCR/cassette utilities, snapshot/golden checks, timeout controls, and test reporter integrations.
- Secrets/env handling: 1Password `op` conventions, `.env.dev`/`.env.prod` templates with `op://` references, generated `.env` exclusion, and plaintext secret prevention.

## Inventory Rules

For every candidate, record:

- Octospark source file(s) and commit/history evidence if useful.
- Problem fixed or reliability benefit.
- Whether the change is generic infrastructure or product-specific.
- tx-agent-kit current equivalent.
- Porting decision: `port_now`, `adapt_carefully`, `leave_octospark_specific`, or `needs_follow_up`.
- tx-agent-kit implementation notes.
- Validation command(s) and expected evidence.

Do not blindly copy files. Compare tx-agent-kit first, then adapt.

## Work Slices

Prefer small, reviewable slices:

1. Observability slice: OTEL, exporters, span/log correlation, Spotlight/Jaeger/Prometheus/Loki wiring, malformed span safeguards, observability docs.
2. Local infra and Docker Compose slice: shared services, health checks, startup ordering, port conventions, worktree-safe scripts, `.env` templates.
3. DB and test harness slice: migration checks, Drizzle/Postgres fixes, isolated schemas, pgTAP where appropriate, pooling/timeouts, reset behavior.
4. Redis/runtime slice: service wiring, queue/cache health checks, startup ordering, integration boot reliability.
5. Performance/routing slice: DNS/resource hints, route caching, query cache policy, auth bootstrap round-trip reduction, API warmup, response timing, and redundant fetch removal.
6. CI/deployment slice: quiet gates, generated artifact checks, self-hosted runner assumptions, Compose release flow, staging verification, fallback docs, Docker cleanup.
7. Package/runtime upgrade slice: version pins and upgrades only where they solve a concrete tx-agent-kit problem or match an already-needed repo-wide upgrade.
8. GitHub Actions slice: workflow templates, path filters, concurrency, required checks, reusable workflow patterns, self-hosted runner assumptions, and generated-artifact gates.
9. MCP template slice: reusable MCP server config templates, documentation, validation, and target-specific adaptation notes.
10. CLI template slice: reusable command wrappers, CLI scaffolding, help conventions, env/secrets loading, and non-interactive agent-safe behavior.
11. Lint/tooling slice: ESLint, structural lint, shell lint, package-boundary checks, generated-file checks, Knip, jscpd, and secret-prevention rules.
12. Agent workflow slice: repo-local skills, agent instructions, hooks, MCP/tooling config, tx workflow docs, progress tracker conventions, and command wrappers.
13. Test harness slice: generic fixtures, factories, auth/session helpers, local API boot helpers, worker/queue harnesses, VCR/cassette support, timeout controls, and reporter integrations.
14. Docs/runbook slice: command catalog, deployment docs, rollback docs, troubleshooting, migration report.

## Target Strategy Notes

tx-agent-kit may be eligible for a broader audited overlay/rebaseline because Octospark still uses the `tx-agent-kit` package namespace and similar monorepo structure. Treat this as a separate assessment, not as permission for a blind copy:

- Create a tx-agent-kit worktree/branch for an Octospark overlay experiment.
- Compare Octospark against tx-agent-kit by directory and package before copying.
- Prefer allowlisted infrastructure, tooling, docs, workflow, and harness directories first.
- Quarantine product-bearing directories until each domain is classified.
- Remove or generalize Octospark product assumptions, social media domains, product routes, provider-specific fixtures, product docs, package scripts, and CLI/MCP names before committing.
- Run a repository-wide product-leak scan for `octospark`, social/X/Twitter terms, product route names, provider slugs, secrets, and stale package names.
- Only choose the overlay path if it produces a cleaner generic tx-agent-kit baseline than selective cherry-picking.

Use selective porting for Trace Learn; do not use the tx-agent-kit overlay strategy there.

Commit and push changes in coherent slices when implementation begins. Keep unrelated edits out.

## Validation Ladder

After each slice, run the narrowest meaningful validation first, then broaden:

- lint/type-check for touched packages
- unit tests for changed packages
- integration tests with real local infrastructure
- generated artifact checks, including OpenAPI/client generation where touched
- shell invariants and workflow syntax checks where touched
- Docker Compose startup and health checks where touched
- staging deployment or real workflow verification for deployment changes where available

Local-only checks are not sufficient for release infrastructure. If a deployment or staging workflow is changed, record real staging/workflow evidence or mark the gap as a remaining risk.

## Safety Constraints

- Keep secrets out of git.
- Use 1Password references in committed templates, not plaintext `.env` values.
- Preserve tx-agent-kit local dev startup and package/test harness behavior.
- Preserve existing deployment paths unless replacement is justified and documented.
- Keep fallbacks documented where useful.
- Do not tear down shared Docker infrastructure during development unless explicitly required.
- Do not remove generated artifacts without regenerating and validating them.
- When copying agent skills or docs, remove Octospark product assumptions and preserve only reusable workflow guidance, scripts, templates, or checklists.
- Treat MCP and CLI assets as templates by default: adapt names, ports, env vars, auth scopes, vault/item paths, and command names to tx-agent-kit before committing.
- Port lint rules only when they enforce generic quality or tx-agent-kit-relevant boundaries; document rules that are intentionally left behind because they encode Octospark-specific architecture.
- Performance changes must be verified with tx-agent-kit behavior and must not assume Octospark route names, product shells, auth flows, or API paths.

## Acceptance Criteria

- Relevant Octospark-derived infrastructure hardening is merged, validated, documented, and pushed.
- Changes are generic infrastructure, or the adaptation is explicitly documented.
- Local dev startup remains reliable.
- Integration tests run against full infrastructure, not mocked infra.
- Deployment/CI changes are proven by real workflow results where available.
- Generated files are current.
- No plaintext secrets or local runtime artifacts are committed.
- A migration report documents ported changes, intentionally unported changes, verification evidence, remaining risks, and follow-up tasks.

## Migration Report Requirements

End with a tx-agent-kit report covering:

- ported changes, grouped by slice
- intentionally unported Octospark-specific changes
- adapted changes and why adaptation was needed
- validation commands and results
- real workflow/staging evidence where applicable
- remaining risks
- follow-up tasks

## Initial Status

- Goal captured: 2026-05-23
- Octospark source audit: not started
- Inventory approval: not started
- tx-agent-kit comparison: not started
- tx-agent-kit implementation: not started
- Push status: not started
