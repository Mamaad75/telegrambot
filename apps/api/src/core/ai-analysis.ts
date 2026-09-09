import { z } from 'zod';
import type { AIAnalysis, Lead, Service, WebsiteAudit } from '@prisma/client';
import { loadEnv } from '../config/env';
import { stableHash } from '../lib/crypto';
import { jobLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { aiBudgetStatus, trackUsage } from '../lib/provider-usage';
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

/* -------------------------------------------------------------------------- */
/*  Output contract (patch 35)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The shape a model must return.
 *
 * Validated rather than trusted, because a model's output is untrusted input like any
 * other: a missing field, a string where an array belongs, or a hallucinated extra key
 * would otherwise be written straight into the database and shown to a salesperson as
 * though it were analysis. Anything that fails validation is retried once and then
 * abandoned in favour of the deterministic brief — which is complete on its own.
 *
 * Fields are permissive about *emptiness* and strict about *type*: the prompt tells the
 * model to answer "نامشخص" when it does not know, and that is a valid answer.
 */
const AiOutputSchema = z.object({
  business_summary: z.string().max(2000).optional().default(''),
  likely_customer_profile: z.string().max(2000).optional().default(''),
  main_digital_problems: z.array(z.string().max(500)).max(20).optional().default([]),
  business_opportunities: z.array(z.string().max(500)).max(20).optional().default([]),
  recommended_baimar_service: z.string().max(120).optional().default(''),
  secondary_services: z.array(z.string().max(120)).max(10).optional().default([]),
  sales_angle: z.string().max(1000).optional().default(''),
  why_contact_this_lead: z.string().max(2000).optional().default(''),
  recommended_opening: z.string().max(2000).optional().default(''),
  recommended_questions: z.array(z.string().max(400)).max(15).optional().default([]),
  likely_objections: z.array(z.string().max(400)).max(15).optional().default([]),
  objection_response_strategy: z.string().max(2000).optional().default(''),
  recommended_next_step: z.string().max(1000).optional().default(''),
});

export type AiOutput = z.infer<typeof AiOutputSchema>;

/**
 * Parse and validate one model response.
 *
 * Returns the reason for rejection rather than throwing, so the caller can decide
 * between retrying and falling back — and so the reason lands in the database where a
 * broken prompt becomes visible instead of being silently absorbed.
 */
export function validateAiOutput(text: string): { ok: true; value: AiOutput } | { ok: false; reason: string } {
  const parsed = parseAiJson(text);
  if (!parsed) return { ok: false, reason: 'Model response was not valid JSON' };

  const result = AiOutputSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, reason: `Model output failed schema validation — ${issues}` };
  }

  // An analysis with nothing in it is not a success: it would replace a complete
  // deterministic brief with an empty one.
  const v = result.data;
  const hasSubstance =
    v.why_contact_this_lead.trim().length > 0 ||
    v.recommended_opening.trim().length > 0 ||
    v.main_digital_problems.length > 0;
  if (!hasSubstance) return { ok: false, reason: 'Model returned a well-formed but empty analysis' };

  return { ok: true, value: v };
}

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
  //
  // Hitting the ceiling is not a failure of the lead. The caller regenerates the
  // deterministic brief either way, so a budget-capped lead still reaches the sales team
  // with a score, a recommended service and an opening — just without the model's
  // wording. The reason string is written to be shown to a human as-is.
  if (settings.monthlyBudgetUsd > 0) {
    const budget = await aiBudgetStatus(settings.monthlyBudgetUsd);
    if (budget.exceeded) {
      return {
        status: 'skipped',
        reason: `AI budget reached for this month (estimated $${budget.estimatedSpentUsd.toFixed(2)} of $${budget.budgetUsd}). The rules-based brief was used instead. The ceiling resets automatically; raise it in Settings → AI to continue sooner.`,
      };
    }
  }

  const snapshot = buildSnapshot(input);
  const promptVersion = loadEnv().AI_PROMPT_VERSION;

  // The cache key covers everything that could change the answer: the observations, the
  // provider, the model and the prompt revision. Leaving the prompt out was the subtle
  // failure this guards against — an edited prompt would keep returning the old answer
  // from cache and look like it had no effect.
  const inputHash = stableHash({
    snapshot,
    model: provider.model,
    provider: provider.descriptor.key,
    promptVersion,
  });

  if (settings.cacheEnabled && !opts.force) {
    const existing = await prisma.aIAnalysis.findFirst({
      where: {
        leadId: input.lead.id,
        inputHash,
        promptVersion,
        model: provider.model,
        provider: provider.descriptor.key,
        error: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { status: 'ok', analysis: existing, cached: true };
  }

  const log = jobLogger({ leadId: input.lead.id, providerKey: provider.descriptor.key, jobName: 'ai_analysis' });

  try {
    // One retry, then stop. A model that returns malformed JSON twice for the same input
    // is not going to get it right on the third attempt, and each attempt is billed.
    const MAX_ATTEMPTS = 2;
    let result: Awaited<ReturnType<AIProvider['complete']>> | null = null;
    let validated: AiOutput | null = null;
    let lastReason = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const strictness =
        attempt === 1
          ? ''
          : `\n\nYour previous response was rejected: ${lastReason}. Return ONLY the JSON object, with no prose, no code fence and no extra keys.`;

      result = await callProvider(
        provider,
        () =>
          (provider as AIProvider).complete({
            system: SYSTEM_PROMPT,
            user: `Business snapshot (JSON):\n${JSON.stringify(snapshot, null, 2)}\n\nReturn only the JSON object described in your instructions.${strictness}`,
            jsonSchemaName: 'baimar_lead_analysis',
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
          }),
        { usage: {} },
      );

      await trackUsage({
        providerKey: provider.descriptor.key,
        kind: 'AI',
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        estimatedCostUsd: result.estimatedCostUsd,
        // The adapter returns undefined when the model is not in the pricing table.
        // Recorded rather than treated as free, so the ceiling cannot be walked past.
        unpriced: result.estimatedCostUsd === undefined || result.estimatedCostUsd === null,
      });

      const check = validateAiOutput(result.text);
      if (check.ok) {
        validated = check.value;
        break;
      }
      lastReason = check.reason;
      log.warn({ attempt, reason: check.reason }, 'AI output rejected by the schema');
    }

    if (!validated || !result) {
      // Store the failure so a broken prompt is visible in the admin log rather than
      // disappearing, then let the caller fall back to the deterministic brief.
      const failed = await prisma.aIAnalysis.create({
        data: {
          leadId: input.lead.id,
          provider: provider.descriptor.key,
          model: result?.model ?? provider.model,
          inputSnapshot: snapshot as object,
          inputHash,
          promptVersion,
          rawOutput: { text: (result?.text ?? '').slice(0, 4000) },
          error: lastReason,
          validationError: lastReason,
          usedFallback: true,
          latencyMs: result?.latencyMs,
          promptTokens: result?.promptTokens,
          completionTokens: result?.completionTokens,
          totalTokens: result?.totalTokens,
          estimatedCostUsd: result?.estimatedCostUsd,
        },
      });
      return {
        status: 'failed',
        reason: `${lastReason} after ${MAX_ATTEMPTS} attempts — falling back to the rules-based brief (analysis ${failed.id})`,
      };
    }

    const parsed = validated as unknown as Record<string, unknown>;
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
        promptVersion,
        rawOutput: parsed as object,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        estimatedCostUsd: result.estimatedCostUsd,
        latencyMs: result.latencyMs,
      },
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
          promptVersion,
          usedFallback: true,
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
