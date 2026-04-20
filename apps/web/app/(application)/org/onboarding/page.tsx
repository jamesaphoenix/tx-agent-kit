'use client'

import type {
  OrganizationOnboardingGoal,
  OrganizationOnboardingTeamSize
} from '@tx-agent-kit/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type SyntheticEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  getOrganizationsGetOrganizationQueryKey,
  getOrganizationsListOrganizationsQueryKey,
  organizationsListOrganizations,
  organizationsCreateOrganization,
  organizationsUpdateOrganization
} from '../../../../lib/api/generated/organizations/organizations'
import { teamsListTeams, teamsCreateTeam } from '../../../../lib/api/generated/teams/teams'
import { notify } from '../../../../lib/notify'
import { syncOrganizationCache } from '../../../../lib/organization-cache'
import { BrandSettingsFields, defaultBrandSettingsValues, type BrandSettingsValues } from '@/components/BrandSettingsFields'
import { SpendCapStep } from '@/components/onboarding/SpendCapStep'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type FlowStep = 'organization_profile' | 'workspace_setup' | 'goals' | 'spend_cap'
type PersistedOnboardingStep = FlowStep | 'completed'

const flowSteps: readonly FlowStep[] = [
  'organization_profile',
  'workspace_setup',
  'goals',
  'spend_cap'
]

const flowStepLabels: Record<FlowStep, string> = {
  organization_profile: 'Organization profile',
  workspace_setup: 'Workspace setup',
  goals: 'Success criteria',
  spend_cap: 'Spend cap'
}

const goalOptions: readonly { value: OrganizationOnboardingGoal; label: string; description: string }[] = [
  {
    value: 'agent_execution',
    label: 'Agent execution',
    description: 'Launch multi-step agent workflows quickly.'
  },
  {
    value: 'automation',
    label: 'Automation',
    description: 'Automate repetitive operational tasks.'
  },
  {
    value: 'analytics',
    label: 'Analytics',
    description: 'Track execution quality and throughput.'
  },
  {
    value: 'internal_tools',
    label: 'Internal tools',
    description: 'Build internal operator tooling for teams.'
  },
  {
    value: 'other',
    label: 'Other',
    description: 'Capture a custom primary objective.'
  }
]

const teamSizeOptions: readonly OrganizationOnboardingTeamSize[] = ['1-5', '6-20', '21-50', '51+']

const resolveFlowStep = (step: PersistedOnboardingStep | undefined): FlowStep => {
  if (step === 'workspace_setup' || step === 'goals' || step === 'spend_cap') {
    return step
  }

  return 'organization_profile'
}

const normalizeWebsite = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const isValidWorkspaceWebsite = (value: string): boolean => {
  try {
    const parsedUrl = new URL(value)
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
  } catch {
    return false
  }
}

const isValidHexColor = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value)

