import { describe, expect, it } from 'vitest';
import { looksLikeFormula, sanitizeCsvCell, sanitizeCsvRow, sanitizeCsvRows } from './csv-safety';

/**
 * Formula injection is the one export vulnerability this product is genuinely exposed
 * to: business names, addresses and page titles all arrive from other people's websites
 * and from uploaded spreadsheets, and the pipeline export is opened in Excel by a
 * salesperson on their own laptop. A cell that executes there is a compromise of the
 * person we built this for.
 */

describe('formula detection', () => {
  const dangerous = [
    ['=1+1', 'plain formula'],
    ['=HYPERLINK("https://evil.example","click")', 'data exfiltration via HYPERLINK'],
    ['=cmd|\'/c calc\'!A1', 'DDE command execution'],
    ['+1+1', 'plus-prefixed formula'],
    ['-1+1', 'minus-prefixed formula'],
    ['@SUM(A1:A9)', 'at-prefixed Lotus-style formula'],
    ['\tSUM(A1)', 'tab-prefixed'],
    ['\r=1+1', 'carriage-return prefixed'],
  ];

  for (const [value, why] of dangerous) {
    it(`flags ${JSON.stringify(value)} — ${why}`, () => {
      expect(looksLikeFormula(value)).toBe(true);
    });
  }

  const safe = ['کلینیک زیبایی آرمان', 'Baimar Agency', '09121234567', 'https://baimar.ir', '', '  =notfirst'];
  for (const value of safe) {
    it(`leaves ${JSON.stringify(value)} alone`, () => {
      expect(looksLikeFormula(value)).toBe(false);
    });
  }
});

describe('sanitization', () => {
  it('prefixes a formula so the spreadsheet treats it as text', () => {
    expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('never alters ordinary text', () => {
    expect(sanitizeCsvCell('کلینیک زیبایی آرمان')).toBe('کلینیک زیبایی آرمان');
    expect(sanitizeCsvCell('Baimar')).toBe('Baimar');
  });

  it('leaves numbers as numbers, so numeric columns still sum', () => {
    expect(sanitizeCsvCell(42)).toBe(42);
    expect(sanitizeCsvCell(-3)).toBe(-3);
    expect(sanitizeCsvCell(null)).toBeNull();
    expect(sanitizeCsvCell(undefined)).toBeUndefined();
  });

  it('preserves the value rather than dropping it', () => {
    // A business is allowed to have a strange name; losing the row would lose real data.
    const original = '=Advanced Systems';
    const safe = sanitizeCsvCell(original) as string;
    expect(safe.slice(1)).toBe(original);
  });

  it('sanitizes every cell of a row', () => {
    const row = sanitizeCsvRow({ business_name: '=evil()', city: 'اراک', score: 87 });
    expect(row.business_name).toBe("'=evil()");
    expect(row.city).toBe('اراک');
    expect(row.score).toBe(87);
  });

  it('sanitizes a whole export', () => {
    const rows = sanitizeCsvRows([
      { name: '=cmd|\'/c calc\'!A1', phone: '09121234567' },
      { name: 'شرکت نمونه', phone: '02188888888' },
    ]);
    expect(rows[0].name).toBe("'=cmd|'/c calc'!A1");
    expect(rows[1].name).toBe('شرکت نمونه');
  });
});
