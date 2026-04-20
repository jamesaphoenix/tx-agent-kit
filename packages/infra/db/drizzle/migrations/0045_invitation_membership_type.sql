ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS membership_type membership_type NOT NULL DEFAULT 'team';
