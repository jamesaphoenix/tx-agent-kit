import { createLogger } from '@tx-agent-kit/logging'
import {
  autoRechargeAttemptsRepository,
  creditLedgerRepository,
  getPool,
  organizationsRepository,
  storageUsageRepository
} from '@tx-agent-kit/db'
import {
  AutoRechargeAttemptStorePortLive,
  BillingService,
  BillingServiceLive,
  BillingStorePortLive,
  ClockPortLive,
  CreditLedgerStorePortLive,
  CreditServicePort,
  makeCreditService,
  makeStorageBillingService,
  StorageUsageReaderPortLive,
  type StripePort
} from '@tx-agent-kit/core'
import {
  EmailDeliveryPort,
  EmailDeliveryPortLive
} from '@tx-agent-kit/email'
import { makeWorkerStripePortLive } from '@tx-agent-kit/stripe'
import { Effect, Layer, Option } from 'effect'
import type { SerializedDomainEvent } from './activities.js'
import { getWorkerStripeSecretKey } from './config/env.js'

const logger = createLogger('tx-agent-kit-worker-billing-activities')

const isPositiveSafeInteger = (value: number): boolean =>
  Number.isFinite(value)
  && Number.isInteger(value)
  && Number.isSafeInteger(value)
  && value > 0

/**
 * Delay between a first auto-recharge failure and the one retry attempt.
 * @spec billing-and-pricing-design §"Auto-recharge retry policy"
 */
const AUTO_RECHARGE_RETRY_DELAY_MS = 48 * 60 * 60 * 1000

interface AutoRechargeAttemptLock {
  readonly release: () => Promise<void>
}

const tryAcquireAutoRechargeAttemptLock = async (
  attemptId: string
): Promise<AutoRechargeAttemptLock | null> => {
  const lockName = `auto-recharge-attempt:${attemptId}`
  const client = await getPool().connect()
  let released = false

  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [lockName]
    )
    if (result.rows[0]?.acquired !== true) {
      client.release()
      return null
    }

    return {
      release: async () => {
        if (released) {
          return
        }
        released = true
        try {
          await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [lockName]
          )
        } finally {
          client.release()
        }
      }
    }
  } catch (error) {
    client.release()
    throw error
  }
}

const failLatestPendingAutoRechargeAttempt = async (
  orgId: string,
  reason: string
): Promise<void> => {
  const pending = await runEffect(
    autoRechargeAttemptsRepository.findLatestPendingForOrganization(orgId)
  )
  const latest = pending[0] ?? null
  if (!latest) {
    return
  }

  await runEffect(
    autoRechargeAttemptsRepository.markFailed(latest.id, reason)
  )
}

/**
 * Top-level helper that exercises the auto-recharge flow for an org. Lifted
 * out of the activity object so that both the `triggerAutoRecharge`
 * activity and the `processDueAutoRechargeRetries` scheduler can call it
 * without a circular self-reference inside the activities const.
 */
