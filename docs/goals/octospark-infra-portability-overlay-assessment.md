# Octospark Overlay Assessment for tx-agent-kit

Status: implementation guardrail retained
Last updated: 2026-05-25

The early idea of copying Octospark over tx-agent-kit and deleting product-specific areas was rejected as the default migration path. Octospark is close enough structurally that this would move fast, but it would also import social publishing, domain names, billing/upload ergonomics, docs examples, skills, and deployment assumptions that are not tx-agent-kit infrastructure.

## Current Decision

- Do not apply a direct Octospark overlay to `main`.
- Port approved infrastructure patterns as reviewed slices with target-owned names, ports, env conventions, and package boundaries.
- Keep the product-leak/plaintext-secret scanner as a hard gate before any future overlay experiment.

## Allowed Future Experiment

An overlay experiment can be useful only on an isolated branch/worktree and only as a discovery aid:

- Allowlist infra-only paths before copying anything.
- Run the product-leak scanner immediately after the copy.
- Delete or quarantine any source-product files before review.
- Produce a diff inventory instead of landing the overlay as a single commit.
- Convert useful findings into normal reviewable slices.

## Rejected Areas

- Social publishing flows, smoke tests, and telemetry.
- Octospark-specific CLI/MCP commands, device auth, and product shortcuts.
- Source domains, Cloudflare route names, R2 bucket names, docs content, specs, and skills.
- Any plaintext secrets or generated local `.env` artifacts.

The current rollout follows the reviewed-slice path instead of the overlay path.
