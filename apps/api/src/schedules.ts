import { getNotificationSettings } from './lib/settings';
import { pruneRefreshTokens } from './services/auth-service';
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

  // Token cleanup: daily.
  timers.push(
    setInterval(
      () => {
        void pruneRefreshTokens().catch(() => undefined);
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
