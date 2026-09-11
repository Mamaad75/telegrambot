-- Publication safety hardening for 1.3.1.
-- Do not edit 0006: applied migration checksums are immutable.
-- This migration is intentionally non-destructive. It guarantees the encrypted
-- contact phone column and update timestamp exist without deleting legacy data.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS contact_phone_enc TEXT;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Prevent pathological duplicate retry rows if an older database missed the
-- partial unique index from 0006.
CREATE UNIQUE INDEX IF NOT EXISTS publication_retries_open_key
  ON publication_retries(site_id, post_id, event_type, platform)
  WHERE status IN ('pending','processing');
