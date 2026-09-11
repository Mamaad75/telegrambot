CREATE INDEX IF NOT EXISTS idx_ai_usage_site_period_operation
  ON ai_usage(site_id, period, operation, status);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_site_period
  ON ai_usage(user_id, site_id, period);

CREATE INDEX IF NOT EXISTS idx_site_members_user_site_active
  ON site_members(user_id, site_id) WHERE status = 'active';
