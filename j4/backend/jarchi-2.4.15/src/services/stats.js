import { query } from "../db/db.js";
import { config } from "../config.js";
import {
  publicationSummary, platformDistribution, recentFailures, recentPublications, dailyVolume,
} from "./publications.js";
import { retrySummary } from "./retry.js";

/**
 * Dashboard aggregation.
 *
 * The dashboard is polled by every open admin tab, so the result is cached for
 * config.dashboardCacheMs and the underlying counts are gathered as a handful of
 * grouped queries rather than one query per card.
 */
let cache = { at: 0, data: null };

export function invalidateDashboardCache() {
  cache = { at: 0, data: null };
}

async function collect(timezone) {
  const [clients, users, subscriptions, invoices, publications, platforms, retries, failures, recent, volume] =
    await Promise.all([
      query(`SELECT
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE enabled)::int AS active,
               COUNT(*) FILTER (WHERE NOT enabled)::int AS disabled,
               COUNT(*) FILTER (WHERE last_webhook_at >= NOW() - INTERVAL '7 days')::int AS active_last_7_days
             FROM sites`),
      query(`SELECT
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status='active')::int AS active,
               COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_last_30_days
             FROM users`),
      query(`SELECT
               COUNT(*) FILTER (WHERE status='active' AND expires_at > NOW())::int AS active,
               COUNT(*) FILTER (WHERE status='active' AND expires_at > NOW() AND expires_at <= NOW() + INTERVAL '7 days')::int AS expiring_7_days,
               COUNT(*) FILTER (WHERE status='expired' OR expires_at <= NOW())::int AS expired,
               COUNT(*) FILTER (WHERE plan_id='trial_7d' AND status='active' AND expires_at > NOW())::int AS active_trials
             FROM subscriptions`),
      query(`SELECT
               COUNT(*) FILTER (WHERE status='paid')::int AS paid,
               COUNT(*) FILTER (WHERE status='pending')::int AS pending,
               COUNT(*) FILTER (WHERE status='failed')::int AS failed,
               COALESCE(SUM(amount_toman) FILTER (WHERE status='paid'),0)::bigint AS paid_amount_toman,
               COALESCE(SUM(amount_toman) FILTER (WHERE status='paid' AND paid_at >= NOW() - INTERVAL '30 days'),0)::bigint AS paid_amount_last_30_days
             FROM invoices`),
      publicationSummary({ timezone }),
      platformDistribution(),
      retrySummary(),
      recentFailures(8),
      recentPublications(8),
      dailyVolume(14, timezone),
    ]);

  return {
    timezone,
    generated_at: new Date().toISOString(),
    clients: clients.rows[0],
    users: users.rows[0],
    subscriptions: subscriptions.rows[0],
    invoices: {
      ...invoices.rows[0],
      paid_amount_toman: Number(invoices.rows[0].paid_amount_toman),
      paid_amount_last_30_days: Number(invoices.rows[0].paid_amount_last_30_days),
    },
    publications,
    platform_distribution: platforms,
    retries,
    recent_failures: failures,
    recent_publications: recent,
    daily_volume: volume,
  };
}

export async function dashboard({ force = false, timezone = config.timezone } = {}) {
  const now = Date.now();
  if (!force && cache.data && now - cache.at < config.dashboardCacheMs && cache.data.timezone === timezone) {
    return { ...cache.data, cached: true };
  }
  const data = await collect(timezone);
  cache = { at: now, data };
  return { ...data, cached: false };
}

/** Compact figures for the Telegram admin dashboard message. */
export async function dashboardSummary({ timezone = config.timezone } = {}) {
  const data = await dashboard({ timezone });
  const platforms = Object.fromEntries(
    data.platform_distribution.map((row) => [row.platform, { published: row.published, failed: row.failed }]),
  );
  return {
    clients: data.clients,
    users: data.users,
    subscriptions: data.subscriptions,
    publications: data.publications,
    platforms,
    retries: data.retries,
    generated_at: data.generated_at,
  };
}
