FROM node:22.22.0-bookworm-slim AS base
WORKDIR /app
RUN corepack enable
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json tsconfig.json ./
COPY patches patches
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
RUN pnpm --filter @tx-agent-kit/api... build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
COPY --from=deps /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=deps /app/patches patches
COPY --from=deps /app/apps/api/package.json apps/api/package.json
COPY --from=deps /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=deps /app/packages/infra/auth/package.json packages/infra/auth/package.json
COPY --from=deps /app/packages/infra/db/package.json packages/infra/db/package.json
COPY --from=deps /app/packages/core/package.json packages/core/package.json
COPY --from=deps /app/packages/infra/logging/package.json packages/infra/logging/package.json
COPY --from=deps /app/packages/infra/observability/package.json packages/infra/observability/package.json
COPY --from=deps /app/packages/testkit/package.json packages/testkit/package.json
COPY --from=deps /app/packages/tooling/vitest-config/package.json packages/tooling/vitest-config/package.json
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/infra/auth/dist packages/infra/auth/dist
COPY --from=build /app/packages/infra/db/dist packages/infra/db/dist
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/infra/logging/dist packages/infra/logging/dist
COPY --from=build /app/packages/infra/observability/dist packages/infra/observability/dist
USER appuser
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
