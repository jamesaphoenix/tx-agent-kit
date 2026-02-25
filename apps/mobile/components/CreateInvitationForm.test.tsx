import React from 'react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { create, act } from 'react-test-renderer'
import { CreateInvitationForm } from './CreateInvitationForm'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

vi.mock('../lib/client-api', () => ({
  clientApi: {
    createInvitation: vi.fn()
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

const organizations = [
  { id: 'o-1', name: 'Alpha' },
  { id: 'o-2', name: 'Beta' }
]

describe('CreateInvitationForm', () => {
  it('renders organization chips, email input, role chips, and send button', () => {
    const tree = create(<CreateInvitationForm organizations={organizations} />)
    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()

    expect(labels).toContain('Invite teammate')
    expect(labels).toContain('Alpha')
    expect(labels).toContain('Beta')
    expect(labels).toContain('Member')
    expect(labels).toContain('Admin')
    expect(labels).toContain('Send invitation')
  })

  it('disables button when email is empty', () => {
    const tree = create(<CreateInvitationForm organizations={organizations} />)
    const buttons = findByType(tree.root, 'TouchableOpacity')
    // The last TouchableOpacity is the submit button
    const submitButton = buttons[buttons.length - 1]
    expect(submitButton.props.disabled).toBe(true)
  })

  it('calls createInvitation with first organization and member role by default', async () => {
    const invitation = { id: 'inv-1', email: 'peer@co.com', role: 'member', status: 'pending', organizationId: 'o-1' }
    ;(clientApi.createInvitation as Mock).mockResolvedValue(invitation)
    const onCreated = vi.fn()

    const tree = create(<CreateInvitationForm organizations={organizations} onCreated={onCreated} />)
    const emailInput = findByType(tree.root, 'TextInput').find(
      (i) => i.props.placeholder === 'teammate@company.com'
    )!

    await act(async () => {
      emailInput.props.onChangeText('peer@co.com')
    })

    const buttons = findByType(tree.root, 'TouchableOpacity')
    const submitButton = buttons[buttons.length - 1]

    await act(async () => {
      submitButton.props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.createInvitation).toHaveBeenCalledWith({
      organizationId: 'o-1',
      email: 'peer@co.com',
      role: 'member'
    })
    expect(notify.success).toHaveBeenCalledWith('Invitation sent')
    expect(onCreated).toHaveBeenCalled()
  })

  it('selects admin role when admin chip is pressed', async () => {
    ;(clientApi.createInvitation as Mock).mockResolvedValue({ id: 'inv-1' })

    const tree = create(<CreateInvitationForm organizations={organizations} />)
    const emailInput = findByType(tree.root, 'TextInput').find(
      (i) => i.props.placeholder === 'teammate@company.com'
    )!

    // Find the Admin chip — it's a TouchableOpacity containing Text with "Admin"
    const allButtons = findByType(tree.root, 'TouchableOpacity')
    const adminChip = allButtons.find((btn) => {
      const childTexts = findByType(btn, 'Text')
      return childTexts.some((t) => t.props.children === 'Admin')
    })!

    await act(async () => {
      emailInput.props.onChangeText('admin@co.com')
      adminChip.props.onPress()
    })

    const buttons = findByType(tree.root, 'TouchableOpacity')
    const submitButton = buttons[buttons.length - 1]

    await act(async () => {
      submitButton.props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' })
    )
  })

  it('shows error when no organizations exist', async () => {
    const tree = create(<CreateInvitationForm organizations={[]} />)
    const emailInput = findByType(tree.root, 'TextInput').find(
      (i) => i.props.placeholder === 'teammate@company.com'
    )!

    await act(async () => {
      emailInput.props.onChangeText('peer@co.com')
    })

    const buttons = findByType(tree.root, 'TouchableOpacity')
    const submitButton = buttons[buttons.length - 1]

    await act(async () => {
      submitButton.props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.createInvitation).not.toHaveBeenCalled()
    expect(notify.error).toHaveBeenCalledWith('Create an organization first')
  })

  it('clears email after successful invitation', async () => {
    ;(clientApi.createInvitation as Mock).mockResolvedValue({ id: 'inv-1' })

    const tree = create(<CreateInvitationForm organizations={organizations} />)
    const emailInput = findByType(tree.root, 'TextInput').find(
      (i) => i.props.placeholder === 'teammate@company.com'
    )!

    await act(async () => {
      emailInput.props.onChangeText('peer@co.com')
    })

    const buttons = findByType(tree.root, 'TouchableOpacity')
    await act(async () => {
      buttons[buttons.length - 1].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    const updatedEmailInput = findByType(tree.root, 'TextInput').find(
      (i) => i.props.placeholder === 'teammate@company.com'
    )!
    expect(updatedEmailInput.props.value).toBe('')
  })

  it('prevents double-submit while pending', async () => {
    let resolveCreate!: (v: unknown) => void
    ;(clientApi.createInvitation as Mock).mockImplementation(
      () => new Promise((r) => { resolveCreate = r })
    )

    const tree = create(<CreateInvitationForm organizations={organizations} />)
    const emailInput = findByType(tree.root, 'TextInput').find(
      (i) => i.props.placeholder === 'teammate@company.com'
    )!

    await act(async () => {
      emailInput.props.onChangeText('peer@co.com')
    })

    const buttons = findByType(tree.root, 'TouchableOpacity')
    const submitButton = buttons[buttons.length - 1]

    await act(async () => {
      submitButton.props.onPress()
    })

    // Second press while pending should be ignored
    await act(async () => {
      const btns = findByType(tree.root, 'TouchableOpacity')
      btns[btns.length - 1].props.onPress()
    })

    await act(async () => {
      resolveCreate({ id: 'inv-1' })
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(clientApi.createInvitation).toHaveBeenCalledTimes(1)
  })

  it('resets organization selection when organizations prop changes', async () => {
    ;(clientApi.createInvitation as Mock).mockResolvedValue({ id: 'inv-1' })

    const tree = create(<CreateInvitationForm organizations={organizations} />)

    // Select the second organization (Beta)
    const allButtons = findByType(tree.root, 'TouchableOpacity')
    const betaChip = allButtons.find((btn) => {
      const childTexts = findByType(btn, 'Text')
      return childTexts.some((t) => t.props.children === 'Beta')
    })!

    await act(async () => {
      betaChip.props.onPress()
    })

    // Re-render with a new organizations array
    const updatedOrganizations = [
      { id: 'o-3', name: 'Gamma' },
      { id: 'o-4', name: 'Delta' }
    ]

    await act(async () => {
      tree.update(<CreateInvitationForm organizations={updatedOrganizations} />)
    })

    // Fill email and submit
    const emailInput = findByType(tree.root, 'TextInput').find(
      (i) => i.props.placeholder === 'teammate@company.com'
    )!

    await act(async () => {
      emailInput.props.onChangeText('peer@co.com')
    })

    const buttons = findByType(tree.root, 'TouchableOpacity')
    await act(async () => {
      buttons[buttons.length - 1].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    // Should use the first organization from the updated array (Gamma / o-3)
    expect(clientApi.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'o-3' })
    )
  })

  it('shows error on API failure and resets pending', async () => {
    ;(clientApi.createInvitation as Mock).mockRejectedValue(new Error('Already invited'))

    const tree = create(<CreateInvitationForm organizations={organizations} />)
    const emailInput = findByType(tree.root, 'TextInput').find(
      (i) => i.props.placeholder === 'teammate@company.com'
    )!

    await act(async () => {
      emailInput.props.onChangeText('dup@co.com')
    })

    const buttons = findByType(tree.root, 'TouchableOpacity')
    await act(async () => {
      buttons[buttons.length - 1].props.onPress()
    })

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(notify.error).toHaveBeenCalledWith('Already invited')

    const texts = findByType(tree.root, 'Text')
    const labels = texts.map((t) => t.props.children).flat()
    expect(labels).toContain('Send invitation')
  })
})
