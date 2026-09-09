import { parse } from 'csv-parse/sync';
import { loadEnv } from '../config/env';
import { looksLikeFormula } from '../lib/csv-safety';
import { normalizePhone, normalizeText, normalizeUrl } from '@baimar/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ingestBusiness } from './lead-service';
import { storeKeywordObservations, storeSearchTerms } from './market-service';
import type { DiscoveredBusiness, KeywordObservation, SearchTermObservation } from '../providers/types';

/**
 * CSV import.
 *
 * Column mapping is automatic but overridable: the header row is matched against a table
 * of aliases in Persian and English, and whatever cannot be mapped is reported back rather
 * than silently dropped. Imported rows go through exactly the same normalization and
 * deduplication as discovered ones.
 */

export type LeadField =
  | 'businessName'
  | 'phone'
  | 'mobile'
  | 'email'
  | 'website'
  | 'city'
  | 'province'
  | 'address'
  | 'category'
  | 'subcategory'
  | 'instagram'
  | 'telegram'
  | 'linkedin'
  | 'whatsapp'
  | 'googleMaps'
  | 'description'
  | 'services'
  | 'reviewCount'
  | 'reviewRating'
  | 'decisionMakerName'
  | 'decisionMakerRole';

/** Header aliases, matched after normalization (case/diacritic/digit folded). */
const COLUMN_ALIASES: Record<LeadField, string[]> = {
  businessName: ['name', 'business', 'business name', 'company', 'title', 'نام', 'نام کسب و کار', 'نام شرکت', 'عنوان', 'کسب و کار'],
  phone: ['phone', 'tel', 'telephone', 'phone number', 'تلفن', 'شماره', 'شماره تماس', 'تلفن ثابت'],
  mobile: ['mobile', 'cell', 'cellphone', 'موبایل', 'همراه', 'شماره همراه'],
  email: ['email', 'e-mail', 'mail', 'ایمیل', 'پست الکترونیک'],
  website: ['website', 'site', 'url', 'web', 'وب سایت', 'سایت', 'وبسایت', 'آدرس سایت'],
  city: ['city', 'town', 'شهر'],
  province: ['province', 'state', 'استان'],
  address: ['address', 'addr', 'location', 'آدرس', 'نشانی'],
  category: ['category', 'type', 'industry', 'دسته', 'دسته بندی', 'صنف', 'نوع کسب و کار'],
  subcategory: ['subcategory', 'sub category', 'زیر دسته'],
  instagram: ['instagram', 'insta', 'ig', 'اینستاگرام', 'اینستا'],
  telegram: ['telegram', 'تلگرام'],
  linkedin: ['linkedin', 'لینکدین'],
  whatsapp: ['whatsapp', 'واتساپ', 'واتس اپ'],
  googleMaps: ['google maps', 'maps', 'map', 'گوگل مپ', 'نقشه'],
  description: ['description', 'about', 'notes', 'توضیحات', 'توضیح', 'درباره'],
  services: ['services', 'products', 'خدمات', 'محصولات'],
  reviewCount: ['reviews', 'review count', 'ratings count', 'تعداد نظرات', 'تعداد نظر'],
  reviewRating: ['rating', 'score', 'stars', 'امتیاز', 'میانگین امتیاز'],
  decisionMakerName: ['contact person', 'owner', 'manager', 'نام مدیر', 'مسئول', 'مدیر'],
  decisionMakerRole: ['role', 'position', 'title of contact', 'سمت', 'عنوان شغلی'],
};

export interface ColumnMapping {
  [csvHeader: string]: LeadField | null;
}

export interface ImportPreview {
  headers: string[];
  mapping: ColumnMapping;
  unmapped: string[];
  sampleRows: Array<Record<string, string>>;
  totalRows: number;
  /** Fields the importer needs but could not find. */
  missingRequired: LeadField[];
}

export function detectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<LeadField>();

  for (const header of headers) {
    const norm = normalizeText(header);
    let matched: LeadField | null = null;

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as Array<[LeadField, string[]]>) {
      if (used.has(field)) continue;
      if (aliases.some((a) => normalizeText(a) === norm)) {
        matched = field;
        break;
      }
    }
    // Second pass: substring match, for headers like "Business Phone Number".
    if (!matched) {
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as Array<[LeadField, string[]]>) {
        if (used.has(field)) continue;
        if (aliases.some((a) => norm.includes(normalizeText(a)) && normalizeText(a).length >= 4)) {
          matched = field;
          break;
        }
      }
    }

    mapping[header] = matched;
    if (matched) used.add(matched);
  }
  return mapping;
}

/** Raised when an upload exceeds a configured limit; carries a message for the user. */
export class ImportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportLimitError';
  }
}

