'use client'

import type { PermissionAction } from '@tx-agent-kit/contracts'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { GroupBase, MenuListProps, SelectInstance } from 'react-select'
import CreatableSelect from 'react-select/creatable'
import { useRouteTransition } from './RouteTransition'
import { useMyPermissions } from '../hooks/use-permissions'
import { useCurrentPrincipal } from '../hooks/use-session-store'
import { clientApi } from '../lib/client-api'
import { getAssetsListAssetsQueryOptions } from '../lib/api/generated/assets/assets'
import {
  getOrganizationsListOrgMembersQueryOptions,
  useOrganizationsGetOrganization,
  useOrganizationsListOrganizations
} from '../lib/api/generated/organizations/organizations'
import { useTeamsListTeams, teamsCreateTeam } from '../lib/api/generated/teams/teams'
import { notify } from '../lib/notify'
// clientApi kept for signOut (auth side effects)
import { cn } from '../lib/utils'
import { sessionStoreActions } from '../stores/session-store'
import { formatUsdFromDecimillicents } from './billing/billing-utils'
import type { BrandSettingsValues } from './BrandSettingsFields'
import { CreateWorkspaceDialog, type CreateWorkspaceDialogInput } from './CreateWorkspaceDialog'
import { Separator } from './ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar
} from './ui/sidebar'

/* ── Inline SVG icons (avoids adding lucide-react dependency) ──── */

const IconHome = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)

const IconUsers = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

const IconSettings = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const IconBuilding = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="2" />
    <path d="M6 6h4v4H6zM14 6h4v4h-4zM6 14h4v4H6zM14 14h4v4h-4z" />
  </svg>
)

const IconGrid = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
)

const IconLogOut = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

/* ── Helpers ─────────────────────────────────────────────────────── */

interface AppSidebarProps {
  /** Optional override; defaults to the `orgId` route param. */
  orgId?: string
  /** Optional override; defaults to the `teamId` route param. */
  teamId?: string
  /** Optional override; defaults to the principal email from the session store. */
  principalEmail?: string | null
}

interface TeamOption {
  value: string
  label: string
}

const toSelectableLabel = (value: string, fallback: string): string => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

const getInitials = (email: string | null | undefined): string => {
  if (!email) {
    return '?'
  }
  const local = email.split('@')[0] ?? ''
  if (local.length === 0) {
    return '?'
  }
  return local.slice(0, 2).toUpperCase()
}

const preventDisabledLinkClick = (
  event: ReactMouseEvent<HTMLAnchorElement>,
  disabled: boolean
): void => {
  if (!disabled) {
    return
  }

  event.preventDefault()
}

/* ── Navigation definition ───────────────────────────────────────── */

interface NavItem {
  label: string
  icon: React.ComponentType
  href: (orgId: string, teamId: string) => string
  matchPattern: (pathname: string, orgId: string, teamId: string) => boolean
  requiresTeam: boolean
  requiredPermission?: PermissionAction
}

const IconMedia = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </svg>
)

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    icon: IconHome,
    href: (orgId, teamId) => `/org/${orgId}/${teamId}`,
    matchPattern: (pathname, orgId, teamId) =>
      pathname === `/org/${orgId}/${teamId}`,
    requiresTeam: true
  },
  {
    label: 'Media',
    icon: IconMedia,
    href: (orgId, teamId) => `/org/${orgId}/${teamId}/media`,
    matchPattern: (pathname, orgId, teamId) =>
      pathname.startsWith(`/org/${orgId}/${teamId}/media`),
    requiresTeam: true
  }
]

const workspacesItem: NavItem = {
  label: 'Workspaces',
  icon: IconGrid,
  href: (orgId) => `/org/${orgId}/workspaces`,
  matchPattern: (pathname, orgId) =>
    pathname === `/org/${orgId}/workspaces`,
  requiresTeam: false
}

const IconBilling = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
  </svg>
)

