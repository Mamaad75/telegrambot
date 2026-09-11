-- AI product creation and automation.
--
-- Everything here references the existing users/sites/plans tables: there is no
-- separate AI user, site, session or subscription model.
-- JSONB is used only for genuinely shaped-by-the-model data (AI output, job
-- payloads, provider metadata); everything queried or constrained is a column.

/* ------------------------------------------------------------------ *
 * WooCommerce connections — one per site, credentials encrypted
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS woocommerce_connections (
  id                     BIGSERIAL PRIMARY KEY,
  site_id                TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  base_url               TEXT NOT NULL,
  consumer_key_enc       TEXT NOT NULL,
  consumer_secret_enc    TEXT NOT NULL,
  -- WordPress application password, used for media uploads (wp/v2/media).
  wp_username            TEXT NOT NULL DEFAULT '',
  wp_app_password_enc    TEXT,
  status                 TEXT NOT NULL DEFAULT 'active',
  last_tested_at         TIMESTAMPTZ,
  last_test_ok           BOOLEAN,
  last_test_error        TEXT,
  store_info             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS woocommerce_connections_site_key
  ON woocommerce_connections(site_id);

/* ------------------------------------------------------------------ *
 * Per-site product automation rules
 *
 * Defaults are deliberately conservative: content generation on, everything
 * that writes to the customer's store or spends image credits off, and manual
 * approval required. Automatic publishing must be turned on explicitly.
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS site_product_settings (
  site_id                  TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  language                 TEXT NOT NULL DEFAULT 'fa',
  auto_generate_content    BOOLEAN NOT NULL DEFAULT true,
  auto_generate_images     BOOLEAN NOT NULL DEFAULT false,
  auto_assign_categories   BOOLEAN NOT NULL DEFAULT false,
  auto_generate_tags       BOOLEAN NOT NULL DEFAULT true,
  require_manual_approval  BOOLEAN NOT NULL DEFAULT true,
  auto_publish             BOOLEAN NOT NULL DEFAULT false,
  allow_category_creation  BOOLEAN NOT NULL DEFAULT false,
  allow_tag_creation       BOOLEAN NOT NULL DEFAULT true,
  replace_original_image   BOOLEAN NOT NULL DEFAULT false,
  default_product_status   TEXT NOT NULL DEFAULT 'draft',
  tone                     TEXT NOT NULL DEFAULT '',
  extra_instructions       TEXT NOT NULL DEFAULT '',
  updated_by_user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* ------------------------------------------------------------------ *
 * Product drafts — the reviewable unit before anything reaches WooCommerce
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS ai_product_drafts (
  id                   BIGSERIAL PRIMARY KEY,
  public_id            TEXT NOT NULL,
  user_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id              TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'draft',
  language             TEXT NOT NULL DEFAULT 'fa',
  -- exactly what the customer supplied, never overwritten by generation
  input                JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- last validated generation result
  generated            JSONB,
  -- fields the customer edited or locked; regeneration must not touch these
  locked_fields        JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_version      INTEGER NOT NULL DEFAULT 0,
  approved_version     INTEGER,
  published_version    INTEGER,
  provider             TEXT,
  model                TEXT,
  prompt_versions      JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings             JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence           NUMERIC(4,3),
  wc_product_id        BIGINT,
  wc_permalink         TEXT,
  wc_status            TEXT,
  error_code           TEXT,
  error_message        TEXT,
  idempotency_key      TEXT,
  approved_at          TIMESTAMPTZ,
  approved_by_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at         TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_product_drafts_public_key
  ON ai_product_drafts(public_id);
-- Idempotent creation: the same key from the same customer returns the same draft.
CREATE UNIQUE INDEX IF NOT EXISTS ai_product_drafts_idempotency_key
  ON ai_product_drafts(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- One draft per WooCommerce product: a double publish cannot fork into two.
CREATE UNIQUE INDEX IF NOT EXISTS ai_product_drafts_wc_product_key
  ON ai_product_drafts(site_id, wc_product_id)
  WHERE wc_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_product_drafts_user_idx ON ai_product_drafts(user_id, id DESC);
CREATE INDEX IF NOT EXISTS ai_product_drafts_site_idx ON ai_product_drafts(site_id, id DESC);
CREATE INDEX IF NOT EXISTS ai_product_drafts_status_idx ON ai_product_drafts(status);
CREATE INDEX IF NOT EXISTS ai_product_drafts_created_idx ON ai_product_drafts(created_at DESC);

/* ------------------------------------------------------------------ *
 * Version history — previous generations are kept, never overwritten
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS ai_product_versions (
  id              BIGSERIAL PRIMARY KEY,
  draft_id        BIGINT NOT NULL REFERENCES ai_product_drafts(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  source          TEXT NOT NULL,          -- ai_generation | user_edit | regeneration
  section         TEXT NOT NULL DEFAULT 'full',
  content         JSONB NOT NULL,
  provider        TEXT,
  model           TEXT,
  prompt_version  TEXT,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_product_versions_key
  ON ai_product_versions(draft_id, version);

/* ------------------------------------------------------------------ *
 * Job queue for AI work
 *
 * Separate from publication_retries on purpose: that queue re-sends one ad to
 * one platform and is keyed by (site, post, event, platform). AI jobs are
 * multi-step generation workflows keyed by draft. The claiming pattern
 * (FOR UPDATE SKIP LOCKED), backoff and stale reclaim are the same.
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS ai_jobs (
  id                BIGSERIAL PRIMARY KEY,
  public_id         TEXT NOT NULL,
  draft_id          BIGINT REFERENCES ai_product_drafts(id) ON DELETE CASCADE,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id           TEXT REFERENCES sites(id) ON DELETE CASCADE,
  type              TEXT NOT NULL,        -- generate | regenerate | publish | analyze_image | generate_image
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'pending',
  progress          JSONB NOT NULL DEFAULT '{}'::jsonb,
  result            JSONB,
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at         TIMESTAMPTZ,
  locked_by         TEXT,
  error_code        TEXT,
  last_error        TEXT,
  duration_ms       INTEGER,
  idempotency_key   TEXT,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_public_key ON ai_jobs(public_id);
-- At most one open job of a type per draft: a double click cannot start two
-- generations, and a repeated publish cannot create two products.
CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_open_key
  ON ai_jobs(draft_id, type)
  WHERE status IN ('pending','processing');
CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_idempotency_key
  ON ai_jobs(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_jobs_due_idx ON ai_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ai_jobs_draft_idx ON ai_jobs(draft_id, id DESC);
CREATE INDEX IF NOT EXISTS ai_jobs_user_idx ON ai_jobs(user_id, id DESC);
CREATE INDEX IF NOT EXISTS ai_jobs_created_idx ON ai_jobs(created_at DESC);

/* ------------------------------------------------------------------ *
 * Usage accounting — reserve before spending, finalize after
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS ai_usage (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id        TEXT REFERENCES sites(id) ON DELETE SET NULL,
  draft_id       BIGINT REFERENCES ai_product_drafts(id) ON DELETE SET NULL,
  job_id         BIGINT REFERENCES ai_jobs(id) ON DELETE SET NULL,
  operation      TEXT NOT NULL,           -- product_generation | image_generation | regeneration | image_analysis
  units          INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'reserved',  -- reserved | committed | released
  -- Billing period the usage counts against, e.g. 2026-08.
  period         TEXT NOT NULL,
  provider       TEXT,
  model          TEXT,
  tokens_in      INTEGER,
  tokens_out     INTEGER,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ai_usage_quota_idx
  ON ai_usage(user_id, period, operation, status);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_job_idx ON ai_usage(job_id);

/* ------------------------------------------------------------------ *
 * Product images — uploaded and generated, metadata only
 *
 * Bytes live on disk under AI_MEDIA_DIR; PostgreSQL stores references.
 * ------------------------------------------------------------------ */

