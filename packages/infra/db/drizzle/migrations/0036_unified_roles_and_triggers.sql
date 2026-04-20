-- Phase 2: Unified member roles + auto-join triggers

-- New enum for unified member roles (admin/member/viewer)
CREATE TYPE "member_role" AS ENUM('admin', 'member', 'viewer');

-- Add role column to team_members
ALTER TABLE "team_members" ADD COLUMN "role" "member_role" NOT NULL DEFAULT 'viewer';

-- Set existing team members to 'member' role (they were all treated as full members before)
UPDATE "team_members" SET "role" = 'member';

-- Trigger 1: When team-type org member joins, auto-add to all teams as member
CREATE OR REPLACE FUNCTION auto_join_teams_on_org_member_insert()
RETURNS trigger AS $$
BEGIN
  IF NEW.membership_type = 'team' THEN
    INSERT INTO team_members (team_id, user_id, role)
    SELECT t.id, NEW.user_id, 'member'::"member_role"
    FROM teams t
    WHERE t.organization_id = NEW.organization_id
    ON CONFLICT (team_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_member_auto_join_teams
AFTER INSERT ON org_members
FOR EACH ROW EXECUTE FUNCTION auto_join_teams_on_org_member_insert();

-- Trigger 2: When new team created, auto-add all team-type org members as member
CREATE OR REPLACE FUNCTION auto_add_org_members_on_team_create()
RETURNS trigger AS $$
BEGIN
  INSERT INTO team_members (team_id, user_id, role)
  SELECT NEW.id, om.user_id, 'member'::"member_role"
  FROM org_members om
  WHERE om.organization_id = NEW.organization_id
    AND om.membership_type = 'team'
  ON CONFLICT (team_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER team_auto_add_org_members
AFTER INSERT ON teams
FOR EACH ROW EXECUTE FUNCTION auto_add_org_members_on_team_create();
