import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosRequestConfig } from 'axios'

vi.mock('../axios', () => ({
  api: vi.fn()
}))

import { api } from '../axios'
import { customInstance } from './orval-mutator'

const mockApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

const getCalledConfig = (): AxiosRequestConfig => {
  const firstCall = mockApi.mock.calls[0]
  if (!firstCall) {
    throw new Error('Expected API client to be called')
  }

  const [config] = firstCall
  if (typeof config === 'string') {
    throw new Error('Expected API call to receive an Axios config object')
  }

  return config
}

describe('customInstance', () => {
  it('calls api with merged config and returns data', async () => {
    mockApi.mockResolvedValue({ data: { id: 'w-1' } })

    const config: AxiosRequestConfig = { url: '/organizations', method: 'GET' }
    const result = await customInstance<{ id: string }>(config)

    expect(result).toEqual({ id: 'w-1' })
    expect(mockApi).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/organizations', method: 'GET' })
    )
  })

  it('merges options headers under config headers', async () => {
    mockApi.mockResolvedValue({ data: {} })

    const config: AxiosRequestConfig = {
      url: '/tasks',
      method: 'POST',
      headers: { 'X-Custom': 'value' }
    }
    const options: AxiosRequestConfig = {
      headers: { Authorization: 'Bearer token' }
    }

    await customInstance(config, options)

    const passedConfig = getCalledConfig()
    expect(passedConfig.headers).toEqual({
      Authorization: 'Bearer token',
      'X-Custom': 'value'
    })
  })

  it('config headers override options headers', async () => {
    mockApi.mockResolvedValue({ data: {} })

    const config: AxiosRequestConfig = {
      url: '/tasks',
      headers: { Authorization: 'Bearer new' }
    }
    const options: AxiosRequestConfig = {
      headers: { Authorization: 'Bearer old' }
    }

    await customInstance(config, options)

    const passedConfig = getCalledConfig()
    expect(passedConfig.headers!['Authorization']).toBe('Bearer new')
  })

  it('provides an AbortController signal', async () => {
    mockApi.mockResolvedValue({ data: {} })

    const config: AxiosRequestConfig = { url: '/test' }
    await customInstance(config)

    const passedConfig = getCalledConfig()
    expect(passedConfig.signal).toBeInstanceOf(AbortSignal)
  })

  it('works without options parameter', async () => {
    mockApi.mockResolvedValue({ data: { ok: true } })

    const config: AxiosRequestConfig = { url: '/health', method: 'GET' }
    const result = await customInstance<{ ok: boolean }>(config)

    expect(result).toEqual({ ok: true })
    const passedConfig = getCalledConfig()
    expect(passedConfig.headers).toEqual({})
  })

  it('options properties are overridden by config properties', async () => {
    mockApi.mockResolvedValue({ data: {} })

    const config: AxiosRequestConfig = { url: '/tasks', method: 'POST' }
    const options: AxiosRequestConfig = { url: '/ignored', method: 'GET' }

    await customInstance(config, options)

    const passedConfig = getCalledConfig()
    expect(passedConfig.url).toBe('/tasks')
    expect(passedConfig.method).toBe('POST')
  })

  it('propagates API errors', async () => {
    const error = new Error('Network error')
    mockApi.mockRejectedValue(error)

    const config: AxiosRequestConfig = { url: '/fail' }
    await expect(customInstance(config)).rejects.toThrow('Network error')
  })
})
