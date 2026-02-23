---
name: new-integration-test
description: Write tx-agent-kit integration tests against Docker-backed infrastructure.
metadata:
  short-description: Integration test workflow
---

# new-integration-test

Write integration tests against Docker-backed infra.

## Rules
- Tests must be idempotent and rerunnable.
- Seed data via API fixtures, not direct DB writes when possible.
- Always clean up created entities.
