BEGIN;

SELECT plan(4);

-- Test 1: member_role enum exists
SELECT ok(
  EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_role'),
  'member_role enum type exists'
);

-- Test 2: team_members has role column
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'team_members' AND column_name = 'role'
  ),
  'team_members table has role column'
);

-- Test 3: auto_join_teams trigger exists on org_members
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class r ON r.oid = t.tgrelid
    WHERE t.tgname = 'org_member_auto_join_teams'
      AND r.relname = 'org_members'
  ),
  'org_member_auto_join_teams trigger exists'
);

-- Test 4: auto_add_org_members trigger exists on teams
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class r ON r.oid = t.tgrelid
    WHERE t.tgname = 'team_auto_add_org_members'
      AND r.relname = 'teams'
  ),
  'team_auto_add_org_members trigger exists'
);

SELECT * FROM finish();
ROLLBACK;
