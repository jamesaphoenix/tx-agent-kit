'use client'

import type { ReactElement } from 'react'
import { Toaster as SonnerToaster, toast } from 'sonner'

export interface NotifyPromiseMessages {
  loading: string
  success: string
  error: string
}

export const notify = {
  success: (message: string): void => {
    toast.success(message)
  },

  error: (message: string): void => {
    toast.error(message)
  },

  info: (message: string): void => {
    toast.info(message)
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
      closeButton
      toastOptions={{
        duration: 4500
      }}
    />
  )
}
