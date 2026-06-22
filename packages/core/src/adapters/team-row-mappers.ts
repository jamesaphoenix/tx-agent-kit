import type {
  ContentReviewTokenRowShape,
  TeamMemberRowShape,
  TeamRowShape
} from '@tx-agent-kit/db'
import type { ContentReviewTokenRecord, TeamMemberRecord, TeamRecord } from '../domains/team/domain/team-domain.js'
import type { PaginatedResult } from '../pagination.js'
import { mapPaginatedResult } from './row-mapper-utils.js'

export const toTeamRecord = (row: TeamRowShape): TeamRecord => row

export const toTeamRecordPage = (page: PaginatedResult<TeamRowShape>): PaginatedResult<TeamRecord> =>
  mapPaginatedResult(page, toTeamRecord)

export const toTeamMemberRecord = (row: TeamMemberRowShape): TeamMemberRecord => row

export const toTeamMemberRecordPage = (page: PaginatedResult<TeamMemberRowShape>): PaginatedResult<TeamMemberRecord> =>
  mapPaginatedResult(page, toTeamMemberRecord)

export const toContentReviewTokenRecord = (row: ContentReviewTokenRowShape): ContentReviewTokenRecord =>
  row

export const toContentReviewTokenRecordPage = (
  page: PaginatedResult<ContentReviewTokenRowShape>
): PaginatedResult<ContentReviewTokenRecord> => mapPaginatedResult(page, toContentReviewTokenRecord)
