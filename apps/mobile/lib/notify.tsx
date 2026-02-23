import type { ReactElement } from 'react'
import Toast from 'react-native-toast-message'

export const notify = {
  success: (message: string): void => {
    Toast.show({ type: 'success', text1: message })
  },

  error: (message: string): void => {
    Toast.show({ type: 'error', text1: message })
  },

  info: (message: string): void => {
    Toast.show({ type: 'info', text1: message })
  }
}

export const NotifyToaster = (): ReactElement => {
  return <Toast />
}
