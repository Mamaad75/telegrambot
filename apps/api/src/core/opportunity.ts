import type { ServiceRule, ScoringSignal } from '@baimar/shared';
import type { Service } from '@prisma/client';
import type { SignalMap } from './signals';

/**
 * Opportunity engine.
 *
 * Deterministic first, always. Given the signals we observed and the service catalogue in
 * the database, it decides which Baimar service a lead most likely needs and why. AI, when
 * available, refines the wording — it never replaces this baseline, so the platform keeps
 * recommending sensible services when no AI provider is configured.
 */

export type OpportunityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

/**
 * One contribution to an opportunity score, with the observation behind it.
 *
 * The score is deterministic and every point is attributable — a salesperson can be told
 * "94, because the market signal is high (+20), they have no online store (+35), their
 * Instagram is active (+15) and the business looks commercially attractive (+8)". AI may
 * later rewrite that into a sentence; it never changes the number.
 */
export interface OpportunityFactor {
  key: string;
  labelFa: string;
  points: number;
  evidence: string;
  kind: 'RULE' | 'MARKET' | 'BUSINESS_VALUE' | 'PRIORITY';
}

export interface ServiceMatch {
  serviceId: string;
  serviceKey: string;
  nameFa: string;
  nameEn: string;
  score: number;
  level: OpportunityLevel;
  reasonsFa: string[];
  reasonsEn: string[];
  /** Extra points contributed by market demand for this service in this city. */
  marketBoost: number;
  matchedRules: number;
  /** Full breakdown of the score. */
  factors: OpportunityFactor[];
}

export interface OpportunityContext {
  /** Commercial attractiveness, kept strictly separate from opportunity fit. */
  businessValueTier?: string | null;
  businessValueScore?: number | null;
}

/**
 * Points added for commercial attractiveness.
 *
 * Deliberately small next to the rule points: a large business with no relevant problem
 * is still a poor lead, and this must never let business size overwhelm actual fit.
 */
const BUSINESS_VALUE_POINTS: Record<string, number> = { HIGH: 10, MEDIUM: 5, LOW: 0, UNKNOWN: 0 };

export interface MarketBoostLookup {
  /** Returns 0..25 extra points when the market shows demand for this service. */
  (serviceKey: string): { points: number; reasonFa: string } | null;
}

function ruleFires(rule: ServiceRule, active: Set<ScoringSignal>): boolean {
  if (rule.excludes?.some((s) => active.has(s))) return false;
  if (rule.requiresAll?.length && !rule.requiresAll.every((s) => active.has(s))) return false;
  if (rule.requiresAny?.length && !rule.requiresAny.some((s) => active.has(s))) return false;
  // A rule with no positive condition never fires on its own.
  if (!rule.requiresAll?.length && !rule.requiresAny?.length) return false;
  return true;
}