CREATE TABLE IF NOT EXISTS ai_product_images (
  id                BIGSERIAL PRIMARY KEY,
  public_id         TEXT NOT NULL,
  draft_id          BIGINT REFERENCES ai_product_drafts(id) ON DELETE CASCADE,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id           TEXT REFERENCES sites(id) ON DELETE CASCADE,
  origin            TEXT NOT NULL,        -- user_upload | ai_generated
  purpose           TEXT NOT NULL DEFAULT 'product',
  source_image_id   BIGINT REFERENCES ai_product_images(id) ON DELETE SET NULL,
  storage_path      TEXT,
  mime_type         TEXT NOT NULL DEFAULT '',
  byte_size         INTEGER NOT NULL DEFAULT 0,
  width             INTEGER,
  height            INTEGER,
  checksum          TEXT,
  status            TEXT NOT NULL DEFAULT 'stored',
  provider          TEXT,
  model             TEXT,
  prompt            TEXT,
  prompt_version    TEXT,
  alt_text          TEXT NOT NULL DEFAULT '',
  position          INTEGER NOT NULL DEFAULT 0,
  analysis          JSONB,
  wp_media_id       BIGINT,
  wp_source_url     TEXT,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_product_images_public_key ON ai_product_images(public_id);
CREATE INDEX IF NOT EXISTS ai_product_images_draft_idx ON ai_product_images(draft_id, position, id);
CREATE INDEX IF NOT EXISTS ai_product_images_user_idx ON ai_product_images(user_id, id DESC);
-- Media upload idempotency: one WordPress media object per stored image.
CREATE UNIQUE INDEX IF NOT EXISTS ai_product_images_wp_media_key
  ON ai_product_images(site_id, wp_media_id)
  WHERE wp_media_id IS NOT NULL;

/* ------------------------------------------------------------------ *
 * Plan-level AI quotas
 *
 * NULL means "not granted"; -1 means unlimited. Existing plans keep working:
 * the defaults below only grant AI to paid plans, and the trial gets a taste.
 * ------------------------------------------------------------------ */

ALTER TABLE plans ADD COLUMN IF NOT EXISTS ai_products_per_month INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS ai_images_per_month INTEGER NOT NULL DEFAULT 0;

UPDATE plans SET ai_products_per_month = 3,  ai_images_per_month = 3   WHERE id = 'trial_7d'   AND ai_products_per_month = 0;
UPDATE plans SET ai_products_per_month = 20, ai_images_per_month = 20  WHERE id = 'monthly'    AND ai_products_per_month = 0;
UPDATE plans SET ai_products_per_month = 60, ai_images_per_month = 60  WHERE id = 'quarterly'  AND ai_products_per_month = 0;
UPDATE plans SET ai_products_per_month = 120,ai_images_per_month = 120 WHERE id = 'semiannual' AND ai_products_per_month = 0;
UPDATE plans SET ai_products_per_month = 300,ai_images_per_month = 300 WHERE id = 'annual'     AND ai_products_per_month = 0;
