import {
  addressSimilarity,
  businessNameKey,
  extractDomain,
  nameSimilarity,
  normalizeBusinessName,
  normalizePhone,
  normalizeText,
} from '@baimar/shared';
import type { Lead } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { DiscoveredBusiness } from '../providers/types';

/**
 * Deduplication.
 *
 * A business discovered from Google Places, OpenStreetMap, a web search and a CSV file
 * must end up as ONE lead with four source references — not four leads. The rules below
 * are ordered from "cannot be a coincidence" to "probably the same place", and every
 * match records why it matched so a human can audit the merge.
 */

export interface NormalizedCandidate {
  businessName: string;
  normalizedBusinessName: string;
  nameKey: string;
  normalizedPhone: string | null;
  originalPhone: string | null;
  websiteDomain: string | null;
  city: string | null;
  province: string | null;
  address: string | null;
  providerKey: string;
  externalId: string | null;
}

export type MatchRule =
  | 'provider-identity'
  | 'phone'
  | 'website-domain'
  | 'name-key-city'
  | 'name-similarity-city'
  | 'name-address-similarity';

export interface DuplicateMatch {
  leadId: string;
  rule: MatchRule;
  confidence: number;
  evidence: string;
}

/** Turn a provider record into the comparable shape used by the matcher. */
export function normalizeCandidate(b: DiscoveredBusiness): NormalizedCandidate {
  const phone = normalizePhone(b.phone ?? null);
  return {
    businessName: b.name.trim(),
    normalizedBusinessName: normalizeBusinessName(b.name),
    nameKey: businessNameKey(b.name),
    normalizedPhone: phone.valid ? phone.e164 : null,
    originalPhone: b.phone ?? null,
    websiteDomain: extractDomain(b.website ?? null),
    city: b.city?.trim() || null,
    province: b.province?.trim() || null,
    address: b.address?.trim() || null,
    providerKey: b.providerKey,
    externalId: b.externalId ?? null,
  };
}

const NAME_STRONG = 0.88;
const NAME_MEDIUM = 0.72;
const ADDRESS_MEDIUM = 0.55;

/**
 * Find the best existing lead for a candidate.
 *
 * Returns null when nothing matches confidently enough — creating a duplicate that a
 * human can merge later is far less damaging than silently welding two different
 * businesses into one record.
 */
