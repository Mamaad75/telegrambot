import type { AIAnalysis, Lead, Service, WebsiteAudit } from '@prisma/client';
import { stableHash } from '../lib/crypto';
import { prisma } from '../lib/prisma';
import { monthlyAiSpendUsd, trackUsage } from '../lib/provider-usage';
import { getAiSettings } from '../lib/settings';
import { callProvider, selectedAiProvider } from '../providers/registry';
import type { AIProvider } from '../providers/types';
import type { BusinessValueResult } from './business-value';
import type { ServiceMatch } from './opportunity';
import type { ScoreResult } from './scoring';
import type { SignalMap } from './signals';

/**
 * AI lead analysis.
 *
 * Cost control is built in, not bolted on:
 *   * the caller filters by lead score before we ever get here;
 *   * an identical input snapshot is served from the previous analysis instead of
 *     re-billing the model;
 *   * a monthly budget ceiling stops the queue rather than quietly overspending.
 *
 * Grounding is enforced by construction: the model is given a compact, explicit snapshot
 * of what we observed and is instructed to return "نامشخص" for anything not present in it.
 * Nothing the model returns is treated as a fact — it is stored as AI_INSIGHT and shown
 * with that badge.
 */

export interface AiAnalysisInput {
  lead: Lead;
  audit: WebsiteAudit | null;
  signals: SignalMap;
  score: ScoreResult | null;
  businessValue: BusinessValueResult | null;
  matches: ServiceMatch[];
  services: Service[];
  marketContext?: Array<{ serviceKey: string; strength: string; basis: string }>;
}

export type AiAnalysisOutcome =
  | { status: 'ok'; analysis: AIAnalysis; cached: boolean }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

const SYSTEM_PROMPT = `You are a B2B sales analyst for Baimar (بایمر), an Iranian digital agency that sells website design, redesign, e-commerce, SEO, branding, landing pages, booking systems, digital marketing, maintenance and automation.

Your job: read a factual snapshot about ONE business and produce a sales analysis that helps a salesperson make a useful first call.

ABSOLUTE RULES — violating any of them makes your output useless:
1. Use ONLY the facts in the snapshot. Never invent phone numbers, people, revenue, traffic, search volume, review counts, competitors, or anything else.
2. If the snapshot does not contain the information needed for a field, output the exact string "نامشخص" for that field (or an empty array for list fields). Never guess.
3. Never claim to know what the business's customers searched for, or what any individual person did.
4. Every problem you list must be traceable to a specific observation in the snapshot. Quote or paraphrase the observation.
5. Recommend a service ONLY from the provided service list, using its exact key.
6. The opening line must be usable on a real phone call in Persian: short, specific, no flattery, no exaggerated claims, no spam wording.
7. Write all human-facing text in Persian (fa-IR). Keys stay in English.

Return ONLY a JSON object with exactly these keys:
{
  "business_summary": string,
  "likely_customer_profile": string,
  "main_digital_problems": string[],
  "business_opportunities": string[],
  "recommended_baimar_service": string,
  "secondary_services": string[],
  "sales_angle": string,
  "why_contact_this_lead": string,
  "recommended_opening": string,
  "recommended_questions": string[],
  "likely_objections": string[],
  "objection_response_strategy": string,
  "recommended_next_step": string
}`;

