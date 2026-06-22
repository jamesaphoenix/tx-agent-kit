import { render } from '@react-email/components'
import { type LifecycleTemplateId } from '@tx-agent-kit/contracts'
import * as React from 'react'
import type { LifecycleEmailProps } from './lifecycle/props.js'
import { LifecycleActivationTipsEmail } from './lifecycle/activation-tips.js'
import { LifecycleChurnedFeedbackEmail } from './lifecycle/churned-feedback.js'
import { LifecycleChurnedWinbackEmail } from './lifecycle/churned-winback.js'
import { LifecycleCompleteOnboardingEmail } from './lifecycle/complete-onboarding.js'
import { LifecycleCreateWorkspaceEmail } from './lifecycle/create-workspace.js'
import { LifecycleFeatureSpotlightCreditsEmail } from './lifecycle/feature-spotlight-credits.js'
import { LifecycleFeedbackRequestEmail } from './lifecycle/feedback-request.js'
import { LifecycleInactiveFinalEmail } from './lifecycle/inactive-final.js'
import { LifecycleInactiveNudgeEmail } from './lifecycle/inactive-nudge.js'
import { LifecycleInviteTeammateEmail } from './lifecycle/invite-teammate.js'
import { LifecycleTrialEndingSoonEmail } from './lifecycle/trial-ending-soon.js'
import { LifecycleTrialGettingStartedEmail } from './lifecycle/trial-getting-started.js'
import { LifecycleUploadFirstAssetEmail } from './lifecycle/upload-first-asset.js'
import { LifecycleUsageMilestoneEmail } from './lifecycle/usage-milestone.js'
import { LifecycleWeMissYouEmail } from './lifecycle/we-miss-you.js'
import { LifecycleWelcomeEmail } from './lifecycle/welcome.js'

export type { LifecycleEmailProps } from './lifecycle/props.js'

/**
 * The single source of truth mapping every lifecycle template id to its React
 * component. Typed as a total `Record<LifecycleTemplateId, ...>`, so adding a new
 * id to `lifecycleTemplateIds` (in @tx-agent-kit/contracts) without a component
 * here is a COMPILE ERROR. html + plain-text bodies both derive from this map.
 */
const lifecycleComponents: Record<
  LifecycleTemplateId,
  React.FC<LifecycleEmailProps>
> = {
  'lifecycle/welcome': LifecycleWelcomeEmail,
  'lifecycle/complete-onboarding': LifecycleCompleteOnboardingEmail,
  'lifecycle/create-workspace': LifecycleCreateWorkspaceEmail,
  'lifecycle/invite-teammate': LifecycleInviteTeammateEmail,
  'lifecycle/upload-first-asset': LifecycleUploadFirstAssetEmail,
  'lifecycle/activation-tips': LifecycleActivationTipsEmail,
  'lifecycle/trial-getting-started': LifecycleTrialGettingStartedEmail,
  'lifecycle/trial-ending-soon': LifecycleTrialEndingSoonEmail,
  'lifecycle/feature-spotlight-credits': LifecycleFeatureSpotlightCreditsEmail,
  'lifecycle/inactive-nudge': LifecycleInactiveNudgeEmail,
  'lifecycle/inactive-final': LifecycleInactiveFinalEmail,
  'lifecycle/we-miss-you': LifecycleWeMissYouEmail,
  'lifecycle/churned-winback': LifecycleChurnedWinbackEmail,
  'lifecycle/churned-feedback': LifecycleChurnedFeedbackEmail,
  'lifecycle/usage-milestone': LifecycleUsageMilestoneEmail,
  'lifecycle/feedback-request': LifecycleFeedbackRequestEmail
}

const renderHtml = (
  Component: React.FC<LifecycleEmailProps>,
  props: LifecycleEmailProps
): Promise<string> => render(React.createElement(Component, props))

const buildRenderer =
  (Component: React.FC<LifecycleEmailProps>) =>
  (props: LifecycleEmailProps): Promise<string> =>
    renderHtml(Component, props)

/**
 * Total map from template id to an HTML renderer. A missing id is a compile
 * error because the type annotation is `Record<LifecycleTemplateId, ...>`.
 */
export const templateRenderers: Record<
  LifecycleTemplateId,
  (props: LifecycleEmailProps) => Promise<string>
> = Object.fromEntries(
  (Object.keys(lifecycleComponents) as ReadonlyArray<LifecycleTemplateId>).map(
    (id) => [id, buildRenderer(lifecycleComponents[id])] as const
  )
) as Record<LifecycleTemplateId, (props: LifecycleEmailProps) => Promise<string>>

const isLifecycleTemplateId = (
  templateId: string
): templateId is LifecycleTemplateId =>
  Object.prototype.hasOwnProperty.call(lifecycleComponents, templateId)

/**
 * Render a lifecycle email to both an HTML and a plain-text body.
 *
 * Returns `null` for an unknown template id so the caller can apply its own
 * fallback (e.g. skip the send or use a generic template) instead of throwing.
 */
export const renderEmailTemplate = async (
  templateId: string,
  props: LifecycleEmailProps
): Promise<{ html: string; text: string } | null> => {
  if (!isLifecycleTemplateId(templateId)) {
    return null
  }
  const Component = lifecycleComponents[templateId]
  const element = React.createElement(Component, props)
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true })
  ])
  return { html, text }
}
