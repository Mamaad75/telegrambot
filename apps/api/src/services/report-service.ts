import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Reports.
 *
 * These answer the questions Baimar has to answer about its own sales operation, not
 * about any one lead:
 *
 *   * Which source actually produces business? (patch 63)
 *   * Which service do we win, and which do we only ever pitch? (patch 64)
 *   * Is the pipeline converting, and where does it stall? (patch 62)
 *
 * Two rules run through all of them.
 *
 * First, every query respects the same visibility predicate as the rest of the platform:
 * archived and demo leads are excluded unless explicitly requested. A report that quietly
 * counted the twenty demo businesses would make OpenStreetMap look twice as productive as
 * it is, and somebody would make a budget decision on it.
 *
 * Second, a rate computed from a handful of leads is noise dressed as insight. Every rate
 * carries the denominator it came from, and one below `MIN_SAMPLE_FOR_RATE` is returned as
 * null so the UI prints "not enough data" instead of "0% win rate" for a service that has
 * been pitched twice.
 */

/** Below this many leads, a percentage says more about luck than about performance. */
export const MIN_SAMPLE_FOR_RATE = 5;

export interface ReportRange {
  from: Date;
  to: Date;
  days: number;
}

export function rangeFor(days: number): ReportRange {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
  return { from, to, days };
}

function visibility(includeDemo: boolean): Prisma.LeadWhereInput {
  return { isArchived: false, ...(includeDemo ? {} : { isDemo: false }) };
}

/** A percentage, or null when the sample is too small to mean anything. */
function rate(numerator: number, denominator: number): number | null {
  if (denominator < MIN_SAMPLE_FOR_RATE) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/* -------------------------------------------------------------------------- */
/*  Lead acquisition                                                           */
/* -------------------------------------------------------------------------- */

export interface AcquisitionPoint {
  date: string;
  created: number;
  qualified: number;
  hot: number;
}

/**
 * Leads created per day, with how many turned out to be worth calling.
 *
 * Grouped in application code rather than SQL so the same visibility predicate applies
 * — a raw date_trunc aggregate would have to re-implement it, and that is exactly the
 * kind of duplication that lets demo rows leak into one report and not another.
 */
export async function leadAcquisition(range: ReportRange, includeDemo = false): Promise<AcquisitionPoint[]> {
  const leads = await prisma.lead.findMany({
    where: { ...visibility(includeDemo), createdAt: { gte: range.from, lte: range.to } },
    select: { createdAt: true, leadScore: true, leadTemperature: true },
    orderBy: { createdAt: 'asc' },
  });

  const byDay = new Map<string, AcquisitionPoint>();
  for (let i = 0; i <= range.days; i++) {
    const day = new Date(range.from.getTime() + i * 24 * 3600 * 1000).toISOString().slice(0, 10);
    byDay.set(day, { date: day, created: 0, qualified: 0, hot: 0 });
  }

  for (const lead of leads) {
    const day = lead.createdAt.toISOString().slice(0, 10);
    const point = byDay.get(day);
    if (!point) continue;
    point.created++;
    if ((lead.leadScore ?? 0) >= 45) point.qualified++;
    if (lead.leadTemperature === 'HOT') point.hot++;
  }

  return [...byDay.values()];
}

/* -------------------------------------------------------------------------- */
/*  Lead quality                                                               */
/* -------------------------------------------------------------------------- */

export interface QualityReport {
  total: number;
  scored: number;
  unscored: number;
  withPhone: number;
  withWebsite: number;
  withoutWebsite: number;
  audited: number;
  averageScore: number | null;
  byTemperature: Array<{ temperature: string; count: number; share: number | null }>;
  /** Leads we could not score, and why — so the gap is fixable rather than mysterious. */
  blockers: Array<{ reason: string; count: number }>;
}

export async function leadQuality(range: ReportRange, includeDemo = false): Promise<QualityReport> {
  const where: Prisma.LeadWhereInput = { ...visibility(includeDemo), createdAt: { gte: range.from, lte: range.to } };

  const [total, scored, withPhone, withWebsite, withoutWebsite, audited, avg, byTemp, noPhoneNoSite, notCrawled] =
    await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.count({ where: { ...where, leadScore: { not: null } } }),
      prisma.lead.count({ where: { ...where, normalizedPhone: { not: null } } }),
      prisma.lead.count({ where: { ...where, websiteDomain: { not: null } } }),
      prisma.lead.count({ where: { ...where, websiteStatus: { in: ['NO_WEBSITE', 'SOCIAL_ONLY'] } } }),
      prisma.lead.count({ where: { ...where, websiteAudits: { some: {} } } }),
      prisma.lead.aggregate({ where: { ...where, leadScore: { not: null } }, _avg: { leadScore: true } }),
      prisma.lead.groupBy({ by: ['leadTemperature'], where, _count: true }),
      // A lead with no phone and no website cannot be contacted or researched.
      prisma.lead.count({ where: { ...where, normalizedPhone: null, websiteDomain: null } }),
      prisma.lead.count({ where: { ...where, websiteDomain: { not: null }, websiteAudits: { none: {} } } }),
    ]);

  return {
    total,
    scored,
    unscored: total - scored,
    withPhone,
    withWebsite,
    withoutWebsite,
    audited,
    averageScore: avg._avg.leadScore === null ? null : Math.round(avg._avg.leadScore),
    byTemperature: byTemp.map((t) => ({
      temperature: t.leadTemperature ?? 'UNSCORED',
      count: t._count,
      share: rate(t._count, total),
    })),
    blockers: [
      { reason: 'بدون شماره تماس و بدون وب‌سایت — قابل تماس یا بررسی نیست', count: noPhoneNoSite },
      { reason: 'وب‌سایت دارد اما هنوز بررسی نشده است', count: notCrawled },
      { reason: 'هنوز امتیازدهی نشده است', count: total - scored },
    ].filter((b) => b.count > 0),
  };
}

