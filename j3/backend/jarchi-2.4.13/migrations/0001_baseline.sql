-- Jarchi baseline schema.
-- Idempotent: safe to run against an existing 1.2.0 production database.
-- Establishes every table the 1.2.x code already assumed to exist.

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  display_name  TEXT NOT NULL DEFAULT '',
  username      TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS identities (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL,
  platform_user_id  TEXT NOT NULL,
  username          TEXT NOT NULL DEFAULT '',
  raw_profile       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS identities_platform_user_key
  ON identities(platform, platform_user_id);
CREATE INDEX IF NOT EXISTS identities_user_idx ON identities(user_id);

CREATE TABLE IF NOT EXISTS app_sessions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT '',
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS app_sessions_token_key ON app_sessions(token_hash);
CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS app_sessions_expiry_idx ON app_sessions(expires_at);

CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  duration_days   INTEGER NOT NULL,
  price_toman     BIGINT NOT NULL DEFAULT 0,
  telegram_stars  INTEGER NOT NULL DEFAULT 0,
  is_trial        BOOLEAN NOT NULL DEFAULT false,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS invoices (
  id                      BIGSERIAL PRIMARY KEY,
  public_id               TEXT NOT NULL UNIQUE,
  user_id                 BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                 TEXT NOT NULL REFERENCES plans(id),
  amount_toman            BIGINT NOT NULL DEFAULT 0,
  currency                TEXT NOT NULL DEFAULT 'TOMAN',
  payment_method          TEXT NOT NULL DEFAULT 'website_gateway',
  status                  TEXT NOT NULL DEFAULT 'pending',
  gateway                 TEXT,
  gateway_authority       TEXT,
  gateway_transaction_id  TEXT,
  checkout_url            TEXT,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at                 TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS invoices_user_idx ON invoices(user_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);
CREATE INDEX IF NOT EXISTS invoices_authority_idx ON invoices(gateway, gateway_authority);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id             TEXT NOT NULL REFERENCES plans(id),
  starts_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  source              TEXT NOT NULL DEFAULT 'manual',
  invoice_id          BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
  notified_3d_at      TIMESTAMPTZ,
  notified_1d_at      TIMESTAMPTZ,
  notified_expired_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions(status, expires_at);

CREATE TABLE IF NOT EXISTS telegram_star_payments (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id             TEXT NOT NULL REFERENCES plans(id),
  telegram_charge_id  TEXT NOT NULL UNIQUE,
  provider_charge_id  TEXT,
  total_amount_stars  INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL DEFAULT '',
  wordpress_url       TEXT NOT NULL DEFAULT '',
  webhook_secret      TEXT NOT NULL DEFAULT '',
  owner_user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  telegram_channel_id TEXT NOT NULL DEFAULT '',
  bale_chat_id        TEXT NOT NULL DEFAULT '',
  owner_telegram_id   TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sites_owner_idx ON sites(owner_user_id);
CREATE INDEX IF NOT EXISTS sites_created_idx ON sites(created_at DESC);

CREATE TABLE IF NOT EXISTS platform_connections (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform              TEXT NOT NULL,
  name                  TEXT NOT NULL DEFAULT 'default',
  credentials_encrypted TEXT NOT NULL,
  settings              JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                TEXT NOT NULL DEFAULT 'active',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_connections_key
  ON platform_connections(user_id, platform, name);

CREATE TABLE IF NOT EXISTS publication_preferences (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  field_keys  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS publication_preferences_key
  ON publication_preferences(user_id, site_id, platform);

CREATE TABLE IF NOT EXISTS publications (
  id                    BIGSERIAL PRIMARY KEY,
  site_id               TEXT NOT NULL,
  post_id               TEXT NOT NULL,
  event_type            TEXT NOT NULL,
  platform              TEXT NOT NULL,
  status                TEXT NOT NULL,
  external_message_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message         TEXT,
  published_at          TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- publication upserts in core/publication.js depend on this unique key.
CREATE UNIQUE INDEX IF NOT EXISTS publications_event_key
  ON publications(site_id, post_id, event_type, platform);
CREATE INDEX IF NOT EXISTS publications_site_idx ON publications(site_id, id DESC);
CREATE INDEX IF NOT EXISTS publications_status_idx ON publications(status);

CREATE TABLE IF NOT EXISTS site_field_catalog (
  id           BIGSERIAL PRIMARY KEY,
  site_id      TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  field_key    TEXT NOT NULL,
  label        TEXT NOT NULL DEFAULT '',
  field_order  INTEGER NOT NULL DEFAULT 9999,
  field_type   TEXT,
  visibility   TEXT,
  field_meta   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS site_field_catalog_key
  ON site_field_catalog(site_id, field_key);
