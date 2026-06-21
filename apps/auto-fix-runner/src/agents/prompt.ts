import type { AutoFixWorkflowPayload } from '@tx-agent-kit/contracts'

/**
 * Construct the operator prompt handed to the headless coding agent.
 *
 * Deliberately product-agnostic: it describes the incident, the isolated
 * worktree the agent runs in, the repo tooling it may use, and the hard safety
 * rules. The agent edits files + runs the repo's own checks itself and returns a
 * typed AutoFixResult; it does NOT open the PR (the activity does the
 * deterministic git push + draft PR finish).
 *
 * Keep this prompt repo-neutral. Per-deployment specifics (observability CLIs,
 * provider docs, etc.) belong in an env-templated extension, NOT hardcoded here.
 */
export const buildAutoFixPrompt = (payload: AutoFixWorkflowPayload): string => {
  const lines: string[] = [
    'You are an autonomous bug-fix agent running headless on an isolated host inside a prepared git worktree of this repository, with the repo tooling available.',
    '',
    '## The incident',
    `- Title: ${payload.title}`,
    `- Where: ${payload.culprit}`,
    `- Severity: ${payload.level}`,
    `- Environment: ${payload.environment}`,
    `- Incident id: ${payload.sentryIssueId}`,
    `- Grouping fingerprint: ${payload.fingerprint}`,
    `- Link (open it for the full stack/breadcrumbs/trace context): ${payload.permalink}`,
    `- First/last seen around: ${payload.occurredAt}`,
    '',
    '## Tooling',
    '- ripgrep/grep, the repo scripts and skills, and web search for provider/library docs.',
    '- Find the failing code path FIRST (read the stack/trace evidence), then fix from that evidence.',
    '',
    '## Hard rules',
    '- You are already inside a prepared worktree. If you need ANOTHER worktree you MUST use scripts/worktree/create.sh (raw `git worktree add` is hook-blocked).',
    '- Reproduce read-only where possible. NEVER run database migrations, destructive mutations, mass emails, or payment/charge calls against any live environment.',
    '- Leave the branch buildable: run `pnpm lint && pnpm type-check && pnpm test` before declaring the fix done.',
    '- If the fix needs something you cannot infer from the code + provider docs + web search (a value, a credential, a human decision), set needsManualInput=true, explain in blockers, and stop.',
    '',
    '## Return contract',
    'Return ONLY a JSON object matching the provided output schema (outcome, summary, rootCause, prTitle, prBody, filesChanged, testsRun, testsPassed, needsManualInput, blockers). Do not open a PR yourself.'
  ]
  return lines.join('\n')
}
