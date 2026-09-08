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
}

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
    }

    if (matchedRules === 0) continue;

    // Service priority breaks ties between rules of equal strength.
    score += service.basePriority * 0.1;

    let boost = 0;
    if (marketBoost) {
      const b = marketBoost(service.key);
      if (b) {
        boost = b.points;
        score += b.points;
        reasonsFa.push(b.reasonFa);
      }
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