const runAutoRechargeTrigger = async (
  orgId: string,
  currentBalanceDecimillicents: number,
  thresholdDecimillicents: number
): Promise<void> => {
  const org = await runEffect(organizationsRepository.getById(orgId))
  if (Option.isNone(org)) {
    logger.warn('Auto-recharge trigger: organization not found.', { orgId })
    return
  }

  const skipThresholdGuard = currentBalanceDecimillicents === 0 && thresholdDecimillicents === 0
  if (!org.value.autoRechargeEnabled) {
    logger.info('Auto-recharge trigger skipped: auto-recharge is disabled.', { orgId })
    if (skipThresholdGuard) {
      await failLatestPendingAutoRechargeAttempt(orgId, 'auto-recharge disabled')
    }
    return
  }

  const amount = org.value.autoRechargeAmount ?? 0
  if (amount <= 0) {
    logger.warn('Auto-recharge trigger skipped: no recharge amount configured.', { orgId })
    if (skipThresholdGuard) {
      await failLatestPendingAutoRechargeAttempt(orgId, 'no recharge amount configured')
    }
    return
  }

  // Idempotency guard: re-read the current available balance and short-
  // circuit if it is already above the threshold. The previous run of
  // this activity (or a manual top-up) may have already refilled the
  // account, so a second invocation for the same low-balance event
  // should be a no-op. The retry path passes (0, 0) so the guard is
  // skipped — the retry should always re-attempt the charge regardless
  // of the current threshold.
  const threshold = org.value.autoRechargeThreshold ?? 0
  const currentAvailable = org.value.creditsBalance - org.value.reservedCredits
  if (!skipThresholdGuard && threshold > 0 && currentAvailable >= threshold) {
    logger.info('Auto-recharge trigger skipped: balance already above threshold.', {
      orgId,
      currentAvailable,
      threshold
    })
    return
  }

  if (!skipThresholdGuard) {
    const unresolvedChallenge = await runEffect(
      autoRechargeAttemptsRepository.findLatestRequiresActionChallenge(orgId)
    )
    if (unresolvedChallenge) {
      logger.info('Auto-recharge trigger skipped: unresolved 3DS challenge already exists.', {
        orgId,
        attemptId: unresolvedChallenge.attemptId,
        stripePaymentIntentId: unresolvedChallenge.stripePaymentIntentId
      })
      return
    }
  }

  // Reuse the latest pending attempt if one is already in flight —
  // this makes Temporal retries of the same credits_low_balance event
  // land on the same attempt id (and therefore the same Stripe
  // idempotency key).
  const existing = await runEffect(
    autoRechargeAttemptsRepository.findLatestPendingForOrganization(orgId)
  )
  const existingAttempt = existing[0] ?? null

  let attemptId: string
  let isRetry: boolean
  if (existingAttempt) {
    attemptId = existingAttempt.id
    isRetry = existingAttempt.retriedFromAttemptId !== null
  } else {
    // Race-safe create: the partial unique index
    // `auto_recharge_attempts_one_pending_per_org_uniq_idx` guarantees
    // at most one pending row per org. On conflict `createPending`
    // returns None — fall through to a re-read and reuse the winning
    // concurrent insert's attempt id. @spec INV-BILLING-010
    const created = await runEffect(
      autoRechargeAttemptsRepository.createPending({
        organizationId: orgId,
        amountDecimillicents: amount
      })
    )
    if (Option.isSome(created)) {
      attemptId = created.value.id
      isRetry = false
    } else {
      const contested = await runEffect(
        autoRechargeAttemptsRepository.findLatestPendingForOrganization(orgId)
      )
      const winner = contested[0]
      if (!winner) {
        logger.error(
          'Auto-recharge trigger: createPending conflicted but no pending row found on re-read.',
          { orgId }
        )
        return
      }
      logger.info('Auto-recharge trigger: reusing concurrent winner pending attempt.', {
        orgId,
        attemptId: winner.id
      })
      attemptId = winner.id
      isRetry = winner.retriedFromAttemptId !== null
    }
  }

  const attemptLock = await tryAcquireAutoRechargeAttemptLock(attemptId)
  if (!attemptLock) {
    logger.info('Auto-recharge trigger skipped: attempt is already being charged by another worker.', {
      orgId,
      attemptId
    })
    return
  }

  const chargeAttemptId = attemptId
  const program = Effect.gen(function* () {
    const billingService = yield* BillingService
    return yield* billingService.chargeAutoRecharge({
      organizationId: orgId,
      attemptId: chargeAttemptId,
      amountDecimillicents: amount
    })
  }).pipe(Effect.provide(BillingServiceRuntimeLive))

  try {
    const result = await Effect.runPromise(
      program.pipe(
        Effect.mapError((e) => {
          const message = e instanceof Error ? e.message : String(e)
          return new Error(message, { cause: e instanceof Error ? e : undefined })
        })
      )
    )

    logger.info('Auto-recharge trigger completed.', {
      orgId,
      currentBalanceDecimillicents,
      thresholdDecimillicents,
      amountDecimillicents: amount,
      attemptId,
      status: result.status,
      stripePaymentIntentId: result.stripePaymentIntentId,
      failureReason: result.failureReason,
      isRetry
    })

    // @spec billing-and-pricing-design §"Auto-recharge retry policy"
    // On a failure, branch on whether this attempt is itself a retry.
    // The first failure schedules one retry at T+48 h; the second
    // failure (i.e. the retry itself failed) marks the attempt
    // permanently failed so the org sees the invoice in their portal.
    if (result.status === 'failed') {
      if (isRetry) {
        await runEffect(
          autoRechargeAttemptsRepository.markPermanentFailed(
            attemptId,
            result.failureReason ?? 'card declined on retry'
          )
        )
        logger.error('Auto-recharge retry failed — attempt marked permanent_failed.', {
          organizationId: orgId,
          attemptId,
          failureReason: result.failureReason
        })
      } else {
        const nextRetryAt = new Date(Date.now() + AUTO_RECHARGE_RETRY_DELAY_MS)
        await runEffect(
          autoRechargeAttemptsRepository.scheduleRetry(attemptId, nextRetryAt)
        )
        logger.warn('Auto-recharge attempt failed — scheduled one retry at T+48 h.', {
          organizationId: orgId,
          attemptId,
          nextRetryAt: nextRetryAt.toISOString()
        })
      }
    }
  } catch (error) {
    // Never rethrow — the attempt row is the source of truth for state,
    // and Stripe idempotency on `attemptId` makes the scheduled retry safe
    // even if the first request reached Stripe but the worker did not
    // receive the response. Leaving the row `pending` here would strand
    // auto-recharge because the retry scheduler only scans failed rows.
    const failureReason = error instanceof Error && error.message.length > 0
      ? error.message
      : 'unexpected auto-recharge failure'
    logger.error(
      'Auto-recharge trigger crashed unexpectedly.',
      {
        orgId,
        attemptId,
        amountDecimillicents: amount,
        failureReason,
        isRetry
      },
      error instanceof Error ? error : new Error(String(error))
    )

    try {
      if (isRetry) {
        await runEffect(
          autoRechargeAttemptsRepository.markPermanentFailed(attemptId, failureReason)
        )
        logger.error('Auto-recharge retry crashed — attempt marked permanent_failed.', {
          organizationId: orgId,
          attemptId,
          failureReason
        })
      } else {
        const nextRetryAt = new Date(Date.now() + AUTO_RECHARGE_RETRY_DELAY_MS)
        await runEffect(
          autoRechargeAttemptsRepository.markFailed(attemptId, failureReason, null)
        )
        await runEffect(
          autoRechargeAttemptsRepository.scheduleRetry(attemptId, nextRetryAt)
        )
        logger.warn('Auto-recharge crash scheduled one retry at T+48 h.', {
          organizationId: orgId,
          attemptId,
          nextRetryAt: nextRetryAt.toISOString(),
          failureReason
        })
      }
    } catch (stateError) {
      logger.error(
        'Auto-recharge trigger could not persist crash recovery state.',
        {
          orgId,
          attemptId,
          failureReason
        },
        stateError instanceof Error ? stateError : new Error(String(stateError))
      )
    }
  } finally {
    await attemptLock.release()
  }
}