const settingsItems: NavItem[] = [
  {
    label: 'Billing',
    icon: IconBilling,
    href: (orgId) => `/org/${orgId}/billing`,
    matchPattern: (pathname, orgId) =>
      pathname.startsWith(`/org/${orgId}/billing`),
    requiresTeam: false,
    requiredPermission: 'manage_billing'
  },
  {
    label: 'Members',
    icon: IconUsers,
    href: (orgId) => `/org/${orgId}/members`,
    matchPattern: (pathname, orgId) =>
      pathname === `/org/${orgId}/members`,
    requiresTeam: false
  },
  {
    label: 'Workspace Settings',
    icon: IconSettings,
    href: (orgId, teamId) => `/org/${orgId}/${teamId}/settings`,
    matchPattern: (pathname, orgId, teamId) =>
      pathname === `/org/${orgId}/${teamId}/settings`,
    requiresTeam: true,
    requiredPermission: 'manage_organization'
  },
  {
    label: 'Org Settings',
    icon: IconBuilding,
    href: (orgId) => `/org/${orgId}/settings`,
    matchPattern: (pathname, orgId) =>
      pathname === `/org/${orgId}/settings`,
    requiresTeam: false,
    requiredPermission: 'manage_organization'
  }
]

/* ── Component ───────────────────────────────────────────────────── */

