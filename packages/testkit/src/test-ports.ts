/**
 * Resolves integration test ports using the worktree port offset.
 *
 * Main repo (WORKTREE_PORT_OFFSET=0): base ports start at 4100.
 * Worktree (WORKTREE_PORT_OFFSET=316): offset ports (4416, 4417, etc.)
 *
 * This enables truly parallel integration test runs across worktrees
 * without port collisions or filesystem locks.
 */

const offset = Number.parseInt(process.env.WORKTREE_PORT_OFFSET ?? '0', 10)

export const resolveTestPort = (basePort: number): number => basePort + offset

/** The shared API server port for integration tests */
export const INTEGRATION_API_PORT = resolveTestPort(4100)

/** Base URL for the shared integration test API server */
export const INTEGRATION_API_BASE_URL = `http://127.0.0.1:${INTEGRATION_API_PORT}`
