import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_BUSINESS_VALUE_CONFIG,
  DEFAULT_SCORING_CONFIG,
  SCORING_SIGNALS,
  SCORING_SIGNAL_META,
  SIGNAL_GROUPS,
  SIGNAL_GROUP_OF,
} from '@baimar/shared';
import { recordAudit } from '../lib/audit-log';
import { prisma } from '../lib/prisma';
import {
  SETTING_KEYS,
  getAiSettings,
  getBusinessValueConfig,
  getCrawlerSettings,
  getGeneralSettings,
  getMarketSettings,
  getNotificationSettings,
  getScoringConfig,
  invalidateSettingsCache,
  writeSetting,
} from '../lib/settings';
import { recalculateLead } from '../services/scoring-service';
import { enqueue } from '../queue/queues';

/**
 * Administrator settings.
 *
 * Changing scoring weights or thresholds makes every stored score stale, so the endpoint
 * offers to re-score in the background rather than leaving the numbers silently wrong.
 */

const scoringSchema = z.object({
  weights: z.record(z.enum(SCORING_SIGNALS), z.number().min(-50).max(50)),
  thresholds: z.object({ hot: z.number().min(1).max(100), warm: z.number().min(1).max(100), medium: z.number().min(0).max(100) }),
  audit: z.object({
    seo: z.number().min(0).max(100),
    mobile: z.number().min(0).max(100),
    performance: z.number().min(0).max(100),
    ux: z.number().min(0).max(100),
    conversion: z.number().min(0).max(100),
    technical: z.number().min(0).max(100),
    highReviewCount: z.number().min(0).max(10000),
  }),
  groupCaps: z
    .object({
      PRESENCE: z.number().min(0).max(100),
      WEBSITE_QUALITY: z.number().min(0).max(100),
      CAPABILITY: z.number().min(0).max(100),
      POTENTIAL: z.number().min(0).max(100),
    })
    .optional(),
  strongCategories: z.array(z.string().min(1).max(80)).max(200),
});

