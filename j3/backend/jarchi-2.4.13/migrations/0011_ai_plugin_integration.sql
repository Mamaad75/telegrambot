-- AI product integration metadata for first-party WordPress/plugin automation.
-- No existing data is rewritten; old drafts remain source_type='customer'.

ALTER TABLE ai_product_drafts
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS source_key TEXT,
  ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS ai_product_drafts_source_idx
  ON ai_product_drafts(site_id, source_type, source_id);

CREATE UNIQUE INDEX IF NOT EXISTS ai_product_drafts_source_key
  ON ai_product_drafts(site_id, source_type, source_key)
  WHERE source_key IS NOT NULL;

ALTER TABLE ai_jobs
  ADD COLUMN IF NOT EXISTS source_request_id TEXT;

CREATE INDEX IF NOT EXISTS ai_jobs_source_request_idx
  ON ai_jobs(source_request_id)
  WHERE source_request_id IS NOT NULL;
