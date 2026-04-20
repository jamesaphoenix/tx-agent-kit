import type { UserRowShape } from '@tx-agent-kit/db'
import type { AuthUserRecord } from '../domains/auth/domain/auth-domain.js'
import type { OrganizationUserRecord } from '../domains/organization/domain/organization-domain.js'

export const toAuthUserRecord = (row: UserRowShape): AuthUserRecord => row

export const toOrganizationUserRecord = (row: UserRowShape): OrganizationUserRecord => row