/**
 * Module-level email delivery port reference. Defaults to the live Resend
 * adapter; tests can swap it out via {@link _setBillingEmailPortForTest}
 * to inject `createTestEmailDelivery()` from `@tx-agent-kit/testkit`
 * without needing an HTTP-level mock.
 */
let billingEmailLayer: Layer.Layer<EmailDeliveryPort> = EmailDeliveryPortLive

export const _setBillingEmailPortForTest = (
  portImpl: typeof EmailDeliveryPort.Service
): void => {
  billingEmailLayer = Layer.succeed(EmailDeliveryPort, portImpl)
}

export const _resetBillingEmailPortForTest = (): void => {
  billingEmailLayer = EmailDeliveryPortLive
}

/**
 * Worker-side StripePort. The shared `@tx-agent-kit/stripe` package
 * owns the actual Stripe SDK wiring — this module just hands the factory
 * the worker's STRIPE_SECRET_KEY (resolved via the lightweight accessor
 * so test contexts without full worker env validation still resolve a
 * `null` stub cleanly).
 *
 * Only `createOffSessionPaymentIntent` is exercised from the worker; the
 * other methods `Effect.fail` with a descriptive error if ever called,
 * making a misrouted cross-process call surface as a recoverable activity
 * failure rather than a worker crash.
 *
 * The layer is built via `Layer.suspend` so the secret-key read happens
 * lazily the first time the adapter is actually provided — and tests can
 * swap the underlying factory via {@link _setBillingStripePortForTest}
 * to drive non-`succeeded` PaymentIntent statuses without a real Stripe
 * account.
 *
 * @spec billing-and-pricing-design
 */
