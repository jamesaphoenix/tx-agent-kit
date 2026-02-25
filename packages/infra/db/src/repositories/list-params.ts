import type { SortOrder } from '@tx-agent-kit/contracts'

export interface ListParams {
  readonly cursor?: string
  readonly limit: number
  readonly sortBy: string
  readonly sortOrder: SortOrder
  readonly filter: Readonly<Record<string, string>>
}
