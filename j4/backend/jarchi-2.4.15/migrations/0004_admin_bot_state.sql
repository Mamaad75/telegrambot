-- Durable, expiring state for Telegram admin bot multi-step flows.
-- Replaces the in-memory Map() that lost every flow on restart.

CREATE TABLE IF NOT EXISTS admin_bot_states (
  id                BIGSERIAL PRIMARY KEY,
  telegram_user_id  TEXT NOT NULL,
  chat_id           TEXT NOT NULL,
  flow              TEXT NOT NULL,
  step              TEXT NOT NULL DEFAULT '',
  data              JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_bot_states_key
  ON admin_bot_states(telegram_user_id, chat_id);
CREATE INDEX IF NOT EXISTS admin_bot_states_expiry_idx ON admin_bot_states(expires_at);