export function buildSnapshot(input: AiAnalysisInput): Record<string, unknown> {
  const { lead, audit, signals, score, businessValue, matches, services } = input;

  const observed = Object.values(signals)
    .filter((s) => s?.value)
    .map((s) => ({ signal: s!.signal, evidence: s!.evidence, confidence: s!.confidence }));

  const findings = Array.isArray(audit?.findings)
    ? (audit!.findings as Array<{ titleFa: string; evidence: string; severity: string; area: string }>).slice(0, 12)
    : [];

  return {
    business: {
      name: lead.businessName,
      category: lead.category ?? 'نامشخص',
      subcategory: lead.subcategory ?? 'نامشخص',
      city: lead.city ?? 'نامشخص',
      province: lead.province ?? 'نامشخص',
      address: lead.address ?? 'نامشخص',
      description: lead.description ?? 'نامشخص',
      services: lead.services ?? [],
      products: lead.products ?? [],
      // Review data is included only when a source actually reported it.
      review_count: lead.reviewCount ?? 'نامشخص',
      review_rating: lead.reviewRating ?? 'نامشخص',
      has_instagram: Boolean(lead.instagramUrl),
      has_telegram: Boolean(lead.telegramUrl),
      website_status: lead.websiteStatus,
      website_domain: lead.websiteDomain ?? 'نامشخص',
    },
    website_audit: audit
      ? {
          reachable: audit.reachable,
          scores: {
            seo: audit.seoScore ?? 'اندازه‌گیری نشد',
            mobile: audit.mobileScore ?? 'اندازه‌گیری نشد',
            performance: audit.performanceScore ?? 'اندازه‌گیری نشد',
            ux: audit.uxScore ?? 'اندازه‌گیری نشد',
            conversion: audit.conversionScore ?? 'اندازه‌گیری نشد',
            technical: audit.technicalScore ?? 'اندازه‌گیری نشد',
            overall: audit.overallScore ?? 'اندازه‌گیری نشد',
          },
          pages_crawled: audit.pagesCrawled,
          has_ssl: audit.hasSsl,
          has_contact_form: audit.hasContactForm,
          has_online_store: audit.hasEcommerce,
          has_online_booking: audit.hasBooking,
          has_analytics: audit.hasAnalytics,
          technologies: Array.isArray(audit.technologies)
            ? (audit.technologies as Array<{ name: string; confidence: string }>).map((t) => `${t.name} (${t.confidence})`)
            : [],
          key_findings: findings.map((f) => ({ title: f.titleFa, evidence: f.evidence, severity: f.severity })),
          not_measured: audit.unavailable ?? [],
        }
      : 'وب‌سایت هنوز بررسی نشده است',
    observed_signals: observed,
    lead_score: score ? { score: score.score, temperature: score.temperature, top_reasons: score.contributions.slice(0, 5) } : 'محاسبه نشده',
    business_value: businessValue
      ? { tier: businessValue.tier, score: businessValue.score, reasons: businessValue.reasons.map((r) => r.labelFa) }
      : 'محاسبه نشده',
    rule_based_recommendation: matches.slice(0, 3).map((m) => ({ key: m.serviceKey, name: m.nameFa, reasons: m.reasonsFa })),
    market_context: input.marketContext?.length ? input.marketContext : 'داده تقاضای بازار برای این خدمت موجود نیست',
    available_services: services.filter((s) => s.isActive).map((s) => ({ key: s.key, name: s.nameFa, description: s.descriptionFa })),
  };
}

