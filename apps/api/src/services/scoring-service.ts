import type { Lead, Prisma, WebsiteAudit } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getBusinessValueConfig, getScoringConfig } from '../lib/settings';
import { assessBusinessValue, type BusinessValueResult } from '../core/business-value';
import { buildMarketBoost } from '../core/market';
import { matchServices, pickRecommendations, type ServiceMatch } from '../core/opportunity';
import { buildSalesBrief } from '../core/sales-brief';
import { scoreLead, type ScoreResult } from '../core/scoring';
import { extractSignals, type SignalMap } from '../core/signals';

/**
 * Recomputation pipeline for a single lead.
 *
 * Order matters: business value feeds a scoring signal, market demand feeds the
 * opportunity engine, and the sales brief consumes all of them. Running this is cheap and
 * involves no external calls, so it is safe to re-run whenever anything about a lead
 * changes — after an audit, after a manual edit, after the admin re-tunes the weights.
 */

export interface RecalculationResult {
  lead: Lead;
  signals: SignalMap;
  score: ScoreResult;
  businessValue: BusinessValueResult;
  matches: ServiceMatch[];
  primary: ServiceMatch | null;
  secondary: ServiceMatch[];
}

export async function recalculateLead(
  leadId: string,
  opts: { regenerateBrief?: boolean; persist?: boolean } = {},
): Promise<RecalculationResult | null> {
  const persist = opts.persist ?? true;

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return null;

  const audit = await latestAudit(leadId);
  const [scoringConfig, valueConfig, services] = await Promise.all([
    getScoringConfig(),
    getBusinessValueConfig(),
    prisma.service.findMany({ where: { isActive: true } }),
  ]);

  // 1. Business value first — a HIGH tier is itself a scoring signal.
  const businessValue = assessBusinessValue(lead, audit, valueConfig);

  // 2. Market demand for this lead's city, used to boost matching services.
  const marketBoost = await buildMarketBoost(lead.city ?? null);

  // 3. Signals, without the market match; we need the services to know which one applies.
  let signals = extractSignals({ lead, audit, config: scoringConfig, businessValueTier: businessValue.tier });

  // 4. Opportunity matching.
  const opportunityContext = { businessValueTier: businessValue.tier, businessValueScore: businessValue.score };
  let matches = matchServices(signals, services, marketBoost, opportunityContext);
  let { primary, secondary } = pickRecommendations(matches);

  // 5. If the primary recommendation is backed by market demand, that is a scoring signal
  //    in its own right — recompute the signals once with it, then re-match.
  if (primary) {
    const boost = marketBoost(primary.serviceKey);
    if (boost) {
      signals = extractSignals({
        lead,
        audit,
        config: scoringConfig,
        businessValueTier: businessValue.tier,
        marketDemandMatch: { matched: true, evidence: boost.reasonFa },
      });
      matches = matchServices(signals, services, marketBoost, opportunityContext);
      ({ primary, secondary } = pickRecommendations(matches));
    }
  }

  // 6. Score.
  const score = scoreLead(signals, scoringConfig);

  if (!persist) {
    return { lead, signals, score, businessValue, matches, primary, secondary };
  }

  // --- Persist -------------------------------------------------------------
  await prisma.$transaction(async (tx) => {
    // Business signals: one row per observed signal, for the transparency panel.
    await tx.businessSignal.deleteMany({ where: { leadId } });
    const signalRows = Object.values(signals)
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({
        leadId,
        key: s.signal,
        value: s.value,
        evidence: s.evidence,
        confidence: s.confidence as Prisma.BusinessSignalCreateManyInput['confidence'],
        weightHint: scoringConfig.weights[s.signal] ?? null,
      }));
    if (signalRows.length) await tx.businessSignal.createMany({ data: signalRows });

    await tx.leadScore.create({
      data: {
        leadId,
        score: score.score,
        temperature: score.temperature,
        breakdown: score.contributions as unknown as Prisma.InputJsonValue,
        configHash: score.configHash,
        reason: score.summary,
      },
    });

    await tx.opportunity.deleteMany({ where: { leadId } });
    if (matches.length) {
      await tx.opportunity.createMany({
        data: matches.slice(0, 6).map((m) => ({
          leadId,
          serviceId: m.serviceId,
          serviceKey: m.serviceKey,
          score: m.score,
          level: m.level,
          reasons: m.reasonsFa,
          factors: m.factors as unknown as Prisma.InputJsonValue,
          marketBoost: m.marketBoost,
          isPrimary: m.serviceKey === primary?.serviceKey,
        })),
      });
    }

    await tx.lead.update({
      where: { id: leadId },
      data: {
        leadScore: score.score,
        leadTemperature: score.temperature,
        scoreBreakdown: score.contributions as unknown as Prisma.InputJsonValue,
        scoredAt: new Date(),
        businessValueScore: businessValue.score,
        businessValueTier: businessValue.tier,
        businessValueReasons: businessValue as unknown as Prisma.InputJsonValue,
        businessSizeEstimate: businessValue.sizeEstimate,
        recommendedService: primary?.serviceKey ?? null,
        secondaryServices: secondary.map((s) => s.serviceKey),
        salesAngle: primary?.reasonsFa?.[0] ?? null,
        painPoints: Object.values(signals)
          .filter((s) => s?.value && (scoringConfig.weights[s.signal] ?? 0) > 0)
          .map((s) => s!.evidence)
          .slice(0, 8),
        opportunities: matches.slice(0, 4).map((m) => `${m.nameFa} (${m.level})`),
      },
    });
  });

  const updated = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  if (opts.regenerateBrief !== false) {
    await regenerateSalesBrief(updated, { audit, signals, score, businessValue, primary, secondary, services });
  }

  return { lead: updated, signals, score, businessValue, matches, primary, secondary };
}

