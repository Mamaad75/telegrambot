import type { AuditFinding, Confidence } from '@baimar/shared';
import type { PageAnalysis } from '../crawler/parse';

/**
 * The audit scoring primitive.
 *
 * A check is either passed, failed, or *unavailable*. "Unavailable" is a first-class
 * outcome: when a measurement cannot be taken it is excluded from the denominator and
 * reported to the UI, instead of being silently counted as a failure. That is what stops
 * the platform from presenting a fabricated score.
 */

export type CheckArea = AuditFinding['area'];

export interface Check {
  id: string;
  area: CheckArea;
  weight: number;
  outcome: 'PASS' | 'FAIL' | 'UNAVAILABLE';
  evidence: string;
  /** Present when the check failed and the failure is worth showing to a salesperson. */
  finding?: { titleFa: string; titleEn: string; evidence: string; confidence?: Confidence };
  severity?: AuditFinding['severity'];
}

export interface AreaScore {
  score: number | null;
  /** Check ids that could not be evaluated. */
  unavailable: string[];
  passed: number;
  failed: number;
}

export function scoreArea(checks: Check[], area: CheckArea): AreaScore {
  const relevant = checks.filter((c) => c.area === area);
  const applicable = relevant.filter((c) => c.outcome !== 'UNAVAILABLE');
  const unavailable = relevant.filter((c) => c.outcome === 'UNAVAILABLE').map((c) => c.id);

  if (!applicable.length) return { score: null, unavailable, passed: 0, failed: 0 };

  const total = applicable.reduce((s, c) => s + c.weight, 0);
  const earned = applicable.filter((c) => c.outcome === 'PASS').reduce((s, c) => s + c.weight, 0);
  return {
    score: total === 0 ? null : Math.round((earned / total) * 100),
    unavailable,
    passed: applicable.filter((c) => c.outcome === 'PASS').length,
    failed: applicable.filter((c) => c.outcome === 'FAIL').length,
  };
}

export function findingsFrom(checks: Check[]): AuditFinding[] {
  return checks
    .filter((c) => c.outcome === 'FAIL' && c.finding)
    .map<AuditFinding>((c) => ({
      code: c.id,
      area: c.area,
      severity: c.severity ?? 'MEDIUM',
      titleFa: c.finding!.titleFa,
      titleEn: c.finding!.titleEn,
      evidence: c.finding!.evidence || c.evidence,
      confidence: c.finding!.confidence ?? 'FACT',
    }))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(s: AuditFinding['severity']): number {
  return { HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 }[s];
}

export function pass(id: string, area: CheckArea, weight: number, evidence: string): Check {
  return { id, area, weight, outcome: 'PASS', evidence };
}

export function fail(
  id: string,
  area: CheckArea,
  weight: number,
  evidence: string,
  finding: { titleFa: string; titleEn: string; severity?: AuditFinding['severity']; confidence?: Confidence },
): Check {
  return {
    id,
    area,
    weight,
    outcome: 'FAIL',
    evidence,
    severity: finding.severity ?? 'MEDIUM',
    finding: { titleFa: finding.titleFa, titleEn: finding.titleEn, evidence, confidence: finding.confidence },
  };
}

export function unavailable(id: string, area: CheckArea, weight: number, reason: string): Check {
  return { id, area, weight, outcome: 'UNAVAILABLE', evidence: reason };
}

/** Convenience: pick pass/fail from a boolean. */
export function check(
  condition: boolean,
  id: string,
  area: CheckArea,
  weight: number,
  passEvidence: string,
  failInfo: { evidence: string; titleFa: string; titleEn: string; severity?: AuditFinding['severity'] },
): Check {
  return condition
    ? pass(id, area, weight, passEvidence)
    : fail(id, area, weight, failInfo.evidence, failInfo);
}

/** Average of the pages we managed to fetch, ignoring pages that failed. */
export function averageOf(pages: PageAnalysis[], pick: (p: PageAnalysis) => number | null | undefined): number | null {
  const values = pages.map(pick).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
