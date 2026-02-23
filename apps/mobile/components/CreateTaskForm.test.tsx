import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import { CreateTaskForm } from './CreateTaskForm'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

vi.mock('../lib/client-api', () => ({
  clientApi: {
    createTask: vi.fn()
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

describe('CreateTaskForm', () => {
  it('renders title input, description input, and button', () => {
    const tree = create(<CreateTaskForm workspaceId="w-1" />)
    const inputs = findByType(tree.root, 'TextInput')

    expect(inputs.some((i) => i.props.placeholder === 'Ship invitation acceptance flow')).toBe(true)
    expect(inputs.some((i) => i.props.placeholder === 'Optional context')).toBe(true)

    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()
    expect(labels).toContain('Create Task')
  })

  it('disables button when title is empty', () => {
    const tree = create(<CreateTaskForm workspaceId="w-1" />)
    const button = findByType(tree.root, 'TouchableOpacity')[0]
    expect(button.props.disabled).toBe(true)
  })

  it('calls createTask with workspaceId, title, and optional description', async () => {
    const task = { id: 't-1', title: 'Test', workspaceId: 'w-1', status: 'pending' }
    ;(clientApi.createTask as Mock).mockResolvedValue(task)
    const onCreated = vi.fn()

    const tree = create(<CreateTaskForm workspaceId="w-1" onCreated={onCreated} />)
    const inputs = findByType(tree.root, 'TextInput')
    const titleInput = inputs.find((i) => i.props.placeholder === 'Ship invitation acceptance flow')!
    const descInput = inputs.find((i) => i.props.placeholder === 'Optional context')!

    await act(async () => {
      titleInput.props.onChangeText('Build auth flow')
      descInput.props.onChangeText('Need OAuth support')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.createTask).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      title: 'Build auth flow',
      description: 'Need OAuth support'
    })
    expect(notify.success).toHaveBeenCalledWith('Task created')
    expect(onCreated).toHaveBeenCalled()
  })

  it('omits description when empty', async () => {
    ;(clientApi.createTask as Mock).mockResolvedValue({ id: 't-1', title: 'X', workspaceId: 'w-1', status: 'pending' })

    const tree = create(<CreateTaskForm workspaceId="w-1" />)
    const inputs = findByType(tree.root, 'TextInput')
    const titleInput = inputs.find((i) => i.props.placeholder === 'Ship invitation acceptance flow')!

    await act(async () => {
      titleInput.props.onChangeText('Quick task')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.createTask).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      title: 'Quick task',
      description: undefined
    })
  })

  it('clears inputs after successful creation', async () => {
    ;(clientApi.createTask as Mock).mockResolvedValue({ id: 't-1', title: 'X', workspaceId: 'w-1', status: 'pending' })

    const tree = create(<CreateTaskForm workspaceId="w-1" />)
    const inputs = findByType(tree.root, 'TextInput')

    await act(async () => {
      inputs.find((i) => i.props.placeholder === 'Ship invitation acceptance flow')!.props.onChangeText('Test')
      inputs.find((i) => i.props.placeholder === 'Optional context')!.props.onChangeText('Context')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const updatedInputs = findByType(tree.root, 'TextInput')
    expect(updatedInputs[0].props.value).toBe('')
    expect(updatedInputs[1].props.value).toBe('')
  })

  it('prevents double-submit while pending', async () => {
    let resolveCreate!: (v: unknown) => void
    ;(clientApi.createTask as Mock).mockImplementation(
      () => new Promise((r) => { resolveCreate = r })
    )

    const tree = create(<CreateTaskForm workspaceId="w-1" />)
    const titleInput = findByType(tree.root, 'TextInput').find(
      (i) => i.props.placeholder === 'Ship invitation acceptance flow'
    )!

    await act(async () => {
      titleInput.props.onChangeText('Task')
    })

    // First press starts the request
    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    // Second press while pending should be ignored
    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    // Resolve the pending request
    await act(async () => {
      resolveCreate({ id: 't-1', title: 'Task', workspaceId: 'w-1', status: 'pending' })
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.createTask).toHaveBeenCalledTimes(1)
  })

  it('shows error on failure and resets pending', async () => {
    ;(clientApi.createTask as Mock).mockRejectedValue(new Error('Limit reached'))

    const tree = create(<CreateTaskForm workspaceId="w-1" />)
    const titleInput = findByType(tree.root, 'TextInput').find(
      (i) => i.props.placeholder === 'Ship invitation acceptance flow'
    )!

    await act(async () => {
      titleInput.props.onChangeText('Test')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(notify.error).toHaveBeenCalledWith('Limit reached')

    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()
    expect(labels).toContain('Create task')
  })
})
