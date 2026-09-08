import nodemailer, { type Transporter } from 'nodemailer';
import { loadEnv } from '../../config/env';
import { ProviderError } from '../../lib/errors';
import type { NotificationMessage, NotificationProvider, ProviderDescriptor } from '../types';

/** Optional SMTP notifier. Disabled unless SMTP_HOST is configured. */
export class EmailProvider implements NotificationProvider {
  readonly descriptor: ProviderDescriptor = {
    key: 'email_smtp',
    kind: 'NOTIFICATION',
    displayName: 'E-mail (SMTP)',
    description: 'Sends notifications over SMTP. Optional.',
    requiredConfig: ['SMTP_HOST', 'SMTP_FROM'],
    cost: 'FREE',
    defaultRateLimit: { perMinute: 20, perHour: 300, perDay: 2000 },
    priority: 50,
  };

  private transporter: Transporter | null = null;

  isConfigured(): boolean {
    return Boolean(loadEnv().SMTP_HOST);
  }

  missingConfig(): string[] {
    return this.isConfigured() ? [] : ['SMTP_HOST'];
  }

  private getTransport(): Transporter {
    if (this.transporter) return this.transporter;
    const e = loadEnv();
    this.transporter = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
    });
    return this.transporter;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) return { ok: false, message: 'SMTP_HOST is not set' };
    try {
      await this.getTransport().verify();
      return { ok: true, message: 'SMTP connection verified' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'verification failed' };
    }
  }

  async send(message: NotificationMessage): Promise<{ ok: boolean; message: string }> {
    if (!this.isConfigured()) throw new ProviderError(this.descriptor.key, 'SMTP_HOST is not configured');
    if (!message.target) return { ok: false, message: 'No e-mail address for this recipient' };

    const e = loadEnv();
    const info = await this.getTransport().sendMail({
      from: e.SMTP_FROM,
      to: message.target,
      subject: message.title,
      text: [message.body, message.url].filter(Boolean).join('\n\n'),
    });
    return { ok: true, message: `sent (${info.messageId})` };
  }
}
