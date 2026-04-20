import type { RoleRowShape } from '@tx-agent-kit/db'

// Extends row shape — new DB columns appear automatically.
export type RoleRecord = Readonly<RoleRowShape>

export interface RoleWithPermissions extends Readonly<RoleRowShape> {
  readonly permissions: ReadonlyArray<string>
}
