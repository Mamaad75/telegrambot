-- Administrator identity, sessions and audit trail.
-- Replaces the single ADMIN_API_TOKEN / ADMIN_TELEGRAM_ID security model.

CREATE TABLE IF NOT EXISTS admin_users (
  id                BIGSERIAL PRIMARY KEY,
  username          TEXT NOT NULL,
  display_name      TEXT NOT NULL DEFAULT '',
  password_hash     TEXT,
  role              TEXT NOT NULL DEFAULT 'viewer',
  status            TEXT NOT NULL DEFAULT 'active',
  telegram_user_id  TEXT,
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  locked_until      TIMESTAMPTZ,
  last_login_at     TIMESTAMPTZ,
  created_by        BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_username_key
  ON admin_users(lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_telegram_key
  ON admin_users(telegram_user_id) WHERE telegram_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS admin_users_role_idx ON admin_users(role, status);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id             BIGSERIAL PRIMARY KEY,
  admin_user_id  BIGINT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL,
  csrf_hash      TEXT NOT NULL DEFAULT '',
  ip             TEXT NOT NULL DEFAULT '',
  user_agent     TEXT NOT NULL DEFAULT '',
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  rotated_from   BIGINT REFERENCES admin_sessions(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_sessions_token_key ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             BIGSERIAL PRIMARY KEY,
  actor_admin_id BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  actor_label    TEXT NOT NULL DEFAULT '',
  actor_role     TEXT NOT NULL DEFAULT '',
  channel        TEXT NOT NULL DEFAULT 'web',
  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL DEFAULT '',
  target_id      TEXT NOT NULL DEFAULT '',
  success        BOOLEAN NOT NULL DEFAULT true,
  request_id     TEXT NOT NULL DEFAULT '',
  ip             TEXT NOT NULL DEFAULT '',
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_actor_idx ON admin_audit_log(actor_admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS admin_audit_action_idx ON admin_audit_log(action);
