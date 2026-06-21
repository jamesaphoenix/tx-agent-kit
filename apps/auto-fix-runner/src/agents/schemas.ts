/**
 * JSON-Schema for the agent's structured return contract (AutoFixResult).
 *
 * This is the file written to disk and passed to `codex exec --output-schema`
 * for native validation. The claude runner parses the JSON envelope's result
 * field and validates it against the shared effect/Schema instead, but the two
 * descriptions stay in lock-step with `autoFixResultSchema` in
 * `@tx-agent-kit/contracts`. The `needsManualInput` key MUST match the contract
 * (and the prompt) exactly, or codex output validation diverges from the effect
 * decode.
 */
export const autoFixResultJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    outcome: { enum: ['fixed', 'blocked', 'no_change'] },
    summary: { type: 'string' },
    rootCause: { type: 'string' },
    prTitle: { type: 'string' },
    prBody: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsRun: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    needsManualInput: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } }
  },
  required: [
    'outcome',
    'summary',
    'rootCause',
    'prTitle',
    'prBody',
    'filesChanged',
    'testsRun',
    'testsPassed',
    'needsManualInput',
    'blockers'
  ],
  additionalProperties: false
} as const