/* -------------------------------------------------------------------------- */
/*  Sales conversion                                                           */
/* -------------------------------------------------------------------------- */

export interface FunnelStage {
  key: string;
  labelFa: string;
  count: number;
  /** Share of the leads that entered the funnel. Null on a small sample. */
  shareOfTotal: number | null;
}

export interface ConversionReport {
  stages: FunnelStage[];
  contactRate: number | null;
  meetingRate: number | null;
  proposalRate: number | null;
  winRate: number | null;
  /** Median days from creation to won, when there are enough closed deals to say. */
  medianDaysToWin: number | null;
  sampleSize: number;
}

export async function salesConversion(range: ReportRange, includeDemo = false): Promise<ConversionReport> {
  const where: Prisma.LeadWhereInput = { ...visibility(includeDemo), createdAt: { gte: range.from, lte: range.to } };

  const [total, contacted, meetings, proposals, won, lost, wonLeads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...where, lastContactAt: { not: null } } }),
    prisma.lead.count({ where: { ...where, contactStatus: { in: ['MEETING', 'PROPOSAL', 'NEGOTIATION', 'WON'] } } }),
    prisma.lead.count({ where: { ...where, contactStatus: { in: ['PROPOSAL', 'NEGOTIATION', 'WON'] } } }),
    prisma.lead.count({ where: { ...where, contactStatus: 'WON' } }),
    prisma.lead.count({ where: { ...where, contactStatus: { in: ['LOST', 'NOT_INTERESTED'] } } }),
    prisma.lead.findMany({
      where: { ...where, wonAt: { not: null } },
      select: { createdAt: true, wonAt: true },
    }),
  ]);

  const durations = wonLeads
    .map((l) => (l.wonAt!.getTime() - l.createdAt.getTime()) / (24 * 3600 * 1000))
    .sort((a, b) => a - b);
  const medianDaysToWin =
    durations.length >= MIN_SAMPLE_FOR_RATE ? Math.round(durations[Math.floor(durations.length / 2)]) : null;

  return {
    stages: [
      { key: 'total', labelFa: 'سرنخ‌های جمع‌آوری‌شده', count: total, shareOfTotal: total > 0 ? 100 : null },
      { key: 'contacted', labelFa: 'تماس گرفته شد', count: contacted, shareOfTotal: rate(contacted, total) },
      { key: 'meeting', labelFa: 'جلسه', count: meetings, shareOfTotal: rate(meetings, total) },
      { key: 'proposal', labelFa: 'پیشنهاد ارسال شد', count: proposals, shareOfTotal: rate(proposals, total) },
      { key: 'won', labelFa: 'بسته‌شده — موفق', count: won, shareOfTotal: rate(won, total) },
      { key: 'lost', labelFa: 'بسته‌شده — ناموفق', count: lost, shareOfTotal: rate(lost, total) },
    ],
    contactRate: rate(contacted, total),
    meetingRate: rate(meetings, contacted),
    proposalRate: rate(proposals, meetings),
    // Win rate is measured against closed deals, not against every lead: a lead still in
    // the pipeline has not been lost, and counting it as such would understate the team.
    winRate: rate(won, won + lost),
    medianDaysToWin,
    sampleSize: total,
  };
}

