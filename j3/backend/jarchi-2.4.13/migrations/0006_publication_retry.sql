-- Durable, bounded retry queue for failed publications, plus the publication
-- columns the admin publication history and phone-privacy rules need.

ALTER TABLE publications ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS contact_phone_enc TEXT;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 1.2.0 stored the advertiser phone in publications.metadata.contact_phone.
-- Phone numbers must not sit in a column that admin screens read freely, so the
-- plaintext copy is dropped here; core/publication.js writes the encrypted
-- column from now on and the contact button reads that.
UPDATE publications
   SET metadata = metadata - 'contact_phone'
 WHERE metadata ? 'contact_phone';

CREATE TABLE IF NOT EXISTS publication_retries (
  id               BIGSERIAL PRIMARY KEY,
  publication_id   BIGINT REFERENCES publications(id) ON DELETE SET NULL,
  site_id          TEXT NOT NULL,
  post_id          TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  platform         TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL DEFAULT 'pending',
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 5,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at        TIMESTAMPTZ,
  locked_by        TEXT,
  last_error       TEXT,
  requested_by     TEXT NOT NULL DEFAULT 'system',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- At most one open retry per publication target: makes enqueue idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS publication_retries_open_key
  ON publication_retries(site_id, post_id, event_type, platform)
  WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS publication_retries_due_idx
  ON publication_retries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS publication_retries_site_idx
  ON publication_retries(site_id, id DESC);