export default function OrganizationOnboardingPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<FlowStep>('organization_profile')

  const [organizationName, setOrganizationName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceWebsite, setWorkspaceWebsite] = useState('')
  const [brandSettings, setBrandSettings] = useState<BrandSettingsValues>(defaultBrandSettingsValues)
  const [primaryGoal, setPrimaryGoal] = useState<OrganizationOnboardingGoal>('agent_execution')
  const [teamSize, setTeamSize] = useState<OrganizationOnboardingTeamSize>('1-5')

  const currentStepIndex = flowSteps.findIndex((step) => step === currentStep)

  const getPersistableBrandSettings = (): BrandSettingsValues | null => {
    const { colors } = brandSettings
    const allColors = [colors.primary, colors.secondary, colors.accent, colors.background, colors.text]
    if (allColors.some((color) => !isValidHexColor(color))) {
      return null
    }
    if (!brandSettings.industry.trim() || !brandSettings.targetAudience.trim() || !brandSettings.brandGuidelines.trim()) {
      return null
    }
    return brandSettings
  }

  const buildOnboardingData = (
    overrides: {
      status: 'in_progress' | 'completed'
      currentStep: PersistedOnboardingStep
      completedSteps: PersistedOnboardingStep[]
      completedAt?: string | null
    },
    resolvedOrganizationName: string
  ) => {
    const trimmedWorkspaceName = workspaceName.trim()
    const persistedBrandSettings = getPersistableBrandSettings()
    const workspaceProfile = trimmedWorkspaceName.length >= 2
      ? {
          teamName: trimmedWorkspaceName,
          website: normalizeWebsite(workspaceWebsite),
          brandSettings: persistedBrandSettings
        }
      : undefined

    const goals = (
      overrides.currentStep === 'goals'
      || overrides.currentStep === 'completed'
      || overrides.completedSteps.includes('goals')
    )
      ? {
          primaryGoal,
          teamSize
        }
      : undefined

    return {
      version: 1 as const,
      status: overrides.status,
      currentStep: overrides.currentStep,
      completedSteps: [...overrides.completedSteps],
      organizationProfile: {
        displayName: resolvedOrganizationName
      },
      ...(workspaceProfile ? { workspaceProfile } : {}),
      ...(goals ? { goals } : {}),
      completedAt: overrides.completedAt ?? null
    }
  }

  useEffect(() => {
    const bootstrap = async (): Promise<void> => {
      setLoading(true)
      setError(null)

      try {
        const organizationsPayload = await organizationsListOrganizations({
          limit: '1',
          sortBy: 'createdAt',
          sortOrder: 'desc'
        })

        const org = organizationsPayload.data[0]
        if (!org) {
          setLoading(false)
          return
        }

        setOrganizationId(org.id)
        setOrganizationName(org.name)

        const onboardingData = org.onboardingData ?? null
        if (onboardingData?.workspaceProfile?.teamName) {
          setWorkspaceName(onboardingData.workspaceProfile.teamName)
        }

        if (onboardingData?.workspaceProfile?.website) {
          setWorkspaceWebsite(onboardingData.workspaceProfile.website)
        }

        if (onboardingData?.workspaceProfile?.brandSettings) {
          setBrandSettings(onboardingData.workspaceProfile.brandSettings)
        }

        if (onboardingData?.goals?.primaryGoal) {
          setPrimaryGoal(onboardingData.goals.primaryGoal)
        }

        if (onboardingData?.goals?.teamSize) {
          setTeamSize(onboardingData.goals.teamSize)
        }

        const teamsPayload = await teamsListTeams({
          organizationId: org.id,
          limit: '1',
          sortBy: 'createdAt',
          sortOrder: 'asc'
        })

        const firstTeam = teamsPayload.data[0]
        if (firstTeam) {
          setTeamId(firstTeam.id)
        }

        if (onboardingData?.status === 'completed' && firstTeam) {
          router.replace(`/org/${org.id}/${firstTeam.id}`)
          return
        }

        if (onboardingData?.currentStep) {
          setCurrentStep(resolveFlowStep(onboardingData.currentStep))
          setLoading(false)
          return
        }

        if (firstTeam) {
          setCurrentStep('goals')
        } else {
          setCurrentStep('workspace_setup')
        }

        setLoading(false)
      } catch {
        setError('Failed to load onboarding state')
        setLoading(false)
      }
    }

    void bootstrap()
  }, [router])

  const onBack = () => {
    if (saving || currentStepIndex <= 0) {
      return
    }

    const previousStep = flowSteps[currentStepIndex - 1]
    if (previousStep) {
      setCurrentStep(previousStep)
    }
  }

  const submitOrganizationProfile = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>
  ): Promise<void> => {
    event.preventDefault()
    if (saving) {return}

    const trimmedName = organizationName.trim()
    if (trimmedName.length < 2) {
      setError('Organization name must be at least 2 characters.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      let nextOrganizationId = organizationId

      if (!nextOrganizationId) {
        const created = await organizationsCreateOrganization({ name: trimmedName })
        nextOrganizationId = created.id
        setOrganizationId(created.id)
      }

      const onboardingData = buildOnboardingData(
        {
          status: 'in_progress',
          currentStep: 'workspace_setup',
          completedSteps: ['organization_profile']
        },
        trimmedName
      )

      await organizationsUpdateOrganization(nextOrganizationId, {
        name: trimmedName,
        onboardingData
      })

      setCurrentStep('workspace_setup')
      notify.success('Organization profile saved')
    } catch {
      notify.error('Failed to save organization profile')
    } finally {
      setSaving(false)
    }
  }

  const submitWorkspaceSetup = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>
  ): Promise<void> => {
    event.preventDefault()
    if (saving || !organizationId) {return}

    const trimmedWorkspaceName = workspaceName.trim()
    if (trimmedWorkspaceName.length < 2) {
      setError('Workspace name must be at least 2 characters.')
      return
    }

    const normalizedWebsite = normalizeWebsite(workspaceWebsite)
    if (!normalizedWebsite) {
      setError('Workspace website is required.')
      return
    }

    if (!isValidWorkspaceWebsite(normalizedWebsite)) {
      setError('Workspace website must be a valid URL starting with http:// or https://.')
      return
    }

    const { colors } = brandSettings
    const allColors = [colors.primary, colors.secondary, colors.accent, colors.background, colors.text]
    if (allColors.some((c) => !isValidHexColor(c))) {
      setError('All color values must be valid hex colors (e.g. #FF5733).')
      return
    }

    if (!brandSettings.industry.trim()) {
      setError('Industry is required.')
      return
    }

    if (!brandSettings.targetAudience.trim()) {
      setError('Target audience is required.')
      return
    }

    if (!brandSettings.brandGuidelines.trim()) {
      setError('Brand guidelines are required.')
      return
    }

    setSaving(true)
    setError(null)

    try {
      if (!teamId) {
        const created = await teamsCreateTeam({
          organizationId,
          name: trimmedWorkspaceName,
          brandSettings
        })
        setTeamId(created.id)
      }

      const onboardingData = buildOnboardingData(
        {
          status: 'in_progress',
          currentStep: 'goals',
          completedSteps: ['organization_profile', 'workspace_setup']
        },
        organizationName.trim()
      )

      await organizationsUpdateOrganization(organizationId, {
        onboardingData
      })

      setCurrentStep('goals')
      notify.success('Workspace setup saved')
    } catch {
      notify.error('Failed to save workspace setup')
    } finally {
      setSaving(false)
    }
  }

  const submitGoals = async (
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>
  ): Promise<void> => {
    event.preventDefault()
    if (saving || !organizationId) {return}

    setSaving(true)
    setError(null)

    try {
      const onboardingData = buildOnboardingData(
        {
          status: 'in_progress',
          currentStep: 'spend_cap',
          completedSteps: ['organization_profile', 'workspace_setup', 'goals']
        },
        organizationName.trim()
      )

      await organizationsUpdateOrganization(organizationId, {
        onboardingData
      })

      setCurrentStep('spend_cap')
      notify.success('Success criteria saved')
    } catch {
      notify.error('Failed to save onboarding')
    } finally {
      setSaving(false)
    }
  }

  const completeOnboarding = async (): Promise<void> => {
    if (saving || !organizationId) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const onboardingData = buildOnboardingData(
        {
          status: 'completed',
          currentStep: 'completed',
          completedSteps: ['organization_profile', 'workspace_setup', 'goals', 'spend_cap', 'completed'],
          completedAt: new Date().toISOString()
        },
        organizationName.trim()
      )

      const updatedOrganization = await organizationsUpdateOrganization(organizationId, {
        onboardingData
      })
      syncOrganizationCache(queryClient, updatedOrganization)

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getOrganizationsListOrganizationsQueryKey()
        }),
        queryClient.invalidateQueries({
          queryKey: getOrganizationsGetOrganizationQueryKey(organizationId)
        })
      ])

      notify.success('Onboarding complete')

      if (teamId) {
        router.replace(`/org/${organizationId}/${teamId}`)
        return
      }

      router.replace(`/org/${organizationId}/workspaces`)
    } catch {
      notify.error('Failed to complete onboarding')
    } finally {
      setSaving(false)
    }
  }

  const renderStepForm = () => {
    if (loading) {
      return <p className="text-sm text-muted-foreground">Loading onboarding flow...</p>
    }

    if (currentStep === 'organization_profile') {
      return (
        <form className="space-y-4" onSubmit={(event) => { void submitOrganizationProfile(event) }}>
          <div className="space-y-2">
            <Label htmlFor="onboarding-organization-name">Organization name</Label>
            <Input
              id="onboarding-organization-name"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Acme Automation"
              minLength={2}
              maxLength={64}
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Continue'}
            </Button>
          </div>
        </form>
      )
    }

    if (currentStep === 'workspace_setup') {
      return (
        <form className="space-y-5" onSubmit={(event) => { void submitWorkspaceSetup(event) }}>
          <div className="space-y-2">
            <Label htmlFor="onboarding-workspace-name">Workspace name</Label>
            <Input
              id="onboarding-workspace-name"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Core Operations"
              minLength={2}
              maxLength={64}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="onboarding-workspace-website">Workspace website</Label>
            <Input
              id="onboarding-workspace-website"
              value={workspaceWebsite}
              onChange={(event) => setWorkspaceWebsite(event.target.value)}
              placeholder="https://acme.example"
              type="url"
              required
              pattern="https?://.+"
              title="Enter a valid URL starting with http:// or https://"
            />
          </div>

          <BrandSettingsFields
            values={brandSettings}
            onChange={setBrandSettings}
            disabled={saving}
          />

          <div className="flex items-center gap-2 pt-2">
            <Button variant="outline" type="button" onClick={onBack} disabled={saving}>
              Back
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Continue'}
            </Button>
          </div>
        </form>
      )
    }

    if (currentStep === 'goals') {
      return (
      <form className="space-y-4" onSubmit={(event) => { void submitGoals(event) }}>
        <div className="space-y-2">
          <Label htmlFor="onboarding-primary-goal">Primary goal</Label>
          <select
            id="onboarding-primary-goal"
            value={primaryGoal}
            onChange={(event) => setPrimaryGoal(event.target.value as OrganizationOnboardingGoal)}
            className="flex h-10 w-full items-center rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {goalOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-sm text-muted-foreground">
            {goalOptions.find((option) => option.value === primaryGoal)?.description}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="onboarding-team-size">Team size</Label>
          <select
            id="onboarding-team-size"
            value={teamSize}
            onChange={(event) => setTeamSize(event.target.value as OrganizationOnboardingTeamSize)}
            className="flex h-10 w-full items-center rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {teamSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" type="button" onClick={onBack} disabled={saving}>
            Back
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Continue'}
          </Button>
        </div>
      </form>
      )
    }

    return (
      <SpendCapStep
        organizationId={organizationId ?? ''}
        onBack={() => setCurrentStep('goals')}
        onContinue={completeOnboarding}
      />
    )
  }

  return (
    <section className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-background p-8 shadow-sm space-y-6">
        <header className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Organization onboarding</h1>
          <p className="text-sm text-muted-foreground">Set up your workspace in four steps.</p>
        </header>

        <ol className="flex items-center gap-4" aria-label="Onboarding steps">
          {flowSteps.map((step, index) => {
            const isCurrent = step === currentStep
            const isComplete = index < currentStepIndex

            return (
              <li key={step} className={`flex items-center gap-2 text-sm ${isCurrent ? 'font-semibold text-primary' : ''} ${isComplete ? 'text-green-600' : ''} ${!isCurrent && !isComplete ? 'text-muted-foreground' : ''}`}>
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${isCurrent ? 'bg-primary text-white' : ''} ${isComplete ? 'bg-green-100 text-green-700' : ''} ${!isCurrent && !isComplete ? 'bg-muted text-muted-foreground' : ''}`}>{index + 1}</span>
                <span>{flowStepLabels[step]}</span>
              </li>
            )
          })}
        </ol>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {renderStepForm()}
      </div>
    </section>
  )
}
