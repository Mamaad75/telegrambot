import { getNotificationSettings } from './lib/settings';
import { logger } from './lib/logger';
import { pruneRefreshTokens } from './services/auth-service';
import { closeStalledRuns } from './services/campaign-service';
import { cleanupExpiredCache, runRetentionCleanup } from './services/cleanup-service';
import { notifyDueFollowUps, sendDailySummary } from './services/notification-service';
import { enqueue } from './queue/queues';

/**
 * Periodic maintenance.
 *
 * Deliberately implemented with plain intervals rather than a cron dependency: the tasks
 * are idempotent, and a missed tick simply happens on the next one.
 */

const timers: NodeJS.Timeout[] = [];
let lastDailySummaryDay: number | null = null;

const MINUTE = 60_000;

export function startSchedules(): void {
  if (timers.length) return;

  // Follow-up reminders: every 10 minutes.
  timers.push(
    setInterval(() => {
      void notifyDueFollowUps().catch((err) => console.error('[schedule] follow-up reminders failed:', err));
    }, 10 * MINUTE),
  );

  // Market re-aggregation: every 6 hours.
  timers.push(
    setInterval(
      () => {
        void enqueue('market_analysis', { syncProviders: true }).catch(() => undefined);
      },
      6 * 60 * MINUTE,
    ),
  );

  // Stalled campaign runs: every 15 minutes.
  //
  // A run must always reach a terminal state. Jobs can be lost in ways no retry policy
  // covers — the worker container is replaced mid-crawl, Redis is flushed — and without
  // this sweep the campaign would sit at RUNNING while a salesperson waits for a list
  // that is never coming.
  timers.push(
    setInterval(
      () => {
        void closeStalledRuns()
          .then((closed) => {
            if (closed > 0) logger.warn({ scope: 'schedule', closed }, 'closed stalled campaign run(s)');
          })
          .catch((err) => logger.error({ scope: 'schedule', err: String(err) }, 'stalled-run sweep failed'));
      },
      15 * MINUTE,
    ),
  );

  // Housekeeping: daily. Token pruning, log retention and cache cleanup.
  //
  // CRM records are deliberately out of scope here — see cleanup-service.ts.
  timers.push(
    setInterval(
      () => {
        void (async () => {
          try {
            await pruneRefreshTokens();
            await runRetentionCleanup();
            await cleanupExpiredCache();
          } catch (err) {
            logger.error({ scope: 'schedule', err: String(err) }, 'daily housekeeping failed');
          }
        })();
      },
      24 * 60 * MINUTE,
    ),
  );

  // Daily summary: checked every 15 minutes, sent once on the configured hour.
  timers.push(
    setInterval(
      () => {
        void (async () => {
          try {
            const settings = await getNotificationSettings();
            const now = new Date();
            if (now.getHours() !== settings.dailySummaryHour) return;
            if (lastDailySummaryDay === now.getDate()) return;
            lastDailySummaryDay = now.getDate();
            await sendDailySummary();
          } catch (err) {
            console.error('[schedule] daily summary failed:', err);
          }
        })();
      },
      15 * MINUTE,
    ),
  );

  for (const timer of timers) timer.unref?.();
}

export function stopSchedules(): void {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}
