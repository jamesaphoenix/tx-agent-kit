import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Types are gated separately in CI (`pnpm type-check`), so running tsc again
  // inside `next build` is redundant. That in-build pass walks the whole
  // monorepo source graph via project references and OOMs the builder (exit
  // 137). Skipping it removes the OOM and cuts build time; type regressions
  // still block merges via the CI gate. (Next dropped built-in ESLint-during-
  // build, so there is no eslint key to disable here.)
  typescript: { ignoreBuildErrors: true },
  transpilePackages: ['@tx-agent-kit/contracts'],
  env: {
    NEXT_PUBLIC_API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      process.env.API_BASE_URL ??
      'http://localhost:4000'
  },
  // Turbopack: resolve .ts/.tsx files when imports use .js extensions (ESM convention).
  // @tx-agent-kit/contracts uses .js extensions in barrel exports (Node.js ESM),
  // but the web app resolves to .ts source via tsconfig paths.
  turbopack: {
    resolveAlias: {
      // Turbopack handles .js → .ts natively when transpilePackages is set,
      // but for monorepo path-mapped packages we need webpack extensionAlias too.
    }
  },
  webpack: (config: Record<string, Record<string, unknown>>) => {
    config.resolve = config.resolve ?? {}
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs']
    }
    return config
  }
}

export default nextConfig
