import type { GetListParams } from 'react-admin'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../axios'
import { cursorCache } from './cursor-cache'
import { dataProvider } from './data-provider'

vi.mock('../axios', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}))

const getTaskListParams = (
  page: number,
  overrides?: Partial<GetListParams>
): GetListParams => ({
  pagination: {
    page,
    perPage: 2
  },
  sort: {
    field: 'createdAt',
    order: 'ASC'
  },
  filter: {
    workspaceId: 'workspace-1'
  },
  ...(overrides ?? {})
})

interface MockWithCalls {
  mock: {
    calls: unknown[][]
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const readCallConfig = (mockFn: MockWithCalls, callIndex: number): unknown => {
  const call = mockFn.mock.calls[callIndex]
  if (!Array.isArray(call)) {
    return undefined
  }

  return call[1]
}

const extractCursor = (config: unknown): string | undefined => {
  if (!isRecord(config)) {
    return undefined
  }

  const params = config.params
  if (!isRecord(params)) {
    return undefined
  }

  const cursor = params.cursor
  return typeof cursor === 'string' ? cursor : undefined
}

describe('react-admin dataProvider', () => {
  beforeEach(() => {
    cursorCache.clearAll()
    vi.clearAllMocks()
  })

  it('returns empty tasks list when workspaceId filter is missing', async () => {
    const getMock = vi.spyOn(api, 'get')

    const result = await dataProvider.getList('tasks', {
      pagination: { page: 1, perPage: 2 },
      sort: { field: 'createdAt', order: 'ASC' },
      filter: {}
    })

    expect(result).toEqual({
      data: [],
      total: 0
    })
    expect(getMock).not.toHaveBeenCalled()
  })

  it('uses cached next cursor for sequential page requests', async () => {
    const getMock = vi.spyOn(api, 'get')

    getMock
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'task-1' }],
          total: 3,
          nextCursor: 'cursor-page-2',
          prevCursor: null
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'task-2' }],
          total: 3,
          nextCursor: null,
          prevCursor: 'cursor-page-2'
        }
      })

    await dataProvider.getList('tasks', getTaskListParams(1))
    await dataProvider.getList('tasks', getTaskListParams(2))

    const firstCursor = extractCursor(readCallConfig(getMock, 0))
    const secondCursor = extractCursor(readCallConfig(getMock, 1))
    expect([firstCursor, secondCursor]).toEqual([undefined, 'cursor-page-2'])
  })

  it('invalidates cursor cache when sort/filter changes', async () => {
    const getMock = vi.spyOn(api, 'get')

    getMock
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'task-1' }],
          total: 3,
          nextCursor: 'cursor-page-2',
          prevCursor: null
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'task-3' }],
          total: 3,
          nextCursor: null,
          prevCursor: null
        }
      })

    await dataProvider.getList('tasks', getTaskListParams(1))
    await dataProvider.getList('tasks', getTaskListParams(2, { sort: { field: 'title', order: 'ASC' } }))

    const firstCursor = extractCursor(readCallConfig(getMock, 0))
    const secondCursor = extractCursor(readCallConfig(getMock, 1))
    expect([firstCursor, secondCursor]).toEqual([undefined, undefined])
  })

  it('clears cached cursors after mutations', async () => {
    const getMock = vi.spyOn(api, 'get')
    const postMock = vi.spyOn(api, 'post')

    getMock
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'task-1' }],
          total: 2,
          nextCursor: 'cursor-page-2',
          prevCursor: null
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'task-2' }],
          total: 2,
          nextCursor: null,
          prevCursor: null
        }
      })

    postMock.mockResolvedValueOnce({
      data: {
        id: 'task-new'
      }
    })

    await dataProvider.getList('tasks', getTaskListParams(1))
    await dataProvider.create('tasks', {
      data: {
        workspaceId: 'workspace-1',
        title: 'New task'
      }
    })
    await dataProvider.getList('tasks', getTaskListParams(2))

    const firstCursor = extractCursor(readCallConfig(getMock, 0))
    const secondCursor = extractCursor(readCallConfig(getMock, 1))
    expect([firstCursor, secondCursor]).toEqual([undefined, undefined])
  })

  it('fetches many records with one batch request', async () => {
    const postMock = vi.spyOn(api, 'post')
    postMock.mockResolvedValueOnce({
      data: {
        data: [{ id: 'task-1' }, { id: 'task-2' }]
      }
    })

    const result = await dataProvider.getMany('tasks', {
      ids: ['task-1', 'task-2']
    })

    expect(result.data).toHaveLength(2)
    expect(postMock).toHaveBeenCalledWith('/v1/tasks/batch/get-many', {
      ids: ['task-1', 'task-2']
    })
  })

  it('fetches many workspaces with one batch request', async () => {
    const postMock = vi.spyOn(api, 'post')
    postMock.mockResolvedValueOnce({
      data: {
        data: [{ id: 'workspace-1' }]
      }
    })

    const result = await dataProvider.getMany('workspaces', {
      ids: ['workspace-1']
    })

    expect(result.data).toHaveLength(1)
    expect(postMock).toHaveBeenCalledWith('/v1/workspaces/batch/get-many', {
      ids: ['workspace-1']
    })
  })

  it('fetches many invitations with one batch request', async () => {
    const postMock = vi.spyOn(api, 'post')
    postMock.mockResolvedValueOnce({
      data: {
        data: [{ id: 'invitation-1' }]
      }
    })

    const result = await dataProvider.getMany('invitations', {
      ids: ['invitation-1']
    })

    expect(result.data).toHaveLength(1)
    expect(postMock).toHaveBeenCalledWith('/v1/invitations/batch/get-many', {
      ids: ['invitation-1']
    })
  })
})