export default async function settingsRoutes(app: FastifyInstance) {
  app.get('/', { onRequest: [app.requirePermission('settings:read')] }, async () => {
    const [scoring, businessValue, ai, crawler, market, notifications, general] = await Promise.all([
      getScoringConfig(),
      getBusinessValueConfig(),
      getAiSettings(),
      getCrawlerSettings(),
      getMarketSettings(),
      getNotificationSettings(),
      getGeneralSettings(),
    ]);

    return {
      scoring,
      businessValue,
      // The AI section never reveals keys — only which provider is selected.
      ai,
      crawler,
      market,
      notifications,
      general,
      meta: {
        signals: SCORING_SIGNALS.map((key) => ({
          key,
          labelFa: SCORING_SIGNAL_META[key].labelFa,
          labelEn: SCORING_SIGNAL_META[key].labelEn,
          criterion: SCORING_SIGNAL_META[key].criterion,
          defaultWeight: SCORING_SIGNAL_META[key].defaultWeight,
        })),
        groups: SIGNAL_GROUPS.map((group) => ({
          group,
          signals: SCORING_SIGNALS.filter((s) => SIGNAL_GROUP_OF[s] === group),
        })),
        defaults: { scoring: DEFAULT_SCORING_CONFIG, businessValue: DEFAULT_BUSINESS_VALUE_CONFIG },
      },
    };
  });

  app.put('/scoring', { onRequest: [app.requirePermission('settings:write')] }, async (req) => {
    const body = z.object({ config: scoringSchema, rescoreAll: z.boolean().default(true) }).parse(req.body);
    const before = await getScoringConfig();

    const merged = {
      ...DEFAULT_SCORING_CONFIG,
      ...body.config,
      weights: { ...DEFAULT_SCORING_CONFIG.weights, ...body.config.weights },
      groupCaps: { ...DEFAULT_SCORING_CONFIG.groupCaps, ...(body.config.groupCaps ?? {}) },
    };

    await writeSetting(SETTING_KEYS.scoring, merged, req.user!.id, 'Lead scoring weights and thresholds');
    await recordAudit({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'settings.scoring_updated',
      before,
      after: merged,
      ip: req.ip,
    });

    let queued = 0;
    if (body.rescoreAll) {
      // Weights changed: every stored score is now stale. Re-score in the background.
      const leads = await prisma.lead.findMany({ where: { isArchived: false }, select: { id: true }, take: 5000 });
      for (const lead of leads) {
        const jobId = await enqueue('calculate_score', { leadId: lead.id });
        if (jobId) queued++;
      }
      if (!queued && leads.length) {
        // No queue available: do a bounded synchronous pass so the UI is not left wrong.
        for (const lead of leads.slice(0, 200)) await recalculateLead(lead.id).catch(() => undefined);
      }
    }

    return { config: merged, rescoreQueued: queued };
  });

  app.put('/business-value', { onRequest: [app.requirePermission('settings:write')] }, async (req) => {
    const body = z.object({ config: z.record(z.string(), z.unknown()) }).parse(req.body);
    const merged = { ...DEFAULT_BUSINESS_VALUE_CONFIG, ...(body.config as Record<string, unknown>) };
    await writeSetting(SETTING_KEYS.businessValue, merged, req.user!.id, 'Business value scoring');
    return { config: merged };
  });

  app.put('/ai', { onRequest: [app.requirePermission('settings:write')] }, async (req) => {
    const body = z
      .object({
        provider: z.enum(['anthropic', 'openai', 'compatible', 'local', 'none']),
        model: z.string().max(120).nullable().optional(),
        temperature: z.number().min(0).max(2),
        maxTokens: z.number().int().min(256).max(16000),
        monthlyBudgetUsd: z.number().min(0).max(100000),
        minLeadScore: z.number().int().min(0).max(100),
        cacheEnabled: z.boolean(),
      })
      .parse(req.body);

    await writeSetting(SETTING_KEYS.ai, body, req.user!.id, 'AI provider and cost controls');
    await recordAudit({ userId: req.user!.id, actorEmail: req.user!.email, action: 'settings.ai_updated', after: body, ip: req.ip });
    return { config: body };
  });

  app.put('/crawler', { onRequest: [app.requirePermission('settings:write')] }, async (req) => {
    const body = z
      .object({
        respectRobots: z.boolean(),
        maxPages: z.number().int().min(1).max(20),
        timeoutMs: z.number().int().min(2000).max(60000),
        delayMs: z.number().int().min(200).max(30000),
        maxBytes: z.number().int().min(100_000).max(20_000_000),
        reauditAfterHours: z.number().int().min(1).max(24 * 365),
      })
      .parse(req.body);

    await writeSetting(SETTING_KEYS.crawler, body, req.user!.id, 'Website crawler budget and politeness');
    return { config: body };
  });

  app.put('/market', { onRequest: [app.requirePermission('settings:write')] }, async (req) => {
    const body = z
      .object({
        minSampleSize: z.number().int().min(1).max(1000),
        lookbackDays: z.number().int().min(7).max(730),
        thresholds: z.object({
          veryHigh: z.number().min(1).max(100),
          high: z.number().min(1).max(100),
          medium: z.number().min(1).max(100),
          low: z.number().min(0).max(100),
        }),
      })
      .parse(req.body);

    await writeSetting(SETTING_KEYS.market, body, req.user!.id, 'Market demand aggregation');
    await enqueue('market_analysis', {});
    return { config: body };
  });

  app.put('/notifications', { onRequest: [app.requirePermission('settings:write')] }, async (req) => {
    const body = z
      .object({
        hotLeadThreshold: z.number().int().min(0).max(100),
        telegramEnabled: z.boolean(),
        emailEnabled: z.boolean(),
        inAppEnabled: z.boolean(),
        dailySummaryHour: z.number().int().min(0).max(23),
      })
      .parse(req.body);

    await writeSetting(SETTING_KEYS.notifications, body, req.user!.id, 'Notification behaviour');
    return { config: body };
  });

  app.put('/general', { onRequest: [app.requirePermission('settings:write')] }, async (req) => {
    const body = z
      .object({
        organizationName: z.string().min(1).max(120),
        defaultCountry: z.string().length(2),
        defaultCity: z.string().max(80).nullable(),
        showDemoData: z.boolean(),
        currency: z.string().max(8),
      })
      .parse(req.body);

    await writeSetting(SETTING_KEYS.general, body, req.user!.id, 'General preferences');
    return { config: body };
  });

  app.post('/reset-cache', { onRequest: [app.requirePermission('settings:write')] }, async () => {
    await invalidateSettingsCache();
    return { ok: true };
  });
}
