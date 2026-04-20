# Documentation Index

**Description**: Search map for subsystem PRDs and design docs. Use this file to find the authoritative spec by feature area, domain term, or implementation concern.

**Search Keywords**: ai-generation-design, AI Generation, ai-generation, design, ai, openrouter, tools, analytics-design, Analytics Collector, analytics, metrics, temporal, assets-design, Assets, storage, r2, billing-and-pricing-design, Billing & Pricing, billing-and-pricing, billing, pricing, credits, stripe, campaigns-design, Campaigns, batch, workflows, content-approvals-design, Content Approvals, approvals, review, gates, content-pipeline-design, Content Pipeline, content-pipeline, content, pipeline, publishing, email-campaigns-design, Email Campaigns & Drip Infrastructure, email-campaigns, email, drip, resend, experiments-design, Experiments, experimentation, bandit, prompt-optimization, multi-stage, elo, knowledge-base-design, Knowledge Base, knowledge, embeddings, search, langfuse-observability-design, Langfuse Observability, langfuse-observability, observability, langfuse, llm-tracing, notifications-design, Notifications, overview-design, System Overview, system, overview, architecture, rendering-architecture-design, Rendering Architecture, rendering-architecture, rendering, pipelines, scraping-and-trend-discovery-design, Scraping & Trend Discovery, scraping-and-trend-discovery, scraping, trends, deferred, social-platform-integration-design, Social Platform Integration, social-platform-integration, social, oauth, platform-adapters, temporal-workflows-design, Temporal Workflows, temporal-workflows, sse, tenancy-model-design, Tenancy Model, tenancy-model, tenancy, auth, rbac, webhooks-design, Webhooks, events, analytics-prd, prd, migration, system-design, assets-prd, billing-and-pricing-prd, and, content-pipeline-prd, langfuse-observability-prd, rendering-architecture-prd, scraping-and-trend-discovery-prd, trend, discovery, social-platform-integration-prd, platform, integration, temporal-workflows-prd, tenancy-model-prd, model

## Product Requirements Documents

| Name | Title | Description | Search Keywords | Status |
|------|-------|-------------|-----------------|--------|
| [analytics-prd](prd/analytics-prd.md) | Analytics | Lightweight product scope for the "Analytics" subsystem split. | analytics, prd, migration, system-design | changing |
| [assets-prd](prd/assets-prd.md) | Assets | Product scope for media assets, R2 storage, upload confirmation, local upload proxy, metadata, search, retention, and prepaid storage metering. | assets, prd, migration, system-design | changing |
| [billing-and-pricing-prd](prd/billing-and-pricing-prd.md) | Billing & Pricing | Product scope for subscriptions, prepaid credits, usage metering, billing UI, and local-dev billing bootstrap. | billing-and-pricing, prd, migration, system-design, billing, and, pricing | changing |
| [content-pipeline-prd](prd/content-pipeline-prd.md) | Content Pipeline | Lightweight product scope for the "Content Pipeline" subsystem split. | content-pipeline, prd, migration, system-design, content, pipeline | changing |
| [email-campaigns](prd/email-campaigns.md) | Email Campaigns & Drip Infrastructure | Self-owned email infrastructure for drip campaigns, onboarding sequences, broadcast sends, and lifecycle emails to tx-agent-kit platform users via Resend + Temporal. | email-campaigns, prd, email, campaigns, drip, temporal, resend | changing |
| [langfuse-observability-prd](prd/langfuse-observability-prd.md) | Langfuse Observability | Product scope for Langfuse LLM observability alongside native OTEL, excluding agent/message Postgres persistence. | langfuse-observability, prd, langfuse, observability, llm-tracing | draft |
| [rendering-architecture-prd](prd/rendering-architecture-prd.md) | Rendering Architecture | Lightweight product scope for the "Rendering Architecture" subsystem split. | rendering-architecture, prd, migration, system-design, rendering, architecture | changing |
| [scraping-and-trend-discovery-prd](prd/scraping-and-trend-discovery-prd.md) | Scraping & Trend Discovery | Lightweight product scope for the "Scraping & Trend Discovery" subsystem split. | scraping-and-trend-discovery, prd, migration, system-design, scraping, and, trend, discovery | changing |
| [social-platform-integration-prd](prd/social-platform-integration-prd.md) | Social Platform Integration | Lightweight product scope for the "Social Platform Integration" subsystem split. | social-platform-integration, prd, migration, system-design, social, platform, integration | changing |
| [temporal-workflows-prd](prd/temporal-workflows-prd.md) | Temporal Workflows | Lightweight product scope for the "Temporal Workflows" subsystem split. | temporal-workflows, prd, migration, system-design, temporal, workflows | changing |
| [tenancy-model-prd](prd/tenancy-model-prd.md) | Tenancy Model | Product scope for auth, organizations, workspaces, RBAC, invitations, member lifecycle, and tenant isolation. | tenancy-model, prd, migration, system-design, tenancy, model | changing |

