import type { DataOrigin } from './enums';

/**
 * Confidence badge shown next to every non-trivial value in the UI.
 *
 * The product rule is: the salesperson must always be able to tell the difference between
 * something we saw, something we computed, something we guessed and something an LLM wrote.
 */
export const CONFIDENCE_LEVELS = ['FACT', 'CALCULATED', 'ESTIMATED', 'AI_INSIGHT', 'UNKNOWN'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export interface Provenance {
  /** How sure we are, and what kind of statement this is. */
  confidence: Confidence;
  /** Which data world this came from. */
  origin?: DataOrigin;
  /** Human readable source, e.g. "Official website", "OpenStreetMap", "Google Places API". */
  source?: string;
  /** Canonical URL of the source document, when one exists. */
  sourceUrl?: string;
  /** When the value was observed. ISO-8601. */
  observedAt?: string;
  /** Free text explaining how a CALCULATED / ESTIMATED value was derived. */
  method?: string;
}

/** A value carried together with its provenance. `value === null` means "we do not know". */
export interface Sourced<T> extends Provenance {
  value: T | null;
}

export function fact<T>(value: T | null | undefined, p: Omit<Provenance, 'confidence'> = {}): Sourced<T> {
  if (value === null || value === undefined || value === '') return unknown<T>(p);
  return { value, confidence: 'FACT', ...p };
}

export function calculated<T>(value: T | null | undefined, method: string, p: Omit<Provenance, 'confidence' | 'method'> = {}): Sourced<T> {
  if (value === null || value === undefined) return unknown<T>(p);
  return { value, confidence: 'CALCULATED', method, ...p };
}

export function estimated<T>(value: T | null | undefined, method: string, p: Omit<Provenance, 'confidence' | 'method'> = {}): Sourced<T> {
  if (value === null || value === undefined) return unknown<T>(p);
  return { value, confidence: 'ESTIMATED', method, ...p };
}

export function aiInsight<T>(value: T | null | undefined, p: Omit<Provenance, 'confidence'> = {}): Sourced<T> {
  if (value === null || value === undefined || value === '') return unknown<T>(p);
  return { value, confidence: 'AI_INSIGHT', origin: 'AI_INFERENCE', ...p };
}

export function unknown<T>(p: Omit<Provenance, 'confidence'> = {}): Sourced<T> {
  return { value: null, confidence: 'UNKNOWN', ...p };
}

/** Labels used by the UI badges. Persian first — this is an Iranian sales team. */
export const CONFIDENCE_LABELS: Record<Confidence, { fa: string; en: string }> = {
  FACT: { fa: 'واقعیت', en: 'Fact' },
  CALCULATED: { fa: 'محاسبه‌شده', en: 'Calculated' },
  ESTIMATED: { fa: 'تخمینی', en: 'Estimated' },
  AI_INSIGHT: { fa: 'تحلیل هوش مصنوعی', en: 'AI insight' },
  UNKNOWN: { fa: 'نامشخص', en: 'Unknown' },
};

export const UNKNOWN_LABEL_FA = 'نامشخص';
export const NOT_FOUND_LABEL_FA = 'یافت نشد';
export const NEEDS_VERIFICATION_LABEL_FA = 'نیازمند بررسی';
