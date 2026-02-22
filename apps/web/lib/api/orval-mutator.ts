import type { AxiosError, AxiosRequestConfig } from 'axios'
import { api } from '../axios'

export type ErrorType<Error> = AxiosError<Error>
type CancelablePromise<T> = Promise<T> & { cancel: () => void }

export const customInstance = async <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig
): Promise<T> => {
  const controller = new AbortController()
  const mergedConfig: AxiosRequestConfig = {
    ...options,
    ...config,
    headers: {
      ...options?.headers,
      ...config.headers
    },
    signal: controller.signal
  }

  const promise = (async (): Promise<T> => {
    const { data } = await api<T>(mergedConfig)
    return data
  })() as CancelablePromise<T>

  promise.cancel = () => {
    controller.abort()
  }

  return promise
}

export default customInstance
