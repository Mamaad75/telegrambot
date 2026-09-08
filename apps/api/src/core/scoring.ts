import {
  DEFAULT_GROUP_CAPS,
  SCORING_SIGNAL_META,
  SIGNAL_GROUPS,
  SIGNAL_GROUP_OF,
  temperatureFor,
  type LeadTemperature,
  type ScoreContribution,
  type ScoringConfig,
  type ScoringSignal,
  type SignalGroup,
} from '@baimar/shared';
import { stableHash } from '../lib/crypto';
import type { SignalMap } from './signals';

/**
 * Lead scoring.
 *
 * The score answers exactly one question: *how likely is it that Baimar has a relevant
 * opportunity here?* It is not a measure of how big the business is — that is the separate
 * business value score.
 *
 * Signals are grouped and each group is capped, so a website with a dozen small findings
 * cannot pin every audited lead at 100 and flatten the ranking. Every point is
 * attributable: the breakdown is stored with the score so the UI can show
 * "87/100 because: no website (+25), strong category (+10), …" rather than a bare number.
 */

export interface GroupSummary {
  group: SignalGroup;
  raw: number;
  applied: number;
  cap: number;
  capped: boolean;
}

export interface ScoreResult {
  score: number;
  temperature: LeadTemperature;
  contributions: ScoreContribution[];
  /** Per-group totals before and after capping, so the UI can explain a capped score. */
  groups: GroupSummary[];
  /** Sum of applied group totals plus counter-signals, before clamping to 0..100. */
  rawTotal: number;
  /** Identifies the configuration used, so a stale score can be detected after a re-tune. */
  configHash: string;
  /** Human-readable one-liner for the lead list tooltip. */
  summary: string;
}

export function scoreLead(signals: SignalMap, config: ScoringConfig): ScoreResult {
  const caps = { ...DEFAULT_GROUP_CAPS, ...(config.groupCaps ?? {}) };

  const contributions: ScoreContribution[] = [];
  const groupTotals = new Map<SignalGroup, number>(SIGNAL_GROUPS.map((g) => [g, 0]));
  let counterTotal = 0;

  for (const key of Object.keys(signals) as ScoringSignal[]) {
    const signal = signals[key];
    if (!signal?.value) continue;

    const weight = config.weights?.[key] ?? SCORING_SIGNAL_META[key]?.defaultWeight ?? 0;
    if (weight === 0) continue;

    const group = SIGNAL_GROUP_OF[key];
    if (group === 'COUNTER') counterTotal += weight;
    else groupTotals.set(group, (groupTotals.get(group) ?? 0) + weight);

    contributions.push({
      signal: key,
      points: weight,
      labelFa: SCORING_SIGNAL_META[key]?.labelFa ?? key,
      labelEn: SCORING_SIGNAL_META[key]?.labelEn ?? key,
      evidence: signal.evidence,
      confidence: signal.confidence,
    });
  }

  const groups: GroupSummary[] = SIGNAL_GROUPS.map((group) => {
    const raw = groupTotals.get(group) ?? 0;
    const cap = caps[group];
    const applied = Math.min(raw, cap);
    return { group, raw, applied, cap, capped: raw > cap };
  });

  const rawTotal = groups.reduce((sum, g) => sum + g.applied, 0) + counterTotal;

  contributions.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  const score = Math.max(0, Math.min(100, Math.round(rawTotal)));
  const temperature = temperatureFor(score, config.thresholds);

  const positives = contributions.filter((c) => c.points > 0).slice(0, 3).map((c) => c.labelFa);
  const summary = positives.length
    ? `${score}/100 — ${positives.join('، ')}`
    : `${score}/100 — سیگنال فروش قابل توجهی یافت نشد`;

  return {
    score,
    temperature,
    contributions,
    groups,
    rawTotal,
    configHash: configHashOf(config),
    summary,
  };
}

function configHashOf(config: ScoringConfig): string {
  return stableHash({
    weights: config.weights,
    thresholds: config.thresholds,
    audit: config.audit,
    groupCaps: config.groupCaps ?? DEFAULT_GROUP_CAPS,
  }).slice(0, 16);
}

/**
 * Explain a score in plain Persian, for the sales brief and the lead detail header.
 * Only mentions contributions that actually fired, and notes any group that was capped.
 */
export function explainScore(result: ScoreResult): string[] {
  const lines = result.contributions.map(
    (c) => `${c.labelFa} (${c.points > 0 ? '+' : ''}${c.points}) — ${c.evidence}`,
  );
  for (const group of result.groups.filter((g) => g.capped)) {
    lines.push(
      `سقف گروه ${group.group}: مجموع ${group.raw} امتیاز به ${group.applied} محدود شد تا یک دسته سیگنال بر امتیاز کل غالب نشود.`,
    );
  }
  return lines;
}

/** True when the stored score was produced by a different configuration than the current one. */
export function isScoreStale(storedHash: string | null | undefined, config: ScoringConfig): boolean {
  if (!storedHash) return true;
  return storedHash !== configHashOf(config);
}