export function AppSidebar({
  orgId: orgIdProp,
  teamId: teamIdProp,
  principalEmail: principalEmailProp
}: AppSidebarProps = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()
  const principal = useCurrentPrincipal()
  const orgId = orgIdProp ?? (typeof params.orgId === 'string' ? params.orgId : undefined)
  const teamId = teamIdProp ?? (typeof params.teamId === 'string' ? params.teamId : undefined)
  const principalEmail = principalEmailProp ?? principal?.email ?? null
  const queryClient = useQueryClient()
  const routeTransition = useRouteTransition()
  const { state: sidebarState } = useSidebar()
  const isCollapsed = sidebarState === 'collapsed'
  const myPermissionsQuery = useMyPermissions()

  const visibleSettingsItems = useMemo(() => {
    const permissions = new Set(myPermissionsQuery.data?.permissions ?? [])
    return settingsItems.filter(
      (item) => !item.requiredPermission || permissions.has(item.requiredPermission)
    )
  }, [myPermissionsQuery.data?.permissions])

  const orgsQuery = useOrganizationsListOrganizations(
    { limit: '100', sortBy: 'name', sortOrder: 'asc' }
  )
  const organizations = orgsQuery.data?.data ?? []
  const organizationLoading = orgsQuery.isLoading
  const [teamCreating, setTeamCreating] = useState(false)
  const [organizationSelection, setOrganizationSelection] = useState<string>('')
  const [teamSelection, setTeamSelection] = useState<string>('')
  const [teamInput, setTeamInput] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createDialogName, setCreateDialogName] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setOrganizationSelection(orgId ?? '')
  }, [orgId])

  useEffect(() => {
    setTeamSelection(teamId ?? '')
  }, [teamId])

  // Sync org selection from query data
  useEffect(() => {
    if (!orgId && organizations.length > 0 && !organizationSelection) {
      setOrganizationSelection(organizations[0]?.id ?? '')
    }
  }, [orgId, organizations, organizationSelection])

  const selectedOrgId = useMemo(() => {
    if (orgId) {
      return orgId
    }

    if (organizationSelection) {
      return organizationSelection
    }

    return organizations[0]?.id ?? ''
  }, [orgId, organizationSelection, organizations])

  const selectedOrganization = useMemo(() => {
    return organizations.find((organization) => organization.id === selectedOrgId) ?? null
  }, [organizations, selectedOrgId])

  const selectedOrganizationQuery = useOrganizationsGetOrganization(selectedOrgId, {
    query: {
      enabled: !!selectedOrgId
    }
  })

  const currentOrganization = selectedOrganizationQuery.data ?? selectedOrganization

  const shouldShowContinueSetup = useMemo(() => {
    if (!currentOrganization) {
      return false
    }

    const onboardingData = currentOrganization.onboardingData
    if (!onboardingData) {
      return true
    }

    return onboardingData.status !== 'completed'
  }, [currentOrganization])

  const teamsQuery = useTeamsListTeams(
    { organizationId: selectedOrgId, limit: '100', sortBy: 'name', sortOrder: 'asc' },
    { query: { enabled: !!selectedOrgId } }
  )
  const teams = teamsQuery.data?.data ?? []
  const teamLoading = teamsQuery.isLoading

  // Sync team selection from query data
  useEffect(() => {
    if (!teamId && teams.length > 0) {
      setTeamSelection((current) => {
        if (teams.some((t) => t.id === current)) {return current}
        return teams[0]?.id ?? ''
      })
    }
  }, [teamId, teams])

  useEffect(() => {
    if (!selectedOrgId || !teamId || teams.length === 0) {
      return
    }

    if (teams.some((team) => team.id === teamId)) {
      return
    }

    const fallbackTeamId = teams[0]?.id
    if (!fallbackTeamId) {
      return
    }

    setTeamSelection(fallbackTeamId)

    if (pathname.startsWith(`/org/${selectedOrgId}/${teamId}`)) {
      router.replace(`/org/${selectedOrgId}/${fallbackTeamId}`)
    }
  }, [pathname, router, selectedOrgId, teamId, teams])

  const handleTeamChange = useCallback((nextTeamId: string) => {
    setTeamSelection(nextTeamId)

    if (!selectedOrgId || !nextTeamId) {
      return
    }

    router.push(`/org/${selectedOrgId}/${nextTeamId}`)
  }, [router, selectedOrgId])

  // Navigate through the route transition when one is available (inside the
  // AppShell) so the current page stays visible while the next renders; fall
  // back to a plain push when rendered standalone (e.g. in tests).
  const navigate = useCallback((href: string) => {
    if (routeTransition) {
      routeTransition.navigate(href)
      return
    }

    router.push(href)
  }, [routeTransition, router])

  const handleSidebarLinkClick = useCallback((
    event: ReactMouseEvent<HTMLAnchorElement>,
    href: string,
    disabled: boolean
  ) => {
    preventDisabledLinkClick(event, disabled)
    if (
      disabled
      || event.defaultPrevented
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return
    }

    event.preventDefault()
    navigate(href)
  }, [navigate])

  const handleCreateWorkspace = useCallback(async (
    rawName: string,
    website: string | null | undefined,
    brand: BrandSettingsValues
  ) => {
    const trimmedName = rawName.trim()
    if (!selectedOrgId || trimmedName.length < 2 || teamCreating) {
      return
    }

    setTeamCreating(true)
    try {
      const createdTeam = await teamsCreateTeam({
        organizationId: selectedOrgId,
        name: trimmedName,
        website,
        brandSettings: brand
      })

      setTeamSelection(createdTeam.id)
      setTeamInput('')
      notify.success(`Workspace "${createdTeam.name}" created`)
      void teamsQuery.refetch()
      router.push(`/org/${selectedOrgId}/${createdTeam.id}`)
    } catch {
      notify.error('Failed to create workspace')
    } finally {
      setTeamCreating(false)
    }
  }, [router, selectedOrgId, teamCreating, teamsQuery])

  const teamOptions = useMemo<TeamOption[]>(() => {
    return teams.map((team) => ({
      value: team.id,
      label: toSelectableLabel(team.name, 'Untitled team')
    }))
  }, [teams])

  const selectedTeamOption = useMemo<TeamOption | null>(() => {
    return teamOptions.find((team) => team.value === teamSelection) ?? null
  }, [teamOptions, teamSelection])

  useEffect(() => {
    if (!teamCreating) {
      setTeamInput('')
    }
  }, [teamCreating])

  const selectRef = useRef<SelectInstance<TeamOption> | null>(null)

  const workspaceMenuComponents = useMemo(() => ({
    MenuList: (props: MenuListProps<TeamOption, false, GroupBase<TeamOption>>) => {
      const handleClick = (e?: React.MouseEvent | React.KeyboardEvent) => {
        e?.preventDefault()
        e?.stopPropagation()
        selectRef.current?.blur()
        setCreateDialogOpen(true)
        setCreateDialogName('')
      }
      return (
        <div ref={props.innerRef} {...props.innerProps}>
          <div
            role="button"
            tabIndex={0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-accent cursor-pointer border-b border-border"
            onClick={handleClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleClick()
              }
            }}
          >
            <IconPlus />
            <span>New Workspace</span>
          </div>
          {props.children}
        </div>
      )
    }
  }), [selectRef])

  const handleCreateDialogSubmit = useCallback(async ({ name, website, brandSettings }: CreateWorkspaceDialogInput) => {
    if (!name.trim() || teamCreating) {
      return
    }
    setCreateDialogOpen(false)
    await handleCreateWorkspace(name.trim(), website, brandSettings)
    setCreateDialogName('')
  }, [handleCreateWorkspace, teamCreating])

  // Close user menu on click outside
  useEffect(() => {
    if (!userMenuOpen) { return undefined }

    const onClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', onClickOutside)
    return () => { document.removeEventListener('mousedown', onClickOutside) }
  }, [userMenuOpen])

  // Close user menu when sidebar expands
  useEffect(() => {
    if (!isCollapsed) { setUserMenuOpen(false) }
  }, [isCollapsed])

  const handleSignOut = useCallback(() => {
    void (async () => {
      setSigningOut(true)
      try {
        await clientApi.signOut()
        notify.info('Signed out')
      } catch {
        notify.error('Sign out failed')
      } finally {
        sessionStoreActions.clear()
        setSigningOut(false)
        router.replace('/sign-in')
      }
    })()
  }, [router])

  const resolvedTeamId = teamSelection || teamId || ''

  // Warm the destination's primary list query on hover/focus so the page is
  // already populated by the time the user clicks. Keyed off the href so we
  // only prefetch the data-heavy workspace/org pages.
  const prefetchForHref = useCallback((href: string) => {
    if (!href || href === '#') {
      return
    }

    if (href.endsWith('/media') && resolvedTeamId) {
      void queryClient.prefetchQuery({
        ...getAssetsListAssetsQueryOptions(resolvedTeamId),
        staleTime: 30_000
      })
    } else if (href.endsWith('/members') && selectedOrgId) {
      void queryClient.prefetchQuery({
        ...getOrganizationsListOrgMembersQueryOptions(selectedOrgId),
        staleTime: 30_000
      })
    }
  }, [queryClient, resolvedTeamId, selectedOrgId])

  const availableCredits = selectedOrganization
    ? selectedOrganization.creditsBalance - selectedOrganization.reservedCredits
    : null
  const activeSettingsItem = useMemo(() => {
    if (!selectedOrgId) {
      return false
    }

    return visibleSettingsItems.some((item) =>
      item.matchPattern(pathname, selectedOrgId, resolvedTeamId)
    )
  }, [pathname, resolvedTeamId, selectedOrgId, visibleSettingsItems])

  useEffect(() => {
    if (!isCollapsed && activeSettingsItem) {
      setSettingsOpen(true)
    }
  }, [activeSettingsItem, isCollapsed])

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      {/* ── Header: brand + org + workspace switcher ── */}
      <SidebarHeader>
        <div className={cn("flex items-center gap-2", isCollapsed && "justify-center")}>
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-indigo-400 text-white flex items-center justify-center text-xs font-bold shrink-0">TX</div>
          {!isCollapsed && (
            <span className="text-sm font-semibold tracking-tight">tx-agent-kit</span>
          )}
        </div>

        {!isCollapsed && (
          <div className="flex flex-col gap-3 mt-1">
            <label className="flex flex-col gap-1.5" htmlFor="app-sidebar-team-switcher-input">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Workspace</span>
              <CreatableSelect
                ref={selectRef}
                options={teamOptions}
                value={selectedTeamOption}
                inputValue={teamInput}
                classNamePrefix="app-sidebar-team-select"
                isDisabled={!selectedOrgId || teamLoading || teamCreating || organizationLoading}
                placeholder="Workspace"
                formatCreateLabel={(inputValue) => `Create "${inputValue}"`}
                components={workspaceMenuComponents}
                onChange={(option) => {
                  if (!option) {
                    return
                  }

                  setTeamInput('')
                  handleTeamChange(option.value)
                }}
                onCreateOption={(inputValue) => {
                  setCreateDialogName(inputValue)
                  setCreateDialogOpen(true)
                }}
                onInputChange={(value, meta) => {
                  if (meta.action === 'input-change') {
                    setTeamInput(value)
                  }
                }}
                noOptionsMessage={() => 'No workspaces'}
                instanceId="app-sidebar-team-switcher-input"
                menuPortalTarget={typeof document !== 'undefined' ? document.body : undefined}
                styles={{
                  control: (base) => ({
                    ...base,
                    minHeight: 40,
                    cursor: 'pointer'
                  }),
                  valueContainer: (base) => ({
                    ...base,
                    cursor: 'pointer',
                    minWidth: 0,
                    padding: '0 0.5rem'
                  }),
                  placeholder: (base) => ({
                    ...base,
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }),
                  singleValue: (base) => ({
                    ...base,
                    cursor: 'pointer',
                    margin: 0,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }),
                  input: (base) => ({
                    ...base,
                    cursor: 'pointer',
                    margin: 0,
                    padding: 0
                  }),
                  indicatorsContainer: (base) => ({
                    ...base,
                    cursor: 'pointer'
                  }),
                  dropdownIndicator: (base) => ({
                    ...base,
                    cursor: 'pointer'
                  }),
                  menuPortal: (base) => ({
                    ...base,
                    zIndex: 1600
                  })
                }}
              />
            </label>

            {shouldShowContinueSetup && (
              <Link href="/org/onboarding" className="text-[11px] text-muted-foreground hover:text-primary hover:underline">
                Continue setup &rarr;
              </Link>
            )}
          </div>
        )}
      </SidebarHeader>

      {/* ── Navigation ── */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const needsTeam = item.requiresTeam && !resolvedTeamId
                const href = needsTeam
                  ? '#'
                  : item.href(selectedOrgId, resolvedTeamId)
                const isActive = selectedOrgId
                  ? item.matchPattern(pathname, selectedOrgId, resolvedTeamId)
                  : false
                const Icon = item.icon

                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link
                        href={href}
                        aria-disabled={needsTeam || !selectedOrgId}
                        aria-label={isCollapsed ? item.label : undefined}
                        title={item.label}
                        tabIndex={needsTeam || !selectedOrgId ? -1 : undefined}
                        onClick={(event) => handleSidebarLinkClick(event, href, needsTeam || !selectedOrgId)}
                        onMouseEnter={() => prefetchForHref(href)}
                        onFocus={() => prefetchForHref(href)}
                      >
                        <Icon />
                        {!isCollapsed && <span className="overflow-hidden whitespace-nowrap text-ellipsis">{item.label}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ── Footer: workspaces link + settings dropdown + user row ── */}
      <SidebarFooter>
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-1">
            {[workspacesItem, ...visibleSettingsItems].map((item) => {
              const needsTeam = item.requiresTeam && !resolvedTeamId
              const disabled = needsTeam || !selectedOrgId
              const href = disabled ? '#' : item.href(selectedOrgId, resolvedTeamId)
              const isActive = selectedOrgId
                ? item.matchPattern(pathname, selectedOrgId, resolvedTeamId)
                : false
              const Icon = item.icon

              return (
                <Link
                  key={item.label}
                  href={href}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer transition-colors',
                    isActive && 'bg-accent text-foreground'
                  )}
                  aria-disabled={disabled}
                  aria-label={item.label}
                  title={item.label}
                  tabIndex={disabled ? -1 : undefined}
                  onClick={(event) => handleSidebarLinkClick(event, href, disabled)}
                  onMouseEnter={() => prefetchForHref(href)}
                  onFocus={() => prefetchForHref(href)}
                >
                  <Icon />
                </Link>
              )
            })}
          </div>
        ) : (() => {
          const wsHref = workspacesItem.href(selectedOrgId, resolvedTeamId)
          const wsActive = selectedOrgId
            ? workspacesItem.matchPattern(pathname, selectedOrgId, resolvedTeamId)
            : false
          const WsIcon = workspacesItem.icon

          return (
            <Link
              href={wsHref}
              className={cn(
                'flex items-center gap-2 px-2 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
                wsActive && 'bg-accent text-foreground'
              )}
              aria-disabled={!selectedOrgId}
              title={workspacesItem.label}
              tabIndex={!selectedOrgId ? -1 : undefined}
              onClick={(event) => handleSidebarLinkClick(event, wsHref, !selectedOrgId)}
              onMouseEnter={() => prefetchForHref(wsHref)}
              onFocus={() => prefetchForHref(wsHref)}
            >
              <WsIcon />
              <span>{workspacesItem.label}</span>
            </Link>
          )
        })()}

        {!isCollapsed && <Separator />}

        {!isCollapsed && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
              onClick={() => setSettingsOpen((prev) => !prev)}
              aria-expanded={settingsOpen}
            >
              <IconSettings />
              <span>Settings</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn(
                  'ml-auto transition-transform duration-200 ease-out',
                  settingsOpen && 'rotate-180'
                )}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div
              data-testid="app-sidebar-settings-section"
              aria-hidden={!settingsOpen}
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
                settingsOpen
                  ? 'grid-rows-[1fr] opacity-100 pointer-events-auto'
                  : 'grid-rows-[0fr] opacity-0 pointer-events-none'
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="flex flex-col gap-px py-1">
                  {visibleSettingsItems.map((item) => {
                    const needsTeam = item.requiresTeam && !resolvedTeamId
                    const href = needsTeam
                      ? '#'
                      : item.href(selectedOrgId, resolvedTeamId)
                    const isActive = selectedOrgId
                      ? item.matchPattern(pathname, selectedOrgId, resolvedTeamId)
                      : false
                    const Icon = item.icon

                    return (
                      <Link
                        key={item.label}
                        href={href}
                        className={cn(
                          'flex items-center gap-2 px-2 py-1.5 pl-8 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer',
                          isActive && 'bg-accent text-foreground font-medium'
                        )}
                        aria-disabled={needsTeam || !selectedOrgId}
                        title={item.label}
                        tabIndex={!settingsOpen || needsTeam || !selectedOrgId ? -1 : undefined}
                        onClick={(event) => handleSidebarLinkClick(event, href, needsTeam || !selectedOrgId)}
                        onMouseEnter={() => prefetchForHref(href)}
                        onFocus={() => prefetchForHref(href)}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {!isCollapsed && <Separator />}

        {!isCollapsed && selectedOrganization ? (
          <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Available credits
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {formatUsdFromDecimillicents(availableCredits)}
            </div>
          </div>
        ) : null}

        {!isCollapsed && selectedOrganization ? <Separator /> : null}

        <div className={cn("flex items-center gap-2 px-1", isCollapsed && "justify-center px-0")}>
          {isCollapsed ? (
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-indigo-400 text-white flex items-center justify-center text-xs font-bold shrink-0 cursor-pointer hover:ring-2 hover:ring-indigo-400/50 transition-shadow"
                title={principalEmail ?? 'User menu'}
                onClick={() => setUserMenuOpen((prev) => !prev)}
              >
                {getInitials(principalEmail)}
              </button>

              {userMenuOpen && (
                <div className="fixed bottom-3 left-[calc(var(--sidebar-width-icon)+0.5rem)] w-48 rounded-md border border-border bg-popover shadow-lg py-1 z-50">
                  <div className="px-3 py-2 border-b border-border">
                    <span className="text-xs text-muted-foreground truncate block" title={principalEmail ?? undefined}>
                      {principalEmail ?? 'Authenticated user'}
                    </span>
                  </div>

                  {visibleSettingsItems.map((item) => {
                    const needsTeam = item.requiresTeam && !resolvedTeamId
                    const href = needsTeam ? '#' : item.href(selectedOrgId, resolvedTeamId)
                    const Icon = item.icon

                    return (
                      <Link
                        key={item.label}
                        href={href}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-disabled={needsTeam || !selectedOrgId}
                        title={item.label}
                        tabIndex={needsTeam || !selectedOrgId ? -1 : undefined}
                        onClick={(event) => {
                          handleSidebarLinkClick(event, href, needsTeam || !selectedOrgId)
                          setUserMenuOpen(false)
                        }}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    )
                  })}

                  <div className="border-t border-border mt-1 pt-1">
                    <button
                      type="button"
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                      disabled={signingOut}
                      onClick={handleSignOut}
                    >
                      <IconLogOut />
                      <span>{signingOut ? 'Signing out...' : 'Sign out'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-indigo-400 text-white flex items-center justify-center text-xs font-bold shrink-0" title={principalEmail ?? 'User'}>
                {getInitials(principalEmail)}
              </div>

              <div className="flex-1 min-w-0">
                <span className="text-xs text-muted-foreground truncate block" title={principalEmail ?? undefined}>
                  {principalEmail ?? 'Authenticated user'}
                </span>
              </div>

              <button
                type="button"
                className="ml-auto w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                title={signingOut ? 'Signing out...' : 'Sign out'}
                disabled={signingOut}
                onClick={handleSignOut}
              >
                <IconLogOut />
              </button>
            </>
          )}
        </div>
      </SidebarFooter>

      <SidebarRail />

      <CreateWorkspaceDialog
        open={createDialogOpen}
        initialName={createDialogName}
        isCreating={teamCreating}
        onOpenChange={(open) => {
          setCreateDialogOpen(open)
          if (!open) {
            setCreateDialogName('')
          }
        }}
        onCreate={handleCreateDialogSubmit}
      />
    </Sidebar>
  )
}
