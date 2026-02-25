import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import { CreateOrganizationForm } from './CreateOrganizationForm'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

vi.mock('../lib/client-api', () => ({
  clientApi: {
    createOrganization: vi.fn()
  }
}))

vi.mock('../lib/notify', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const findByType = (root: ReturnType<typeof create>['root'], type: string) =>
  root.findAllByType(type as never)

describe('CreateOrganizationForm', () => {
  it('renders heading and name input', () => {
    const tree = create(<CreateOrganizationForm />)
    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()
    expect(labels).toContain('Create Organization')

    const inputs = findByType(tree.root, 'TextInput')
    expect(inputs.some((i) => i.props.placeholder === 'Growth Experiments')).toBe(true)
  })

  it('disables button when name is too short', () => {
    const tree = create(<CreateOrganizationForm />)
    const button = findByType(tree.root, 'TouchableOpacity')[0]
    expect(button.props.disabled).toBe(true)
  })

  it('disables button with a single-character name', async () => {
    const tree = create(<CreateOrganizationForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('A')
    })

    const button = findByType(tree.root, 'TouchableOpacity')[0]
    expect(button.props.disabled).toBe(true)
  })

  it('enables button with a two-character name', async () => {
    const tree = create(<CreateOrganizationForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('AB')
    })

    const button = findByType(tree.root, 'TouchableOpacity')[0]
    expect(button.props.disabled).toBe(false)
  })

  it('calls createOrganization and onCreated on success', async () => {
    const organization = { id: 'o-1', name: 'Test', ownerUserId: 'u-1' }
    ;(clientApi.createOrganization as Mock).mockResolvedValue(organization)
    const onCreated = vi.fn()

    const tree = create(<CreateOrganizationForm onCreated={onCreated} />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('Test Organization')
    })

    const button = findByType(tree.root, 'TouchableOpacity')[0]
    await act(async () => {
      button.props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.createOrganization).toHaveBeenCalledWith({ name: 'Test Organization' })
    expect(notify.success).toHaveBeenCalledWith('Organization created')
    expect(onCreated).toHaveBeenCalled()
  })

  it('clears name input after successful creation', async () => {
    ;(clientApi.createOrganization as Mock).mockResolvedValue({ id: 'o-1', name: 'X', ownerUserId: 'u-1' })

    const tree = create(<CreateOrganizationForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('New Organization')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    // After success, the input value should be cleared
    const updatedInput = findByType(tree.root, 'TextInput')[0]
    expect(updatedInput.props.value).toBe('')
  })

  it('prevents double-submit while pending', async () => {
    let resolveCreate!: (v: unknown) => void
    ;(clientApi.createOrganization as Mock).mockImplementation(
      () => new Promise((r) => { resolveCreate = r })
    )

    const tree = create(<CreateOrganizationForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('Test Organization')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    // Second press while pending should be ignored
    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      resolveCreate({ id: 'o-1', name: 'Test Organization', ownerUserId: 'u-1' })
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.createOrganization).toHaveBeenCalledTimes(1)
  })

  it('shows error on failure', async () => {
    ;(clientApi.createOrganization as Mock).mockRejectedValue(new Error('Name taken'))

    const tree = create(<CreateOrganizationForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('Taken Name')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(notify.error).toHaveBeenCalledWith('Name taken')

    // Button should be re-enabled
    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()
    expect(labels).toContain('Create organization')
  })
})
