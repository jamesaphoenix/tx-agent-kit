# @tx-agent-kit/mobile

React Native (Expo) client app for `tx-agent-kit`.

## Scope
- Mobile UI for auth, workspaces, tasks, and invitations.
- Uses generated API hooks/clients from the backend OpenAPI contract.
- Shares API contracts with web via `@tx-agent-kit/contracts`.

## Prerequisites
- Node.js `>=22`
- pnpm `10.x`
- Expo-compatible simulator/device tooling
- API running locally (default `http://localhost:4000`)

## Local Development
From repo root:

```bash
pnpm dev:mobile
```

Or from this package:

```bash
pnpm dev
```

Mobile resolves `API_BASE_URL` from Expo config in this order:
1. `EXPO_PUBLIC_API_BASE_URL`
2. `API_BASE_URL`
3. fallback `http://localhost:4000`

## API Client Generation
The mobile API client is generated from `apps/api/openapi.json`.

From repo root:

```bash
pnpm mobile:generate:api
```

From this package:

```bash
pnpm generate:api
```

## Contract Notes
- List endpoints are cursor-paginated and return:
  - `{ data, total, nextCursor, prevCursor }`
- Resource enums are sourced from shared literals in `@tx-agent-kit/contracts`.

## Quality Commands
From repo root:

```bash
pnpm lint:quiet
pnpm type-check:quiet
pnpm test:quiet
pnpm test:integration:quiet
```
