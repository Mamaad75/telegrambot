-- Link administrator accounts to Bale Mini App identities.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS bale_user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_bale_key
  ON admin_users(bale_user_id) WHERE bale_user_id IS NOT NULL;
