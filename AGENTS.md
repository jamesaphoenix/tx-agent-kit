# tx-agent-kit

Agent-first starter for Effect HTTP + Temporal + Next.js + Drizzle.

## Map
- Architecture: `docs/ARCHITECTURE.md`
- Quality and boundaries: `docs/QUALITY.md`
- Runbooks: `docs/RUNBOOKS.md`
- API contract and invariants: `OpenAPI.yml`
- Skills: `.claude/skills/*`

## Guardrails
- API and worker use Effect layers/services.
- Web never queries Postgres directly.
- Shared types live in `packages/contracts`.
- Domain state changes go through `apps/api`.

## Harness Engineering Principles (OpenAI, Feb 11, 2026)
Reference: `https://openai.com/index/harness-engineering/`
- Humans steer; agents execute. Push intent/specs, not hand-written ad hoc code paths.
- Keep `AGENTS.md` short. Treat it as a map into source-of-truth docs, not a giant manual.
- Repository knowledge is the system of record. If a decision is not in-repo, it does not exist for agents.
- Prefer progressive disclosure: small stable entry docs that link to deeper design/product/reliability docs.
- Enforce architecture/taste mechanically via linters, structural tests, and CI checks.
- Optimize for agent legibility: clear layering, explicit boundaries, predictable naming, strong schema contracts.
- Make the app observable to agents in local dev: logs, metrics, traces, and reproducible UI validation loops.
- Keep PRs short-lived and reversible; fix quickly with follow-up runs when safe.
- Run recurring cleanup/doc-gardening to prevent drift and remove stale instructions.