export async function findDuplicate(
  candidate: NormalizedCandidate,
  opts: { includeDemo?: boolean } = {},
): Promise<DuplicateMatch | null> {
  const demoFilter = opts.includeDemo ? {} : { isDemo: false };

  // 1. The same provider returning the same external id is the same business, always.
  if (candidate.externalId) {
    const ref = await prisma.leadSourceReference.findFirst({
      where: { providerKey: candidate.providerKey, externalId: candidate.externalId },
      select: { leadId: true },
    });
    if (ref) {
      return {
        leadId: ref.leadId,
        rule: 'provider-identity',
        confidence: 1,
        evidence: `Same ${candidate.providerKey} identifier (${candidate.externalId})`,
      };
    }
  }

  // 2. An identical normalized phone number. Two businesses sharing a phone line is rare
  //    enough — and when it happens (shared reception) a human merge review is cheap.
  if (candidate.normalizedPhone) {
    const byPhone = await prisma.lead.findFirst({
      where: { normalizedPhone: candidate.normalizedPhone, isArchived: false, ...demoFilter },
      select: { id: true, businessName: true },
    });
    if (byPhone) {
      return {
        leadId: byPhone.id,
        rule: 'phone',
        confidence: 0.97,
        evidence: `Same normalized phone number (${candidate.normalizedPhone})`,
      };
    }
  }

  // 3. The same website domain.
  if (candidate.websiteDomain) {
    const byDomain = await prisma.lead.findFirst({
      where: { websiteDomain: candidate.websiteDomain, isArchived: false, ...demoFilter },
      select: { id: true },
    });
    if (byDomain) {
      return {
        leadId: byDomain.id,
        rule: 'website-domain',
        confidence: 0.95,
        evidence: `Same website domain (${candidate.websiteDomain})`,
      };
    }
  }

  // 4-6. Name-based matching, always scoped to a city so that "کلینیک آرمان" in Arak
  //      never merges with "کلینیک آرمان" in Mashhad.
  if (!candidate.nameKey) return null;

  const cityFilter = candidate.city
    ? { city: candidate.city }
    : candidate.province
      ? { province: candidate.province }
      : null;
  if (!cityFilter) return null;

  const exact = await prisma.lead.findFirst({
    where: { nameKey: candidate.nameKey, isArchived: false, ...cityFilter, ...demoFilter },
    select: { id: true },
  });
  if (exact) {
    return {
      leadId: exact.id,
      rule: 'name-key-city',
      confidence: 0.9,
      evidence: `Identical normalized name in the same city (${candidate.city ?? candidate.province})`,
    };
  }

  // Fuzzy pass over the candidates in the same city. Bounded so a large city does not
  // turn every insert into a table scan.
  const neighbours = await prisma.lead.findMany({
    where: { isArchived: false, ...cityFilter, ...demoFilter },
    select: { id: true, businessName: true, address: true },
    take: 500,
    orderBy: { updatedAt: 'desc' },
  });

  let best: DuplicateMatch | null = null;
  for (const n of neighbours) {
    const sim = nameSimilarity(candidate.businessName, n.businessName);
    if (sim >= NAME_STRONG) {
      const match: DuplicateMatch = {
        leadId: n.id,
        rule: 'name-similarity-city',
        confidence: 0.8 + (sim - NAME_STRONG) * 0.5,
        evidence: `Very similar name in the same city ("${n.businessName}", similarity ${sim.toFixed(2)})`,
      };
      if (!best || match.confidence > best.confidence) best = match;
      continue;
    }
    if (sim >= NAME_MEDIUM && candidate.address && n.address) {
      const addrSim = addressSimilarity(candidate.address, n.address);
      if (addrSim >= ADDRESS_MEDIUM) {
        const match: DuplicateMatch = {
          leadId: n.id,
          rule: 'name-address-similarity',
          confidence: 0.7 + Math.min(0.2, (sim - NAME_MEDIUM) + (addrSim - ADDRESS_MEDIUM)),
          evidence: `Similar name (${sim.toFixed(2)}) and similar address (${addrSim.toFixed(2)})`,
        };
        if (!best || match.confidence > best.confidence) best = match;
      }
    }
  }
  return best;
}

/**
 * Merge policy for a lead that already exists.
 *
 * Only fills gaps: an existing non-null value is never replaced by a different value from
 * another source, because we cannot tell which one is right. Conflicting values are
 * surfaced through the source references instead, where a human can compare them.
 */
