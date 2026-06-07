-- Align org_members and teams indexes with cursor access paths that order by a
-- timestamp/name then tie-break by id, and that filter by organization before
-- ordering. Mirrors the composite/cursor index upgrades shipped in octospark.

CREATE INDEX IF NOT EXISTS org_members_user_created_at_id_idx
  ON org_members(user_id, created_at, id);

CREATE INDEX IF NOT EXISTS org_members_org_created_at_id_idx
  ON org_members(organization_id, created_at, id);

CREATE INDEX IF NOT EXISTS org_members_user_org_idx
  ON org_members(user_id, organization_id);

CREATE INDEX IF NOT EXISTS teams_org_name_id_idx
  ON teams(organization_id, name, id);

CREATE INDEX IF NOT EXISTS teams_org_created_at_id_idx
  ON teams(organization_id, created_at, id);
