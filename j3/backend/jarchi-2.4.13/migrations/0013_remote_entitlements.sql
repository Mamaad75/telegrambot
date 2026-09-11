/* Remote Mini App access is a paid product capability. Local WordPress
 * Ticket Center never depends on these flags. */
ALTER TABLE plans ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE plans
   SET features = CASE
     WHEN is_trial THEN jsonb_build_object(
       'site_control', false,
       'remote_tickets', false,
       'remote_announcements', false,
       'remote_products', false,
       'analytics', false
     )
     ELSE jsonb_build_object(
       'site_control', true,
       'remote_tickets', true,
       'remote_announcements', true,
       'remote_products', true,
       'analytics', true
     )
   END
 WHERE features = '{}'::jsonb;

CREATE TABLE IF NOT EXISTS site_members (
  id BIGSERIAL PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_id,user_id)
);
CREATE INDEX IF NOT EXISTS site_members_user_idx ON site_members(user_id,status);
CREATE INDEX IF NOT EXISTS site_members_site_idx ON site_members(site_id,status);
