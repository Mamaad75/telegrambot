import { stringify } from 'csv-stringify/sync';
import { formatPhoneForDisplay, BUSINESS_VALUE_LABELS, TEMPERATURE_LABELS } from '@baimar/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * CSV export.
 *
 * Exports carry the provenance columns too — the lead score, its temperature and the
 * recommended service are meaningless without knowing whether the website was actually
 * audited, so that column travels with them.
 */

export type ExportKind = 'leads' | 'hot_leads' | 'pipeline' | 'campaign' | 'market';

const LEAD_COLUMNS = [
  'business_name',
  'category',
  'city',
  'province',
  'phone',
  'phone_display',
  'mobile',
  'email',
  'website',
  'website_status',
  'instagram',
  'telegram',
  'lead_score',
  'lead_temperature',
  'business_value_score',
  'business_value_tier',
  'recommended_service',
  'secondary_services',
  'sales_angle',
  'pain_points',
  'contact_status',
  'assigned_to',
  'last_contact_at',
  'next_follow_up_at',
  'website_audited',
  'audit_overall_score',
  'review_count',
  'review_rating',
  'source_providers',
  'google_maps_url',
  'address',
  'is_demo',
  'created_at',
] as const;

export async function exportLeadsCsv(where: Prisma.LeadWhereInput, opts: { limit?: number } = {}): Promise<string> {
  const leads = await prisma.lead.findMany({
    where,
    include: {
      assignedTo: { select: { name: true } },
      sourceReferences: { select: { providerKey: true } },
      websiteAudits: { select: { overallScore: true, reachable: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: [{ leadScore: 'desc' }, { createdAt: 'desc' }],
    take: opts.limit ?? 5000,
  });

  const rows = leads.map((lead) => {
    const audit = lead.websiteAudits[0];
    return {
      business_name: lead.businessName,
      category: lead.category ?? '',
      city: lead.city ?? '',
      province: lead.province ?? '',
      phone: lead.normalizedPhone ?? '',
      phone_display: formatPhoneForDisplay(lead.normalizedPhone) ?? lead.originalPhone ?? '',
      mobile: lead.mobile ?? '',
      email: lead.email ?? '',
      website: lead.website ?? '',
      website_status: lead.websiteStatus,
      instagram: lead.instagramUrl ?? '',
      telegram: lead.telegramUrl ?? '',
      lead_score: lead.leadScore ?? '',
      lead_temperature: lead.leadTemperature ? TEMPERATURE_LABELS[lead.leadTemperature].fa : '',
      business_value_score: lead.businessValueScore ?? '',
      business_value_tier: BUSINESS_VALUE_LABELS[lead.businessValueTier].fa,
      recommended_service: lead.recommendedService ?? '',
      secondary_services: lead.secondaryServices.join(' | '),
      sales_angle: lead.salesAngle ?? '',
      pain_points: lead.painPoints.join(' | '),
      contact_status: lead.contactStatus,
      assigned_to: lead.assignedTo?.name ?? '',
      last_contact_at: lead.lastContactAt?.toISOString() ?? '',
      next_follow_up_at: lead.nextFollowUpAt?.toISOString() ?? '',
      website_audited: audit ? 'yes' : 'no',
      audit_overall_score: audit?.overallScore ?? '',
      review_count: lead.reviewCount ?? '',
      review_rating: lead.reviewRating ?? '',
      source_providers: Array.from(new Set(lead.sourceReferences.map((r) => r.providerKey))).join(' | '),
      google_maps_url: lead.googleMapsUrl ?? '',
      address: lead.address ?? '',
      is_demo: lead.isDemo ? 'DEMO' : '',
      created_at: lead.createdAt.toISOString(),
    };
  });

  // UTF-8 BOM so Excel on Windows opens Persian text correctly.
  return `﻿${stringify(rows, { header: true, columns: [...LEAD_COLUMNS] })}`;
}

export async function exportMarketCsv(): Promise<string> {
  const signals = await prisma.marketSignal.findMany({
    where: { isDemo: false },
    orderBy: [{ score: { sort: 'desc', nulls: 'last' } }],
    take: 2000,
  });
  const rows = signals.map((s) => ({
    service: s.serviceKey ?? '',
    city: s.city ?? '',
    province: s.province ?? '',
    strength: s.strength,
    score: s.score ?? '',
    basis: s.basis,
    sources: s.sources.join(' | '),
    sample_size: s.sampleSize,
    total_clicks: s.totalClicks ?? '',
    total_impressions: s.totalImpressions ?? '',
    total_conversions: s.totalConversions ?? '',
    period_start: s.periodStart?.toISOString().slice(0, 10) ?? '',
    period_end: s.periodEnd?.toISOString().slice(0, 10) ?? '',
    computed_at: s.computedAt.toISOString(),
  }));
  return `﻿${stringify(rows, { header: true })}`;
}

export async function exportPipelineCsv(): Promise<string> {
  const leads = await prisma.lead.findMany({
    where: { isArchived: false, isDemo: false },
    include: { assignedTo: { select: { name: true } }, calls: { select: { id: true } }, followUps: { where: { completedAt: null }, select: { dueAt: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 5000,
  });

  const rows = leads.map((lead) => ({
    business_name: lead.businessName,
    stage: lead.contactStatus,
    lead_score: lead.leadScore ?? '',
    recommended_service: lead.recommendedService ?? '',
    assigned_to: lead.assignedTo?.name ?? '',
    calls_logged: lead.calls.length,
    open_follow_ups: lead.followUps.length,
    next_follow_up: lead.followUps[0]?.dueAt?.toISOString() ?? '',
    last_contact_at: lead.lastContactAt?.toISOString() ?? '',
    won_at: lead.wonAt?.toISOString() ?? '',
    lost_at: lead.lostAt?.toISOString() ?? '',
    lost_reason: lead.lostReason ?? '',
  }));
  return `﻿${stringify(rows, { header: true })}`;
}
