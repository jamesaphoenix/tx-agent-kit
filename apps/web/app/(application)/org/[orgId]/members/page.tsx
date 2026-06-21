'use client'

import type { InvitationAssignableRole, MembershipType, OrgMemberRole } from '@tx-agent-kit/contracts'
import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import ReactSelect, {
  components as reactSelectComponents,
  type ActionMeta,
  type MultiValue,
  type MultiValueRemoveProps,
  type StylesConfig
} from 'react-select'
import { DashboardShell } from '../../../../../components/DashboardShell'
import { useCurrentPrincipal } from '../../../../../hooks/use-session-store'
import { notify } from '../../../../../lib/notify'
import { isUuid, NIL_UUID } from '../../../../../lib/id-validation'
import {
  useOrganizationsListOrgMembers,
  useOrganizationsListOrgInvitations,
  useOrganizationsUpdateMemberRole,
  useOrganizationsDisableMember,
  useOrganizationsEnableMember,
  useOrganizationsRemoveMember,
  useOrganizationsTransferOwnership,
  useOrganizationsRemoveInvitation,
  getOrganizationsListOrgMembersQueryKey,
  getOrganizationsListOrgInvitationsQueryKey,
  organizationsCreateInvitation,
  organizationsDisableMember,
  organizationsRemoveMember
} from '../../../../../lib/api/generated/organizations/organizations'
import {
  getTeamsListTeamMembersQueryKey,
  teamsAddTeamMember,
  teamsListTeamMembers,
  teamsRemoveTeamMember,
  useTeamsListTeams
} from '../../../../../lib/api/generated/teams/teams'
import type { OrganizationsListOrgMembers200DataItem } from '../../../../../lib/api/generated/schemas/organizationsListOrgMembers200DataItem'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

type Member = OrganizationsListOrgMembers200DataItem
const ALL_WORKSPACES_VALUE = '__all_workspaces__'
const teamMemberListParams = { limit: '100' } as const

interface InviteWorkspaceOption {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly scope: 'all' | 'team'
}

interface TeamMembershipOption {
  readonly value: string
  readonly label: string
}

interface MemberTeamMembership {
  readonly teamId: string
  readonly teamMemberId: string
  readonly name: string
}

const inviteAccessOptions: ReadonlyArray<{
  readonly value: InvitationAssignableRole
  readonly title: string
  readonly description: string
}> = [
  {
    value: 'member',
    title: 'Member',
    description: 'Can view and execute workflows.'
  },
  {
    value: 'admin',
    title: 'Admin',
    description: 'Full access including billing and member management.'
  }
] as const

const inviteMemberTypeOptions: ReadonlyArray<{
  readonly value: MembershipType
  readonly title: string
  readonly description: string
}> = [
  {
    value: 'team',
    title: 'Internal teammate',
    description: 'Normal teammate access with workspace-scoped invites.'
  },
  {
    value: 'client',
    title: 'Client collaborator',
    description: 'Client-facing access for shared workspace content.'
  }
] as const

const inviteWorkspaceSelectStyles: StylesConfig<InviteWorkspaceOption, true> = {
  control: (base, state) => ({
    ...base,
    minHeight: 46,
    borderColor: state.isFocused ? 'var(--ring)' : 'var(--input)',
    boxShadow: state.isFocused ? '0 0 0 2px color-mix(in oklch, var(--ring) 35%, transparent)' : 'none',
    cursor: 'pointer',
    fontSize: '0.875rem'
  }),
  valueContainer: (base) => ({
    ...base,
    gap: '0.25rem',
    padding: '0.25rem 0.5rem'
  }),
  multiValue: (base, state) => ({
    ...base,
    maxWidth: '100%',
    borderRadius: '9999px',
    backgroundColor: state.data.scope === 'all' ? 'var(--primary)' : 'var(--muted)'
  }),
  multiValueLabel: (base, state) => ({
    ...base,
    color: state.data.scope === 'all' ? 'var(--primary-foreground)' : 'var(--foreground)',
    fontSize: '0.75rem',
    fontWeight: 600,
    paddingInline: '0.625rem'
  }),
  multiValueRemove: (base, state) => ({
    ...base,
    borderRadius: '9999px',
    color: state.data.scope === 'all' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
    cursor: 'pointer',
    display: state.data.scope === 'all' ? 'none' : base.display,
    ':hover': {
      backgroundColor: state.data.scope === 'all' ? 'color-mix(in oklch, var(--primary-foreground) 18%, transparent)' : 'var(--destructive)',
      color: state.data.scope === 'all' ? 'var(--primary-foreground)' : 'white'
    }
  }),
  menu: (base) => ({
    ...base,
    border: '1px solid var(--border)',
    boxShadow: '0 18px 40px color-mix(in oklch, var(--foreground) 16%, transparent)',
    overflow: 'hidden',
    zIndex: 1700
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 1700
  }),
  option: (base, state) => {
    let backgroundColor = 'var(--background)'
    if (state.isSelected) {
      backgroundColor = 'var(--primary)'
    } else if (state.isFocused) {
      backgroundColor = 'var(--accent)'
    }

    return {
      ...base,
      backgroundColor,
      color: state.isSelected ? 'var(--primary-foreground)' : 'var(--foreground)',
      cursor: 'pointer',
      padding: '0.7rem 0.85rem'
    }
  }
}