export async function analyzeLead(input: AiAnalysisInput, opts: { force?: boolean } = {}): Promise<AiAnalysisOutcome> {
  const settings = await getAiSettings();
  const provider = await selectedAiProvider(settings.provider === 'none' ? undefined : keyFor(settings.provider));

  if (!provider) {
    return {
      status: 'skipped',
      reason: 'No AI provider is configured or enabled. The rule-based analysis and sales brief are still available.',
    };
  }

  // Budget ceiling: refuse rather than overspend.
  if (settings.monthlyBudgetUsd > 0) {
    const spent = await monthlyAiSpendUsd();
    if (spent >= settings.monthlyBudgetUsd) {
      return {
        status: 'skipped',
        reason: `Monthly AI budget reached (estimated $${spent.toFixed(2)} of $${settings.monthlyBudgetUsd}). Raise it in Settings → AI to continue.`,
      };
    }
  }

  const snapshot = buildSnapshot(input);
  const inputHash = stableHash({ snapshot, model: provider.model });

  if (settings.cacheEnabled && !opts.force) {
    const existing = await prisma.aIAnalysis.findFirst({
      where: { leadId: input.lead.id, inputHash, error: null },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { status: 'ok', analysis: existing, cached: true };
  }

  try {
    const result = await callProvider(
      provider,
      () =>
        (provider as AIProvider).complete({
          system: SYSTEM_PROMPT,
          user: `Business snapshot (JSON):\n${JSON.stringify(snapshot, null, 2)}\n\nReturn only the JSON object described in your instructions.`,
          jsonSchemaName: 'baimar_lead_analysis',
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
        }),
      {
        usage: {},
      },
    );

    const parsed = parseAiJson(result.text);
    if (!parsed) {
      const failed = await prisma.aIAnalysis.create({
        data: {
          leadId: input.lead.id,
          provider: provider.descriptor.key,
          model: result.model,
          inputSnapshot: snapshot as object,
          inputHash,
          rawOutput: { text: result.text.slice(0, 4000) },
          error: 'Model response was not valid JSON',
          latencyMs: result.latencyMs,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
          estimatedCostUsd: result.estimatedCostUsd,
        },
      });
      await trackUsage({
        providerKey: provider.descriptor.key,
        kind: 'AI',
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        estimatedCostUsd: result.estimatedCostUsd,
      });
      return { status: 'failed', reason: `Model returned unparseable output (analysis ${failed.id})` };
    }

    const validServiceKeys = new Set(input.services.map((s) => s.key));
    const recommended = validServiceKeys.has(String(parsed.recommended_baimar_service))
      ? String(parsed.recommended_baimar_service)
      : // The model went off-catalogue: fall back to the deterministic recommendation
        // rather than storing a service Baimar does not sell.
        input.matches[0]?.serviceKey ?? null;

    const analysis = await prisma.aIAnalysis.create({
      data: {
        leadId: input.lead.id,
        provider: provider.descriptor.key,
        model: result.model,
        businessSummary: clean(parsed.business_summary),
        likelyCustomerProfile: clean(parsed.likely_customer_profile),
        mainDigitalProblems: strArray(parsed.main_digital_problems),
        businessOpportunities: strArray(parsed.business_opportunities),
        recommendedService: recommended,
        secondaryServices: strArray(parsed.secondary_services).filter((k) => validServiceKeys.has(k)),
        salesAngle: clean(parsed.sales_angle),
        whyContact: clean(parsed.why_contact_this_lead),
        recommendedOpening: clean(parsed.recommended_opening),
        recommendedQuestions: strArray(parsed.recommended_questions),
        likelyObjections: strArray(parsed.likely_objections),
        objectionStrategy: clean(parsed.objection_response_strategy),
        recommendedNextStep: clean(parsed.recommended_next_step),
        inputSnapshot: snapshot as object,
        inputHash,
        rawOutput: parsed as object,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        estimatedCostUsd: result.estimatedCostUsd,
        latencyMs: result.latencyMs,
      },
    });

    await trackUsage({
      providerKey: provider.descriptor.key,
      kind: 'AI',
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      estimatedCostUsd: result.estimatedCostUsd,
    });

    return { status: 'ok', analysis, cached: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await prisma.aIAnalysis
      .create({
        data: {
          leadId: input.lead.id,
          provider: provider.descriptor.key,
          model: provider.model,
          inputSnapshot: snapshot as object,
          inputHash,
          error: reason.slice(0, 1000),
        },
      })
      .catch(() => undefined);
    return { status: 'failed', reason };
  }
}

function keyFor(provider: string): string | undefined {
  return { anthropic: 'anthropic', openai: 'openai', compatible: 'compatible_ai', local: 'local_ai' }[provider];
}

/** Models sometimes wrap JSON in prose or a code fence; recover the object when possible. */
export function parseAiJson(text: string): Record<string, unknown> | null {
  const attempt = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const direct = attempt(text.trim());
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const parsed = attempt(fenced[1].trim());
    if (parsed) return parsed;
  }

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return attempt(text.slice(first, last + 1));
  return null;
}

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s === 'نامشخص' || s.toLowerCase() === 'unknown' || s === 'null') return null;
  return s;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x && x !== 'نامشخص' && x.toLowerCase() !== 'unknown');
}