/* -------------------------------------------------------------------------- */
/*  Source performance (patch 63)                                              */
/* -------------------------------------------------------------------------- */

export interface SourcePerformanceRow {
  providerKey: string;
  displayName: string;
  leads: number;
  qualified: number;
  hot: number;
  contacted: number;
  won: number;
  qualifiedRate: number | null;
  contactRate: number | null;
  winRate: number | null;
}

/**
 * Which lead source is actually worth paying for.
 *
 * This is the report that decides whether Google Places earns its bill. Counting leads
 * alone would answer the wrong question — a source that produces four hundred
 * uncontactable records is worse than one that produces forty good ones — so every
 * source is followed all the way to won.
 */
export async function sourcePerformance(range: ReportRange, includeDemo = false): Promise<SourcePerformanceRow[]> {
  const references = await prisma.leadSourceReference.findMany({
    where: {
      lead: { ...visibility(includeDemo), createdAt: { gte: range.from, lte: range.to } },
    },
    select: {
      providerKey: true,
      lead: { select: { id: true, leadScore: true, leadTemperature: true, lastContactAt: true, contactStatus: true } },
    },
  });

  const sources = await prisma.leadSource.findMany({ select: { key: true, displayName: true } });
  const displayNames = new Map(sources.map((s) => [s.key, s.displayName]));

  // A lead can carry references from several providers; each is credited once so two
  // sources that both found a business each get the credit for finding it.
  const seen = new Map<string, Set<string>>();
  const rows = new Map<string, SourcePerformanceRow>();

  for (const ref of references) {
    const key = ref.providerKey;
    if (!seen.has(key)) seen.set(key, new Set());
    if (seen.get(key)!.has(ref.lead.id)) continue;
    seen.get(key)!.add(ref.lead.id);

    const row =
      rows.get(key) ??
      ({
        providerKey: key,
        displayName: displayNames.get(key) ?? key,
        leads: 0,
        qualified: 0,
        hot: 0,
        contacted: 0,
        won: 0,
        qualifiedRate: null,
        contactRate: null,
        winRate: null,
      } satisfies SourcePerformanceRow);

    row.leads++;
    if ((ref.lead.leadScore ?? 0) >= 45) row.qualified++;
    if (ref.lead.leadTemperature === 'HOT') row.hot++;
    if (ref.lead.lastContactAt) row.contacted++;
    if (ref.lead.contactStatus === 'WON') row.won++;
    rows.set(key, row);
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      qualifiedRate: rate(row.qualified, row.leads),
      contactRate: rate(row.contacted, row.leads),
      winRate: rate(row.won, row.contacted),
    }))
    .sort((a, b) => b.leads - a.leads);
}

/* -------------------------------------------------------------------------- */
/*  Service performance (patch 64)                                             */
/* -------------------------------------------------------------------------- */

export interface ServicePerformanceRow {
  serviceKey: string;
  nameFa: string;
  leads: number;
  contacted: number;
  meetings: number;
  proposals: number;
  won: number;
  contactRate: number | null;
  meetingRate: number | null;
  proposalRate: number | null;
  winRate: number | null;
}

/**
 * How each recommended service performs once a salesperson takes it to a call.
 *
 * The point is to find the gap between what the engine recommends and what Baimar
 * actually sells: a service the engine recommends constantly and nobody ever wins is
 * either mis-scored or mis-priced, and either way that is worth knowing.
 */
export async function servicePerformance(range: ReportRange, includeDemo = false): Promise<ServicePerformanceRow[]> {
  const leads = await prisma.lead.findMany({
    where: {
      ...visibility(includeDemo),
      createdAt: { gte: range.from, lte: range.to },
      recommendedService: { not: null },
    },
    select: { recommendedService: true, lastContactAt: true, contactStatus: true },
  });

  const services = await prisma.service.findMany({ select: { key: true, nameFa: true } });
  const names = new Map(services.map((s) => [s.key, s.nameFa]));

  const rows = new Map<string, ServicePerformanceRow>();
  for (const lead of leads) {
    const key = lead.recommendedService!;
    const row =
      rows.get(key) ??
      ({
        serviceKey: key,
        nameFa: names.get(key) ?? key,
        leads: 0,
        contacted: 0,
        meetings: 0,
        proposals: 0,
        won: 0,
        contactRate: null,
        meetingRate: null,
        proposalRate: null,
        winRate: null,
      } satisfies ServicePerformanceRow);

    row.leads++;
    if (lead.lastContactAt) row.contacted++;
    if (['MEETING', 'PROPOSAL', 'NEGOTIATION', 'WON'].includes(lead.contactStatus)) row.meetings++;
    if (['PROPOSAL', 'NEGOTIATION', 'WON'].includes(lead.contactStatus)) row.proposals++;
    if (lead.contactStatus === 'WON') row.won++;
    rows.set(key, row);
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      contactRate: rate(row.contacted, row.leads),
      meetingRate: rate(row.meetings, row.contacted),
      proposalRate: rate(row.proposals, row.meetings),
      winRate: rate(row.won, row.proposals),
    }))
    .sort((a, b) => b.leads - a.leads);
}

