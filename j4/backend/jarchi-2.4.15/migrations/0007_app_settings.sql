-- Small key/value store for operator-configurable backend settings
-- (display timezone, dashboard cache TTL overrides, feature switches).

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
