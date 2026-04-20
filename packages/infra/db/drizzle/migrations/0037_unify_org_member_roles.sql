-- Unify org_members + invitations role to use member_role enum (admin/member/viewer)
-- Removes the old membership_role enum (owner/admin/member)

-- Step 1: Convert existing role values — owner → admin, member stays member
UPDATE org_members SET role = 'admin' WHERE role = 'owner';

-- Step 2: Change org_members.role column type from membership_role to member_role
-- Must drop default before type change to avoid auto-cast error
ALTER TABLE org_members ALTER COLUMN role DROP DEFAULT;

ALTER TABLE org_members
  ALTER COLUMN role TYPE member_role USING role::text::member_role;

ALTER TABLE org_members ALTER COLUMN role SET DEFAULT 'member'::member_role;

-- Step 3: Change invitations.role column type from membership_role to member_role
UPDATE invitations SET role = 'admin' WHERE role = 'owner';

ALTER TABLE invitations ALTER COLUMN role DROP DEFAULT;

ALTER TABLE invitations
  ALTER COLUMN role TYPE member_role USING role::text::member_role;

ALTER TABLE invitations ALTER COLUMN role SET DEFAULT 'member'::member_role;

-- Step 4: Remove stale 'owner' and 'creator' roles from the roles table
DELETE FROM roles WHERE name IN ('owner', 'creator') AND is_system = true;

-- Step 5: Drop the old enum type (no longer used by any table)
DROP TYPE IF EXISTS membership_role;