let billingStripeLayerFactory: () => Layer.Layer<StripePort> = () =>
  makeWorkerStripePortLive({ secretKey: getWorkerStripeSecretKey() })

/**
 * Test hook: swap the worker-side StripePort factory so integration
 * tests can drive `requires_action` / `requires_payment_method` /
 * `canceled` PaymentIntent statuses without a live Stripe account.
 */
export const _setBillingStripePortForTest = (
  factory: () => Layer.Layer<StripePort>
): void => {
  billingStripeLayerFactory = factory
}

export const _resetBillingStripePortForTest = (): void => {
  billingStripeLayerFactory = () =>
    makeWorkerStripePortLive({ secretKey: getWorkerStripeSecretKey() })
}

const WorkerStripePortLive = Layer.suspend(() => billingStripeLayerFactory())

const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )

/**
 * Layer satisfying the ports that `makeCreditService` requires. The
 * `StaleReservationReaderPortLive` is already baked into `makeCreditService`
 * internally, so only billing store + credit ledger store need wiring here.
 *
 * @spec INV-BILLING-003
 */
const CreditServiceDependenciesLive = Layer.mergeAll(
  BillingStorePortLive,
  CreditLedgerStorePortLive
)

/**
 * Layer providing the {@link CreditServicePort} to any Effect that needs
 * to run the auto-recharge loop via `BillingService.chargeAutoRecharge`.
 */
const CreditServicePortLive = Layer.effect(CreditServicePort, makeCreditService).pipe(
  Layer.provide(CreditServiceDependenciesLive)
)

/**
 * Full dependency graph for `BillingService.chargeAutoRecharge`. Provides
 * the billing service itself plus every port the service method relies on:
 * the billing store, credit service (ledger + outbox), auto-recharge
 * attempt store and the worker-side StripePort stub.
 *
 * @spec billing-and-pricing-design
 * @spec INV-BILLING-009
 */
const BillingServiceRuntimeLive = Layer.mergeAll(
  BillingServiceLive,
  BillingStorePortLive,
  CreditLedgerStorePortLive,
  AutoRechargeAttemptStorePortLive,
  WorkerStripePortLive,
  CreditServicePortLive
)

/**
 * Layer graph for {@link makeStorageBillingService}. The service reads the
 * org's subscription (BillingStorePort), writes ledger entries
 * (CreditLedgerStorePort), reads the current period's storage usage
 * (StorageUsageReaderPort) and occasionally needs wall-clock time
 * (ClockPort). All four live layers are wired here so the nightly
 * reconciliation activity can run the service end-to-end.
 *
 * @spec billing-and-pricing-design §"Monthly Storage Reconciliation"
 */
const StorageBillingServiceDependenciesLive = Layer.mergeAll(
  BillingStorePortLive,
  CreditLedgerStorePortLive,
  StorageUsageReaderPortLive,
  ClockPortLive
)

/**
 * Billing domain activities invoked by the outbox poller.
 *
 * Every method is designed to be re-entrant. Temporal retries an activity on
 * failure, so a second execution of the same event must either produce the
 * same terminal state or be a no-op. Where possible, idempotency is enforced
 * at the DB layer (unique reference IDs, conditional updates); otherwise it
 * is enforced by checking for prior state before mutating.
 *
 * @spec INV-BILLING-010 — billing consumers are idempotent.
 */
