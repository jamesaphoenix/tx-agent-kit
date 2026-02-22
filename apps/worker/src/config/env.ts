const defaultTemporalAddress = 'localhost:7233'
const defaultTemporalNamespace = 'default'
const defaultTemporalTaskQueue = 'tx-agent-kit'

export interface WorkerEnv {
  TEMPORAL_ADDRESS: string
  TEMPORAL_NAMESPACE: string
  TEMPORAL_TASK_QUEUE: string
}

export const getWorkerEnv = (): WorkerEnv => ({
  TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS ?? defaultTemporalAddress,
  TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE ?? defaultTemporalNamespace,
  TEMPORAL_TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE ?? defaultTemporalTaskQueue
})
