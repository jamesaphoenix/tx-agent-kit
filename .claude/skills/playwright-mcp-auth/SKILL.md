---
name: playwright-mcp-auth
description: Bootstrap authenticated Playwright MCP sessions in tx-agent-kit with real auth APIs and 1Password-backed credentials. Use when asked to log in quickly for UI checks or polish runs without manual sign-in.
---

# Playwright MCP Auth Bootstrap

Use this skill when the task needs fast authenticated Playwright MCP access in local/dev environments.

## Workflow

1. Ensure local services are up:
   - `pnpm infra:ensure`
2. Bootstrap auth storage state with 1Password-backed env values:
   - `op run --env-file=.env.playwright.dev -- pnpm playwright:auth:bootstrap`
3. Start Playwright MCP already authenticated:
   - `op run --env-file=.env.playwright.dev -- pnpm mcp:playwright:auth`

## Required Env Keys

- `PLAYWRIGHT_AUTH_EMAIL`
- `PLAYWRIGHT_AUTH_PASSWORD`
- `PLAYWRIGHT_AUTH_NAME` (optional)
- `PLAYWRIGHT_AUTH_SITE_URL` (default `http://localhost:3000`)
- `PLAYWRIGHT_AUTH_API_BASE_URL` (default `http://localhost:4000`)
- `PLAYWRIGHT_MCP_STORAGE_STATE` (default `.artifacts/playwright-mcp/storage-state.json`)

## Guardrails

- Do not add auth bypass/backdoor endpoints for this workflow.
- Use real auth endpoints only: `/v1/auth/sign-up`, `/v1/auth/sign-in`, `/v1/auth/me`.
- Production bootstrap is blocked by default unless `PLAYWRIGHT_AUTH_ALLOW_PROD=true`.
- Never commit plaintext credentials; use 1Password references in `.env.playwright.dev`.

## Troubleshooting

- Sign-up conflict/already-exists is expected for repeated runs; sign-in should still succeed.
- If bootstrap fails with missing env, run through `op run --env-file=.env.playwright.dev -- ...`.
- If MCP starts unauthenticated, verify `PLAYWRIGHT_MCP_STORAGE_STATE` points to an existing file.
