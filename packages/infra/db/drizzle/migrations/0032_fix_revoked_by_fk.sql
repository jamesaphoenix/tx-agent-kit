ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_revoked_by_user_id_users_id_fk;
ALTER TABLE invitations ADD CONSTRAINT invitations_revoked_by_user_id_users_id_fk
  FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
