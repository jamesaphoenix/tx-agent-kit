# Architecture

## Applications

- `apps/web`: Client-only Next.js SPA with two route groups:
  - `(website)`: Public marketing site — landing page, blog (listing + single post), pricing, terms, privacy. Uses `WebsiteHeader`/`WebsiteFooter` layout.
  - `(application)`: Authenticated app shell — org/team dashboard, workspaces page. Uses auth-guard layout.
  - Auth pages: `sign-in`, `sign-up`, `forgot-password`, `reset-password` (split-panel layout).
- `apps/api`: Effect HttpApi server for auth/organizations/teams/invitations.
- `apps/worker`: Temporal worker + workflows.
- `apps/mobile`: Expo React Native client.
- `apps/docs`: Fumadocs documentation site.

## Web Route Structure

```
apps/web/app/
  (website)/               # Public marketing (no auth required)
    layout.tsx             # WebsiteHeader + WebsiteFooter
    page.tsx               # Landing page (config-driven features, FAQs, CTA)
    blog/page.tsx          # Blog listing with category filtering
    blog/[slug]/page.tsx   # Individual blog post
    pricing/page.tsx       # 3-tier pricing (Free/Pro/Enterprise)
    terms/page.tsx         # Terms of Service
    privacy/page.tsx       # Privacy Policy
  (application)/           # Authenticated app (auth-guard layout)
    layout.tsx             # Token check → redirect to /sign-in if missing
    org/page.tsx           # Smart redirect → resolves org/team → dashboard
    org/[orgId]/workspaces/page.tsx  # Team listing + create
    org/[orgId]/[teamId]/page.tsx    # Team dashboard
  sign-in/page.tsx         # Split-panel auth (form left, brand right)
  sign-up/page.tsx         # Split-panel auth (form left, brand right)
```

## Web Infrastructure

- `apps/web/config/index.ts`: Site-wide config (company info, homepage content, blog, dashboard nav). No Stripe price IDs.
- `apps/web/lib/seo.ts`: SEO utilities — `buildTitle`, `buildDescription`, structured data builders (Organization, WebPage, BreadcrumbList, FAQPage).
- `apps/web/lib/blog.ts`: Backend-agnostic blog data layer — `BlogDataSource` interface, `setBlogDataSource`/`getBlogDataSource`, `estimateReadingTime`, `escapeXml`.
- `apps/web/lib/blog-seo.ts`: Blog-specific structured data builders (BlogPosting, Blog).
- `apps/web/components/Breadcrumbs.tsx`: Breadcrumb navigation with chevron separators.
- `apps/web/components/StructuredData.tsx`: JSON-LD `<script>` renderer for Schema.org data.
- `apps/web/app/sitemap.ts`: Sitemap with all marketing pages.
- `apps/web/app/robots.ts`: Robots.txt (disallows authenticated routes).

## Packages

- `packages/infra/db`: Drizzle schema, client, repositories, migrations.
- `packages/infra/db/src/effect-schemas`: Table-aligned Effect schemas (one schema per table).
- `packages/core`: Effect services composing db/auth behavior.
- `packages/core/src/domains/*`: DDD slices (`domain -> ports -> application/adapters -> runtime/ui`).
- Persistence terminology:
  - `packages/core/src/domains/*/ports/*`: abstract persistence contracts (repository seam).
  - `packages/infra/db/src/repositories/*`: concrete persistence implementations.
  - Core domains must not define a `repositories/` folder.
- `packages/infra/auth`: Password and JWT primitives.
- `packages/infra/logging`: Structured JSON logger helpers (mandatory over `console.*`).
- `packages/contracts`: Shared API schemas and types.
- `packages/infra/observability`: OpenTelemetry bootstrap helpers.
- `apps/api/openapi.json`: generated API contract + closed DDD invariants for auth/organizations/invitations.

## Permissions System

- Migration `0008_permission_seeding.sql` seeds `admin` and `member` roles with 17 permission actions.
- Permission actions defined in `packages/contracts/src/literals.ts` (`permissionActions` + `PermissionAction` type).
- Admin role gets all permissions; member role gets a safe subset (excludes `manage_organization`, `manage_billing`, `assign_roles`, `delete_teams`, `delete_workflows`, `export_analytics`, `manage_integrations`, `manage_api_keys`).
- Team CRUD in `apps/web/lib/client-api.ts`: `listTeams`, `getTeam`, `createTeam`, `updateTeam`, `removeTeam`.
