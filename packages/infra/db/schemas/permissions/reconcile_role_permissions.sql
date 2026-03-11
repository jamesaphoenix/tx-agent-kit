-- Generated from packages/contracts/src/permissions.ts.
-- Update rolePermissionPolicy and regenerate when policy changes.

INSERT INTO roles (name)
VALUES
  ('owner'),
  ('admin'),
  ('member')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (key)
VALUES
  ('view_organization'),
  ('manage_organization'),
  ('manage_organization_members'),
  ('manage_billing'),
  ('manage_team_members'),
  ('assign_roles'),
  ('create_teams'),
  ('delete_teams'),
  ('view_workflows'),
  ('create_workflows'),
  ('edit_workflows'),
  ('delete_workflows'),
  ('execute_workflows'),
  ('view_analytics'),
  ('export_analytics'),
  ('manage_integrations'),
  ('manage_api_keys')
ON CONFLICT (key) DO NOTHING;

WITH desired_role_permissions(role_name, permission_key) AS (
  VALUES
  ('owner', 'view_organization'),
  ('owner', 'manage_organization'),
  ('owner', 'manage_organization_members'),
  ('owner', 'manage_billing'),
  ('owner', 'manage_team_members'),
  ('owner', 'assign_roles'),
  ('owner', 'create_teams'),
  ('owner', 'delete_teams'),
  ('owner', 'view_workflows'),
  ('owner', 'create_workflows'),
  ('owner', 'edit_workflows'),
  ('owner', 'delete_workflows'),
  ('owner', 'execute_workflows'),
  ('owner', 'view_analytics'),
  ('owner', 'export_analytics'),
  ('owner', 'manage_integrations'),
  ('owner', 'manage_api_keys'),
  ('admin', 'view_organization'),
  ('admin', 'manage_organization'),
  ('admin', 'manage_organization_members'),
  ('admin', 'manage_billing'),
  ('admin', 'manage_team_members'),
  ('admin', 'assign_roles'),
  ('admin', 'create_teams'),
  ('admin', 'delete_teams'),
  ('admin', 'view_workflows'),
  ('admin', 'create_workflows'),
  ('admin', 'edit_workflows'),
  ('admin', 'delete_workflows'),
  ('admin', 'execute_workflows'),
  ('admin', 'view_analytics'),
  ('admin', 'export_analytics'),
  ('admin', 'manage_integrations'),
  ('admin', 'manage_api_keys'),
  ('member', 'view_organization'),
  ('member', 'create_teams'),
  ('member', 'view_workflows'),
  ('member', 'create_workflows'),
  ('member', 'edit_workflows'),
  ('member', 'execute_workflows'),
  ('member', 'view_analytics')
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM desired_role_permissions desired
JOIN roles r
  ON r.name = desired.role_name
JOIN permissions p
  ON p.key = desired.permission_key
ON CONFLICT DO NOTHING;

WITH desired_role_permissions(role_name, permission_key) AS (
  VALUES
  ('owner', 'view_organization'),
  ('owner', 'manage_organization'),
  ('owner', 'manage_organization_members'),
  ('owner', 'manage_billing'),
  ('owner', 'manage_team_members'),
  ('owner', 'assign_roles'),
  ('owner', 'create_teams'),
  ('owner', 'delete_teams'),
  ('owner', 'view_workflows'),
  ('owner', 'create_workflows'),
  ('owner', 'edit_workflows'),
  ('owner', 'delete_workflows'),
  ('owner', 'execute_workflows'),
  ('owner', 'view_analytics'),
  ('owner', 'export_analytics'),
  ('owner', 'manage_integrations'),
  ('owner', 'manage_api_keys'),
  ('admin', 'view_organization'),
  ('admin', 'manage_organization'),
  ('admin', 'manage_organization_members'),
  ('admin', 'manage_billing'),
  ('admin', 'manage_team_members'),
  ('admin', 'assign_roles'),
  ('admin', 'create_teams'),
  ('admin', 'delete_teams'),
  ('admin', 'view_workflows'),
  ('admin', 'create_workflows'),
  ('admin', 'edit_workflows'),
  ('admin', 'delete_workflows'),
  ('admin', 'execute_workflows'),
  ('admin', 'view_analytics'),
  ('admin', 'export_analytics'),
  ('admin', 'manage_integrations'),
  ('admin', 'manage_api_keys'),
  ('member', 'view_organization'),
  ('member', 'create_teams'),
  ('member', 'view_workflows'),
  ('member', 'create_workflows'),
  ('member', 'edit_workflows'),
  ('member', 'execute_workflows'),
  ('member', 'view_analytics')
)
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.name IN ('owner', 'admin', 'member')
  AND NOT EXISTS (
    SELECT 1
    FROM desired_role_permissions desired
    WHERE desired.role_name = r.name
      AND desired.permission_key = p.key
  );

DELETE FROM permissions
WHERE key NOT IN ('view_organization', 'manage_organization', 'manage_organization_members', 'manage_billing', 'manage_team_members', 'assign_roles', 'create_teams', 'delete_teams', 'view_workflows', 'create_workflows', 'edit_workflows', 'delete_workflows', 'execute_workflows', 'view_analytics', 'export_analytics', 'manage_integrations', 'manage_api_keys')
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.permission_id = permissions.id
  );
