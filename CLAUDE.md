# tx-agent-kit Claude Guide

This repository follows an agent-first operating model inspired by OpenAI's "Harness engineering: leveraging Codex in an agent-first world" (February 11, 2026).

## Core Operating Model
- Humans steer; agents execute.
- Prioritize environment design, clear intent, and feedback loops over ad hoc coding.
- Treat agent struggles as system gaps: add tooling, docs, constraints, and checks.

## Repository Knowledge Rules
- Keep this file and `AGENTS.md` concise and map-like.
- Keep durable decisions in versioned docs/code, not chat history.
- Use progressive disclosure: link into deeper docs instead of bloating entrypoint docs.
- If knowledge is not in-repo, assume agents cannot reliably use it.

## Legibility and Architecture
- Optimize for agent legibility: explicit layers, stable APIs, predictable naming.
- Enforce dependency direction and bounded-context boundaries mechanically.
- Validate data at boundaries with `effect/Schema` only.
- Keep `OpenAPI.yml` as external API contract and closed invariant reference.

## Enforcement and Feedback
- Encode invariants as lint rules, structural tests, and CI checks.
- Keep logs/metrics/traces queryable in local environments so agents can self-debug.
- Prefer small, short-lived PRs and rapid correction loops.
- Run recurring refactor/doc-gardening passes to prevent drift and stale guidance.

## Practical Expectations
- Correctness, maintainability, and agent legibility are the quality bar.
- Human stylistic preference is secondary to verifiable behavior and clear constraints.
- When docs and reality diverge, update docs or encode the rule into tooling.