## Design Documents

| Name | Title | Description | Search Keywords | Implements | Status |
|------|-------|-------------|-----------------|------------|--------|
| [ai-generation-design](design/ai-generation-design.md) | AI Generation | Multi-provider AI generation via OpenRouter + direct providers, tool calling, conversation loop, media enrichment, and credit-gated execution. | ai-generation, design, ai, openrouter, tools | - | changing |
| [analytics-design](design/analytics-design.md) | Analytics Collector | Post-performance metrics collection, time-series snapshots, derived metrics, and aggregate views. Covers the Analytics Collector subsystem (#12). | analytics, design, metrics, temporal | analytics-prd | changing |
| [assets-design](design/assets-design.md) | Assets | Media asset storage, upload flow, metadata, search, retention, and prepaid storage metering on Cloudflare R2. | assets, design, storage, r2 | assets-prd | changing |
| [billing-and-pricing-design](design/billing-and-pricing-design.md) | Billing & Pricing | Stripe integration, subscription plans, credit system, usage metering, storage billing, and cost controls for tx-agent-kit. | billing-and-pricing, design, billing, pricing, credits, stripe | billing-and-pricing-prd | changing |
| [campaigns-design](design/campaigns-design.md) | Campaigns | Autonomous campaign orchestration: nightly batch execution, budget enforcement, content-type strategies, pause/resume, and campaign-social-account binding. | campaigns, design, batch, workflows | - | changing |
| [content-approvals-design](design/content-approvals-design.md) | Content Approvals | Two-gate content approval workflow with stateless client review, auto-approval rules, edit iterations, and gate expiry. | approvals, design, review, gates | - | changing |
| [content-pipeline-design](design/content-pipeline-design.md) | Content Pipeline | Content lifecycle subsystem covering creative concepts, content items, assets, approval gates, agent orchestration, scheduled posts, and publishing workflows. | content-pipeline, design, content, pipeline, assets, publishing | content-pipeline-prd | changing |
| [email-campaigns-design](design/email-campaigns-design.md) | Email Campaigns & Drip Infrastructure | Technical design for a self-owned email automation system using Resend delivery + Temporal workflow orchestration, covering drip sequences, broadcasts, delivery tracking, suppression, and CAN-SPAM compliance. | email-campaigns, design, email, campaigns, drip, temporal, resend | email-campaigns | changing |
| [experiments-design](design/experiments-design.md) | Experiments | Multi-stage adaptive experimentation engine with per-stage bandits, lineage-based credit assignment, Elo pre-filtering, phased LLM-to-real reward blend, and hierarchical team/global experiments. | experimentation, design, bandit, prompt-optimization, multi-stage, elo | - | changing |
| [knowledge-base-design](design/knowledge-base-design.md) | Knowledge Base | Per-team brand knowledge store with AI processing, semantic search, change tracking, and proposal/approval workflow. | knowledge, design, embeddings, search | - | changing |
| [langfuse-observability-design](design/langfuse-observability-design.md) | Langfuse Observability | Technical design for Langfuse LLM tracing beside native OTEL without adding agent/message Postgres tables. | langfuse-observability, design, langfuse, observability, llm-tracing | langfuse-observability-prd | draft |
| [notifications-design](design/notifications-design.md) | Notifications | In-app and email notification subsystem with per-user preferences, digest batching, and Temporal workflow delivery. | notifications, design, email | - | changing |
| [overview-design](design/overview-design.md) | System Overview | Cross-cutting system architecture, infrastructure, observability, security, and design principles for tx-agent-kit. | system, design, overview, architecture | - | changing |
| [rendering-architecture-design](design/rendering-architecture-design.md) | Rendering Architecture | Media rendering subsystem covering rendering backends (fal.ai, FFmpeg, Remotion, ElevenLabs, OpenRouter), content pipelines, nightly batch campaign execution, quality scoring, and credit middleware. | rendering-architecture, design, rendering, workflows, campaigns, pipelines | rendering-architecture-prd | changing |
| [scraping-and-trend-discovery-design](design/scraping-and-trend-discovery-design.md) | Scraping & Trend Discovery | TikTok scraping, trend discovery, competitor analysis, and AI-powered content insights. Deferred -- not building in v1. | scraping-and-trend-discovery, design, scraping, trends, deferred | scraping-and-trend-discovery-prd | changing |
| [social-platform-integration-design](design/social-platform-integration-design.md) | Social Platform Integration | Social platform integration subsystem covering OAuth flows, token management, provider adapters, platform-specific publishing workflows, polling, retry logic, and the platform constraints registry. | social-platform-integration, design, social, oauth, publishing, platform-adapters | social-platform-integration-prd | changing |
| [temporal-workflows-design](design/temporal-workflows-design.md) | Temporal Workflows | Temporal workflow organization, task queues, design rules, activity patterns, retry policies, signal handling, and real-time pipeline event feedback via SSE. Covers the Workflows subsystem (#15). | temporal-workflows, design, temporal, workflows, sse, pipelines | temporal-workflows-prd | changing |
| [tenancy-model-design](design/tenancy-model-design.md) | Tenancy Model | Auth, identity, organization/team hierarchy, RBAC, client review, and tenant isolation for tx-agent-kit. | tenancy-model, design, tenancy, auth, rbac | tenancy-model-prd | changing |
| [webhooks-design](design/webhooks-design.md) | Webhooks | Org-scoped outbound webhook subscriptions with HMAC signing, retry with exponential backoff, and dead letter handling. | webhooks, design, events | - | changing |

## Invariant Summary

**Total invariants**: 262

**By enforcement type**:

- integration_test: 262

**By subsystem**:

- design: 193
- prd: 69

## Document Links

| From | To | Type |
|------|-----|------|
| tenancy-model-prd | tenancy-model-design | prd_to_design |
| assets-prd | assets-design | prd_to_design |
| 6 | 5 | prd_to_design |
| content-pipeline-prd | content-pipeline-design | prd_to_design |
| rendering-architecture-prd | rendering-architecture-design | prd_to_design |
| social-platform-integration-prd | social-platform-integration-design | prd_to_design |
| 14 | 13 | prd_to_design |
| 16 | 15 | prd_to_design |
| billing-and-pricing-prd | billing-and-pricing-design | prd_to_design |
| analytics-prd | analytics-design | prd_to_design |
| scraping-and-trend-discovery-prd | scraping-and-trend-discovery-design | prd_to_design |
| 24 | 23 | prd_to_design |
| temporal-workflows-prd | temporal-workflows-design | prd_to_design |
| 28 | 27 | prd_to_design |
| 30 | 29 | prd_to_design |
| 32 | 31 | prd_to_design |
| 34 | 33 | prd_to_design |
| 36 | 35 | prd_to_design |
| 38 | 37 | prd_to_design |
| 40 | 39 | prd_to_design |
| 42 | 41 | prd_to_design |
| email-campaigns | email-campaigns-design | prd_to_design |
| langfuse-observability-prd | langfuse-observability-design | prd_to_design |
