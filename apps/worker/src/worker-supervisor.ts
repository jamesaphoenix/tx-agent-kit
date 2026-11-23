/**
 * The worker process runs two Temporal workers (default queue and email
 * campaigns). It is only healthy while BOTH poll. If either stops, for any
 * reason other than a requested shutdown, the process must exit non-zero so the
 * container restart policy replaces it.
 *
 * Incident 2026-11-23: a worker's run loop ended with a namespace-describe
 * error, but the process stayed alive with nothing polling, so Docker never
 * restarted it and it sat idle for hours.
 */

export interface SupervisedWorkerRun {
  readonly taskQueue: string
  readonly run: Promise<void>
}

export type WorkerRunOutcome =
  | { readonly kind: 'stopped'; readonly taskQueue: string }
  | { readonly kind: 'failed'; readonly taskQueue: string; readonly error: unknown }

const toOutcome = async ({ taskQueue, run }: SupervisedWorkerRun): Promise<WorkerRunOutcome> => {
  try {
    await run
    return { kind: 'stopped', taskQueue }
  } catch (error: unknown) {
    return { kind: 'failed', taskQueue, error }
  }
}

/** Settles (never rejects) the moment the first worker's run settles. */
export const firstWorkerToStop = (
  runs: ReadonlyArray<SupervisedWorkerRun>
): Promise<WorkerRunOutcome> => Promise.race(runs.map(toOutcome))

/** Settles (never rejects) once every worker's run has settled. */
export const settleWorkerRuns = (
  runs: ReadonlyArray<SupervisedWorkerRun>
): Promise<ReadonlyArray<WorkerRunOutcome>> => Promise.all(runs.map(toOutcome))

/**
 * 0 only when a shutdown was requested (SIGTERM/SIGINT) and every worker then
 * stopped cleanly. Anything else is a failure the restart policy must handle.
 */
export const resolveWorkerExitCode = (
  outcomes: ReadonlyArray<WorkerRunOutcome>,
  shutdownRequested: boolean
): 0 | 1 =>
  shutdownRequested && outcomes.length > 0 && outcomes.every((outcome) => outcome.kind === 'stopped')
    ? 0
    : 1
