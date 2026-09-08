import { loadEnv } from '../../config/env';
import { ProviderError } from '../../lib/errors';
import { httpJson } from '../../lib/http';
import type { NotificationMessage, NotificationProvider, ProviderDescriptor } from '../types';

/**
 * Telegram Bot API notifier.
 *
 * Optional: with no bot token the platform still records every notification in-app, and
 * Settings → Integrations shows Telegram as "Not configured".
 */

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: { message_id: number };
}

export class TelegramProvider implements NotificationProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'telegram',
    kind: 'NOTIFICATION',
    displayName: 'Telegram bot',
    description: 'Sends hot-lead alerts, follow-up reminders and daily summaries to Telegram.',
    requiredConfig: ['TELEGRAM_BOT_TOKEN'],
    cost: 'FREE',
    docsUrl: 'https://core.telegram.org/bots/api',
    defaultRateLimit: { perMinute: 20, perHour: 500, perDay: 5000 },
    priority: 90,
  };

  isConfigured(): boolean {
    return Boolean(loadEnv().TELEGRAM_BOT_TOKEN);
  }

  missingConfig(): string[] {
    return this.isConfigured() ? [] : ['TELEGRAM_BOT_TOKEN'];
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) return { ok: false, message: 'TELEGRAM_BOT_TOKEN is not set' };
    const e = loadEnv();
    try {
      const { data } = await httpJson<TelegramResponse & { result?: { username?: string } }>(
        `${e.TELEGRAM_API_BASE}/bot${e.TELEGRAM_BOT_TOKEN}/getMe`,
        { timeoutMs: 10000, retries: 1, providerKey: this.descriptor.key },
      );
      return data.ok
        ? { ok: true, message: `Connected as @${data.result?.username ?? 'bot'}` }
        : { ok: false, message: data.description ?? 'getMe failed' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'unreachable' };
    }
  }

  async send(message: NotificationMessage): Promise<{ ok: boolean; message: string }> {
    const e = loadEnv();
    if (!this.isConfigured()) throw new ProviderError(this.descriptor.key, 'TELEGRAM_BOT_TOKEN is not configured');

    const chatId = message.target ?? e.TELEGRAM_DEFAULT_CHAT_ID;
    if (!chatId) {
      return { ok: false, message: 'No Telegram chat id for this recipient (set one on the user, or TELEGRAM_DEFAULT_CHAT_ID)' };
    }

    const text = [`*${escapeMarkdown(message.title)}*`, escapeMarkdown(message.body), message.url ? message.url : '']
      .filter(Boolean)
      .join('\n\n');

    const { data } = await httpJson<TelegramResponse>(`${e.TELEGRAM_API_BASE}/bot${e.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
      timeoutMs: 15000,
      retries: 2,
      providerKey: this.descriptor.key,
    });

    return data.ok ? { ok: true, message: 'sent' } : { ok: false, message: data.description ?? 'send failed' };
  }
}

/** MarkdownV2 requires escaping a fixed set of characters, or Telegram rejects the message. */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
