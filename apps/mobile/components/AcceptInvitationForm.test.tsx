import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import { AcceptInvitationForm } from './AcceptInvitationForm'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

vi.mock('../lib/client-api', () => ({
  clientApi: {
    acceptInvitation: vi.fn()
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

describe('AcceptInvitationForm', () => {
  it('renders token input and accept button', () => {
    const tree = create(<AcceptInvitationForm />)
    const inputs = findByType(tree.root, 'TextInput')
    expect(inputs.some((i) => i.props.placeholder === 'Paste invitation token')).toBe(true)

    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()
    expect(labels).toContain('Accept invitation')
  })

  it('disables button when token is empty', () => {
    const tree = create(<AcceptInvitationForm />)
    const button = findByType(tree.root, 'TouchableOpacity')[0]
    expect(button.props.disabled).toBe(true)
  })

  it('calls acceptInvitation with token and calls onAccepted', async () => {
    ;(clientApi.acceptInvitation as Mock).mockResolvedValue({ accepted: true })
    const onAccepted = vi.fn()

    const tree = create(<AcceptInvitationForm onAccepted={onAccepted} />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('inv-token-123')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.acceptInvitation).toHaveBeenCalledWith('inv-token-123')
    expect(notify.success).toHaveBeenCalledWith('Invitation accepted')
    expect(onAccepted).toHaveBeenCalled()
  })

  it('clears token and shows success message after acceptance', async () => {
    ;(clientApi.acceptInvitation as Mock).mockResolvedValue({ accepted: true })

    const tree = create(<AcceptInvitationForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('my-token')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const updatedInput = findByType(tree.root, 'TextInput')[0]
    expect(updatedInput.props.value).toBe('')

    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()
    expect(labels).toContain('Invitation accepted successfully')
  })

  it('prevents double-submit while pending', async () => {
    let resolveAccept!: (v: unknown) => void
    ;(clientApi.acceptInvitation as Mock).mockImplementation(
      () => new Promise((r) => { resolveAccept = r })
    )

    const tree = create(<AcceptInvitationForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('inv-token-123')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    // Second press while pending should be ignored
    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      resolveAccept({ accepted: true })
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.acceptInvitation).toHaveBeenCalledTimes(1)
  })

  it('shows error on failure and resets pending', async () => {
    ;(clientApi.acceptInvitation as Mock).mockRejectedValue(new Error('Token expired'))

    const tree = create(<AcceptInvitationForm />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input.props.onChangeText('bad-token')
    })

    await act(async () => {
      findByType(tree.root, 'TouchableOpacity')[0].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(notify.error).toHaveBeenCalledWith('Token expired')

    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()
    expect(labels).toContain('Accept invitation')
  })
})