const InviteWorkspaceMultiValueRemove = (
  props: MultiValueRemoveProps<InviteWorkspaceOption, true>
) => {
  if (props.data.scope === 'all') {
    return null
  }

  return (
    <reactSelectComponents.MultiValueRemove
      {...props}
      innerProps={{
        ...props.innerProps,
        'aria-label': `Remove ${props.data.label}`,
        title: `Remove ${props.data.label}`
      }}
    />
  )
}

const memberTeamSelectStyles: StylesConfig<TeamMembershipOption, true> = {
  control: (base, state) => ({
    ...base,
    minHeight: 36,
    borderColor: state.isFocused ? 'var(--ring)' : 'var(--input)',
    boxShadow: state.isFocused ? '0 0 0 2px color-mix(in oklch, var(--ring) 30%, transparent)' : 'none',
    cursor: state.isDisabled ? 'not-allowed' : 'pointer',
    fontSize: '0.8125rem'
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '0.125rem 0.5rem',
    gap: '0.25rem'
  }),
  multiValue: (base) => ({
    ...base,
    borderRadius: '9999px',
    backgroundColor: 'var(--muted)'
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: 'var(--foreground)',
    fontSize: '0.75rem',
    paddingInline: '0.5rem'
  }),
  multiValueRemove: (base) => ({
    ...base,
    borderRadius: '9999px',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: 'var(--destructive)',
      color: 'white'
    }
  }),
  menu: (base) => ({
    ...base,
    border: '1px solid var(--border)',
    boxShadow: '0 18px 40px color-mix(in oklch, var(--foreground) 16%, transparent)',
    overflow: 'hidden',
    zIndex: 1700
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 1700
  }),
  option: (base, state) => {
    let backgroundColor = 'var(--background)'
    if (state.isSelected) {
      backgroundColor = 'var(--primary)'
    } else if (state.isFocused) {
      backgroundColor = 'var(--accent)'
    }

    return {
      ...base,
      cursor: 'pointer',
      fontSize: '0.8125rem',
      backgroundColor,
      color: state.isSelected ? 'var(--primary-foreground)' : 'var(--foreground)'
    }
  }
}

const invitationStatusBadge = (status: string) => {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="border-yellow-500 bg-yellow-50 text-yellow-700">pending</Badge>
    case 'accepted':
      return <Badge variant="outline" className="border-green-500 bg-green-50 text-green-700">accepted</Badge>
    case 'revoked':
      return <Badge variant="outline" className="border-red-500 bg-red-50 text-red-700">revoked</Badge>
    case 'expired':
      return <Badge variant="outline" className="border-gray-400 bg-gray-50 text-gray-500">expired</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

const roleBadgeVariant = (role: OrgMemberRole) => {
  if (role === 'admin') {return 'default' as const}
  if (role === 'member') {return 'secondary' as const}
  return 'outline' as const
}

const TrashIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
)

