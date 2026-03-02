# Authenticated Browser Sessions

Bootstrap authenticated `playwright-cli` sessions using real auth APIs and 1Password-backed credentials. Use this for quick UI checks or polish runs without manual sign-in.

## Prerequisites

- Local services running: `pnpm infra:ensure`
- 1Password CLI installed: `brew install 1password-cli`
- `.env` file with `PLAYWRIGHT_AUTH_EMAIL` and `PLAYWRIGHT_AUTH_PASSWORD` (use `op://` references)

## Workflow

### 1. Bootstrap auth storage state

The bootstrap script signs up (idempotent) and signs in via real API endpoints, then writes a Playwright-compatible storage state file.

```bash
# With 1Password-backed env
op run --env-file=.env -- pnpm playwright:auth:bootstrap

# Or with env vars set directly
PLAYWRIGHT_AUTH_EMAIL=test@example.com \
PLAYWRIGHT_AUTH_PASSWORD=secret123 \
pnpm playwright:auth:bootstrap
```

This writes storage state to `.artifacts/playwright-mcp/storage-state.json`.

### 2. Load state into playwright-cli

```bash
playwright-cli open http://localhost:3000
playwright-cli state-load .artifacts/playwright-mcp/storage-state.json
playwright-cli goto http://localhost:3000
# Already authenticated!
```

### 3. One-shot: bootstrap + open

```bash
op run --env-file=.env -- pnpm playwright:auth:bootstrap && \
playwright-cli open http://localhost:3000 && \
playwright-cli state-load .artifacts/playwright-mcp/storage-state.json && \
playwright-cli goto http://localhost:3000
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLAYWRIGHT_AUTH_EMAIL` | (required) | Auth email for sign-up/sign-in |
| `PLAYWRIGHT_AUTH_PASSWORD` | (required) | Auth password |
| `PLAYWRIGHT_AUTH_NAME` | `Playwright MCP User` | Display name for sign-up |
| `PLAYWRIGHT_AUTH_SITE_URL` | `http://localhost:3000` | Web app origin (for localStorage) |
| `PLAYWRIGHT_AUTH_API_BASE_URL` | `http://localhost:4000` | API base URL |
| `PLAYWRIGHT_MCP_STORAGE_STATE` | `.artifacts/playwright-mcp/storage-state.json` | Output path |
| `PLAYWRIGHT_AUTH_ALLOW_PROD` | `false` | Set `true` to allow production bootstrap |

## Guardrails

- Uses real auth endpoints only: `/v1/auth/sign-up`, `/v1/auth/sign-in`, `/v1/auth/me`.
- Production bootstrap is blocked by default unless `PLAYWRIGHT_AUTH_ALLOW_PROD=true`.
- Never commit plaintext credentials; use 1Password references.
- Do not add auth bypass/backdoor endpoints for this workflow.

## Troubleshooting

- **Sign-up conflict/already-exists**: Expected for repeated runs; sign-in still succeeds.
- **Missing env vars**: Run through `op run --env-file=.env -- ...`.
- **Session not authenticated after load**: Ensure you `goto` the site URL after `state-load` so localStorage takes effect.
- **Token expired**: Re-run `pnpm playwright:auth:bootstrap` to get a fresh token.
