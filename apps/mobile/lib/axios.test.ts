import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalAxiosRequestConfig } from 'axios'
import axios from 'axios'
import { writeAuthToken, clearAuthToken } from './auth-token'
import { api, getApiErrorStatus, getApiErrorMessage } from './axios'

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: { API_BASE_URL: 'https://test.example.com' }
    }
  }
}))

const mockStore: Record<string, string> = {}

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn((key: string) => Promise.resolve(mockStore[key] ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    mockStore[key] = value
    return Promise.resolve()
  }),
  deleteItemAsync: vi.fn((key: string) => {
    delete mockStore[key]
    return Promise.resolve()
  })
}))

describe('axios interceptor', () => {
  let capturedConfig: InternalAxiosRequestConfig | null = null

  beforeEach(() => {
    for (const key of Object.keys(mockStore)) {
      delete mockStore[key]
    }
    capturedConfig = null

    api.defaults.adapter = (config: InternalAxiosRequestConfig) => {
      capturedConfig = config
      return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config })
    }
  })

  it('attaches Authorization header when token exists', async () => {
    await writeAuthToken('test-jwt')
    await api.get('/test')

    expect(capturedConfig).not.toBeNull()
    expect(capturedConfig!.headers.Authorization).toBe('Bearer test-jwt')
  })

  it('removes Authorization header when no token', async () => {
    await clearAuthToken()
    await api.get('/test')

    expect(capturedConfig).not.toBeNull()
    expect(capturedConfig!.headers.Authorization).toBeUndefined()
  })
})

describe('getApiErrorStatus', () => {
  it('returns status from AxiosError response', () => {
    const error = new axios.AxiosError('fail', '400', undefined, undefined, {
      status: 400,
      data: {},
      statusText: 'Bad Request',
      headers: {},
      config: { headers: {} } as never
    })
    expect(getApiErrorStatus(error)).toBe(400)
  })

  it('returns undefined for non-axios errors', () => {
    expect(getApiErrorStatus(new Error('oops'))).toBeUndefined()
  })

  it('returns undefined when no response', () => {
    const error = new axios.AxiosError('network fail', 'ERR_NETWORK')
    expect(getApiErrorStatus(error)).toBeUndefined()
  })
})

describe('getApiErrorMessage', () => {
  it('returns error.message from nested payload', () => {
    const error = new axios.AxiosError('fail', '400', undefined, undefined, {
      status: 400,
      data: { error: { message: 'Invalid email' } },
      statusText: 'Bad Request',
      headers: {},
      config: { headers: {} } as never
    })
    expect(getApiErrorMessage(error, 'fallback')).toBe('Invalid email')
  })

  it('returns payload.message when no nested error', () => {
    const error = new axios.AxiosError('fail', '400', undefined, undefined, {
      status: 400,
      data: { message: 'Bad request body' },
      statusText: 'Bad Request',
      headers: {},
      config: { headers: {} } as never
    })
    expect(getApiErrorMessage(error, 'fallback')).toBe('Bad request body')
  })

  it('returns fallback for non-axios errors', () => {
    expect(getApiErrorMessage(new Error('oops'), 'Something went wrong')).toBe(
      'Something went wrong'
    )
  })

  it('returns axios error.message when payload has no message fields', () => {
    const error = new axios.AxiosError('Request timeout', 'ECONNABORTED', undefined, undefined, {
      status: 500,
      data: {},
      statusText: 'Internal Server Error',
      headers: {},
      config: { headers: {} } as never
    })
    expect(getApiErrorMessage(error, 'fallback')).toBe('Request timeout')
  })

  it('returns axios error message when response data is a non-object string', () => {
    const error = new axios.AxiosError('fail', '502', undefined, undefined, {
      status: 502,
      data: '<html><body>Bad Gateway</body></html>',
      statusText: 'Bad Gateway',
      headers: {},
      config: { headers: {} } as never
    })
    expect(getApiErrorMessage(error, 'Server error')).toBe('fail')
  })

  it('returns fallback when response data is null', () => {
    const error = new axios.AxiosError('fail', '500', undefined, undefined, {
      status: 500,
      data: null,
      statusText: 'Internal Server Error',
      headers: {},
      config: { headers: {} } as never
    })
    expect(getApiErrorMessage(error, 'Server error')).toBe('fail')
  })

  it('returns fallback when error.message is empty and response data is non-JSON', () => {
    const error = new axios.AxiosError('', '502', undefined, undefined, {
      status: 502,
      data: '<html>Bad Gateway</html>',
      statusText: 'Bad Gateway',
      headers: {},
      config: { headers: {} } as never
    })
    expect(getApiErrorMessage(error, 'Server error')).toBe('Server error')
  })
})
