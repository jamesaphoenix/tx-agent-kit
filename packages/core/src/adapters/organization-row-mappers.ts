import type {
  InvitationRowShape,
  OrgMemberRowShape,
  OrgMemberWithUserRowShape,
  OrganizationRowShape,
  RoleRowShape
} from '@tx-agent-kit/db'
import type {
  InvitationRecord,
  OrgMemberRecord,
  OrganizationRecord
} from '../domains/organization/domain/organization-domain.js'
import type { RoleRecord } from '../domains/role/domain/role-domain.js'
import type { PaginatedResult } from '../pagination.js'
import { mapPaginatedResult } from './row-mapper-utils.js'

export const toOrganizationRecord = (row: OrganizationRowShape): OrganizationRecord =>
  row

export const toOrganizationRecordPage = (
  page: PaginatedResult<OrganizationRowShape>
): PaginatedResult<OrganizationRecord> => mapPaginatedResult(page, toOrganizationRecord)

export const toInvitationRecord = (row: InvitationRowShape): InvitationRecord => row

export const toInvitationRecordPage = (
  page: PaginatedResult<InvitationRowShape>
): PaginatedResult<InvitationRecord> => mapPaginatedResult(page, toInvitationRecord)

export const toOrgMemberRecord = (row: OrgMemberRowShape): OrgMemberRecord => row

export const toOrgMemberRecordPage = (
  page: PaginatedResult<OrgMemberRowShape>
): PaginatedResult<OrgMemberRecord> => mapPaginatedResult(page, toOrgMemberRecord)

export const toOrgMemberWithUserRecord = (row: OrgMemberWithUserRowShape): OrgMemberRecord =>
  row

export const toOrgMemberWithUserRecordPage = (
  page: PaginatedResult<OrgMemberWithUserRowShape>
): PaginatedResult<OrgMemberRecord> => mapPaginatedResult(page, toOrgMemberWithUserRecord)

export const toRoleRecord = (row: RoleRowShape): RoleRecord => row

export const toRoleRecordPage = (
  page: PaginatedResult<RoleRowShape>
): PaginatedResult<RoleRecord> => mapPaginatedResult(page, toRoleRecord)