export function mergeIntoLead(existing: Lead, incoming: DiscoveredBusiness): {
  data: Record<string, unknown>;
  filledFields: string[];
  conflicts: Array<{ field: string; existing: string; incoming: string }>;
} {
  const data: Record<string, unknown> = {};
  const filledFields: string[] = [];
  const conflicts: Array<{ field: string; existing: string; incoming: string }> = [];

  const fill = (field: keyof Lead, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    const current = existing[field];
    if (current === null || current === undefined || current === '') {
      data[field as string] = value;
      filledFields.push(field as string);
    } else if (typeof current === 'string' && typeof value === 'string' && normalizeText(current) !== normalizeText(value)) {
      conflicts.push({ field: field as string, existing: current, incoming: value });
    }
  };

  fill('businessType', incoming.businessType);
  fill('category', incoming.category);
  fill('subcategory', incoming.subcategory);
  fill('province', incoming.province);
  fill('city', incoming.city);
  fill('area', incoming.area);
  fill('address', incoming.address);
  fill('latitude', incoming.latitude);
  fill('longitude', incoming.longitude);
  fill('email', incoming.email);
  fill('googleMapsUrl', incoming.googleMapsUrl);
  fill('instagramUrl', incoming.instagramUrl);
  fill('telegramUrl', incoming.telegramUrl);
  fill('linkedinUrl', incoming.linkedinUrl);
  fill('whatsappUrl', incoming.whatsappUrl);
  fill('facebookUrl', incoming.facebookUrl);
  fill('description', incoming.description);

  // Phone: keep the original from the first source, but adopt a normalized number when
  // we did not have one before.
  const phone = normalizePhone(incoming.phone ?? null);
  if (phone.valid && phone.e164 && !existing.normalizedPhone) {
    data.normalizedPhone = phone.e164;
    data.originalPhone = existing.originalPhone ?? incoming.phone ?? null;
    if (phone.kind === 'MOBILE') data.mobile = phone.e164;
    filledFields.push('normalizedPhone');
  } else if (phone.valid && phone.e164 && existing.normalizedPhone && existing.normalizedPhone !== phone.e164) {
    // A second, different number is additional contact information, not a conflict.
    const extras = new Set(existing.extraPhones ?? []);
    if (!extras.has(phone.e164)) {
      extras.add(phone.e164);
      data.extraPhones = Array.from(extras);
      filledFields.push('extraPhones');
    }
  }

  // Website: only adopt when we have none. Domain changes need human confirmation.
  const domain = extractDomain(incoming.website ?? null);
  if (domain && !existing.websiteDomain) {
    data.website = incoming.website;
    data.websiteDomain = domain;
    data.websiteStatus = 'NOT_VERIFIED';
    filledFields.push('website');
  } else if (domain && existing.websiteDomain && existing.websiteDomain !== domain) {
    conflicts.push({ field: 'websiteDomain', existing: existing.websiteDomain, incoming: domain });
  }

  // Reviews: take the higher count, since a source with more reviews saw more of them.
  if (incoming.reviewCount !== undefined && (existing.reviewCount ?? -1) < incoming.reviewCount) {
    data.reviewCount = incoming.reviewCount;
    if (incoming.reviewRating !== undefined) data.reviewRating = incoming.reviewRating;
    filledFields.push('reviewCount');
  }

  // Lists are unioned rather than replaced.
  if (incoming.services?.length) {
    const merged = Array.from(new Set([...(existing.services ?? []), ...incoming.services]));
    if (merged.length !== existing.services?.length) {
      data.services = merged;
      filledFields.push('services');
    }
  }
  if (incoming.products?.length) {
    const merged = Array.from(new Set([...(existing.products ?? []), ...incoming.products]));
    if (merged.length !== existing.products?.length) {
      data.products = merged;
      filledFields.push('products');
    }
  }
  if (incoming.openingHours && !existing.openingHours) {
    data.openingHours = incoming.openingHours;
    filledFields.push('openingHours');
  }

  return { data, filledFields, conflicts };
}

/** Fields a discovered business contributes, for source attribution. */
export function contributedFields(b: DiscoveredBusiness): string[] {
  const fields: string[] = ['businessName'];
  const map: Array<[keyof DiscoveredBusiness, string]> = [
    ['phone', 'phone'],
    ['website', 'website'],
    ['address', 'address'],
    ['city', 'city'],
    ['province', 'province'],
    ['email', 'email'],
    ['instagramUrl', 'instagramUrl'],
    ['telegramUrl', 'telegramUrl'],
    ['googleMapsUrl', 'googleMapsUrl'],
    ['reviewCount', 'reviewCount'],
    ['reviewRating', 'reviewRating'],
    ['description', 'description'],
    ['openingHours', 'openingHours'],
    ['latitude', 'coordinates'],
  ];
  for (const [key, label] of map) {
    const v = b[key];
    if (v !== undefined && v !== null && v !== '') fields.push(label);
  }
  return Array.from(new Set(fields));
}
