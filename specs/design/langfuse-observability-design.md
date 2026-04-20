---
kind: spec
spec_type: design
doc_id: doc-langfuse-observability-design
name: langfuse-observability-design
title: "Langfuse Observability"
status: draft
version: 1
owners:
  - jamesaphoenix
summary: "Technical design for adding Langfuse LLM tracing beside native OTEL without adding agent/message Postgres tables."
domain: observability
tags:
  - design
  - langfuse
  - observability
  - ai
depends_on:
  - ai-generation-design
  - overview-design
supersedes: []
implements: langfuse-observability-prd
last_reviewed_at: 2026-04-18
plan: "~/.codex/plans/2026-04-18-langfuse-observability.md"
---

# Summary

Langfuse is added as an optional second span processor in the existing Node OpenTelemetry SDK. Standard OTEL traces, metrics, and logs continue to use the existing OTLP exporter. Langfuse receives only LLM/GenAI spans from `@tx-agent-kit/ai`.

# Architecture

Local development:

```text
API / Worker
  -> @tx-agent-kit/observability NodeSDK
     -> OTLPTraceExporter -> local OTEL Collector -> Jaeger
     -> LangfuseSpanProcessor -> local Langfuse
```

Staging and production:

```text
API / Worker
  -> @tx-agent-kit/observability NodeSDK
     -> OTLPTraceExporter -> GCP OTEL path
     -> LangfuseSpanProcessor -> Langfuse Cloud
```

# Components

| Component | Path | Responsibility |
|-----------|------|----------------|
| Langfuse env parsing | `packages/infra/observability/src/env.ts` | Parse `LANGFUSE_*` config, validate credentials and sampling. |
| Langfuse processor | `packages/infra/observability/src/langfuse.ts` | Create `LangfuseSpanProcessor`, mask sensitive values, and enforce LLM-only export. |
| Telemetry bootstrap | `packages/infra/observability/src/index.ts` | Register Langfuse beside the existing OTLP span processor when enabled. |
| AI tracing | `packages/infra/ai/src/tracing.ts` | Attach Langfuse generation attributes to OpenRouter spans. |
| Local infra | `docker-compose.yml`, `scripts/start-dev-services.sh` | Run and health-check Langfuse local stack via `pnpm infra:ensure`. |
| Deploy env | `deploy/env/*.env.template` | Reference Langfuse Cloud secrets through 1Password. |

# Span Export Policy

The Langfuse processor uses `@langfuse/otel` and composes with Langfuse's default span filter. That default exports Langfuse SDK spans, spans with `gen_ai.*` attributes, and known LLM instrumentation scopes. The tx-agent-kit wrapper adds deterministic trace sampling after that LLM-only decision.

Database, HTTP, queue, auth, and worker lifecycle spans do not have `gen_ai.*` attributes and are not from known LLM instrumentors, so they remain in normal OTEL only.

# Attribute Contract

`tracedCallModel` emits:

```yaml
generation_attributes:
  gen_ai.system: openrouter
  gen_ai.request.model: "<resolved model>"
  gen_ai.response.model: "<response model>"
  gen_ai.usage.prompt_tokens: "<input token count>"
  gen_ai.usage.completion_tokens: "<output token count>"
  gen_ai.usage.total_tokens: "<total token count>"
  gen_ai.usage.cost: "<provider cost when available>"
  langfuse.observation.type: generation
  langfuse.observation.input: "<JSON string>"
  langfuse.observation.output: "<JSON string>"
  langfuse.observation.model.name: "<model>"
  langfuse.observation.model.parameters: "<JSON string>"
  langfuse.observation.usage_details: "<JSON string>"
  langfuse.observation.cost_details: "<JSON string>"
  langfuse.observation.metadata.provider: openrouter
```

# Configuration

```yaml
langfuse_env:
  LANGFUSE_ENABLED:
    default: false
  LANGFUSE_BASE_URL:
    local: http://localhost:3003
    staging_prod: https://us.cloud.langfuse.com
  LANGFUSE_HOST:
    purpose: "Compatibility alias for existing vault fields."
  LANGFUSE_PUBLIC_KEY:
    source: "Local default for self-hosted dev; 1Password for staging/prod."
  LANGFUSE_SECRET_KEY:
    source: "Local default for self-hosted dev; 1Password for staging/prod."
  LANGFUSE_SAMPLE_RATE:
    default: 1
    valid_range: "0..1"
  LANGFUSE_LOG_LEVEL:
    values: [DEBUG, INFO, WARN, ERROR]
```

# Local Infrastructure

Local Langfuse runs in the standard `infra` compose profile:

```yaml
local_langfuse_services:
  - langfuse-web
  - langfuse-worker
  - langfuse-postgres
  - langfuse-clickhouse
  - langfuse-minio
  - langfuse-redis
```

The Langfuse Postgres service is separate from tx-agent-kit's application Postgres service. This avoids accidental coupling between product data and Langfuse-owned operational data.

# Invariants

```yaml
invariants:
  - id: INV-LANGFUSE-001
    statement: "No agent_threads, agent_messages, or other agent persistence tables are added by this design."
    severity: critical
    verified_by: [REQ-LANGFUSE-001, AC-LANGFUSE-006]

  - id: INV-LANGFUSE-002
    statement: "The existing OTLP exporter remains registered for standard platform telemetry regardless of Langfuse state."
    severity: critical
    verified_by: [REQ-LANGFUSE-002, REQ-LANGFUSE-005]

  - id: INV-LANGFUSE-003
    statement: "Only LLM/GenAI spans are eligible for Langfuse export."
    severity: critical
    verified_by: [REQ-LANGFUSE-007, REQ-LANGFUSE-008, AC-LANGFUSE-005]

  - id: INV-LANGFUSE-004
    statement: "Langfuse credentials for staging/prod are represented as 1Password references in committed templates."
    severity: high
    verified_by: [REQ-LANGFUSE-006, AC-LANGFUSE-003]
```

# Verification

```yaml
verification:
  unit_tests:
    - "Env parsing validates enabled credentials, sample rate, base URL fallback, and disabled defaults."
    - "Processor tests prove GenAI spans export while DB/HTTP spans do not."
    - "AI tracing tests prove OpenRouter spans include Langfuse generation attributes."
  integration_tests:
    - "Local, staging, and production Langfuse env configurations resolve correctly."
    - "Each environment case exports LLM spans and rejects database spans."
  smoke:
    - "pnpm infra:ensure exposes Langfuse at http://localhost:3003 plus Jaeger at http://localhost:16686."
```