export async function latestAudit(leadId: string): Promise<WebsiteAudit | null> {
  return prisma.websiteAudit.findFirst({ where: { leadId }, orderBy: { createdAt: 'desc' } });
}

/**
 * Regenerate the sales brief from the current state, merging the newest AI analysis when
 * one exists. Previous briefs are kept but marked non-current, so the history is auditable.
 */
export async function regenerateSalesBrief(
  lead: Lead,
  ctx: {
    audit?: WebsiteAudit | null;
    signals?: SignalMap;
    score?: ScoreResult | null;
    businessValue?: BusinessValueResult | null;
    primary?: ServiceMatch | null;
    secondary?: ServiceMatch[];
    services?: Awaited<ReturnType<typeof prisma.service.findMany>>;
    useAi?: boolean;
  } = {},
): Promise<void> {
  const audit = ctx.audit !== undefined ? ctx.audit : await latestAudit(lead.id);
  const services = ctx.services ?? (await prisma.service.findMany({ where: { isActive: true } }));

  let signals = ctx.signals;
  let score = ctx.score ?? null;
  let businessValue = ctx.businessValue ?? null;
  let primary = ctx.primary ?? null;
  let secondary = ctx.secondary ?? [];

  if (!signals) {
    const [scoringConfig, valueConfig] = await Promise.all([getScoringConfig(), getBusinessValueConfig()]);
    businessValue = assessBusinessValue(lead, audit, valueConfig);
    signals = extractSignals({ lead, audit, config: scoringConfig, businessValueTier: businessValue.tier });
    score = scoreLead(signals, scoringConfig);
    const matches = matchServices(signals, services, await buildMarketBoost(lead.city ?? null));
    ({ primary, secondary } = pickRecommendations(matches));
  }

  const ai =
    ctx.useAi === false
      ? null
      : await prisma.aIAnalysis.findFirst({
          where: { leadId: lead.id, error: null },
          orderBy: { createdAt: 'desc' },
        });

  const content = buildSalesBrief({
    lead,
    audit,
    signals,
    score,
    businessValue,
    primary,
    secondary,
    services,
    ai,
  });

  const previous = await prisma.salesBrief.findFirst({
    where: { leadId: lead.id },
    orderBy: { version: 'desc' },
  });

  await prisma.$transaction([
    prisma.salesBrief.updateMany({ where: { leadId: lead.id, isCurrent: true }, data: { isCurrent: false } }),
    prisma.salesBrief.create({
      data: {
        leadId: lead.id,
        generatedBy: content.generatedBy,
        content: content as unknown as Prisma.InputJsonValue,
        aiAnalysisId: ai?.id ?? null,
        version: (previous?.version ?? 0) + 1,
        isCurrent: true,
      },
    }),
  ]);
}
