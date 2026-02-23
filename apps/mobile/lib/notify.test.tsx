import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'react-test-renderer'
import Toast from 'react-native-toast-message'
import { notify, NotifyToaster } from './notify'

vi.mock('react-native-toast-message', () => {
  const MockToast = () => 'Toast'
  return {
    default: Object.assign(MockToast, {
      show: vi.fn()
    })
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notify', () => {
  it('success calls Toast.show with type success', () => {
    notify.success('Done')
    expect(Toast.show).toHaveBeenCalledWith({ type: 'success', text1: 'Done' })
  })

  it('error calls Toast.show with type error', () => {
    notify.error('Oops')
    expect(Toast.show).toHaveBeenCalledWith({ type: 'error', text1: 'Oops' })
  })

  it('info calls Toast.show with type info', () => {
    notify.info('FYI')
    expect(Toast.show).toHaveBeenCalledWith({ type: 'info', text1: 'FYI' })
  })
})

describe('NotifyToaster', () => {
  it('renders without crashing', () => {
    const tree = create(<NotifyToaster />)
    expect(tree.toJSON()).toBeTruthy()
  })
})