/* -------------------------------------------------------------------------- */
/*  Campaign performance                                                       */
/* -------------------------------------------------------------------------- */

export interface CampaignPerformanceRow {
  campaignId: string;
  name: string;
  city: string | null;
  runs: number;
  collected: number;
  unique: number;
  qualified: number;
  hot: number;
  failed: number;
  errors: number;
  lastRunAt: Date | null;
  lastStatus: string | null;
  /** Unique leads per record collected — how much of the raw haul was worth keeping. */
  yieldRate: number | null;
}

export async function campaignPerformance(range: ReportRange): Promise<CampaignPerformanceRow[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { runs: { some: { createdAt: { gte: range.from, lte: range.to } } } },
    include: {
      runs: { where: { createdAt: { gte: range.from, lte: range.to } }, orderBy: { createdAt: 'desc' } },
    },
  });

  return campaigns
    .map((campaign) => {
      const totals = campaign.runs.reduce(
        (acc, run) => ({
          collected: acc.collected + run.collected,
          unique: acc.unique + run.unique,
          qualified: acc.qualified + run.qualified,
          hot: acc.hot + run.hot,
          failed: acc.failed + run.failed,
          errors: acc.errors + run.errors,
        }),
        { collected: 0, unique: 0, qualified: 0, hot: 0, failed: 0, errors: 0 },
      );

      return {
        campaignId: campaign.id,
        name: campaign.name,
        city: campaign.city,
        runs: campaign.runs.length,
        ...totals,
        lastRunAt: campaign.runs[0]?.createdAt ?? null,
        lastStatus: campaign.runs[0]?.status ?? null,
        yieldRate: rate(totals.unique, totals.collected),
      };
    })
    .sort((a, b) => (b.lastRunAt?.getTime() ?? 0) - (a.lastRunAt?.getTime() ?? 0));
}

/* -------------------------------------------------------------------------- */
/*  Service demand                                                             */
/* -------------------------------------------------------------------------- */

export interface ServiceDemandRow {
  serviceKey: string;
  nameFa: string;
  /** Leads whose best opportunity is this service. */
  recommendedFor: number;
  /** Market signal strength for this service, when one has been computed. */
  marketStrength: string | null;
  marketQuality: string | null;
  marketBasis: string | null;
}

/**
 * Where the supply of leads meets the demand signal.
 *
 * A service with many matching leads and a strong market signal is where the next
 * campaign should go; one with many leads and no signal is a guess, and the report says
 * so rather than filling the column with a number.
 */
export async function serviceDemand(includeDemo = false): Promise<ServiceDemandRow[]> {
  const [byService, services, signals] = await Promise.all([
    prisma.lead.groupBy({
      by: ['recommendedService'],
      where: { ...visibility(includeDemo), recommendedService: { not: null } },
      _count: true,
    }),
    prisma.service.findMany({ where: { isActive: true }, select: { key: true, nameFa: true } }),
    prisma.marketSignal.findMany({
      where: { isDemo: false },
      orderBy: { computedAt: 'desc' },
      select: { serviceKey: true, strength: true, quality: true, basis: true },
    }),
  ]);

  const counts = new Map(byService.map((s) => [s.recommendedService!, s._count]));
  const signalByService = new Map<string, (typeof signals)[number]>();
  for (const signal of signals) {
    if (signal.serviceKey && !signalByService.has(signal.serviceKey)) signalByService.set(signal.serviceKey, signal);
  }

  return services
    .map((service) => {
      const signal = signalByService.get(service.key);
      return {
        serviceKey: service.key,
        nameFa: service.nameFa,
        recommendedFor: counts.get(service.key) ?? 0,
        // Null, not "LOW": no signal means nobody has measured, which is different from
        // having measured and found little.
        marketStrength: signal?.strength ?? null,
        marketQuality: signal?.quality ?? null,
        marketBasis: signal?.basis ?? null,
      };
    })
    .sort((a, b) => b.recommendedFor - a.recommendedFor);
}
