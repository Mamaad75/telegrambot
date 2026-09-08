import {
  businessNameKey,
  extractDomain,
  normalizeBusinessName,
  normalizePhone,
  provinceForCity,
} from '@baimar/shared';
import { Prisma, type Lead } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { contributedFields, findDuplicate, mergeIntoLead, normalizeCandidate } from '../core/dedupe';
import type { DiscoveredBusiness } from '../providers/types';

/**
 * Lead ingestion.
 *
 * Every path into the Lead table — campaign discovery, CSV import, manual creation —
 * goes through here, so normalization, deduplication and source attribution are applied
 * uniformly and exactly once.
 */

export interface IngestOptions {
  campaignId?: string | null;
  createdById?: string | null;
  isDemo?: boolean;
  /** Skip the duplicate search (used by the demo seeder, which controls its own ids). */
  skipDedupe?: boolean;
}

export type IngestOutcome =
  | { action: 'created'; lead: Lead }
  | { action: 'merged'; lead: Lead; rule: string; evidence: string; filledFields: string[] }
  | { action: 'rejected'; reason: string };

export async function ingestBusiness(business: DiscoveredBusiness, opts: IngestOptions = {}): Promise<IngestOutcome> {
  const name = business.name?.trim();
  if (!name || name.length < 2) return { action: 'rejected', reason: 'missing-or-too-short-name' };

  const candidate = normalizeCandidate(business);

  if (!opts.skipDedupe) {
    const duplicate = await findDuplicate(candidate, { includeDemo: opts.isDemo });
    if (duplicate) {
      const existing = await prisma.lead.findUnique({ where: { id: duplicate.leadId } });
      if (existing) {
        const { data, filledFields } = mergeIntoLead(existing, business);
        const updated = Object.keys(data).length
          ? await prisma.lead.update({ where: { id: existing.id }, data: data as Prisma.LeadUpdateInput })
          : existing;

        await addSourceReference(updated.id, business);
        return {
          action: 'merged',
          lead: updated,
          rule: duplicate.rule,
          evidence: duplicate.evidence,
          filledFields,
        };
      }
    }
  }

  const phone = normalizePhone(business.phone ?? null);
  const province = business.province ?? (business.city ? provinceForCity(business.city) : null);

  const lead = await prisma.lead.create({
    data: {
      businessName: name,
      normalizedBusinessName: normalizeBusinessName(name),
      nameKey: businessNameKey(name),
      businessType: business.businessType ?? null,
      category: business.category ?? null,
      subcategory: business.subcategory ?? null,
      country: business.country ?? 'IR',
      province,
      city: business.city ?? null,
      area: business.area ?? null,
      address: business.address ?? null,
      latitude: business.latitude ?? null,
      longitude: business.longitude ?? null,
      originalPhone: business.phone ?? null,
      normalizedPhone: phone.valid ? phone.e164 : null,
      mobile: phone.kind === 'MOBILE' ? phone.e164 : null,
      extraPhones: business.extraPhones ?? [],
      email: business.email ?? null,
      website: business.website ?? null,
      websiteDomain: extractDomain(business.website ?? null),
      // A URL supplied by a directory is a claim, not a verified fact, until we fetch it.
      websiteStatus: business.website ? 'NOT_VERIFIED' : 'UNKNOWN',
      googleMapsUrl: business.googleMapsUrl ?? null,
      instagramUrl: business.instagramUrl ?? null,
      telegramUrl: business.telegramUrl ?? null,
      linkedinUrl: business.linkedinUrl ?? null,
      whatsappUrl: business.whatsappUrl ?? null,
      facebookUrl: business.facebookUrl ?? null,
      description: business.description ?? null,
      services: business.services ?? [],
      products: business.products ?? [],
      openingHours: (business.openingHours as Prisma.InputJsonValue) ?? Prisma.DbNull,
      reviewCount: business.reviewCount ?? null,
      reviewRating: business.reviewRating ?? null,
      campaignId: opts.campaignId ?? null,
      createdById: opts.createdById ?? null,
      isDemo: opts.isDemo ?? false,
    },
  });

  await addSourceReference(lead.id, business);
  return { action: 'created', lead };
}

/** Record where a piece of lead data came from. Idempotent per (provider, externalId, lead). */
export async function addSourceReference(leadId: string, business: DiscoveredBusiness): Promise<void> {
  const leadSource = await prisma.leadSource.findUnique({ where: { key: business.providerKey } }).catch(() => null);
  try {
    await prisma.leadSourceReference.upsert({
      where: {
        providerKey_externalId_leadId: {
          providerKey: business.providerKey,
          externalId: business.externalId ?? '',
          leadId,
        },
      },
      create: {
        leadId,
        leadSourceId: leadSource?.id ?? null,
        providerKey: business.providerKey,
        externalId: business.externalId ?? '',
        sourceUrl: business.sourceUrl ?? null,
        fields: contributedFields(business),
        origin: business.origin,
        raw: (business.raw as Prisma.InputJsonValue) ?? Prisma.DbNull,
      },
      update: {
        sourceUrl: business.sourceUrl ?? null,
        fields: contributedFields(business),
        raw: (business.raw as Prisma.InputJsonValue) ?? Prisma.DbNull,
        fetchedAt: new Date(),
      },
    });
  } catch {
    // A unique-constraint race means another worker recorded the same reference. Fine.
  }
}

