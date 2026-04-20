---
kind: spec
spec_type: prd
doc_id: doc-langfuse-observability-prd
name: langfuse-observability-prd
title: "Langfuse Observability"
status: draft
version: 1
owners:
  - jamesaphoenix
summary: "Product requirements for Langfuse LLM observability alongside the existing OTEL stack, excluding agent/message Postgres persistence."
domain: observability
tags:
  - prd
  - langfuse
  - observability
  - ai
depends_on:
  - ai-generation-design
  - overview-design
supersedes: []
implements: null
last_reviewed_at: 2026-04-18
plan: "~/.codex/plans/2026-04-18-langfuse-observability.md"
---

# Summary

tx-agent-kit needs Langfuse for LLM-specific debugging without replacing native OpenTelemetry. Local development should run Jaeger plus a local Langfuse stack. Staging and production should keep standard OTEL traces flowing through the GCP path while sending only LLM calls to Langfuse Cloud.

This scope intentionally excludes `agent_threads`, `agent_messages`, and any other Postgres tables for agent history. Agent/message persistence will be designed separately.

# Requirements

```yaml
ears_requirements:
  - id: REQ-LANGFUSE-001
    kind: ubiquitous
    statement: "The system shall add Langfuse LLM observability without adding tx-agent-kit Postgres agent/message persistence tables."
    priority: must

  - id: REQ-LANGFUSE-002
    kind: ubiquitous
    statement: "The system shall preserve the existing OpenTelemetry export path for platform traces, metrics, and logs."
    priority: must

  - id: REQ-LANGFUSE-003
    kind: state-driven
    while: "running in local development"
    statement: "While running in local development, the system shall support Jaeger and local Langfuse at the same time."
    priority: must

  - id: REQ-LANGFUSE-004
    kind: state-driven
    while: "running in staging or production"
    statement: "While running in staging or production, the system shall send standard OTEL traces to the configured GCP path and LLM calls to Langfuse Cloud."
    priority: must

  - id: REQ-LANGFUSE-005
    kind: optional
    where: "LANGFUSE_ENABLED is false or unset"
    statement: "Where LANGFUSE_ENABLED is false or unset, the system shall run with unchanged existing telemetry behavior."
    priority: must

  - id: REQ-LANGFUSE-006
    kind: optional
    where: "LANGFUSE_ENABLED is true"
    statement: "Where LANGFUSE_ENABLED is true, the system shall initialize Langfuse from typed environment configuration and 1Password-backed secrets for staging/prod."
    priority: must

  - id: REQ-LANGFUSE-007
    kind: ubiquitous
    statement: "The system shall export only LLM-relevant spans to Langfuse."
    priority: must

  - id: REQ-LANGFUSE-008
    kind: ubiquitous
    statement: "The system shall not export database, HTTP, auth, queue, worker lifecycle, or other non-LLM infrastructure spans to Langfuse."
    priority: must

  - id: REQ-LANGFUSE-009
    kind: ubiquitous
    statement: "The system shall capture prompt input, model output, model name, provider, token usage, cost, environment, and service context for LLM calls."
    priority: must

  - id: REQ-LANGFUSE-010
    kind: unwanted
    if: "Langfuse export fails or Langfuse is unavailable"
    statement: "If Langfuse export fails or Langfuse is unavailable, then AI requests and standard OTEL telemetry shall continue."
    priority: must

  - id: REQ-LANGFUSE-011
    kind: unwanted
    if: "Langfuse credentials are missing while Langfuse is enabled"
    statement: "If Langfuse credentials are missing while Langfuse is enabled, then startup shall fail with a clear configuration error."
    priority: must
```

# Acceptance Criteria

```yaml
acceptance_criteria:
  - id: AC-LANGFUSE-001
    statement: "pnpm infra:ensure starts local Langfuse alongside the existing local observability stack."
  - id: AC-LANGFUSE-002
    statement: "Local Langfuse uses Langfuse-owned storage services and does not share the tx-agent-kit application Postgres database."
  - id: AC-LANGFUSE-003
    statement: "Staging and production env templates reference Langfuse credentials through 1Password op:// URIs."
  - id: AC-LANGFUSE-004
    statement: "An OpenRouter LLM call is eligible for Langfuse export with Langfuse generation attributes."
  - id: AC-LANGFUSE-005
    statement: "A Postgres/database span is rejected by the Langfuse export filter in local, staging, and production configurations."
  - id: AC-LANGFUSE-006
    statement: "The implementation includes no migrations or Drizzle schema for agent/message persistence."
```

# Non-goals

- Agent conversation storage in Postgres.
- A product UI for browsing Langfuse traces.
- Prompt management, datasets, evals, or scoring workflows.
- Using Langfuse as the collector for all application OTEL telemetry.

# References

- Langfuse SDK overview: https://langfuse.com/docs/observability/sdk/overview
- Langfuse OpenTelemetry integration: https://langfuse.com/integrations/native/opentelemetry
- Langfuse health/readiness endpoints: https://langfuse.com/self-hosting/configuration/health-readiness-endpoints
- Langfuse headless initialization: https://langfuse.com/self-hosting/administration/headless-initialization
