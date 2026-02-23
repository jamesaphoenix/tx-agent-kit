FROM node:22.22.0-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json tsconfig.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/logging/package.json packages/logging/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/temporal-client/package.json packages/temporal-client/package.json
COPY packages/tooling/vitest-config/package.json packages/tooling/vitest-config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm turbo run build --filter=@tx-agent-kit/worker...

FROM build AS runner
WORKDIR /app
CMD ["node", "apps/worker/dist/index.js"]
