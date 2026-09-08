'use client';

import { formatPhoneForDisplay, toPersianDigits } from '@baimar/shared';

/** Display helpers. Persian digits everywhere the user reads a number. */

export function fa(n: number | string | null | undefined, fallback = '—'): string {
  if (n === null || n === undefined || n === '') return fallback;
  return toPersianDigits(String(n));
}

export function faNumber(n: number | null | undefined, fallback = '—'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return fallback;
  return toPersianDigits(n.toLocaleString('en-US'));
}

export function phone(e164: string | null | undefined): string {
  return formatPhoneForDisplay(e164, true) ?? '—';
}

const PERSIAN_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/**
 * Dates are stored as ISO-8601 UTC and only converted for display.
 * Uses the browser's Persian calendar support, with a Gregorian fallback.
 */
export function faDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(date);
  } catch {
    const y = date.getFullYear();
    const m = PERSIAN_MONTHS[date.getMonth()] ?? date.getMonth() + 1;
    return `${toPersianDigits(String(date.getDate()))} ${m} ${toPersianDigits(String(y))}`;
  }
}

/** "۳ روز پیش" / "فردا" — relative time in Persian. */
export function faRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = date.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  const diffHours = Math.round(diffMs / 3_600_000);
  const diffMinutes = Math.round(diffMs / 60_000);

  try {
    const rtf = new Intl.RelativeTimeFormat('fa-IR', { numeric: 'auto' });
    if (Math.abs(diffDays) >= 1) return rtf.format(diffDays, 'day');
    if (Math.abs(diffHours) >= 1) return rtf.format(diffHours, 'hour');
    return rtf.format(diffMinutes, 'minute');
  } catch {
    return faDate(date);
  }
}

export function isOverdue(value: string | Date | null | undefined): boolean {
  if (!value) return false;
  const date = typeof value === 'string' ? new Date(value) : value;
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

/** Truncate for table cells without cutting a word in half where avoidable. */
export function truncate(text: string | null | undefined, max = 60): string {
  if (!text) return '—';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '—';
  return `${toPersianDigits(value.toFixed(digits))}٪`;
}

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}