export default function MembersPage() {
  const params = useParams<{ orgId: string }>()
  const orgId = params.orgId
  const hasValidOrgId = isUuid(orgId)
  const principal = useCurrentPrincipal()
  const queryClient = useQueryClient()

  // ── Queries ──────────────────────────────────────────────────────────
  const membersQuery = useOrganizationsListOrgMembers(orgId, undefined, {
    query: {}
  })
  const invitationsQuery = useOrganizationsListOrgInvitations(
    orgId,
    { 'filter[status]': 'pending' },
    { query: { enabled: !!principal } }
  )
  const teamsQuery = useTeamsListTeams(
    { organizationId: hasValidOrgId ? orgId : NIL_UUID, limit: '100', sortBy: 'name', sortOrder: 'asc' },
    { query: { enabled: hasValidOrgId && !!principal } }
  )

  const members = membersQuery.data?.data ?? []
  const invitations = invitationsQuery.data?.data ?? []
  const teams = teamsQuery.data?.data ?? []
  const loading = membersQuery.isLoading
  const error = membersQuery.error ? 'Failed to load members' : null

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: getOrganizationsListOrgMembersQueryKey(orgId) })
  const invalidateInvitations = () =>
    queryClient.invalidateQueries({ queryKey: getOrganizationsListOrgInvitationsQueryKey(orgId, { 'filter[status]': 'pending' }) })
  const invalidateTeamMemberships = () =>
    Promise.all(
      teams.map((team) =>
        queryClient.invalidateQueries({
          queryKey: getTeamsListTeamMembersQueryKey(team.id, teamMemberListParams)
        })
      )
    )

  // ── Mutations ────────────────────────────────────────────────────────
  const updateRoleMutation = useOrganizationsUpdateMemberRole({
    mutation: {
      onSuccess: () => { void invalidateMembers() },
      onError: (error) => { notify.apiError(error, 'Failed to update role') }
    }
  })

  const disableMutation = useOrganizationsDisableMember({
    mutation: {
      onSuccess: () => { void invalidateMembers() },
      onError: (error) => { notify.apiError(error, 'Failed to disable member') }
    }
  })

  const enableMutation = useOrganizationsEnableMember({
    mutation: {
      onSuccess: () => { void invalidateMembers() },
      onError: (error) => { notify.apiError(error, 'Failed to enable member') }
    }
  })

  const removeMutation = useOrganizationsRemoveMember({
    mutation: {
      onSuccess: () => {
        setRemoveConfirm(null)
        void invalidateMembers()
        void invalidateTeamMemberships()
      },
      onError: (error) => { notify.apiError(error, 'Failed to remove member') }
    }
  })

  const transferMutation = useOrganizationsTransferOwnership({
    mutation: {
      onSuccess: () => {
        setTransferDialogOpen(false)
        setNewOwnerUserId('')
        void invalidateMembers()
      },
      onError: (error) => { notify.apiError(error, 'Failed to transfer ownership') }
    }
  })

  const revokeInvitationMutation = useOrganizationsRemoveInvitation({
    mutation: {
      onSuccess: () => {
        setRevokeConfirmId(null)
        void invalidateInvitations()
      },
      onError: (error) => { notify.apiError(error, 'Failed to revoke invitation') }
    }
  })

  // ── Local UI state ───────────────────────────────────────────────────
  const [guardMessage, setGuardMessage] = useState<string | null>(null)
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [newOwnerUserId, setNewOwnerUserId] = useState('')
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InvitationAssignableRole>('member')
  const [inviteMemberType, setInviteMemberType] = useState<MembershipType>('team')
  const [inviteWorkspaceValues, setInviteWorkspaceValues] = useState<readonly string[]>([ALL_WORKSPACES_VALUE])
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set())
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null)
  const [bulkRemoveConfirm, setBulkRemoveConfirm] = useState(false)
  const [bulkDisabling, setBulkDisabling] = useState(false)
  const [bulkRemoving, setBulkRemoving] = useState(false)
  const [teamMembershipUpdatingUserId, setTeamMembershipUpdatingUserId] = useState<string | null>(null)
  const allWorkspaceOptionDescription = inviteMemberType === 'client'
    ? 'Invite to every current workspace'
    : 'Invite across the whole organization'
  const inviteWorkspaceOptions = useMemo<InviteWorkspaceOption[]>(() => [
    {
      value: ALL_WORKSPACES_VALUE,
      label: 'All workspaces',
      description: allWorkspaceOptionDescription,
      scope: 'all'
    },
    ...teams.map((team) => ({
      value: team.id,
      label: team.name,
      description: 'Add this person to this workspace',
      scope: 'team' as const
    }))
  ], [allWorkspaceOptionDescription, teams])
  const selectedInviteWorkspaceOptions = useMemo(() => {
    const selectedValues = new Set(inviteWorkspaceValues)
    const selectedOptions = inviteWorkspaceOptions.filter((option) => selectedValues.has(option.value))
    return selectedOptions.length > 0 ? selectedOptions : inviteWorkspaceOptions.slice(0, 1)
  }, [inviteWorkspaceOptions, inviteWorkspaceValues])
  const selectedInviteTeamOptions = selectedInviteWorkspaceOptions.filter((option) => option.scope === 'team')
  let inviteWorkspaceSummary = 'All current and future workspaces'
  if (selectedInviteTeamOptions.length > 0) {
    inviteWorkspaceSummary = `${selectedInviteTeamOptions.length} workspace${selectedInviteTeamOptions.length === 1 ? '' : 's'} selected`
  } else if (inviteMemberType === 'client' && teams.length > 0) {
    inviteWorkspaceSummary = `All ${teams.length} current workspace${teams.length === 1 ? '' : 's'}`
  } else if (inviteMemberType === 'client') {
    inviteWorkspaceSummary = 'Create a workspace before inviting clients'
  }
  const resetInviteForm = () => {
    setInviteEmail('')
    setInviteRole('member')
    setInviteMemberType('team')
    setInviteWorkspaceValues([ALL_WORKSPACES_VALUE])
    setInviteError(null)
  }
  const closeInviteDialog = () => {
    setInviteDialogOpen(false)
    resetInviteForm()
  }
  const handleInviteWorkspaceChange = (
    nextOptions: MultiValue<InviteWorkspaceOption>,
    actionMeta: ActionMeta<InviteWorkspaceOption>
  ) => {
    if (inviteError) {
      setInviteError(null)
    }

    if (actionMeta.action === 'select-option' && actionMeta.option?.value === ALL_WORKSPACES_VALUE) {
      setInviteWorkspaceValues([ALL_WORKSPACES_VALUE])
      return
    }

    const selectedTeamValues = nextOptions
      .filter((option) => option.scope === 'team')
      .map((option) => option.value)

    setInviteWorkspaceValues(selectedTeamValues.length > 0 ? selectedTeamValues : [ALL_WORKSPACES_VALUE])
  }
  const memberTeamOptions = useMemo<TeamMembershipOption[]>(
    () => teams.map((team) => ({ value: team.id, label: team.name })),
    [teams]
  )

  // ── Derived state ────────────────────────────────────────────────────
  const currentUserId = principal?.userId
  const currentMember = members.find((m) => m.userId === currentUserId)
  const isAdmin = currentMember?.role === 'admin'
  const adminCount = members.filter((m) => m.role === 'admin' && !m.disabledAt).length
  const isSelf = (member: Member): boolean => member.userId === currentUserId
  const bulkSelectableMembers = members.filter((member) => !isSelf(member))
  const eligibleOwners = members.filter(
    (m) => m.userId !== currentUserId && !m.disabledAt && m.role === 'admin'
  )
  const pendingInvitations = invitations.filter((inv) => inv.status === 'pending')
  const teamNameById = new Map(teams.map((team) => [team.id, team.name]))
  const teamMemberQueries = useQueries({
    queries: teams.map((team) => ({
      queryKey: getTeamsListTeamMembersQueryKey(team.id, teamMemberListParams),
      queryFn: ({ signal }) => teamsListTeamMembers(team.id, teamMemberListParams, undefined, signal),
      enabled: !!principal && isAdmin && members.length > 0
    }))
  })
  const teamMembershipsByUserId = new Map<string, MemberTeamMembership[]>()
  teams.forEach((team, index) => {
    const teamMembers = teamMemberQueries[index]?.data?.data ?? []
    teamMembers.forEach((teamMember) => {
      if (teamMember.disabledAt) {
        return
      }
      const existing = teamMembershipsByUserId.get(teamMember.userId) ?? []
      teamMembershipsByUserId.set(teamMember.userId, [
        ...existing,
        {
          teamId: team.id,
          teamMemberId: teamMember.id,
          name: team.name
        }
      ])
    })
  })
  const teamMembershipsLoading = teamMemberQueries.some((query) => query.isLoading || query.isFetching)

  // ── Handlers ─────────────────────────────────────────────────────────
  const submitInvite = async () => {
    const email = inviteEmail.trim()
    if (!email || inviteSubmitting) {
      return
    }

    setInviteError(null)
    setInviteSubmitting(true)

    const selectedTeamIds = selectedInviteTeamOptions.map((option) => option.value)
    let teamIds = selectedTeamIds
    if (teamIds.length === 0 && inviteMemberType === 'client') {
      teamIds = teams.map((team) => team.id)
    }
    if (inviteMemberType === 'client' && teamIds.length === 0) {
      setInviteError('Create a workspace before inviting a client collaborator')
      setInviteSubmitting(false)
      return
    }
    const invitationTargets: ReadonlyArray<string | undefined> = teamIds.length > 0 ? teamIds : [undefined]

    try {
      const invitationResults = await Promise.allSettled(
        invitationTargets.map((teamId) =>
          organizationsCreateInvitation({
            organizationId: orgId,
            email,
            role: inviteRole,
            teamId,
            membershipType: inviteMemberType
          })
        )
      )
      const successfulInvitationCount = invitationResults.filter((result) => result.status === 'fulfilled').length

      if (successfulInvitationCount === 0) {
        const firstRejectedResult = invitationResults.find((result) => result.status === 'rejected')
        throw firstRejectedResult?.reason
      }

      closeInviteDialog()
      if (successfulInvitationCount === invitationTargets.length) {
        notify.success(
          invitationTargets.length === 1
            ? 'Invitation sent successfully'
            : `${invitationTargets.length} workspace invitations sent successfully`
        )
      } else {
        notify.info(`${successfulInvitationCount} of ${invitationTargets.length} workspace invitations sent. Existing pending invites were skipped.`)
      }
      void invalidateInvitations()
    } catch (error) {
      const message = notify.apiError(error, 'Failed to send invitation')
      setInviteError(message)
    } finally {
      setInviteSubmitting(false)
    }
  }

  const handleRoleChange = (member: Member, newRole: OrgMemberRole) => {
    setGuardMessage(null)
    if (member.role === 'admin' && adminCount <= 1 && newRole !== 'admin') {
      setGuardMessage('Cannot change role: must have at least one admin')
      return
    }
    updateRoleMutation.mutate({
      organizationId: orgId,
      memberId: member.id,
      data: { role: newRole as 'admin' | 'member' }
    })
  }

  const handleBulkDisable = async () => {
    if (bulkDisabling) {return}
    setBulkDisabling(true)
    const targets = members.filter(
      (m) => selectedMemberIds.has(m.id) && m.userId !== currentUserId && !m.disabledAt
    )
    let failCount = 0
    for (const member of targets) {
      try {
        await organizationsDisableMember(orgId, member.id)
      } catch (error) {
        failCount++
        notify.apiError(error, `Failed to disable ${member.userName ?? member.userEmail ?? 'member'}`)
      }
    }
    if (failCount === 0 && targets.length > 0) {
      notify.success(`Disabled ${targets.length} member${targets.length !== 1 ? 's' : ''}`)
    }
    setSelectedMemberIds(new Set())
    setBulkDisabling(false)
    void invalidateMembers()
  }

  const handleBulkRemove = async () => {
    if (bulkRemoving) {return}
    setBulkRemoving(true)
    const selectedCount = selectedMemberIds.size
    const targets = members.filter(
      (m) => selectedMemberIds.has(m.id) && m.userId !== currentUserId
    )
    if (selectedCount > 0 && targets.length === 0) {
      notify.error('You cannot remove yourself from the organization. Transfer ownership or ask another admin to remove you.')
      setBulkRemoveConfirm(false)
      setBulkRemoving(false)
      return
    }

    let failCount = 0
    for (const member of targets) {
      try {
        await organizationsRemoveMember(orgId, member.id)
      } catch (error) {
        failCount++
        notify.apiError(error, `Failed to remove ${member.userName ?? member.userEmail ?? 'member'}`)
      }
    }
    if (failCount === 0 && targets.length > 0) {
      notify.success(`Removed ${targets.length} member${targets.length !== 1 ? 's' : ''}`)
    }
    if (selectedCount > targets.length) {
      notify.info('Your own membership was skipped. Transfer ownership before trying to remove yourself.')
    }
    setSelectedMemberIds(new Set())
    setBulkRemoveConfirm(false)
    setBulkRemoving(false)
    void invalidateMembers()
  }

  const handleMemberTeamsChange = async (
    member: Member,
    selectedOptions: readonly TeamMembershipOption[]
  ) => {
    if (teamMembershipUpdatingUserId) {
      return
    }

    const currentMemberships = teamMembershipsByUserId.get(member.userId) ?? []
    const currentTeamIds = new Set(currentMemberships.map((membership) => membership.teamId))
    const selectedTeamIds = new Set(selectedOptions.map((option) => option.value))

    if (currentMemberships.length > 0 && selectedTeamIds.size === 0) {
      if (isSelf(member)) {
        notify.error('You cannot remove yourself from every workspace from this table.')
        return
      }

      const confirmed = window.confirm('Are you sure you want to delete this person from the organization?')
      if (!confirmed) {
        return
      }

      removeMutation.mutate({ organizationId: orgId, memberId: member.id })
      return
    }

    const teamIdsToAdd = [...selectedTeamIds].filter((teamId) => !currentTeamIds.has(teamId))
    const membershipsToRemove = currentMemberships.filter((membership) => !selectedTeamIds.has(membership.teamId))

    if (teamIdsToAdd.length === 0 && membershipsToRemove.length === 0) {
      return
    }

    setTeamMembershipUpdatingUserId(member.userId)
    try {
      for (const teamId of teamIdsToAdd) {
        await teamsAddTeamMember(teamId, { userId: member.userId })
      }

      for (const membership of membershipsToRemove) {
        await teamsRemoveTeamMember(membership.teamId, membership.teamMemberId)
      }

      notify.success('Workspace access updated')
      void invalidateTeamMemberships()
    } catch (error) {
      notify.apiError(error, 'Failed to update workspace access')
    } finally {
      setTeamMembershipUpdatingUserId(null)
    }
  }

  return (
    <DashboardShell
      title="Organization Members"
      subtitle="Manage members, roles, and access for this organization."
      principalEmail={principal?.email}
      orgId={orgId}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}
      {guardMessage && <p className="text-sm text-destructive">{guardMessage}</p>}

      {loading && members.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}

      {!loading && members.length === 0 && !error && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No members yet.</p>
        </div>
      )}

      {members.length > 0 && (
        <>
        <Card className="overflow-hidden border-border/80 shadow-sm">
        <div className="flex items-center justify-between border-b px-8 py-5">
          <div className="text-sm text-muted-foreground">{members.length} member{members.length !== 1 ? 's' : ''}</div>
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => {
                resetInviteForm()
                setInviteDialogOpen(true)
              }}
            >
              Invite Member
            </Button>
          )}
        </div>
        {isAdmin && selectedMemberIds.size > 0 && (
          <div className="flex items-center gap-2 border-b bg-muted/50 px-8 py-3">
            <span className="text-sm font-medium">{selectedMemberIds.size} selected</span>
            {bulkRemoveConfirm ? (
              <>
                <span className="text-sm text-destructive font-medium">Remove {selectedMemberIds.size} member{selectedMemberIds.size !== 1 ? 's' : ''}?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={bulkRemoving}
                  onClick={() => { void handleBulkRemove() }}
                >
                  {bulkRemoving ? 'Removing...' : 'Confirm Remove'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkRemoving}
                  onClick={() => setBulkRemoveConfirm(false)}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkDisabling}
                  onClick={() => { void handleBulkDisable() }}
                >
                  {bulkDisabling ? 'Disabling...' : 'Disable Selected'}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setBulkRemoveConfirm(true)}
                >
                  Remove Selected
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setSelectedMemberIds(new Set()); setBulkRemoveConfirm(false) }}>
              Clear
            </Button>
          </div>
        )}
        <Table className="[&_td]:px-8 [&_td]:py-5 [&_th]:px-8 [&_th]:py-4">
          <TableHeader className="bg-muted/50">
            <TableRow>
              {isAdmin && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="rounded border-border"
                    aria-label="Select all members"
                    checked={selectedMemberIds.size === bulkSelectableMembers.length && bulkSelectableMembers.length > 0}
                    disabled={bulkSelectableMembers.length === 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedMemberIds(new Set(bulkSelectableMembers.map((member) => member.id)))
                      } else {
                        setSelectedMemberIds(new Set())
                      }
                    }}
                  />
                </TableHead>
              )}
              <TableHead>Member</TableHead>
              <TableHead>Workspaces</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin && <TableHead className="w-[220px] text-center">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const memberTeamMemberships = teamMembershipsByUserId.get(member.userId) ?? []
              const memberTeamIds = new Set(memberTeamMemberships.map((membership) => membership.teamId))
              const selectedTeamOptions = memberTeamOptions.filter((option) => memberTeamIds.has(option.value))
              const visibleTeamMemberships = memberTeamMemberships.slice(0, 3)
              const hiddenTeamCount = Math.max(memberTeamMemberships.length - visibleTeamMemberships.length, 0)
              const memberDisplayName = member.userName ?? member.userEmail ?? 'member'
              const canEditTeams = isAdmin

              return (
                <TableRow
                  key={member.id}
                  data-testid="member-row"
                  className={member.disabledAt ? 'opacity-60' : ''}
                >
                  {isAdmin && (
                    <TableCell className="w-10">
                      <input
                        type="checkbox"
                        className="rounded border-border disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Select ${member.userName ?? member.userEmail ?? 'member'}`}
                        disabled={isSelf(member)}
                        checked={selectedMemberIds.has(member.id)}
                        onChange={(e) => {
                          const next = new Set(selectedMemberIds)
                          if (e.target.checked) {next.add(member.id)}
                          else {next.delete(member.id)}
                          setSelectedMemberIds(next)
                        }}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar size="sm">
                        <AvatarFallback>
                          {(member.userName ?? member.userEmail ?? '?').charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium">{member.userName ?? member.userEmail ?? 'Unknown user'}</span>
                        {member.userName && member.userEmail && (
                          <span className="text-xs text-muted-foreground">{member.userEmail}</span>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="min-w-[240px] max-w-[320px] whitespace-normal">
                    {canEditTeams ? (
                      <ReactSelect<TeamMembershipOption, true>
                        aria-label={`Teams for ${memberDisplayName}`}
                        classNamePrefix="member-team-select"
                        closeMenuOnSelect={false}
                        isClearable
                        isDisabled={
                          teamMembershipsLoading
                          || teamMembershipUpdatingUserId === member.userId
                          || removeMutation.isPending
                        }
                        isMulti
                        menuPlacement="auto"
                        menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                        menuShouldBlockScroll
                        menuShouldScrollIntoView={false}
                        noOptionsMessage={() => 'No workspaces'}
                        onChange={(nextOptions: MultiValue<TeamMembershipOption>) => {
                          void handleMemberTeamsChange(member, nextOptions)
                        }}
                        options={memberTeamOptions}
                        placeholder={teamMembershipsLoading ? 'Loading...' : 'Select workspaces...'}
                        styles={memberTeamSelectStyles}
                        value={selectedTeamOptions}
                      />
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {teamMembershipsLoading ? (
                          <span className="text-xs text-muted-foreground">Loading...</span>
                        ) : null}
                        {!teamMembershipsLoading && visibleTeamMemberships.length > 0 ? (
                          <>
                            {visibleTeamMemberships.map((membership) => (
                              <Badge key={membership.teamId} variant="outline" className="max-w-[10rem] truncate">
                                {membership.name}
                              </Badge>
                            ))}
                            {hiddenTeamCount > 0 ? (
                              <Badge variant="secondary">+{hiddenTeamCount}</Badge>
                            ) : null}
                          </>
                        ) : null}
                        {!teamMembershipsLoading && visibleTeamMemberships.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No workspace access</span>
                        ) : null}
                      </div>
                    )}
                    {canEditTeams && memberTeamMemberships.length > 0 && !teamMembershipsLoading ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {isSelf(member)
                          ? 'You can remove individual workspaces; your last workspace is protected here.'
                          : 'Removing the last workspace prompts organization removal.'}
                      </p>
                    ) : null}
                  </TableCell>

                <TableCell>
                  {isAdmin && !isSelf(member) ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) => {
                        if (value) { handleRoleChange(member, value as OrgMemberRole) }
                      }}
                    >
                      <SelectTrigger size="sm" data-testid="role-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="member">member</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant={roleBadgeVariant(member.role)}>{member.role}</Badge>
                  )}
                </TableCell>

                <TableCell>
                  {member.disabledAt ? (
                    <Badge variant="default" className="bg-gray-500 text-white">disabled</Badge>
                  ) : (
                    <Badge variant="default" className="bg-green-600 text-white">active</Badge>
                  )}
                </TableCell>

                {isAdmin && (
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      {!isSelf(member) && (
                        <>
                          {member.disabledAt ? (
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid="enable-member-button"
                              aria-label="Enable member"
                              disabled={enableMutation.isPending}
                              onClick={() => enableMutation.mutate({ organizationId: orgId, memberId: member.id })}
                            >
                              {enableMutation.isPending ? 'Enabling...' : 'Enable'}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid="disable-member-button"
                              aria-label="Disable member"
                              disabled={disableMutation.isPending}
                              onClick={() => disableMutation.mutate({ organizationId: orgId, memberId: member.id })}
                            >
                              {disableMutation.isPending ? 'Disabling...' : 'Disable'}
                            </Button>
                          )}
                          {removeConfirm === member.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">Are you sure?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={removeMutation.isPending}
                                onClick={() => removeMutation.mutate({ organizationId: orgId, memberId: member.id })}
                              >
                                {removeMutation.isPending ? 'Removing...' : 'Confirm'}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={removeMutation.isPending}
                                onClick={() => setRemoveConfirm(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              data-testid="remove-member-button"
                              aria-label={`Remove ${member.userName ?? member.userEmail ?? 'member'}`}
                              title="Remove member"
                              onClick={() => setRemoveConfirm(member.id)}
                            >
                              <TrashIcon />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {isAdmin && (
          <div className="flex items-center border-t px-8 py-5">
            <Button variant="outline" size="sm" onClick={() => setTransferDialogOpen(true)}>
              Transfer Ownership
            </Button>
          </div>
        )}
        </Card>
        </>
      )}


      {pendingInvitations.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-base font-semibold">Pending Invitations</h2>
          <Card className="overflow-hidden border-border/80 shadow-sm">
            <Table className="[&_td]:px-8 [&_td]:py-5 [&_th]:px-8 [&_th]:py-4">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead className="w-[160px] text-center">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations.map((invitation) => (
                  <TableRow key={invitation.id} data-testid="invitation-row">
                    <TableCell className="font-medium">{invitation.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {invitation.teamId ? (teamNameById.get(invitation.teamId) ?? 'Assigned workspace') : 'All workspaces'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={invitation.membershipType === 'client' ? 'secondary' : 'outline'}>
                        {invitation.membershipType === 'client' ? 'client' : 'team'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={roleBadgeVariant(invitation.role)}>{invitation.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {invitationStatusBadge(invitation.status)}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-center">
                        {revokeConfirmId === invitation.id ? (
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-sm text-muted-foreground">Revoke?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={revokeInvitationMutation.isPending}
                              onClick={() => revokeInvitationMutation.mutate({ invitationId: invitation.id })}
                            >
                              {revokeInvitationMutation.isPending ? 'Revoking...' : 'Confirm'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={revokeInvitationMutation.isPending}
                              onClick={() => setRevokeConfirmId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            aria-label="Revoke invitation"
                            onClick={() => setRevokeConfirmId(invitation.id)}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {isAdmin && (
        <>
          <Dialog
            open={transferDialogOpen}
            onOpenChange={(open: boolean) => {
              if (!open) {
                setTransferDialogOpen(false)
                setNewOwnerUserId('')
              }
            }}
          >
            <DialogContent aria-label="Transfer ownership">
              <DialogHeader>
                <DialogTitle>Transfer Ownership</DialogTitle>
                <DialogDescription>
                  Select a member to transfer organization ownership to. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 py-2">
                <Label htmlFor="new-owner-select">New owner</Label>
                <Select
                  value={newOwnerUserId}
                  onValueChange={(value) => setNewOwnerUserId(value)}
                >
                  <SelectTrigger id="new-owner-select" aria-label="New owner">
                    <SelectValue>{newOwnerUserId ? undefined : 'Select a member'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleOwners.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.userName ?? m.userEmail ?? m.userId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setTransferDialogOpen(false)
                    setNewOwnerUserId('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => transferMutation.mutate({
                    organizationId: orgId,
                    data: { newOwnerUserId }
                  })}
                  disabled={!newOwnerUserId || transferMutation.isPending}
                >
                  {transferMutation.isPending ? 'Transferring...' : 'Confirm Transfer'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      <Dialog
        open={inviteDialogOpen}
        onOpenChange={(open: boolean) => {
          if (!open) {
            closeInviteDialog()
          } else {
            setInviteDialogOpen(true)
          }
        }}
      >
        <DialogContent
          aria-label="Invite member"
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[960px]"
        >
          <DialogHeader>
            <DialogTitle>Invite Member</DialogTitle>
            <DialogDescription>
              Send an invitation to a new teammate with the right level of access from the start.
            </DialogDescription>
          </DialogHeader>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              void submitInvite()
            }}
          >
          <div className="grid min-w-0 gap-5 py-2 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
              <div>
                <h3 className="text-sm font-semibold">Who and where</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Invite across every workspace, or pick one or more specific workspaces.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="member@example.com"
                  value={inviteEmail}
                  onChange={(e) => {
                    setInviteEmail(e.target.value)
                    if (inviteError) {
                      setInviteError(null)
                    }
                  }}
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-workspace-access">Workspace access</Label>
                <ReactSelect<InviteWorkspaceOption, true>
                  inputId="invite-workspace-access"
                  instanceId="invite-workspace-access"
                  aria-label="Workspace access"
                  classNamePrefix="invite-workspace-select"
                  closeMenuOnSelect={false}
                  components={{ MultiValueRemove: InviteWorkspaceMultiValueRemove }}
                  getOptionLabel={(option) => option.label}
                  getOptionValue={(option) => option.value}
                  hideSelectedOptions={false}
                  isClearable={selectedInviteTeamOptions.length > 0}
                  isMulti
                  options={inviteWorkspaceOptions}
                  value={selectedInviteWorkspaceOptions}
                  isSearchable={teams.length > 6}
                  maxMenuHeight={190}
                  menuPlacement="auto"
                  menuPosition="fixed"
                  menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                  menuShouldBlockScroll
                  menuShouldScrollIntoView={false}
                  styles={inviteWorkspaceSelectStyles}
                  formatOptionLabel={(option, meta) => (
                    meta.context === 'value' ? (
                      <span className="max-w-full truncate">{option.label}</span>
                    ) : (
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{option.label}</span>
                        <span className="truncate text-xs text-current/70">{option.description}</span>
                      </div>
                    )
                  )}
                  onChange={handleInviteWorkspaceChange}
                />
                <p className="text-sm text-muted-foreground">
                  {inviteWorkspaceSummary}. “All workspaces” is exclusive; selecting a workspace switches to scoped invites.
                </p>
                {teams.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No workspaces yet. This invite will stay organization-wide until you create one.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
              <div>
                <h3 className="text-sm font-semibold">Permissions</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose what they can do and how they should be treated after accepting.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Access level</Label>
                <div className="grid min-w-0 gap-2 sm:grid-cols-2" role="group" aria-label="Access level">
                  {inviteAccessOptions.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant={inviteRole === option.value ? 'default' : 'outline'}
                      aria-pressed={inviteRole === option.value}
                      className="h-auto min-h-[4.75rem] min-w-0 cursor-pointer items-start justify-start overflow-hidden whitespace-normal rounded-xl px-3 py-2.5 text-left"
                      onClick={() => setInviteRole(option.value)}
                    >
                      <span className="flex min-w-0 flex-col items-start gap-1">
                        <span className="font-medium leading-5">{option.title}</span>
                        <span className={cn(
                          'whitespace-normal break-words text-xs leading-4',
                          inviteRole === option.value ? 'text-primary-foreground/80' : 'text-muted-foreground'
                        )}
                        >
                          {option.description}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Member type</Label>
                <div className="grid min-w-0 gap-2 sm:grid-cols-2" role="group" aria-label="Member type">
                  {inviteMemberTypeOptions.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant={inviteMemberType === option.value ? 'default' : 'outline'}
                      aria-pressed={inviteMemberType === option.value}
                      className="h-auto min-h-[4.75rem] min-w-0 cursor-pointer items-start justify-start overflow-hidden whitespace-normal rounded-xl px-3 py-2.5 text-left"
                      onClick={() => setInviteMemberType(option.value)}
                    >
                      <span className="flex min-w-0 flex-col items-start gap-1">
                        <span className="font-medium leading-5">{option.title}</span>
                        <span className={cn(
                          'whitespace-normal break-words text-xs leading-4',
                          inviteMemberType === option.value ? 'text-primary-foreground/80' : 'text-muted-foreground'
                        )}
                        >
                          {option.description}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Client collaborators keep a client membership type when they accept the invite.
                </p>
              </div>
            </div>
            {inviteError ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive md:col-span-2">
                {inviteError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                closeInviteDialog()
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!inviteEmail.trim() || inviteSubmitting}
            >
              {inviteSubmitting ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  )
}
