---
name: frontend-role-checks
description: Guide for implementing permission-based UI gating in the web app.
metadata:
  short-description: Permission-based UI gating patterns for the web app
---

# Frontend Role Checks Skill

Guide for implementing permission-based UI gating in the web app.

## When to use
- Hiding buttons/actions from users without permission
- Gating entire pages to admin-only
- Conditionally rendering sidebar nav items
- Writing integration tests for role-based UI

## Components

### PermissionsGate — hide elements based on permission
```tsx
import { PermissionsGate } from '@/components/PermissionsGate'

<PermissionsGate permission="upload_assets">
  <Button>Upload</Button>
</PermissionsGate>

// With fallback
<PermissionsGate permission="manage_billing" fallback={<span>Admin only</span>}>
  <BillingSettings />
</PermissionsGate>
```

### RequireRole — gate pages by role
```tsx
import { RequireRole } from '@/components/RequireRole'

<RequireRole roles={['admin']} redirectTo={`/org/${orgId}`}>
  <OrgSettingsPage />
</RequireRole>
```

### usePermissions hooks
```tsx
import { useHasPermission, useMyPermissions } from '@/hooks/use-permissions'

// Check single permission
const canUpload = useHasPermission('upload_assets')

// Get full permission set
const { data } = useMyPermissions()
const role = data?.role
const permissions = data?.permissions ?? []
```

## Permission reference

| Permission | Admin | Member | Viewer |
|-----------|-------|--------|--------|
| view_assets | yes | yes | yes |
| upload_assets | yes | yes | no |
| manage_assets | yes | yes | no |
| delete_assets | yes | yes | no |
| manage_team_members | yes | no | no |
| manage_billing | yes | no | no |
| manage_organization | yes | no | no |

## Sidebar nav gating

Add `requiredPermission` to NavItem in AppSidebar.tsx:
```tsx
{
  label: 'Settings',
  requiredPermission: 'manage_organization',
}
```

## Testing pattern

Use renderWithProviders + seed a user with the appropriate role.
The permissions API (`/v1/permissions/me`) returns the user's resolved permissions.

```tsx
describe('MyComponent role behavior', () => {
  it('admin sees all controls', async () => {
    const { owner } = await setupOwnerWithTeam()
    writeAuthToken(owner.token)
    renderWithProviders(<MyComponent />)
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('viewer cannot see delete', async () => {
    // Seed a viewer-role team member
    // writeAuthToken(viewer.token)
    // renderWithProviders(<MyComponent />)
    // expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })
})
```

Note: Full role-based integration tests require seeding users with specific team
roles via the API. The `team_members.role` column defaults to 'viewer'. Use
`clientApi.updateTeamMemberRole()` to set admin/member roles after invitation.
