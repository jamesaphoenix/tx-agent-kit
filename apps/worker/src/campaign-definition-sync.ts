import { campaignDefinitions } from '@tx-agent-kit/contracts'
import { campaignRepository, campaignStepRepository } from '@tx-agent-kit/db'
import { createLogger } from '@tx-agent-kit/logging'
import { Effect } from 'effect'

const logger = createLogger('tx-agent-kit-worker-campaign-sync')

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

/**
 * Idempotently converge the email_campaigns tables to the config-as-code
 * `campaignDefinitions`. Campaigns match by stable slug; steps reconcile by
 * positional stepOrder (update in place to preserve step ids -> email_sends FKs
 * and the sweep's fetchCampaignSteps stay valid). A step absent from config is
 * left in place (never hard-deleted), so live enrollments keep advancing.
 */
export const syncCampaignDefinitions = async (): Promise<void> => {
  for (const def of campaignDefinitions) {
    const existing = await run(campaignRepository.findBySlug(def.slug))

    let campaignId: string
    if (existing === null) {
      const created = await run(
        campaignRepository.create({
          name: def.name,
          description: def.description ?? null,
          campaignType: def.campaignType,
          status: def.status,
          triggerConfig: def.trigger,
          audienceFilter: def.audienceFilter ?? null,
          slug: def.slug
        })
      )
      if (created === null) {
        logger.error('Failed to create campaign during sync.', { slug: def.slug })
        continue
      }
      campaignId = created.id
    } else {
      campaignId = existing.id
      // Preserve runtime-managed statuses. An admin can pause or archive a synced
      // campaign (platform-admin pause/archive endpoints), and config can only
      // express active/draft - so re-syncing status verbatim on every deploy would
      // silently revert an admin pause and resume sending. Only sync status when
      // the live row is itself a config-expressible status (active/draft).
      const runtimeManaged = existing.status === 'paused' || existing.status === 'archived'
      await run(
        campaignRepository.updateById(existing.id, {
          name: def.name,
          description: def.description ?? null,
          triggerConfig: def.trigger,
          audienceFilter: def.audienceFilter ?? null,
          ...(runtimeManaged ? {} : { status: def.status })
        })
      )
    }

    const existingSteps = await run(campaignStepRepository.findByCampaign(campaignId))
    const byOrder = new Map(existingSteps.map((step) => [step.stepOrder, step]))

    for (const step of def.steps) {
      const current = byOrder.get(step.stepOrder)
      if (current === undefined) {
        await run(
          campaignStepRepository.create({
            campaignId,
            stepOrder: step.stepOrder,
            subject: step.subject,
            templateId: step.templateId,
            templateData: step.templateData ?? {},
            delaySeconds: step.delaySeconds
          })
        )
      } else {
        await run(
          campaignStepRepository.updateById(current.id, {
            subject: step.subject,
            templateId: step.templateId,
            templateData: step.templateData ?? {},
            delaySeconds: step.delaySeconds
          })
        )
      }
    }

    logger.info('Synced lifecycle campaign.', { slug: def.slug, campaignId, steps: def.steps.length })
  }
}
