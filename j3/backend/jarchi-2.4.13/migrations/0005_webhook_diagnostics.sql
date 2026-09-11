-- Per-site webhook diagnostics: what arrived, when, how it was authenticated,
-- how long it took and what failed. Feeds the client detail screen.

CREATE TABLE IF NOT EXISTS site_webhook_events (
  id            BIGSERIAL PRIMARY KEY,
  site_id       TEXT NOT NULL DEFAULT '',
  request_id    TEXT NOT NULL DEFAULT '',
  event_type    TEXT NOT NULL DEFAULT '',
  post_id       TEXT NOT NULL DEFAULT '',
  http_status   INTEGER NOT NULL DEFAULT 0,
  auth_result   TEXT NOT NULL DEFAULT '',
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  contract_version TEXT NOT NULL DEFAULT '',
  targets       JSONB NOT NULL DEFAULT '[]'::jsonb,
  error         TEXT,
  ip            TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS site_webhook_events_site_idx
  ON site_webhook_events(site_id, id DESC);
CREATE INDEX IF NOT EXISTS site_webhook_events_created_idx
  ON site_webhook_events(created_at DESC);

ALTER TABLE sites ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS last_publication_at TIMESTAMPTZ;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS last_failure_message TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS webhook_event_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS webhook_failure_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS publication_success_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS publication_failure_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS secret_rotated_at TIMESTAMPTZ;