/**
 * Parse an uploaded CSV, refusing anything outside the configured limits.
 *
 * The limits are not paranoia. A spreadsheet is user-supplied input that is parsed
 * entirely in memory on a 4 GB box, and a malformed or hostile file — a hundred
 * megabytes, a million rows, ten thousand columns — is an easy way to take the API
 * down. Each limit is configurable (IMPORT_MAX_BYTES / ROWS / COLUMNS) and each failure
 * says exactly which limit was hit and what the limit is, so a legitimate large import
 * can be split rather than merely rejected.
 */
export function parseCsv(content: string): Array<Record<string, string>> {
  const env = loadEnv();

  const bytes = Buffer.byteLength(content, 'utf8');
  if (env.IMPORT_MAX_BYTES > 0 && bytes > env.IMPORT_MAX_BYTES) {
    throw new ImportLimitError(
      `فایل ${(bytes / 1_000_000).toFixed(1)} مگابایت است و از حد مجاز ${(env.IMPORT_MAX_BYTES / 1_000_000).toFixed(1)} مگابایت بیشتر است. فایل را به چند بخش تقسیم کنید.`,
    );
  }

  let rows: Array<Record<string, string>>;
  try {
    // BOM-tolerant, quote-aware, tolerant of ragged rows.
    rows = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      // Hard stop inside the parser, so a runaway file is abandoned before it is fully
      // materialised rather than after.
      to: env.IMPORT_MAX_ROWS > 0 ? env.IMPORT_MAX_ROWS + 1 : undefined,
    }) as Array<Record<string, string>>;
  } catch (err) {
    // A malformed CSV is a user error with a fixable cause, not a server fault.
    throw new ImportLimitError(
      `فایل CSV قابل خواندن نبود: ${err instanceof Error ? err.message : 'ساختار نامعتبر'}. فایل را با UTF-8 و جداکنندهٔ ویرگول ذخیره کنید.`,
    );
  }

  if (env.IMPORT_MAX_ROWS > 0 && rows.length > env.IMPORT_MAX_ROWS) {
    throw new ImportLimitError(
      `فایل بیش از ${env.IMPORT_MAX_ROWS.toLocaleString('fa-IR')} ردیف دارد. آن را به چند فایل کوچک‌تر تقسیم کنید.`,
    );
  }

  const columnCount = rows.length ? Object.keys(rows[0]).length : 0;
  if (env.IMPORT_MAX_COLUMNS > 0 && columnCount > env.IMPORT_MAX_COLUMNS) {
    throw new ImportLimitError(
      `فایل ${columnCount} ستون دارد و از حد مجاز ${env.IMPORT_MAX_COLUMNS} ستون بیشتر است. ستون‌های اضافی را حذف کنید.`,
    );
  }

  return rows;
}

/**
 * Count cells that a spreadsheet would execute as a formula.
 *
 * Imported values are stored as text and re-exported later, so a formula arriving here
 * would be handed straight back to a salesperson's Excel. The export path neutralises it
 * (see lib/csv-safety.ts); this count surfaces it in the import report so somebody knows
 * the file contained one.
 */
export function countFormulaCells(rows: Array<Record<string, string>>): number {
  let count = 0;
  for (const row of rows) {
    for (const value of Object.values(row)) if (looksLikeFormula(value)) count++;
  }
  return count;
}

export function previewImport(content: string): ImportPreview {
  const rows = parseCsv(content);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const mapping = detectMapping(headers);
  const mapped = new Set(Object.values(mapping).filter(Boolean) as LeadField[]);

  return {
    headers,
    mapping,
    unmapped: headers.filter((h) => !mapping[h]),
    sampleRows: rows.slice(0, 5),
    totalRows: rows.length,
    missingRequired: mapped.has('businessName') ? [] : ['businessName'],
  };
}

