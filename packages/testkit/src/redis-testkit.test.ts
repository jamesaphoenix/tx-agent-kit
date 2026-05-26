import { describe, expect, it, vi } from 'vitest'
import {
  createRedisTestKeyPrefix,
  deleteRedisTestKeysByPrefix,
  getRedisWorktreeNamespace,
  normalizeRedisKeyPrefix,
  scanRedisTestKeys
} from './redis-testkit.js'

describe('redis-testkit', () => {
  it('creates normalized, prefix-safe Redis namespaces', () => {
    expect(createRedisTestKeyPrefix('Quota Bucket')).toMatch(
      /^test:repo-[a-f0-9]{8}:worktree-[a-z0-9_-]+:schema-[a-z0-9_-]+:quota-bucket:$/u
    )
    expect(normalizeRedisKeyPrefix('test:quota')).toBe('test:quota:')
    expect(normalizeRedisKeyPrefix('test:quota:')).toBe('test:quota:')
  })

  it('includes worktree and schema state in the default Redis namespace', () => {
    const previousOffset = process.env.WORKTREE_PORT_OFFSET
    const previousSchema = process.env.DATABASE_SCHEMA
    const previousNamespace = process.env.TESTKIT_REDIS_NAMESPACE
    process.env.WORKTREE_PORT_OFFSET = '31'
    process.env.DATABASE_SCHEMA = 'branch_feature_xyz'
    process.env.TESTKIT_REDIS_NAMESPACE = 'tx-agent-kit'
    try {
      expect(getRedisWorktreeNamespace()).toBe('tx-agent-kit:worktree-31:schema-branch_feature_xyz')
      expect(createRedisTestKeyPrefix('Quota')).toBe('test:tx-agent-kit:worktree-31:schema-branch_feature_xyz:quota:')
    } finally {
      if (previousOffset === undefined) {
        delete process.env.WORKTREE_PORT_OFFSET
      } else {
        process.env.WORKTREE_PORT_OFFSET = previousOffset
      }
      if (previousSchema === undefined) {
        delete process.env.DATABASE_SCHEMA
      } else {
        process.env.DATABASE_SCHEMA = previousSchema
      }
      if (previousNamespace === undefined) {
        delete process.env.TESTKIT_REDIS_NAMESPACE
      } else {
        process.env.TESTKIT_REDIS_NAMESPACE = previousNamespace
      }
    }
  })

  it('rejects empty Redis test namespaces', () => {
    expect(() => createRedisTestKeyPrefix(' !!! ')).toThrow('Redis test prefix parts')
  })

  it('scans and deletes only keys under the requested prefix', async () => {
    const scan = vi.fn()
      .mockResolvedValueOnce(['1', ['test:quota:a', 'test:quota:b']])
      .mockResolvedValueOnce(['0', ['test:quota:c']])
      .mockResolvedValueOnce(['1', ['test:quota:a', 'test:quota:b']])
      .mockResolvedValueOnce(['0', ['test:quota:c']])
    const del = vi.fn(() => Promise.resolve(3))
    const client = { scan, del }

    await expect(scanRedisTestKeys(client as never, 'test:quota')).resolves.toEqual([
      'test:quota:a',
      'test:quota:b',
      'test:quota:c'
    ])
    await expect(deleteRedisTestKeysByPrefix(client as never, 'test:quota')).resolves.toBe(3)
    expect(del).toHaveBeenCalledWith('test:quota:a', 'test:quota:b', 'test:quota:c')
  })
})
