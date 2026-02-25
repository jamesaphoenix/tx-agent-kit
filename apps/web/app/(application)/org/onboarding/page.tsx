'use client'

import type {
  Organization,
  OrganizationOnboardingData,
  OrganizationOnboardingGoal,
  OrganizationOnboardingStep,
  OrganizationOnboardingTeamSize
} from '@tx-agent-kit/contracts'
import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { clientApi } from '../../../../lib/client-api'
import { handleUnauthorizedApiError } from '../../../../lib/client-auth'
import { notify } from '../../../../lib/notify'

type FlowStep = 'organization_profile' | 'workspace_setup' | 'goals'

const flowSteps: readonly FlowStep[] = [
  'organization_profile',
  'workspace_setup',
  'goals'
]

const flowStepLabels: Record<FlowStep, string> = {
  organization_profile: 'Organization profile',
  workspace_setup: 'Workspace setup',
  goals: 'Success criteria'
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

const resolveFlowStep = (step: OrganizationOnboardingStep | undefined): FlowStep => {
  if (step === 'workspace_setup' || step === 'goals') {
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

const parseOnboardingData = (organization: Organization): OrganizationOnboardingData | null => {
  return organization.onboardingData
}

export default function OrganizationOnboardingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState<FlowStep>('organization_profile')

  const [organizationName, setOrganizationName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceWebsite, setWorkspaceWebsite] = useState('')
  const [primaryGoal, setPrimaryGoal] = useState<OrganizationOnboardingGoal>('agent_execution')
  const [teamSize, setTeamSize] = useState<OrganizationOnboardingTeamSize>('1-5')

  const currentStepIndex = flowSteps.findIndex((step) => step === currentStep)

  const buildOnboardingData = (
    overrides: {
      status: 'in_progress' | 'completed'
      currentStep: OrganizationOnboardingStep
      completedSteps: OrganizationOnboardingStep[]
      completedAt?: string | null
    },
    resolvedOrganizationName: string
  ): OrganizationOnboardingData => {
    const trimmedWorkspaceName = workspaceName.trim()
    const workspaceProfile = trimmedWorkspaceName.length >= 2
      ? {
          teamName: trimmedWorkspaceName,
          website: normalizeWebsite(workspaceWebsite)
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
      version: 1,
      status: overrides.status,
      currentStep: overrides.currentStep,
      completedSteps: overrides.completedSteps,
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
        const organizationsPayload = await clientApi.listOrganizations({
          limit: 1,
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

        const onboardingData = parseOnboardingData(org)
        if (onboardingData?.workspaceProfile?.teamName) {
          setWorkspaceName(onboardingData.workspaceProfile.teamName)
        }

        if (onboardingData?.workspaceProfile?.website) {
          setWorkspaceWebsite(onboardingData.workspaceProfile.website)
        }

        if (onboardingData?.goals?.primaryGoal) {
          setPrimaryGoal(onboardingData.goals.primaryGoal)
        }

        if (onboardingData?.goals?.teamSize) {
          setTeamSize(onboardingData.goals.teamSize)
        }

        const teamsPayload = await clientApi.listTeams(org.id, {
          limit: 1,
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
      } catch (err) {
        if (handleUnauthorizedApiError(err, router, '/org/onboarding')) {
          return
        }

        setError(err instanceof Error ? err.message : 'Failed to load onboarding state')
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

  const submitOrganizationProfile = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (saving) {
      return
    }

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
        const createdOrganization = await clientApi.createOrganization({
          name: trimmedName
        })
        nextOrganizationId = createdOrganization.id
        setOrganizationId(createdOrganization.id)
      }

      const onboardingData = buildOnboardingData(
        {
          status: 'in_progress',
          currentStep: 'workspace_setup',
          completedSteps: ['organization_profile']
        },
        trimmedName
      )

      await clientApi.updateOrganization(nextOrganizationId, {
        name: trimmedName,
        onboardingData
      })

      setCurrentStep('workspace_setup')
      notify.success('Organization profile saved')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save organization profile'
      setError(message)
      notify.error(message)
    } finally {
      setSaving(false)
    }
  }

  const submitWorkspaceSetup = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (saving || !organizationId) {
      return
    }

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

    setSaving(true)
    setError(null)

    try {
      if (!teamId) {
        const createdTeam = await clientApi.createTeam({
          organizationId,
          name: trimmedWorkspaceName
        })
        setTeamId(createdTeam.id)
      }

      const onboardingData = buildOnboardingData(
        {
          status: 'in_progress',
          currentStep: 'goals',
          completedSteps: ['organization_profile', 'workspace_setup']
        },
        organizationName.trim()
      )

      await clientApi.updateOrganization(organizationId, {
        onboardingData
      })

      setCurrentStep('goals')
      notify.success('Workspace setup saved')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save workspace setup'
      setError(message)
      notify.error(message)
    } finally {
      setSaving(false)
    }
  }

  const submitGoals = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
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
          completedSteps: ['organization_profile', 'workspace_setup', 'goals', 'completed'],
          completedAt: new Date().toISOString()
        },
        organizationName.trim()
      )

      await clientApi.updateOrganization(organizationId, {
        onboardingData
      })

      notify.success('Onboarding complete')

      if (teamId) {
        router.replace(`/org/${organizationId}/${teamId}`)
        return
      }

      router.replace(`/org/${organizationId}/workspaces`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to complete onboarding'
      setError(message)
      notify.error(message)
    } finally {
      setSaving(false)
    }
  }

  const renderStepForm = () => {
    if (loading) {
      return <p className="muted">Loading onboarding flow...</p>
    }

    if (currentStep === 'organization_profile') {
      return (
        <form className="onboarding-form" onSubmit={(event) => { void submitOrganizationProfile(event) }}>
          <div className="onboarding-field">
            <label htmlFor="onboarding-organization-name">Organization name</label>
            <input
              id="onboarding-organization-name"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Acme Automation"
              minLength={2}
              maxLength={64}
              required
            />
          </div>

          <div className="onboarding-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Continue'}
            </button>
          </div>
        </form>
      )
    }

    if (currentStep === 'workspace_setup') {
      return (
        <form className="onboarding-form" onSubmit={(event) => { void submitWorkspaceSetup(event) }}>
          <div className="onboarding-field">
            <label htmlFor="onboarding-workspace-name">Workspace name</label>
            <input
              id="onboarding-workspace-name"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="Core Operations"
              minLength={2}
              maxLength={64}
              required
            />
          </div>

          <div className="onboarding-field">
            <label htmlFor="onboarding-workspace-website">Workspace website</label>
            <input
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

          <div className="onboarding-actions">
            <button className="secondary" type="button" onClick={onBack} disabled={saving}>
              Back
            </button>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Continue'}
            </button>
          </div>
        </form>
      )
    }

    return (
      <form className="onboarding-form" onSubmit={(event) => { void submitGoals(event) }}>
        <div className="onboarding-field">
          <label htmlFor="onboarding-primary-goal">Primary goal</label>
          <select
            id="onboarding-primary-goal"
            value={primaryGoal}
            onChange={(event) => setPrimaryGoal(event.target.value as OrganizationOnboardingGoal)}
          >
            {goalOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="muted onboarding-field-hint">
            {goalOptions.find((option) => option.value === primaryGoal)?.description}
          </p>
        </div>

        <div className="onboarding-field">
          <label htmlFor="onboarding-team-size">Team size</label>
          <select
            id="onboarding-team-size"
            value={teamSize}
            onChange={(event) => setTeamSize(event.target.value as OrganizationOnboardingTeamSize)}
          >
            {teamSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className="onboarding-actions">
          <button className="secondary" type="button" onClick={onBack} disabled={saving}>
            Back
          </button>
          <button type="submit" disabled={saving}>
            {saving ? 'Finishing...' : 'Finish onboarding'}
          </button>
        </div>
      </form>
    )
  }

  return (
    <section className="onboarding-shell">
      <div className="onboarding-card">
        <header className="onboarding-header">
          <h1>Organization onboarding</h1>
          <p>Set up your workspace in three steps. Progress is saved as typed JSON on your organization record.</p>
        </header>

        <ol className="onboarding-stepper" aria-label="Onboarding steps">
          {flowSteps.map((step, index) => {
            const isCurrent = step === currentStep
            const isComplete = index < currentStepIndex

            return (
              <li key={step} className={`onboarding-step ${isCurrent ? 'is-current' : ''} ${isComplete ? 'is-complete' : ''}`}>
                <span className="onboarding-step-index">{index + 1}</span>
                <span className="onboarding-step-label">{flowStepLabels[step]}</span>
              </li>
            )
          })}
        </ol>

        {error && <p className="error">{error}</p>}

        {renderStepForm()}
      </div>
    </section>
  )
}
