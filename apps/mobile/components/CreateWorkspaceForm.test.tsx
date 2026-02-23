import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import { CreateWorkspaceForm } from './CreateWorkspaceForm'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

vi.mock('../lib/client-api', () => ({
  clientApi: {
    createWorkspace: vi.fn()
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

describe('CreateWorkspaceForm', () => {
  it('renders heading and name input', () => {
    const tree = create(<CreateWorkspaceForm />)
    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()
    expect(labels).toContain('Create Workspace')

    const inputs = findByType(tree.root, 'TextInput')
    expect(inputs.some((i) => i.props.placeholder === 'Growth Experiments')).toBe(true)
  })

  it('disables button when name is too short', () => {
    const tree = create(<CreateWorkspaceForm />)
    const button = findByType(tree.root, 'TouchableOpacity')[0]
    expect(button.props.disabled).toBe(true)
  })

  it('disables button with a single-character name', async () => {
    const tree = create(<CreateWorkspaceForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('A')
    })

    const button = findByType(tree.root, 'TouchableOpacity')[0]
    expect(button.props.disabled).toBe(true)
  })

  it('enables button with a two-character name', async () => {
    const tree = create(<CreateWorkspaceForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('AB')
    })

    const button = findByType(tree.root, 'TouchableOpacity')[0]
    expect(button.props.disabled).toBe(false)
  })

  it('calls createWorkspace and onCreated on success', async () => {
    const workspace = { id: 'w-1', name: 'Test', ownerUserId: 'u-1' }
    ;(clientApi.createWorkspace as Mock).mockResolvedValue(workspace)
    const onCreated = vi.fn()

    const tree = create(<CreateWorkspaceForm onCreated={onCreated} />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('Test Workspace')
    })

    const button = findByType(tree.root, 'TouchableOpacity')[0]
    await act(async () => {
      button.props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.createWorkspace).toHaveBeenCalledWith({ name: 'Test Workspace' })
    expect(notify.success).toHaveBeenCalledWith('Workspace created')
    expect(onCreated).toHaveBeenCalled()
  })

  it('clears name input after successful creation', async () => {
    ;(clientApi.createWorkspace as Mock).mockResolvedValue({ id: 'w-1', name: 'X', ownerUserId: 'u-1' })

    const tree = create(<CreateWorkspaceForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('New Workspace')
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
    ;(clientApi.createWorkspace as Mock).mockImplementation(
      () => new Promise((r) => { resolveCreate = r })
    )

    const tree = create(<CreateWorkspaceForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('Test Workspace')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    // Second press while pending should be ignored
    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      resolveCreate({ id: 'w-1', name: 'Test Workspace', ownerUserId: 'u-1' })
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.createWorkspace).toHaveBeenCalledTimes(1)
  })

  it('shows error on failure', async () => {
    ;(clientApi.createWorkspace as Mock).mockRejectedValue(new Error('Name taken'))

    const tree = create(<CreateWorkspaceForm />)
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
    expect(labels).toContain('Create workspace')
  })
})
