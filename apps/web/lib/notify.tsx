'use client'

import type { ReactElement } from 'react'
import { Toaster as SonnerToaster, toast } from 'sonner'
import { getApiErrorMessage } from './axios'

export interface NotifyPromiseMessages {
  loading: string
  success: string
  error: string
}

export interface NotifyOptions {
  id?: number | string
}

export const notify = {
  success: (message: string, options?: NotifyOptions): void => {
    toast.success(message, options)
  },

  error: (message: string, options?: NotifyOptions): void => {
    toast.error(message, options)
  },

  apiError: (error: unknown, fallback: string, options?: NotifyOptions): string => {
    const message = getApiErrorMessage(error, fallback)
    toast.error(message, options)
    return message
  },

  info: (message: string, options?: NotifyOptions): void => {
    toast.info(message, options)
  },

  promise: <T,>(promise: Promise<T>, messages: NotifyPromiseMessages): Promise<T> => {
    toast.promise(promise, messages)
    return promise
  }
}

export const NotifyToaster = (): ReactElement => {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton={false}
      toastOptions={{
        duration: 4500
      }}
    />
  )
}