export function matchServices(
  signals: SignalMap,
  services: Service[],
  marketBoost?: MarketBoostLookup,
  context: OpportunityContext = {},
): ServiceMatch[] {
  const active = new Set<ScoringSignal>(
    (Object.keys(signals) as ScoringSignal[]).filter((k) => signals[k]?.value === true),
  );

  const matches: ServiceMatch[] = [];

  for (const service of services) {
    if (!service.isActive) continue;
    const rules = parseRules(service.rules);
    let score = 0;
    const reasonsFa: string[] = [];
    const reasonsEn: string[] = [];
    const factors: OpportunityFactor[] = [];
    let matchedRules = 0;

    for (const rule of rules) {
      if (!ruleFires(rule, active)) continue;
      matchedRules++;
      score += rule.points;
      reasonsFa.push(rule.reasonFa);
      reasonsEn.push(rule.reasonEn);

      // Attach the concrete observation that satisfied the rule, so the reason is
      // specific ("no viewport meta tag") and not generic ("outdated website").
      const trigger = [...(rule.requiresAny ?? []), ...(rule.requiresAll ?? [])].find((s) => active.has(s));
      if (trigger && signals[trigger]?.evidence) {
        reasonsFa.push(signals[trigger]!.evidence);
      }
      factors.push({
        key: trigger ?? rule.reasonEn,
        labelFa: rule.reasonFa,
        points: rule.points,
        evidence: (trigger && signals[trigger]?.evidence) || 'قاعدهٔ سرویس برقرار شد',
        kind: 'RULE',
      });
    }

    if (matchedRules === 0) continue;

    // Service priority breaks ties between rules of equal strength.
    const priorityPoints = service.basePriority * 0.1;
    score += priorityPoints;
    if (priorityPoints !== 0) {
      factors.push({
        key: 'service_priority',
        labelFa: 'اولویت پایهٔ خدمت',
        points: Math.round(priorityPoints * 10) / 10,
        evidence: `اولویت پیکربندی‌شدهٔ «${service.nameFa}»`,
        kind: 'PRIORITY',
      });
    }

    let boost = 0;
    if (marketBoost) {
      const b = marketBoost(service.key);
      if (b) {
        boost = b.points;
        score += b.points;
        reasonsFa.push(b.reasonFa);
        factors.push({
          key: 'market_demand',
          labelFa: 'تقاضای بازار برای این خدمت',
          points: b.points,
          evidence: b.reasonFa,
          kind: 'MARKET',
        });
      }
    }

    // Commercial attractiveness, kept as its own small factor so it can never be
    // mistaken for opportunity fit — and never presented as revenue.
    const tier = context.businessValueTier ?? 'UNKNOWN';
    const valuePoints = BUSINESS_VALUE_POINTS[tier] ?? 0;
    if (valuePoints > 0) {
      score += valuePoints;
      const label = tier === 'HIGH' ? 'بالا' : 'متوسط';
      reasonsFa.push(`ارزش تجاری کسب‌وکار ${label} ارزیابی شده است`);
      factors.push({
        key: 'business_value',
        labelFa: 'ارزش تجاری کسب‌وکار',
        points: valuePoints,
        evidence: `سطح ارزش تجاری: ${label}${context.businessValueScore != null ? ` (${context.businessValueScore}/100)` : ''}`,
        kind: 'BUSINESS_VALUE',
      });
    }

    matches.push({
      serviceId: service.id,
      serviceKey: service.key,
      nameFa: service.nameFa,
      nameEn: service.nameEn,
      score: Math.round(score),
      level: levelFor(Math.round(score)),
      reasonsFa: Array.from(new Set(reasonsFa)),
      reasonsEn: Array.from(new Set(reasonsEn)),
      marketBoost: boost,
      matchedRules,
      factors: factors.sort((a, b) => b.points - a.points),
    });
  }

  return matches.sort((a, b) => b.score - a.score);
}

export function levelFor(score: number): OpportunityLevel {
  if (score >= 100) return 'VERY_HIGH';
  if (score >= 70) return 'HIGH';
  if (score >= 45) return 'MEDIUM';
  return 'LOW';
}

/** Prisma stores rules as JSON; validate the shape before trusting it. */
export function parseRules(raw: unknown): ServiceRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is ServiceRule => {
    if (!r || typeof r !== 'object') return false;
    const rule = r as Record<string, unknown>;
    return typeof rule.points === 'number' && typeof rule.reasonFa === 'string';
  });
}

/**
 * Primary and secondary recommendations.
 * Secondary services are only offered when they address a *different* problem than
 * the primary one, so the salesperson does not pitch two names for the same fix.
 */
export function pickRecommendations(matches: ServiceMatch[]): {
  primary: ServiceMatch | null;
  secondary: ServiceMatch[];
} {
  if (!matches.length) return { primary: null, secondary: [] };
  const primary = matches[0];
  const primaryReasons = new Set(primary.reasonsEn);
  const secondary = matches
    .slice(1)
    .filter((m) => m.score >= 40 && m.reasonsEn.some((r) => !primaryReasons.has(r)))
    .slice(0, 2);
  return { primary, secondary };
}