export const billingActivities = {
  /**
   * Re-evaluate an organization's posture after a credit-positive event
   * (`billing.credits_purchased` / `billing.credits_recharged` /
   * `billing.dispute_resolved` outcome=won). When the available balance
   * (creditsBalance − reservedCredits) is positive AND the org is currently
   * suspended, clear `organizations.suspended_at` so credit-consuming
   * operations can resume.
   *
   * @spec billing-and-pricing-design §"Credit-Positive Re-evaluation Pattern"
   * @spec INV-BILLING-010 — billing event consumers are idempotent.
   */
  creditPositiveReevaluate: async (orgId: string): Promise<void> => {
    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      logger.warn('Credit positive reevaluate: organization not found.', { orgId })
      return
    }

    const row = org.value
    const available = row.creditsBalance - row.reservedCredits
    const wasSuspended = row.suspendedAt !== null

    logger.info('Credit positive reevaluate: inspected organization state.', {
      orgId,
      creditsBalance: row.creditsBalance,
      reservedCredits: row.reservedCredits,
      available,
      usageCap: row.usageCap,
      wasSuspended
    })

    if (wasSuspended && available > 0) {
      // Use the atomic `clearSuspendedIfPositiveBalance` variant so the
      // balance predicate lives inside the UPDATE WHERE clause. This
      // closes a TOCTOU: between reading `row.creditsBalance` above and
      // firing `clearSuspended`, a concurrent `finalize` or
      // `charge.refunded` can drop balance below reservedCredits —
      // previously the unconditional clear would unsuspend the org with
      // a now-negative available balance. Now the DB re-evaluates the
      // predicate at write time; a stale positive read can no longer
      // unsuspend a currently-underwater org.
      const cleared = await runEffect(
        organizationsRepository.clearSuspendedIfPositiveBalance(orgId)
      )
      if (cleared.cleared) {
        logger.warn('Organization unsuspended after credit-positive event.', {
          organizationId: orgId,
          available
        })
      }
    }
  },

  /**
   * Execute the off-session auto-recharge loop end-to-end: reuse the latest
   * pending `auto_recharge_attempts` row (or create one), call Stripe via
   * `BillingService.chargeAutoRecharge`, update the attempt state, and on
   * success credit the ledger with a `billing.credits_recharged` outbox
   * event committed atomically alongside the positive ledger row.
   *
   * Idempotency:
   *   - The latest pending attempt for an org is reused on retries. If a
   *     prior run of this activity already succeeded, no new pending row
   *     exists and a fresh attempt is created — but the Stripe
   *     PaymentIntent carries the attempt id as its idempotency key, so a
   *     subsequent duplicate call to the same attempt never double-charges.
   *   - `BillingService.chargeAutoRecharge` never throws for normal failure
   *     modes (missing payment method, card decline, requires_action); the
   *     activity always completes and the attempt row captures the state.
   *
   * @spec billing-and-pricing-design
   * @spec INV-BILLING-009 — atomic ledger commit path via creditsRecharged.
   * @spec INV-BILLING-010 — billing consumers are idempotent.
   */
  triggerAutoRecharge: async (
    orgId: string,
    currentBalanceDecimillicents: number,
    thresholdDecimillicents: number
  ): Promise<void> => {
    await runAutoRechargeTrigger(orgId, currentBalanceDecimillicents, thresholdDecimillicents)
  },

  /**
   * Record a usage-cap warning threshold crossing
   * (`billing.usage_cap_warning`). The workflow calls `notifyBillingEvent`
   * after this activity so in-app + email delivery stay centralized in
   * the notification fan-out path and do not double-send on retries.
   *
   * Idempotency: the warning is fire-and-forget; Temporal retries land on
   * a fresh email send. The downstream Resend deliverability layer
   * deduplicates on its own headers.
   *
   * @spec billing-and-pricing-design §"Usage Cap System"
   */
  sendUsageCapWarning: async (
    orgId: string,
    percentUsed: number,
    capDecimillicents: number
  ): Promise<void> => {
    logger.warn('Usage cap warning threshold crossed.', {
      organizationId: orgId,
      percentUsed,
      capDecimillicents
    })

    await Promise.resolve()
  },

  /**
   * Apply the 100% usage cap breach. Sets `organizations.suspended_at` so
   * credit-consuming operations are blocked at the API layer until the
   * org tops up (which fires `billing.credits_purchased` →
   * `creditPositiveReevaluate` → unsuspend).
   *
   * Idempotency: `setSuspended` is conditional on `suspended_at IS NULL`
   * so retries do not overwrite the original suspension instant.
   *
   * @spec billing-and-pricing-design §"Usage Cap System"
   * @spec INV-BILLING-009 — usage_cap_exceeded fires before the consumer
   * blocks the org so the audit trail is complete even if the activity
   * fails halfway through.
   */
  applyUsageCapExceeded: async (
    orgId: string,
    capDecimillicents: number
  ): Promise<void> => {
    const org = await runEffect(organizationsRepository.getById(orgId))
    if (Option.isNone(org)) {
      logger.warn('Usage cap exceeded: organization not found.', { orgId })
      return
    }

    const result = await runEffect(organizationsRepository.setSuspended(orgId))

    logger.error('Usage cap exceeded — organization suspended.', {
      organizationId: orgId,
      capDecimillicents,
      creditsBalance: org.value.creditsBalance,
      newlySuspended: result.suspended
    })
  },

  /**
   * Start the 7-day payment grace period after a Stripe
   * `invoice.payment_failed` webhook. The column exists on `organizations`
   * so we issue a single UPDATE.
   *
   * Idempotency: when the webhook event carries its synchronous
   * `gracePeriodEndsAt` deadline, the activity reuses that exact value.
   * Older events without the field fall back to now + gracePeriodDays.
   */
  startPaymentGracePeriod: async (
    orgId: string,
    gracePeriodDays: number,
    gracePeriodEndsAtIso?: string
  ): Promise<void> => {
    const explicitEndsAt = gracePeriodEndsAtIso ? new Date(gracePeriodEndsAtIso) : null
    const endsAt = explicitEndsAt && !Number.isNaN(explicitEndsAt.getTime())
      ? explicitEndsAt
      : new Date(Date.now() + gracePeriodDays * 24 * 60 * 60 * 1000)

    await runEffect(
      organizationsRepository.setPaymentGracePeriod(orgId, endsAt)
    )

    logger.warn('Payment grace period started.', {
      organizationId: orgId,
      gracePeriodDays,
      endsAt: endsAt.toISOString(),
      source: explicitEndsAt && !Number.isNaN(explicitEndsAt.getTime()) ? 'event' : 'computed'
    })

    // Notification fan-out owns in-app + email delivery for this event.
    await Promise.resolve()
  },

  /**
   * Freeze the org's credit balance after a Stripe `charge.dispute.created`
   * webhook. Sets `organizations.suspended_at` — the same kill switch used
   * by usage-cap exceeded. The dispute outcome (`won`/`lost`) eventually
   * lands as `billing.dispute_resolved`; on `won` the credit-positive
   * re-evaluator clears the suspension, on `lost` the negative ledger
   * entry keeps the available balance ≤ 0 so the suspension persists.
   *
   * @spec billing-and-pricing-design §"Dispute Handling"
   */
  freezeCreditBalance: async (orgId: string): Promise<void> => {
    const result = await runEffect(organizationsRepository.setSuspended(orgId))
    logger.error('Credit balance frozen due to dispute — organization suspended.', {
      organizationId: orgId,
      newlySuspended: result.suspended
    })
  },

  /**
   * Resolve an open credit dispute. On `lost`, deduct the disputed amount
   * from the org's balance via a negative ledger entry with a
   * `dispute_resolution` reason. On `won`, no balance change — just a log.
   *
   * Idempotency: the ledger append uses `referenceId = dispute:<orgId>` so
   * retries of the same dispute resolution collapse to a single entry.
   */
  resolveCreditDispute: async (
    orgId: string,
    outcome: 'won' | 'lost',
    chargeAmountDecimillicents: number,
    stripeEventId: string | null = null
  ): Promise<void> => {
    if (outcome === 'won') {
      // @spec billing-and-pricing-design §"Dispute Handling"
      // freezeCreditBalance suspended the org on dispute_created. On 'won'
      // the hold must be released — the credit-positive re-evaluator
      // clears organizations.suspended_at IF the available balance is
      // positive. This is the symmetric counterpart to freezeCreditBalance
      // that the original implementation forgot to wire up.
      await billingActivities.creditPositiveReevaluate(orgId)
      logger.info('Credit dispute resolved in our favour — suspension re-evaluated.', {
        organizationId: orgId,
        chargeAmountDecimillicents
      })
      return
    }

    if (!isPositiveSafeInteger(chargeAmountDecimillicents)) {
      throw new Error(
        `lost dispute amount must be a positive integer <= Number.MAX_SAFE_INTEGER, got ${String(chargeAmountDecimillicents)}`
      )
    }

    // Align the referenceId with the webhook handler's inline write
    // (`stripe:dispute-closed:<evt>`) so the append's idempotency check
    // collapses the worker path with the webhook path — no double-
    // deduct. Fall back to the historical `dispute:<orgId>:<amount>`
    // shape only when the upstream event didn't carry the stripe id
    // (legacy replay / manual seed).
    const referenceId = stripeEventId
      ? `stripe:dispute-closed:${stripeEventId}`
      : `dispute:${orgId}:${String(chargeAmountDecimillicents)}`

    await runEffect(
      creditLedgerRepository.append({
        organizationId: orgId,
        entryType: 'adjustment',
        amountDecimillicents: -Math.abs(chargeAmountDecimillicents),
        reason: 'dispute_resolution',
        referenceId
      })
    )

    logger.warn('Credit dispute resolved against us — balance debited (or idempotent no-op).', {
      organizationId: orgId,
      chargeAmountDecimillicents,
      referenceId
    })
  },

  /**
   * Schedule an org-wide media purge 30 days after cancellation. Stub: log
   * only. The retention cleaner will do the actual deletions once wired to
   * a cancelled_at column.
   */
  scheduleOrgMediaPurge: async (orgId: string): Promise<void> => {
    logger.info('Scheduled org media purge after subscription cancellation.', {
      organizationId: orgId,
      purgeAfterDays: 30
    })
    await Promise.resolve()
  },

  /**
   * Scan for reservations older than `maxAgeSeconds` that never reached a
   * `finalize` or `release` and append compensating release rows for each
   * one. Driven by `releaseStaleReservationsWorkflow` on a 10-minute
   * interval.
   *
   * Idempotency: the underlying scan excludes any reserve whose close-row
   * (`cancel:<id>` / `release:<id>` / `finalize:<id>`) is already present,
   * so repeat runs of this activity release nothing once the queue drains.
   *
   * @spec INV-BILLING-003 — reservation lifecycle: orphaned reservations
   * must be returned to the available balance so held funds never drift.
   */
  releaseStaleReservations: async (maxAgeSeconds: number): Promise<number> => {
    const program = Effect.gen(function* () {
      const creditService = yield* makeCreditService
      return yield* creditService.releaseStaleReservations(maxAgeSeconds)
    }).pipe(Effect.provide(CreditServiceDependenciesLive))

    const result = await runEffect(program)

    if (result.releasedCount > 0) {
      logger.warn('Released orphaned credit reservations.', {
        releasedCount: result.releasedCount,
        maxAgeSeconds
      })
    } else {
      logger.info('No stale credit reservations found.', { maxAgeSeconds })
    }

    return result.releasedCount
  },

  /**
   * Scan for failed auto-recharge attempts whose `next_retry_at` has
   * elapsed and re-fire `triggerAutoRecharge` for each one. Driven by the
   * scheduled `autoRechargeRetryWorkflow` on an hourly cadence.
   *
   * Idempotency: `createRetryAttempt` clears `next_retry_at` atomically as
   * part of the insert, so concurrent scheduler runs collapse to a single
   * retry. The retry attempt carries `retried_from_attempt_id` back to the
   * original row so a second failure correctly maps to `permanent_failed`.
   *
   * @spec billing-and-pricing-design §"Auto-recharge retry policy"
   * @spec INV-BILLING-010 — billing consumers are idempotent.
   */
  processDueAutoRechargeRetries: async (): Promise<number> => {
    const due = await runEffect(
      autoRechargeAttemptsRepository.findDueRetries(new Date())
    )

    if (due.length === 0) {
      logger.info('No auto-recharge attempts are due for retry.')
      return 0
    }

    let retried = 0
    for (const original of due) {
      const created = await runEffect(
        autoRechargeAttemptsRepository.createRetryAttempt({
          organizationId: original.organizationId,
          amountDecimillicents: original.amountDecimillicents,
          retriedFromAttemptId: original.id
        })
      )
      if (!created || Option.isNone(created)) {
        logger.info('Auto-recharge retry already claimed by another scheduler run.', {
          originalAttemptId: original.id
        })
        continue
      }

      logger.warn('Re-firing auto-recharge after the 48 h retry window.', {
        organizationId: original.organizationId,
        originalAttemptId: original.id,
        retryAttemptId: created.value.id
      })

      // Re-enter the shared trigger helper. Because the new pending row
      // has `retried_from_attempt_id` set, the helper will read
      // `isRetry === true` and fall through to `markPermanentFailed` if
      // the second charge also fails. Passing (0, 0) skips the
      // threshold-guard short-circuit so the retry always re-attempts
      // the charge regardless of the current balance.
      await runAutoRechargeTrigger(original.organizationId, 0, 0)
      retried += 1
    }

    return retried
  },

  /**
   * Fan out a billing domain event to the notifications + email channels.
   * Called from every billing child workflow body. Idempotent per outbox
   * event id — a second invocation with the same event id collapses to a
   * no-op before touching either channel.
   *
   * @spec notifications-design §"Minimal-First Implementation Plan"
   * @spec INV-NOTIF-002 — idempotent per outbox event id
   * @spec INV-NOTIF-005 — email failures never block in-app creation
   */
  notifyBillingEvent: async (event: SerializedDomainEvent): Promise<{ createdNotification: boolean }> => {
    const { fanOutBillingEvent } = await import('./billing-notification-handler.js')
    const { BillingEmailPortLive: BillingEmailPortLiveImpl } = await import('./billing-email-port-live.js')
    // Compose BillingEmailPort on top of the already-mutable
    // EmailDeliveryPort layer so test overrides of the delivery port via
    // `_setBillingEmailPortForTest` also flow through to the billing port.
    const billingPortLayer = BillingEmailPortLiveImpl.pipe(Layer.provide(billingEmailLayer))
    const program = fanOutBillingEvent(event, { billingEmailLayer: billingPortLayer })
    return runEffect(program)
  },

  /**
   * Nightly storage overage reconciliation. Lists every organization whose
   * most-recent `storage_usage` period_end has elapsed, then invokes
   * {@link makeStorageBillingService} `reconcileMonthlyOverage` for each
   * candidate. The service itself is idempotent via a
   * `reconcile:<orgId>:<monthTag>` ledger reference, so repeated runs for
   * the same period never double-charge.
   *
   * Orgs with no overage (current_bytes <= plan limit) are silently skipped
   * by the service. Orgs whose current credit balance is insufficient to
   * cover the overage charge surface a ledger failure — we log it and
   * continue to the next org so one bad tenant can't stall the whole
   * nightly sweep.
   *
   * @spec billing-and-pricing-design §"Monthly Storage Reconciliation"
   * @spec INV-BILLING-010 — billing consumers are idempotent.
   */
  reconcileMonthlyStorageOverage: async (): Promise<{
    candidateCount: number
    chargedCount: number
    totalChargedDecimillicents: number
    errorCount: number
  }> => {
    const now = new Date()
    const orgIds = await runEffect(
      storageUsageRepository.listOrganizationIdsWithExpiredUsage(now)
    )

    if (orgIds.length === 0) {
      logger.info('Nightly storage reconciliation: no candidate orgs.')
      return {
        candidateCount: 0,
        chargedCount: 0,
        totalChargedDecimillicents: 0,
        errorCount: 0
      }
    }

    let chargedCount = 0
    let totalChargedDecimillicents = 0
    let errorCount = 0

    for (const orgId of orgIds) {
      const program = Effect.gen(function* () {
        const service = yield* makeStorageBillingService
        return yield* service.reconcileMonthlyOverage(orgId)
      }).pipe(Effect.provide(StorageBillingServiceDependenciesLive))

      try {
        const outcome = await runEffect(program)
        if (outcome.chargedDecimillicents > 0) {
          chargedCount += 1
          totalChargedDecimillicents += outcome.chargedDecimillicents
          logger.info('Storage overage charged.', {
            organizationId: orgId,
            overageBytes: outcome.overageBytes,
            chargedDecimillicents: outcome.chargedDecimillicents
          })
        }
      } catch (error: unknown) {
        errorCount += 1
        logger.warn('Storage reconciliation failed for org — continuing.', {
          organizationId: orgId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    logger.info('Nightly storage reconciliation complete.', {
      candidateCount: orgIds.length,
      chargedCount,
      totalChargedDecimillicents,
      errorCount
    })

    return {
      candidateCount: orgIds.length,
      chargedCount,
      totalChargedDecimillicents,
      errorCount
    }
  }
}

export type BillingActivities = typeof billingActivities
