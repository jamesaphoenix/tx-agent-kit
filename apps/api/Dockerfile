FROM node:22.22.0-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/infra/auth/package.json packages/infra/auth/package.json
COPY packages/infra/db/package.json packages/infra/db/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/infra/logging/package.json packages/infra/logging/package.json
COPY packages/infra/observability/package.json packages/infra/observability/package.json
COPY packages/testkit/package.json packages/testkit/package.json
COPY packages/tooling/vitest-config/package.json packages/tooling/vitest-config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm turbo run build --filter=@tx-agent-kit/api...

FROM build AS runner
WORKDIR /app
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
