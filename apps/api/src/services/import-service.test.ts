import { describe, expect, it } from 'vitest';
import { detectMapping, parseCsv, previewImport } from './import-service';

describe('CSV column mapping', () => {
  it('maps English headers', () => {
    const mapping = detectMapping(['Business Name', 'Phone', 'Website', 'City', 'Category']);
    expect(mapping['Business Name']).toBe('businessName');
    expect(mapping.Phone).toBe('phone');
    expect(mapping.Website).toBe('website');
    expect(mapping.City).toBe('city');
    expect(mapping.Category).toBe('category');
  });

  it('maps Persian headers', () => {
    const mapping = detectMapping(['نام کسب و کار', 'شماره تماس', 'وب سایت', 'شهر', 'اینستاگرام']);
    expect(mapping['نام کسب و کار']).toBe('businessName');
    expect(mapping['شماره تماس']).toBe('phone');
    expect(mapping['وب سایت']).toBe('website');
    expect(mapping['شهر']).toBe('city');
    expect(mapping['اینستاگرام']).toBe('instagram');
  });

  it('never maps two headers onto the same field', () => {
    const mapping = detectMapping(['name', 'business name', 'company']);
    const assigned = Object.values(mapping).filter(Boolean);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('leaves unrecognised headers unmapped rather than guessing', () => {
    const mapping = detectMapping(['نام', 'کد رهگیری داخلی', 'xyz123']);
    expect(mapping['نام']).toBe('businessName');
    expect(mapping['کد رهگیری داخلی']).toBeNull();
    expect(mapping.xyz123).toBeNull();
  });
});

describe('CSV parsing', () => {
  it('handles a UTF-8 BOM, quoted fields and Persian content', () => {
    const csv = '﻿نام,تلفن,شهر\n"کلینیک زیبایی، آرمان",۰۹۱۲۳۴۵۶۷۸۹,اراک\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]['نام']).toBe('کلینیک زیبایی، آرمان');
    expect(rows[0]['شهر']).toBe('اراک');
  });

  it('tolerates ragged rows instead of rejecting the whole file', () => {
    const rows = parseCsv('a,b,c\n1,2\n3,4,5,6\n');
    expect(rows.length).toBe(2);
  });

  it('reports what it will do before writing anything', () => {
    const preview = previewImport('name,phone,unknown_column\nکلینیک نمونه,09123456789,x\n');
    expect(preview.totalRows).toBe(1);
    expect(preview.mapping.name).toBe('businessName');
    expect(preview.unmapped).toContain('unknown_column');
    expect(preview.missingRequired).toHaveLength(0);
  });

  it('refuses an import with no business-name column', () => {
    const preview = previewImport('phone,city\n09123456789,اراک\n');
    expect(preview.missingRequired).toContain('businessName');
  });
});
