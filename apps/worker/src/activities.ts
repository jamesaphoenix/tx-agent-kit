import { createLogger } from '@tx-agent-kit/logging'

const logger = createLogger('tx-agent-kit-worker-activities')

export const activities = {
  ping: async (): Promise<{ ok: boolean }> => {
    logger.info('Ping activity executed.')
    return await Promise.resolve({ ok: true })
  }
}
