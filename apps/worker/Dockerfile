FROM node:22.22.0-bookworm-slim AS base
WORKDIR /app
RUN corepack enable
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json tsconfig.json ./
COPY patches patches
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/infra/db/package.json packages/infra/db/package.json
COPY packages/infra/logging/package.json packages/infra/logging/package.json
COPY packages/infra/observability/package.json packages/infra/observability/package.json
COPY packages/temporal-client/package.json packages/temporal-client/package.json
COPY packages/tooling/vitest-config/package.json packages/tooling/vitest-config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @tx-agent-kit/worker... build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
COPY --from=deps /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=deps /app/patches patches
COPY --from=deps /app/apps/worker/package.json apps/worker/package.json
COPY --from=deps /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=deps /app/packages/infra/db/package.json packages/infra/db/package.json
COPY --from=deps /app/packages/infra/logging/package.json packages/infra/logging/package.json
COPY --from=deps /app/packages/infra/observability/package.json packages/infra/observability/package.json
COPY --from=deps /app/packages/temporal-client/package.json packages/temporal-client/package.json
COPY --from=deps /app/packages/tooling/vitest-config/package.json packages/tooling/vitest-config/package.json
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/infra/db/dist packages/infra/db/dist
COPY --from=build /app/packages/infra/logging/dist packages/infra/logging/dist
COPY --from=build /app/packages/infra/observability/dist packages/infra/observability/dist
COPY --from=build /app/packages/temporal-client/dist packages/temporal-client/dist
USER appuser
CMD ["node", "apps/worker/dist/index.js"]
