-- Unified cross-platform account linking.
-- A Jarchi user can link exactly one Telegram identity and one Bale identity.
-- The link challenge is one-time, hashed at rest, short-lived, and platform-bound.

CREATE TABLE IF NOT EXISTS account_link_challenges (
  id                         BIGSERIAL PRIMARY KEY,
  token_hash                 TEXT NOT NULL UNIQUE,
  source_user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_platform            TEXT NOT NULL,
  target_platform            TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'pending',
  expires_at                 TIMESTAMPTZ NOT NULL,
  completed_at               TIMESTAMPTZ,
  completed_platform_user_id TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE account_link_challenges DROP CONSTRAINT IF EXISTS account_link_challenges_platform_check;
ALTER TABLE account_link_challenges ADD CONSTRAINT account_link_challenges_platform_check
  CHECK (source_platform IN ('telegram','bale') AND target_platform IN ('telegram','bale') AND source_platform <> target_platform);

ALTER TABLE account_link_challenges DROP CONSTRAINT IF EXISTS account_link_challenges_status_check;
ALTER TABLE account_link_challenges ADD CONSTRAINT account_link_challenges_status_check
  CHECK (status IN ('pending','completed','revoked','expired'));

CREATE INDEX IF NOT EXISTS account_link_challenges_source_idx
  ON account_link_challenges(source_user_id,status,expires_at DESC);
CREATE INDEX IF NOT EXISTS account_link_challenges_expiry_idx
  ON account_link_challenges(status,expires_at);

-- The product's invariant: at most one identity per platform can belong to one account.
-- Existing identities are already unique per (platform, platform_user_id).
CREATE UNIQUE INDEX IF NOT EXISTS identities_user_platform_key
  ON identities(user_id, platform);

-- A stale pending challenge is harmless but should not accumulate forever.
UPDATE account_link_challenges SET status='expired'
 WHERE status='pending' AND expires_at<=NOW();