export interface ImportResult {
  batchId: string;
  total: number;
  imported: number;
  merged: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

export async function importLeadsCsv(
  content: string,
  opts: {
    filename?: string;
    createdById?: string | null;
    mapping?: ColumnMapping;
    campaignId?: string | null;
    isDemo?: boolean;
    defaultCity?: string | null;
    defaultCategory?: string | null;
  } = {},
): Promise<ImportResult> {
  const rows = parseCsv(content);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const mapping = opts.mapping ?? detectMapping(headers);

  const batch = await prisma.importBatch.create({
    data: {
      kind: 'LEADS',
      filename: opts.filename ?? null,
      status: 'PROCESSING',
      totalRows: rows.length,
      columnMapping: mapping as unknown as Prisma.InputJsonValue,
      createdById: opts.createdById ?? null,
      isDemo: opts.isDemo ?? false,
    },
  });

  const errors: Array<{ row: number; reason: string }> = [];
  let imported = 0;
  let merged = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const business = rowToBusiness(row, mapping, opts);
      if (!business) {
        skipped++;
        errors.push({ row: i + 2, reason: 'No business name in this row' });
        continue;
      }
      const outcome = await ingestBusiness(business, {
        campaignId: opts.campaignId ?? null,
        createdById: opts.createdById ?? null,
        isDemo: opts.isDemo ?? false,
      });
      if (outcome.action === 'created') imported++;
      else if (outcome.action === 'merged') merged++;
      else {
        skipped++;
        errors.push({ row: i + 2, reason: outcome.reason });
      }
    } catch (err) {
      skipped++;
      errors.push({ row: i + 2, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      status: 'COMPLETED',
      importedRows: imported,
      mergedRows: merged,
      skippedRows: skipped,
      errorRows: errors.length,
      errors: errors.slice(0, 200) as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });

  return { batchId: batch.id, total: rows.length, imported, merged, skipped, errors: errors.slice(0, 100) };
}

function rowToBusiness(
  row: Record<string, string>,
  mapping: ColumnMapping,
  opts: { defaultCity?: string | null; defaultCategory?: string | null },
): DiscoveredBusiness | null {
  const get = (field: LeadField): string | undefined => {
    const header = Object.keys(mapping).find((h) => mapping[h] === field);
    if (!header) return undefined;
    const value = row[header];
    return value && String(value).trim() !== '' ? String(value).trim() : undefined;
  };

  const name = get('businessName');
  if (!name) return null;

  const phone = get('phone') ?? get('mobile');
  const website = normalizeUrl(get('website') ?? null) ?? undefined;
  const instagram = get('instagram');
  const telegram = get('telegram');
  const services = get('services');
  const reviewCount = get('reviewCount');
  const reviewRating = get('reviewRating');

  const extraPhones: string[] = [];
  const mobileValue = get('mobile');
  if (mobileValue && mobileValue !== phone) {
    const normalized = normalizePhone(mobileValue);
    if (normalized.valid && normalized.e164) extraPhones.push(normalized.e164);
  }

  return {
    providerKey: 'manual',
    externalId: undefined,
    origin: 'MANUAL_ENTRY',
    name,
    category: get('category') ?? opts.defaultCategory ?? undefined,
    subcategory: get('subcategory'),
    city: get('city') ?? opts.defaultCity ?? undefined,
    province: get('province'),
    address: get('address'),
    country: 'IR',
    phone,
    extraPhones,
    email: get('email'),
    website,
    instagramUrl: instagram ? toSocialUrl(instagram, 'instagram.com') : undefined,
    telegramUrl: telegram ? toSocialUrl(telegram, 't.me') : undefined,
    linkedinUrl: normalizeUrl(get('linkedin') ?? null) ?? undefined,
    whatsappUrl: normalizeUrl(get('whatsapp') ?? null) ?? undefined,
    googleMapsUrl: normalizeUrl(get('googleMaps') ?? null) ?? undefined,
    description: get('description'),
    services: services ? services.split(/[,،;|]/).map((s) => s.trim()).filter(Boolean) : undefined,
    // Numeric fields are only set when the cell actually parses as a number, so a blank
    // or malformed cell stays "unknown" instead of becoming zero.
    reviewCount: reviewCount && Number.isFinite(Number(reviewCount)) ? Number(reviewCount) : undefined,
    reviewRating: reviewRating && Number.isFinite(Number(reviewRating)) ? Number(reviewRating) : undefined,
    raw: row,
  };
}

function toSocialUrl(value: string, host: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${host}/${value.replace(/^@/, '')}`;
}

/* -------------------------------------------------------------------------- */
/*  Keyword / search-term import                                               */
/* -------------------------------------------------------------------------- */

const KEYWORD_ALIASES: Record<string, string[]> = {
  keyword: ['keyword', 'query', 'search term', 'term', 'کلیدواژه', 'کلمه کلیدی', 'عبارت'],
  searchVolume: ['search volume', 'volume', 'avg monthly searches', 'avg. monthly searches', 'حجم جستجو', 'میانگین جستجو'],
  competition: ['competition', 'رقابت'],
  clicks: ['clicks', 'کلیک'],
  impressions: ['impressions', 'impr', 'نمایش'],
  conversions: ['conversions', 'conv', 'تبدیل'],
  cost: ['cost', 'spend', 'هزینه'],
  ctr: ['ctr', 'نرخ کلیک'],
  position: ['position', 'avg position', 'average position', 'میانگین جایگاه'],
  city: ['city', 'location', 'شهر'],
  province: ['province', 'استان'],
  date: ['date', 'day', 'تاریخ'],
  campaign: ['campaign', 'کمپین'],
};

export interface KeywordImportResult {
  batchId: string;
  total: number;
  keywordsStored: number;
  searchTermsStored: number;
  errors: Array<{ row: number; reason: string }>;
}

export async function importKeywordsCsv(
  content: string,
  opts: {
    filename?: string;
    createdById?: string | null;
    /** MANUAL_IMPORT for research exports, GOOGLE_ADS for an Ads report you exported. */
    source?: 'MANUAL_IMPORT' | 'GOOGLE_ADS' | 'SEARCH_CONSOLE' | 'PROVIDER';
    /** Treat rows as advertising search terms rather than keyword research. */
    asSearchTerms?: boolean;
    city?: string | null;
  } = {},
): Promise<KeywordImportResult> {
  const rows = parseCsv(content);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const source = opts.source ?? 'MANUAL_IMPORT';

  const columnFor = (field: string): string | undefined =>
    headers.find((h) => (KEYWORD_ALIASES[field] ?? []).some((a) => normalizeText(a) === normalizeText(h))) ??
    headers.find((h) => (KEYWORD_ALIASES[field] ?? []).some((a) => normalizeText(h).includes(normalizeText(a))));

  const batch = await prisma.importBatch.create({
    data: {
      kind: opts.asSearchTerms ? 'SEARCH_TERMS' : 'KEYWORDS',
      filename: opts.filename ?? null,
      status: 'PROCESSING',
      totalRows: rows.length,
      createdById: opts.createdById ?? null,
    },
  });

  const errors: Array<{ row: number; reason: string }> = [];
  const observations: KeywordObservation[] = [];
  const searchTerms: SearchTermObservation[] = [];

  const num = (value: string | undefined): number | undefined => {
    if (value === undefined || value === null || String(value).trim() === '') return undefined;
    const cleaned = String(value).replace(/[,،\s%]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  };

  const cols = {
    keyword: columnFor('keyword'),
    searchVolume: columnFor('searchVolume'),
    competition: columnFor('competition'),
    clicks: columnFor('clicks'),
    impressions: columnFor('impressions'),
    conversions: columnFor('conversions'),
    cost: columnFor('cost'),
    ctr: columnFor('ctr'),
    position: columnFor('position'),
    city: columnFor('city'),
    province: columnFor('province'),
    date: columnFor('date'),
    campaign: columnFor('campaign'),
  };

  if (!cols.keyword) {
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'FAILED', errors: [{ row: 1, reason: 'No keyword column found' }] as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
    });
    return { batchId: batch.id, total: rows.length, keywordsStored: 0, searchTermsStored: 0, errors: [{ row: 1, reason: 'No keyword/search-term column found in the file' }] };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const keyword = cols.keyword ? row[cols.keyword]?.trim() : '';
    if (!keyword) {
      errors.push({ row: i + 2, reason: 'Empty keyword' });
      continue;
    }

    const dateValue = cols.date ? row[cols.date] : undefined;
    const parsedDate = dateValue ? new Date(dateValue) : undefined;
    const costValue = cols.cost ? num(row[cols.cost]) : undefined;

    const common = {
      keyword,
      source,
      origin: (opts.asSearchTerms ? 'ADVERTISING_CAMPAIGN' : 'AGGREGATE_SEARCH_SIGNAL') as KeywordObservation['origin'],
      language: 'fa',
      city: (cols.city ? row[cols.city]?.trim() : undefined) || opts.city || undefined,
      province: cols.province ? row[cols.province]?.trim() || undefined : undefined,
      country: 'IR',
      searchVolume: cols.searchVolume ? num(row[cols.searchVolume]) : undefined,
      competition: cols.competition ? row[cols.competition]?.trim() || undefined : undefined,
      clicks: cols.clicks ? num(row[cols.clicks]) : undefined,
      impressions: cols.impressions ? num(row[cols.impressions]) : undefined,
      conversions: cols.conversions ? num(row[cols.conversions]) : undefined,
      // Cost columns are typically in currency units; store as micros for consistency.
      costMicros: costValue !== undefined ? Math.round(costValue * 1_000_000) : undefined,
      ctr: cols.ctr ? num(row[cols.ctr]) : undefined,
      averagePosition: cols.position ? num(row[cols.position]) : undefined,
      date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : undefined,
    } satisfies KeywordObservation;

    if (opts.asSearchTerms) {
      searchTerms.push({
        ...common,
        term: keyword,
        campaignName: cols.campaign ? row[cols.campaign]?.trim() || undefined : undefined,
      });
    } else {
      observations.push(common);
    }
  }

  const keywordsStored = observations.length ? await storeKeywordObservations(observations) : 0;
  const searchTermsStored = searchTerms.length ? await storeSearchTerms(searchTerms) : 0;

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      status: 'COMPLETED',
      importedRows: keywordsStored + searchTermsStored,
      errorRows: errors.length,
      errors: errors.slice(0, 200) as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });

  return { batchId: batch.id, total: rows.length, keywordsStored, searchTermsStored, errors: errors.slice(0, 100) };
}
