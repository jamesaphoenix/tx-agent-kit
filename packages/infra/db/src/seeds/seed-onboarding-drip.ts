#!/usr/bin/env node

import process from 'node:process'
import { Client } from 'pg'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/tx_agent_kit'

const CAMPAIGN_NAME = 'Onboarding Drip'

const steps = [
  {
    stepOrder: 1,
    subject: 'Welcome to tx-agent-kit — let\u2019s get your content moving',
    templateId: 'onboarding/welcome',
    delaySeconds: 0
  },
  {
    stepOrder: 2,
    subject: 'Ready to launch your first campaign?',
    templateId: 'onboarding/first-campaign',
    delaySeconds: 259_200 // 3 days
  },
  {
    stepOrder: 3,
    subject: '3 tips from teams getting the most out of tx-agent-kit',
    templateId: 'onboarding/power-user-tips',
    delaySeconds: 604_800 // 7 days
  }
] as const

const write = (message: string): void => {
  process.stdout.write(`${message}\n`)
}

const main = async (): Promise<void> => {
  const client = new Client({ connectionString })
  await client.connect()

  try {
    // Check if the campaign already exists
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM email_campaigns WHERE name = $1 LIMIT 1`,
      [CAMPAIGN_NAME]
    )

    if (existing.rows.length > 0) {
      const existingId = existing.rows[0]?.id ?? 'unknown'
      write(`Campaign "${CAMPAIGN_NAME}" already exists (id=${existingId}). Skipping.`)
      return
    }

    await client.query('BEGIN')

    // Create the campaign
    const campaignResult = await client.query<{ id: string }>(
      `INSERT INTO email_campaigns (name, campaign_type, status, trigger_config)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        CAMPAIGN_NAME,
        'drip_sequence',
        'active',
        JSON.stringify({ type: 'domain_event', eventType: 'organization.created' })
      ]
    )

    const campaignRow = campaignResult.rows[0]
    if (!campaignRow) {
      throw new Error('Failed to create campaign — no row returned')
    }
    const campaignId = campaignRow.id
    write(`Created campaign "${CAMPAIGN_NAME}" (id=${campaignId})`)

    // Create steps
    for (const step of steps) {
      await client.query(
        `INSERT INTO email_campaign_steps (campaign_id, step_order, subject, template_id, delay_seconds)
         VALUES ($1, $2, $3, $4, $5)`,
        [campaignId, step.stepOrder, step.subject, step.templateId, step.delaySeconds]
      )
      write(`  Step ${step.stepOrder}: "${step.subject}" (delay=${step.delaySeconds}s)`)
    }

    await client.query('COMMIT')
    write('Onboarding drip seed complete.')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`)
  process.exit(1)
})
