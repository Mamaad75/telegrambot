import { describe, expect, it } from 'vitest';
import { check, fail, findingsFrom, pass, scoreArea, unavailable, type Check } from './checks';

describe('audit scoring primitives', () => {
  it('excludes unavailable checks from the denominator instead of scoring them zero', () => {
    const checks: Check[] = [
      pass('a', 'SEO', 1, 'ok'),
      fail('b', 'SEO', 1, 'not ok', { titleFa: 'x', titleEn: 'x' }),
      unavailable('c', 'SEO', 8, 'requires a browser'),
    ];

    const result = scoreArea(checks, 'SEO');
    // One pass, one fail: 50 — the heavy unavailable check does not drag it to 10.
    expect(result.score).toBe(50);
    expect(result.unavailable).toEqual(['c']);
  });

  it('returns null, not zero, when nothing in an area could be measured', () => {
    const result = scoreArea([unavailable('a', 'PERFORMANCE', 4, 'no browser')], 'PERFORMANCE');
    expect(result.score).toBeNull();
    expect(result.unavailable).toEqual(['a']);
  });

  it('weights checks by importance', () => {
    const checks: Check[] = [
      pass('heavy', 'MOBILE', 9, 'ok'),
      fail('light', 'MOBILE', 1, 'not ok', { titleFa: 'x', titleEn: 'x' }),
    ];
    expect(scoreArea(checks, 'MOBILE').score).toBe(90);
  });

  it('turns only failures into findings, ordered by severity', () => {
    const checks: Check[] = [
      pass('ok', 'SEO', 1, 'fine'),
      fail('low', 'SEO', 1, 'minor', { titleFa: 'کم', titleEn: 'low', severity: 'LOW' }),
      fail('high', 'MOBILE', 1, 'major', { titleFa: 'زیاد', titleEn: 'high', severity: 'HIGH' }),
      unavailable('skip', 'UX', 1, 'not measured'),
    ];

    const findings = findingsFrom(checks);
    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe('HIGH');
    expect(findings[0].evidence).toBe('major');
  });

  it('carries the evidence for both outcomes of a boolean check', () => {
    const passed = check(true, 'x', 'UX', 1, 'has a logo', { evidence: 'no logo', titleFa: 'ن', titleEn: 'n' });
    const failed = check(false, 'x', 'UX', 1, 'has a logo', { evidence: 'no logo', titleFa: 'ن', titleEn: 'n' });

    expect(passed.outcome).toBe('PASS');
    expect(passed.evidence).toBe('has a logo');
    expect(failed.outcome).toBe('FAIL');
    expect(failed.finding?.evidence).toBe('no logo');
  });
});
