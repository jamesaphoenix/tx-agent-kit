import type {
  InvitationRowShape,
  TaskRowShape,
  UserRowShape,
  WorkspaceRowShape
} from '@tx-agent-kit/db'
import type { AuthUserRecord } from '../domains/auth/domain/auth-domain.js'
import type { TaskRecord } from '../domains/task/domain/task-domain.js'
import type {
  InvitationRecord,
  WorkspaceRecord,
  WorkspaceUserRecord
} from '../domains/workspace/domain/workspace-domain.js'
import type { PaginatedResult } from '../pagination.js'

const toRecord = <
  Row extends Record<string, unknown>,
  const Keys extends readonly (keyof Row)[]
>(
  keys: Keys
) =>
  (row: Row): Pick<Row, Keys[number]> => {
    const entries = keys.map((key) => [key, row[key]] as const)
    return Object.fromEntries(entries) as Pick<Row, Keys[number]>
  }

const mapPaginatedResult = <Input, Output>(
  page: PaginatedResult<Input>,
  mapItem: (item: Input) => Output
): PaginatedResult<Output> => ({
  data: page.data.map(mapItem),
  total: page.total,
  nextCursor: page.nextCursor,
  prevCursor: page.prevCursor
})

export const mapNullable = <Input, Output>(
  value: Input | null,
  mapItem: (item: Input) => Output
): Output | null => (value === null ? null : mapItem(value))

const toTaskRecordBase = toRecord<TaskRowShape, readonly [
  'id',
  'workspaceId',
  'title',
  'description',
  'status',
  'createdByUserId',
  'createdAt'
]>(['id', 'workspaceId', 'title', 'description', 'status', 'createdByUserId', 'createdAt'] as const)

export const toTaskRecord = (row: TaskRowShape): TaskRecord => toTaskRecordBase(row)

export const toTaskRecordPage = (page: PaginatedResult<TaskRowShape>): PaginatedResult<TaskRecord> =>
  mapPaginatedResult(page, toTaskRecord)

const toWorkspaceRecordBase = toRecord<WorkspaceRowShape, readonly [
  'id',
  'name',
  'ownerUserId',
  'createdAt'
]>(['id', 'name', 'ownerUserId', 'createdAt'] as const)

export const toWorkspaceRecord = (row: WorkspaceRowShape): WorkspaceRecord => toWorkspaceRecordBase(row)

export const toWorkspaceRecordPage = (
  page: PaginatedResult<WorkspaceRowShape>
): PaginatedResult<WorkspaceRecord> => mapPaginatedResult(page, toWorkspaceRecord)

const toInvitationRecordBase = toRecord<InvitationRowShape, readonly [
  'id',
  'workspaceId',
  'inviteeUserId',
  'email',
  'role',
  'status',
  'invitedByUserId',
  'token',
  'expiresAt',
  'createdAt'
]>([
  'id',
  'workspaceId',
  'inviteeUserId',
  'email',
  'role',
  'status',
  'invitedByUserId',
  'token',
  'expiresAt',
  'createdAt'
] as const)

export const toInvitationRecord = (row: InvitationRowShape): InvitationRecord => toInvitationRecordBase(row)

export const toInvitationRecordPage = (
  page: PaginatedResult<InvitationRowShape>
): PaginatedResult<InvitationRecord> => mapPaginatedResult(page, toInvitationRecord)

const mapUserRecordFields = toRecord<UserRowShape, readonly [
  'id',
  'email',
  'passwordHash',
  'name',
  'createdAt'
]>(['id', 'email', 'passwordHash', 'name', 'createdAt'] as const)

export const toAuthUserRecord = (row: UserRowShape): AuthUserRecord => mapUserRecordFields(row)

export const toWorkspaceUserRecord = (row: UserRowShape): WorkspaceUserRecord =>
  mapUserRecordFields(row)
