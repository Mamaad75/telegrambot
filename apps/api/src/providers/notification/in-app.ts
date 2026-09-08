import type { NotificationMessage, NotificationProvider, ProviderDescriptor } from '../types';

/**
 * In-app notifications.
 *
 * The delivery itself is the database row that the notification service already wrote,
 * so this adapter is a no-op that always succeeds. It exists so the notification service
 * can treat every channel uniformly, and so "In-app" appears in Settings → Integrations
 * as a permanently available channel.
 */
export class InAppProvider implements NotificationProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'in_app',
    kind: 'NOTIFICATION',
    displayName: 'In-app notifications',
    description: 'Notification bell inside the dashboard. Always available.',
    requiredConfig: [],
    cost: 'FREE',
    priority: 100,
  };

  isConfigured(): boolean {
    return true;
  }

  missingConfig(): string[] {
    return [];
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Always available' };
  }

  async send(_message: NotificationMessage): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'stored' };
  }
}
