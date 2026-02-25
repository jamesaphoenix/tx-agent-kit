'use client'

import type { Organization, Team } from '@tx-agent-kit/contracts'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CreatableSelect from 'react-select/creatable'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'
import { SignOutButton } from './SignOutButton'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail
} from './ui/sidebar'

interface AppSidebarProps {
  orgId?: string
  teamId?: string
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

export function AppSidebar({ orgId, teamId, principalEmail }: AppSidebarProps) {
  const router = useRouter()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [organizationLoading, setOrganizationLoading] = useState(true)
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamCreating, setTeamCreating] = useState(false)
  const [organizationSelection, setOrganizationSelection] = useState<string>('')
  const [teamSelection, setTeamSelection] = useState<string>('')
  const [teamInput, setTeamInput] = useState('')
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)

  useEffect(() => {
    setOrganizationSelection(orgId ?? '')
  }, [orgId])

  useEffect(() => {
    setTeamSelection(teamId ?? '')
  }, [teamId])

  useEffect(() => {
    let cancelled = false

    const loadOrganizations = async () => {
      setOrganizationLoading(true)
      try {
        const response = await clientApi.listOrganizations({
          limit: 100,
          sortBy: 'name',
          sortOrder: 'asc'
        })

        if (cancelled) {
          return
        }

        setOrganizations(response.data)

        if (!orgId) {
          setOrganizationSelection((current) => current || response.data[0]?.id || '')
        }
      } catch {
        if (!cancelled) {
          setOrganizations([])
        }
      } finally {
        if (!cancelled) {
          setOrganizationLoading(false)
        }
      }
    }

    void loadOrganizations()

    return () => {
      cancelled = true
    }
  }, [orgId])

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

  const shouldShowContinueSetup = useMemo(() => {
    if (!selectedOrganization) {
      return false
    }

    const onboardingData = selectedOrganization.onboardingData
    if (!onboardingData) {
      return true
    }

    return onboardingData.status !== 'completed'
  }, [selectedOrganization])

  useEffect(() => {
    let cancelled = false

    if (!selectedOrgId) {
      setTeams([])
      setTeamLoading(false)
      return () => {
        cancelled = true
      }
    }

    const loadTeams = async () => {
      setTeamLoading(true)
      try {
        const response = await clientApi.listTeams(selectedOrgId, {
          limit: 100,
          sortBy: 'name',
          sortOrder: 'asc'
        })

        if (cancelled) {
          return
        }

        setTeams(response.data)

        if (!teamId) {
          setTeamSelection((current) => {
            if (response.data.some((team) => team.id === current)) {
              return current
            }

            return response.data[0]?.id ?? ''
          })
        }
      } catch {
        if (!cancelled) {
          setTeams([])
        }
      } finally {
        if (!cancelled) {
          setTeamLoading(false)
        }
      }
    }

    void loadTeams()

    return () => {
      cancelled = true
    }
  }, [selectedOrgId, teamId])

  const handleTeamChange = useCallback((nextTeamId: string) => {
    setTeamSelection(nextTeamId)

    if (!selectedOrgId || !nextTeamId) {
      return
    }

    router.push(`/org/${selectedOrgId}/${nextTeamId}`)
  }, [router, selectedOrgId])

  const handleCreateWorkspace = useCallback(async (rawName: string) => {
    const trimmedName = rawName.trim()
    if (!selectedOrgId || trimmedName.length < 2 || teamCreating) {
      return
    }

    setTeamCreating(true)
    try {
      const createdTeam = await clientApi.createTeam({
        organizationId: selectedOrgId,
        name: trimmedName
      })

      setTeams((current) => {
        const deduped = current.filter((team) => team.id !== createdTeam.id)
        const nextTeams = [...deduped, createdTeam]
        nextTeams.sort((left, right) => left.name.localeCompare(right.name))
        return nextTeams
      })

      setTeamSelection(createdTeam.id)
      setTeamInput(createdTeam.name)
      notify.success(`Workspace "${createdTeam.name}" created`)
      router.push(`/org/${selectedOrgId}/${createdTeam.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create workspace'
      notify.error(message)
    } finally {
      setTeamCreating(false)
    }
  }, [router, selectedOrgId, teamCreating])

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
    if (selectedTeamOption) {
      setTeamInput(selectedTeamOption.label)
      return
    }

    if (!teamLoading && !teamCreating) {
      setTeamInput('')
    }
  }, [selectedTeamOption, teamLoading, teamCreating])

  return (
    <Sidebar collapsible="icon" variant="sidebar" className="app-sidebar">
      <SidebarHeader className="app-sidebar-header">
        <div className="app-sidebar-header-row">
          <div className="app-sidebar-brand">
            <div className="app-sidebar-brand-mark">OS</div>
            <div className="app-sidebar-brand-copy">
              <strong className="app-sidebar-brand-title">OctoSpark</strong>
              <span className="app-sidebar-brand-subtitle">Execution cockpit</span>
            </div>
          </div>
        </div>

        <div className="app-sidebar-switchers">
          <div className="app-sidebar-organization-card">
            <div className="app-sidebar-organization-mark">OS</div>
            <div className="app-sidebar-organization-copy">
              <strong>
                {selectedOrganization
                  ? toSelectableLabel(selectedOrganization.name, 'Untitled organization')
                  : 'No organization selected'}
              </strong>
              <span>{selectedOrgId ? 'Organization context' : 'Waiting for organization'}</span>
            </div>
          </div>

          <label className="app-sidebar-switcher" htmlFor="app-sidebar-team-switcher-input">
            <span>Workspace switcher</span>
            <CreatableSelect
              options={teamOptions}
              value={selectedTeamOption}
              inputValue={teamInput}
              classNamePrefix="app-sidebar-team-select"
              isDisabled={!selectedOrgId || teamLoading || teamCreating || organizationLoading}
              placeholder="Select or create workspace"
              formatCreateLabel={(inputValue) => `Create workspace "${inputValue}"`}
              onChange={(option) => {
                if (!option) {
                  return
                }

                setTeamInput(option.label)
                handleTeamChange(option.value)
              }}
              onCreateOption={(inputValue) => {
                void handleCreateWorkspace(inputValue)
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
                menuPortal: (base) => ({
                  ...base,
                  zIndex: 1600
                })
              }}
            />
          </label>

          {selectedOrgId && (
            <Link href={`/org/${selectedOrgId}/workspaces`} className="app-sidebar-onboarding-link">
              Open workspace manager
            </Link>
          )}

          {shouldShowContinueSetup && (
            <Link href="/org/onboarding" className="app-sidebar-onboarding-link secondary">
              Continue setup
            </Link>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent />

      <SidebarFooter className="app-sidebar-footer">
        <div className="app-sidebar-session">
          <button
            className="app-sidebar-session-trigger"
            type="button"
            onClick={() => setSessionMenuOpen((current) => !current)}
          >
            <span className="app-sidebar-presence-dot" />
            <div className="app-sidebar-presence-copy">
              <strong>Live session</strong>
              <span>{principalEmail ?? 'Authenticated user'}</span>
            </div>
          </button>

          <div className={`app-sidebar-session-panel ${sessionMenuOpen ? 'is-open' : ''}`}>
            <p className="app-sidebar-session-email">{principalEmail ?? 'Authenticated user'}</p>
            <div className="app-sidebar-session-signout">
              <SignOutButton />
            </div>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
