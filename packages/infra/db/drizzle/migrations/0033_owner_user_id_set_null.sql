ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_owner_user_id_users_id_fk;
ALTER TABLE organizations ADD CONSTRAINT organizations_owner_user_id_users_id_fk
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;
