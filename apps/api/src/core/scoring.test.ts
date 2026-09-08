import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from '@baimar/shared';
import { isScoreStale, scoreLead } from './scoring';
import type { SignalMap } from './signals';

const config: ScoringConfig = DEFAULT_SCORING_CONFIG;

function signals(...keys: Array<keyof SignalMap>): SignalMap {
  const map: SignalMap = {};
  for (const key of keys) {
    map[key] = { signal: key as never, value: true, evidence: `evidence for ${String(key)}`, confidence: 'FACT' };
  }
  return map;
}

describe('lead scoring', () => {
  it('scores a lead with no signals as zero and LOW', () => {
    const result = scoreLead({}, config);
    expect(result.score).toBe(0);
    expect(result.temperature).toBe('LOW');
    expect(result.contributions).toHaveLength(0);
  });

  it('attributes every point to a named signal with its evidence', () => {
    const result = scoreLead(signals('NO_WEBSITE', 'STRONG_COMMERCIAL_CATEGORY'), config);
    expect(result.score).toBe(35);
    expect(result.contributions.map((c) => c.signal)).toEqual(['NO_WEBSITE', 'STRONG_COMMERCIAL_CATEGORY']);
    expect(result.contributions[0].evidence).toContain('evidence for');
  });

  it('caps a signal group so many small website findings cannot dominate', () => {
    // Eight website-quality findings sum to well above the 45-point cap.
    const many = signals(
      'OUTDATED_WEBSITE',
      'POOR_MOBILE_UX',
      'POOR_PERFORMANCE',
      'WEAK_SEO',
      'WEAK_CTA',
      'NO_CONTACT_FORM',
      'NO_SSL',
      'MISSING_BUSINESS_INFO',
    );
    const result = scoreLead(many, config);
    const websiteGroup = result.groups.find((g) => g.group === 'WEBSITE_QUALITY');

    expect(websiteGroup?.raw).toBeGreaterThan(config.groupCaps.WEBSITE_QUALITY);
    expect(websiteGroup?.applied).toBe(config.groupCaps.WEBSITE_QUALITY);
    expect(websiteGroup?.capped).toBe(true);
    expect(result.score).toBe(config.groupCaps.WEBSITE_QUALITY);
  });

  it('lets counter-signals reduce the score without being capped', () => {
    const withCounter = { ...signals('NO_WEBSITE'), ...signals('MODERN_WEBSITE') };
    const result = scoreLead(withCounter, config);
    // 25 (no website) - 12 (modern website)
    expect(result.score).toBe(13);
  });

  it('never produces a score outside 0..100', () => {
    const everything = signals(
      'NO_WEBSITE',
      'SOCIAL_ONLY_PRESENCE',
      'OUTDATED_WEBSITE',
      'POOR_MOBILE_UX',
      'POOR_PERFORMANCE',
      'WEAK_SEO',
      'WEAK_CTA',
      'NO_CONTACT_FORM',
      'NO_SSL',
      'NO_ONLINE_STORE',
      'NO_ONLINE_BOOKING',
      'ACTIVE_INSTAGRAM',
      'HIGH_REVIEW_COUNT',
      'HIGH_REVIEW_RATING',
      'STRONG_COMMERCIAL_CATEGORY',
      'HIGH_BUSINESS_POTENTIAL',
      'MARKET_DEMAND_MATCH',
    );
    const result = scoreLead(everything, config);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('assigns temperature from the configured thresholds', () => {
    const custom: ScoringConfig = { ...config, thresholds: { hot: 50, warm: 30, medium: 10 } };
    expect(scoreLead(signals('NO_WEBSITE', 'STRONG_COMMERCIAL_CATEGORY'), custom).temperature).toBe('WARM');
    expect(scoreLead(signals('HIGH_REVIEW_RATING'), custom).temperature).toBe('LOW');
  });

  it('detects a stale score after the configuration changes', () => {
    const result = scoreLead(signals('NO_WEBSITE'), config);
    expect(isScoreStale(result.configHash, config)).toBe(false);

    const retuned: ScoringConfig = { ...config, weights: { ...config.weights, NO_WEBSITE: 40 } };
    expect(isScoreStale(result.configHash, retuned)).toBe(true);
    expect(isScoreStale(null, config)).toBe(true);
  });

  it('ignores signals whose weight is zero', () => {
    const zeroed: ScoringConfig = { ...config, weights: { ...config.weights, NO_WEBSITE: 0 } };
    const result = scoreLead(signals('NO_WEBSITE'), zeroed);
    expect(result.score).toBe(0);
    expect(result.contributions).toHaveLength(0);
  });
});
