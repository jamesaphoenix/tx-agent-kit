// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PermissionsGate } from './PermissionsGate'

const { useHasPermissionMock, useHasAnyPermissionMock } = vi.hoisted(() => ({
  useHasPermissionMock: vi.fn<(permission: string) => boolean>(),
  useHasAnyPermissionMock: vi.fn<(permissions: ReadonlyArray<string>) => boolean>()
}))

vi.mock('@/hooks/use-permissions', () => ({
  useHasPermission: useHasPermissionMock,
  useHasAnyPermission: useHasAnyPermissionMock
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PermissionsGate', () => {
  it('renders children when required permission is granted', () => {
    useHasPermissionMock.mockReturnValue(true)
    useHasAnyPermissionMock.mockReturnValue(true)

    render(
      <PermissionsGate permission="manage_billing" fallback={<span>no-access</span>}>
        <span>billing-settings</span>
      </PermissionsGate>
    )

    expect(screen.queryByText('billing-settings')).not.toBeNull()
    expect(screen.queryByText('no-access')).toBeNull()
  })

  it('renders fallback when required permission is missing', () => {
    useHasPermissionMock.mockReturnValue(false)
    useHasAnyPermissionMock.mockReturnValue(true)

    render(
      <PermissionsGate permission="manage_billing" fallback={<span>no-access</span>}>
        <span>billing-settings</span>
      </PermissionsGate>
    )

    expect(screen.queryByText('billing-settings')).toBeNull()
    expect(screen.queryByText('no-access')).not.toBeNull()
  })

  it('renders fallback when any-of permissions are missing', () => {
    useHasPermissionMock.mockReturnValue(true)
    useHasAnyPermissionMock.mockReturnValue(false)

    render(
      <PermissionsGate permissions={['manage_billing', 'manage_api_keys']} fallback={<span>no-access</span>}>
        <span>billing-settings</span>
      </PermissionsGate>
    )

    expect(screen.queryByText('billing-settings')).toBeNull()
    expect(screen.queryByText('no-access')).not.toBeNull()
  })
})
