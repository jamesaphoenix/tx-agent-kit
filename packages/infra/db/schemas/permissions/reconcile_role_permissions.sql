-- Generated from packages/contracts/src/permissions.ts.
-- Update rolePermissionPolicy and regenerate when policy changes.

INSERT INTO roles (name)
VALUES
  ('admin'),
  ('member'),
  ('viewer')
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
  ('manage_api_keys'),
  ('view_assets'),
  ('upload_assets'),
  ('manage_assets'),
  ('delete_assets')
ON CONFLICT (key) DO NOTHING;

WITH desired_role_permissions(role_name, permission_key) AS (
  VALUES
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
  ('admin', 'view_assets'),
  ('admin', 'upload_assets'),
  ('admin', 'manage_assets'),
  ('admin', 'delete_assets'),
  ('member', 'view_organization'),
  ('member', 'create_teams'),
  ('member', 'view_workflows'),
  ('member', 'create_workflows'),
  ('member', 'edit_workflows'),
  ('member', 'execute_workflows'),
  ('member', 'view_analytics'),
  ('member', 'view_assets'),
  ('member', 'upload_assets'),
  ('viewer', 'view_organization'),
  ('viewer', 'view_workflows'),
  ('viewer', 'view_analytics'),
  ('viewer', 'view_assets')
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
  ('admin', 'view_assets'),
  ('admin', 'upload_assets'),
  ('admin', 'manage_assets'),
  ('admin', 'delete_assets'),
  ('member', 'view_organization'),
  ('member', 'create_teams'),
  ('member', 'view_workflows'),
  ('member', 'create_workflows'),
  ('member', 'edit_workflows'),
  ('member', 'execute_workflows'),
  ('member', 'view_analytics'),
  ('member', 'view_assets'),
  ('member', 'upload_assets'),
  ('viewer', 'view_organization'),
  ('viewer', 'view_workflows'),
  ('viewer', 'view_analytics'),
  ('viewer', 'view_assets')
)
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.name IN ('admin', 'member', 'viewer')
  AND NOT EXISTS (
    SELECT 1
    FROM desired_role_permissions desired
    WHERE desired.role_name = r.name
      AND desired.permission_key = p.key
  );

DELETE FROM permissions
WHERE key NOT IN ('view_organization', 'manage_organization', 'manage_organization_members', 'manage_billing', 'manage_team_members', 'assign_roles', 'create_teams', 'delete_teams', 'view_workflows', 'create_workflows', 'edit_workflows', 'delete_workflows', 'execute_workflows', 'view_analytics', 'export_analytics', 'manage_integrations', 'manage_api_keys', 'view_assets', 'upload_assets', 'manage_assets', 'delete_assets')
  AND NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.permission_id = permissions.id
  );
