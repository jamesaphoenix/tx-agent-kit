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

const getOrganizationListParams = (
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
  filter: {},
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

  it('uses cached next cursor for sequential page requests', async () => {
    const getMock = vi.spyOn(api, 'get')

    getMock
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'org-1' }],
          total: 3,
          nextCursor: 'cursor-page-2',
          prevCursor: null
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'org-2' }],
          total: 3,
          nextCursor: null,
          prevCursor: 'cursor-page-2'
        }
      })

    await dataProvider.getList('organizations', getOrganizationListParams(1))
    await dataProvider.getList('organizations', getOrganizationListParams(2))

    const firstCursor = extractCursor(readCallConfig(getMock, 0))
    const secondCursor = extractCursor(readCallConfig(getMock, 1))
    expect([firstCursor, secondCursor]).toEqual([undefined, 'cursor-page-2'])
  })

  it('invalidates cursor cache when sort/filter changes', async () => {
    const getMock = vi.spyOn(api, 'get')

    getMock
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'org-1' }],
          total: 3,
          nextCursor: 'cursor-page-2',
          prevCursor: null
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'org-3' }],
          total: 3,
          nextCursor: null,
          prevCursor: null
        }
      })

    await dataProvider.getList('organizations', getOrganizationListParams(1))
    await dataProvider.getList('organizations', getOrganizationListParams(2, { sort: { field: 'name', order: 'ASC' } }))

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
          data: [{ id: 'org-1' }],
          total: 2,
          nextCursor: 'cursor-page-2',
          prevCursor: null
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'org-2' }],
          total: 2,
          nextCursor: null,
          prevCursor: null
        }
      })

    postMock.mockResolvedValueOnce({
      data: {
        id: 'org-new'
      }
    })

    await dataProvider.getList('organizations', getOrganizationListParams(1))
    await dataProvider.create('organizations', {
      data: {
        name: 'New organization'
      }
    })
    await dataProvider.getList('organizations', getOrganizationListParams(2))

    const firstCursor = extractCursor(readCallConfig(getMock, 0))
    const secondCursor = extractCursor(readCallConfig(getMock, 1))
    expect([firstCursor, secondCursor]).toEqual([undefined, undefined])
  })

  it('fetches many organizations with one batch request', async () => {
    const postMock = vi.spyOn(api, 'post')
    postMock.mockResolvedValueOnce({
      data: {
        data: [{ id: 'org-1' }]
      }
    })

    const result = await dataProvider.getMany('organizations', {
      ids: ['org-1']
    })

    expect(result.data).toHaveLength(1)
    expect(postMock).toHaveBeenCalledWith('/v1/organizations/batch/get-many', {
      ids: ['org-1']
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