/** Re-derive the normalized columns for an existing lead (after a manual edit or import). */
export async function normalizeLead(leadId: string): Promise<Lead | null> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return null;

  const phone = normalizePhone(lead.originalPhone ?? lead.normalizedPhone);
  const data: Prisma.LeadUpdateInput = {
    normalizedBusinessName: normalizeBusinessName(lead.businessName),
    nameKey: businessNameKey(lead.businessName),
    normalizedPhone: phone.valid ? phone.e164 : null,
    mobile: phone.kind === 'MOBILE' ? phone.e164 : lead.mobile,
    websiteDomain: extractDomain(lead.website),
  };
  if (!lead.province && lead.city) data.province = provinceForCity(lead.city);
  if (lead.website && lead.websiteStatus === 'UNKNOWN') data.websiteStatus = 'NOT_VERIFIED';

  return prisma.lead.update({ where: { id: leadId }, data });
}

/**
 * Find every lead that looks like a duplicate of the given one, without merging.
 * Used by the "possible duplicates" panel so a human decides.
 */
export async function findPossibleDuplicates(leadId: string): Promise<Array<{ lead: Lead; rule: string; evidence: string }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return [];

  const out: Array<{ lead: Lead; rule: string; evidence: string }> = [];
  const seen = new Set<string>([leadId]);

  if (lead.normalizedPhone) {
    const rows = await prisma.lead.findMany({
      where: { normalizedPhone: lead.normalizedPhone, id: { not: leadId }, isArchived: false },
      take: 10,
    });
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ lead: r, rule: 'phone', evidence: `Same phone number (${lead.normalizedPhone})` });
    }
  }

  if (lead.websiteDomain) {
    const rows = await prisma.lead.findMany({
      where: { websiteDomain: lead.websiteDomain, id: { not: leadId }, isArchived: false },
      take: 10,
    });
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ lead: r, rule: 'website-domain', evidence: `Same website domain (${lead.websiteDomain})` });
    }
  }

  const rows = await prisma.lead.findMany({
    where: { nameKey: lead.nameKey, id: { not: leadId }, isArchived: false },
    take: 10,
  });
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ lead: r, rule: 'name-key', evidence: 'Identical normalized business name' });
  }

  return out;
}

/**
 * Merge one lead into another: source references and CRM history move across, the
 * duplicate is archived rather than deleted so the merge stays auditable.
 */
export async function mergeLeads(primaryId: string, duplicateId: string): Promise<Lead> {
  if (primaryId === duplicateId) throw new Error('Cannot merge a lead into itself');

  const [primary, duplicate] = await Promise.all([
    prisma.lead.findUniqueOrThrow({ where: { id: primaryId } }),
    prisma.lead.findUniqueOrThrow({ where: { id: duplicateId } }),
  ]);

  const { data } = mergeIntoLead(primary, {
    providerKey: 'merge',
    origin: 'MANUAL_ENTRY',
    name: duplicate.businessName,
    category: duplicate.category ?? undefined,
    subcategory: duplicate.subcategory ?? undefined,
    businessType: duplicate.businessType ?? undefined,
    city: duplicate.city ?? undefined,
    province: duplicate.province ?? undefined,
    area: duplicate.area ?? undefined,
    address: duplicate.address ?? undefined,
    latitude: duplicate.latitude ?? undefined,
    longitude: duplicate.longitude ?? undefined,
    phone: duplicate.originalPhone ?? duplicate.normalizedPhone ?? undefined,
    email: duplicate.email ?? undefined,
    website: duplicate.website ?? undefined,
    googleMapsUrl: duplicate.googleMapsUrl ?? undefined,
    instagramUrl: duplicate.instagramUrl ?? undefined,
    telegramUrl: duplicate.telegramUrl ?? undefined,
    linkedinUrl: duplicate.linkedinUrl ?? undefined,
    description: duplicate.description ?? undefined,
    services: duplicate.services,
    products: duplicate.products,
    reviewCount: duplicate.reviewCount ?? undefined,
    reviewRating: duplicate.reviewRating ?? undefined,
  });

  return prisma.$transaction(async (tx) => {
    const updated = Object.keys(data).length
      ? await tx.lead.update({ where: { id: primaryId }, data: data as Prisma.LeadUpdateInput })
      : primary;

    await tx.leadSourceReference.updateMany({ where: { leadId: duplicateId }, data: { leadId: primaryId } });
    await tx.salesActivity.updateMany({ where: { leadId: duplicateId }, data: { leadId: primaryId } });
    await tx.note.updateMany({ where: { leadId: duplicateId }, data: { leadId: primaryId } });
    await tx.call.updateMany({ where: { leadId: duplicateId }, data: { leadId: primaryId } });
    await tx.task.updateMany({ where: { leadId: duplicateId }, data: { leadId: primaryId } });
    await tx.followUp.updateMany({ where: { leadId: duplicateId }, data: { leadId: primaryId } });

    await tx.lead.update({
      where: { id: duplicateId },
      data: { isArchived: true, contactStatus: 'NOT_INTERESTED', lostReason: `Merged into ${primaryId}` },
    });

    await tx.salesActivity.create({
      data: {
        leadId: primaryId,
        type: 'SYSTEM',
        title: 'ادغام سرنخ تکراری',
        body: `سرنخ «${duplicate.businessName}» در این سرنخ ادغام شد.`,
        metadata: { mergedFrom: duplicateId },
      },
    });

    return updated;
  });
}
