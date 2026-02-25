-- 0008: Seed permissions and role-permission mappings
-- Adapted from OctoSpark's RBAC model

-- ── Seed default roles (idempotent) ──────────────────────
INSERT INTO roles (name) VALUES ('admin') ON CONFLICT (name) DO NOTHING;
INSERT INTO roles (name) VALUES ('member') ON CONFLICT (name) DO NOTHING;

-- ── Seed permission keys ─────────────────────────────────
INSERT INTO permissions (key) VALUES ('view_organization') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('manage_organization') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('manage_organization_members') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('manage_billing') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('manage_team_members') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('assign_roles') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('create_teams') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('delete_teams') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('view_workflows') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('create_workflows') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('edit_workflows') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('delete_workflows') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('execute_workflows') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('view_analytics') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('export_analytics') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('manage_integrations') ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key) VALUES ('manage_api_keys') ON CONFLICT (key) DO NOTHING;

-- ── Admin role gets all permissions ──────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- ── Member role gets non-management permissions ──────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'member'
  AND p.key NOT IN (
    'manage_organization',
    'manage_organization_members',
    'manage_billing',
    'manage_team_members',
    'assign_roles',
    'delete_teams',
    'delete_workflows',
    'export_analytics',
    'manage_integrations',
    'manage_api_keys'
  )
ON CONFLICT DO NOTHING;
