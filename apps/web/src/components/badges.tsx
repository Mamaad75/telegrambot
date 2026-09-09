'use client';

import {
  BUSINESS_VALUE_LABELS,
  CONFIDENCE_LABELS,
  TEMPERATURE_LABELS,
  type BusinessValueTier,
  type Confidence,
  type ContactStatus,
  type LeadTemperature,
  type WebsiteStatus,
} from '@baimar/shared';
import { fa } from '@/lib/format';

/**
 * Provenance badges.
 *
 * This is the product's core honesty mechanism: every non-trivial value on screen is
 * accompanied by what kind of statement it is. A salesperson must be able to tell at a
 * glance whether they are looking at something we observed, something we computed,
 * something we estimated, or something a language model wrote.
 */

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  FACT: 'bg-success/10 text-success',
  CALCULATED: 'bg-info/10 text-info',
  ESTIMATED: 'bg-warning/10 text-warning',
  AI_INSIGHT: 'bg-accent/15 text-accent',
  UNKNOWN: 'bg-surface-2 text-subtle',
};

const CONFIDENCE_TITLES: Record<Confidence, string> = {
  FACT: 'مشاهده مستقیم از یک منبع عمومی',
  CALCULATED: 'محاسبه‌شده از داده‌های مشاهده‌شده',
  ESTIMATED: 'تخمین بر پایه نشانه‌های غیرمستقیم — نیازمند تأیید',
  AI_INSIGHT: 'تولیدشده توسط مدل زبانی — پیش از استناد بررسی شود',
  UNKNOWN: 'داده‌ای در دسترس نیست',
};

export function ConfidenceBadge({ confidence, className = '' }: { confidence: Confidence; className?: string }) {
  return (
    <span className={`chip ${CONFIDENCE_STYLES[confidence]} ${className}`} title={CONFIDENCE_TITLES[confidence]}>
      {CONFIDENCE_LABELS[confidence].fa}
    </span>
  );
}

/** Renders a value, or an explicit "unknown" state — never a fabricated placeholder. */
export function ValueOrUnknown({
  value,
  confidence,
  unknownLabel = 'نامشخص',
  className = '',
}: {
  value: React.ReactNode;
  confidence?: Confidence;
  unknownLabel?: string;
  className?: string;
}) {
  const isEmpty = value === null || value === undefined || value === '' || value === '—';
  if (isEmpty) {
    return <span className={`text-subtle ${className}`} title="این اطلاعات در منابع در دسترس یافت نشد">{unknownLabel}</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span>{value}</span>
      {confidence && confidence !== 'FACT' && <ConfidenceBadge confidence={confidence} />}
    </span>
  );
}

const TEMPERATURE_STYLES: Record<LeadTemperature, string> = {
  HOT: 'bg-hot/15 text-hot',
  WARM: 'bg-warm/15 text-warm',
  MEDIUM: 'bg-medium/15 text-medium',
  LOW: 'bg-surface-2 text-subtle',
};

export function TemperatureBadge({ temperature }: { temperature: LeadTemperature | null | undefined }) {
  if (!temperature) return <span className="chip bg-surface-2 text-subtle">امتیازدهی نشده</span>;
  return <span className={`chip ${TEMPERATURE_STYLES[temperature]}`}>{TEMPERATURE_LABELS[temperature].fa}</span>;
}

const VALUE_STYLES: Record<BusinessValueTier, string> = {
  VERY_HIGH: 'bg-accent/15 text-accent',
  HIGH: 'bg-success/10 text-success',
  MEDIUM: 'bg-info/10 text-info',
  LOW: 'bg-surface-2 text-muted',
  UNKNOWN: 'bg-surface-2 text-subtle',
};

export function BusinessValueBadge({ tier }: { tier: BusinessValueTier }) {
  return (
    <span className={`chip ${VALUE_STYLES[tier]}`} title="ارزش تجاری تخمینی بر پایه نشانه‌های عمومی — درآمد واقعی نیست">
      {BUSINESS_VALUE_LABELS[tier].fa}
    </span>
  );
}

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  NEW: 'جدید',
  RESEARCHED: 'بررسی‌شده',
  READY_TO_CALL: 'آماده تماس',
  CONTACTED: 'تماس گرفته شد',
  NO_ANSWER: 'بدون پاسخ',
  CALLBACK: 'تماس مجدد',
  INTERESTED: 'علاقه‌مند',
  MEETING: 'جلسه',
  PROPOSAL: 'پیشنهاد ارسال شد',
  NEGOTIATION: 'مذاکره',
  WON: 'برنده',
  LOST: 'از دست رفته',
  NOT_INTERESTED: 'علاقه‌مند نیست',
};

const STATUS_STYLES: Record<ContactStatus, string> = {
  NEW: 'bg-surface-2 text-muted',
  RESEARCHED: 'bg-info/10 text-info',
  READY_TO_CALL: 'bg-accent/15 text-accent',
  CONTACTED: 'bg-info/10 text-info',
  NO_ANSWER: 'bg-surface-2 text-subtle',
  CALLBACK: 'bg-warm/15 text-warm',
  INTERESTED: 'bg-success/10 text-success',
  MEETING: 'bg-success/10 text-success',
  PROPOSAL: 'bg-accent/15 text-accent',
  NEGOTIATION: 'bg-accent/15 text-accent',
  WON: 'bg-success/15 text-success',
  LOST: 'bg-danger/10 text-danger',
  NOT_INTERESTED: 'bg-danger/10 text-danger',
};

export function StatusBadge({ status }: { status: ContactStatus }) {
  return <span className={`chip ${STATUS_STYLES[status]}`}>{CONTACT_STATUS_LABELS[status]}</span>;
}

export const WEBSITE_STATUS_LABELS: Record<WebsiteStatus, string> = {
  UNKNOWN: 'بررسی نشده',
  NO_WEBSITE: 'بدون وب‌سایت',
  NOT_VERIFIED: 'نیازمند تأیید',
  ACTIVE: 'فعال',
  PARKED: 'پارک‌شده',
  BROKEN: 'خراب',
  SOCIAL_ONLY: 'فقط شبکه اجتماعی',
};

const WEBSITE_STATUS_STYLES: Record<WebsiteStatus, string> = {
  UNKNOWN: 'bg-surface-2 text-subtle',
  NO_WEBSITE: 'bg-hot/15 text-hot',
  NOT_VERIFIED: 'bg-warning/10 text-warning',
  ACTIVE: 'bg-success/10 text-success',
  PARKED: 'bg-warm/15 text-warm',
  BROKEN: 'bg-danger/10 text-danger',
  SOCIAL_ONLY: 'bg-warm/15 text-warm',
};

export function WebsiteStatusBadge({ status }: { status: WebsiteStatus }) {
  return <span className={`chip ${WEBSITE_STATUS_STYLES[status]}`}>{WEBSITE_STATUS_LABELS[status]}</span>;
}

export function DemoBadge() {
  return (
    <span className="chip border border-warning/40 bg-warning/10 text-warning" title="داده نمونه — واقعی نیست">
      نمونه
    </span>
  );
}

/** Circular score indicator. Colour follows the temperature bands. */
export function ScoreRing({
  score,
  size = 56,
  label,
}: {
  score: number | null | undefined;
  size?: number;
  label?: string;
}) {
  const value = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : null;
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = value === null ? circumference : circumference * (1 - value / 100);

  const color =
    value === null ? 'rgb(var(--subtle))'
      : value >= 80 ? 'rgb(var(--hot))'
      : value >= 65 ? 'rgb(var(--warm))'
      : value >= 45 ? 'rgb(var(--medium))'
      : 'rgb(var(--subtle))';

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`امتیاز ${value ?? 'نامشخص'}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--border))" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 400ms ease' }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="tnum fill-current text-fg"
          style={{ fontSize: size * 0.3, fontWeight: 600 }}
        >
          {value === null ? '—' : fa(value)}
        </text>
      </svg>
      {label && <span className="text-[11px] text-subtle">{label}</span>}
    </div>
  );
}

/** Horizontal score bar used for the six audit sub-scores. */
export function ScoreBar({
  label,
  score,
  unavailableReason,
}: {
  label: string;
  score: number | null | undefined;
  unavailableReason?: string;
}) {
  if (score === null || score === undefined) {
    return (
      <div className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-[11px] text-subtle" title={unavailableReason ?? 'این سنجه اندازه‌گیری نشد'}>
          اندازه‌گیری نشد
        </span>
      </div>
    );
  }

  const color = score >= 75 ? 'bg-success' : score >= 50 ? 'bg-warning' : 'bg-danger';

  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-xs text-muted">{label}</span>
        <span className="tnum text-xs font-medium text-fg">{fa(score)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%`, transition: 'width 400ms ease' }} />
      </div>
    </div>
  );
}

const STRENGTH_LABELS: Record<string, string> = {
  VERY_HIGH: 'بسیار بالا',
  HIGH: 'بالا',
  MEDIUM: 'متوسط',
  LOW: 'کم',
  INSUFFICIENT_DATA: 'داده کافی نیست',
};

const STRENGTH_STYLES: Record<string, string> = {
  VERY_HIGH: 'bg-accent/15 text-accent',
  HIGH: 'bg-success/10 text-success',
  MEDIUM: 'bg-info/10 text-info',
  LOW: 'bg-surface-2 text-muted',
  INSUFFICIENT_DATA: 'bg-surface-2 text-subtle',
};

export function DemandBadge({ strength }: { strength: string }) {
  return <span className={`chip ${STRENGTH_STYLES[strength] ?? STRENGTH_STYLES.LOW}`}>{STRENGTH_LABELS[strength] ?? strength}</span>;
}

/* -------------------------------------------------------------------------- */
/*  Data-quality badge (patches 16, 17 and 54)                                 */
/* -------------------------------------------------------------------------- */

export type DataQuality = 'FACT' | 'AGGREGATE' | 'ESTIMATED' | 'IMPORTED' | 'AI_INSIGHT' | 'UNKNOWN';

const QUALITY_LABELS: Record<DataQuality, string> = {
  FACT: 'واقعیت',
  AGGREGATE: 'داده تجمیعی',
  ESTIMATED: 'تخمینی',
  IMPORTED: 'واردشده',
  AI_INSIGHT: 'برداشت هوش مصنوعی',
  UNKNOWN: 'نامشخص',
};

/**
 * The tooltips matter as much as the labels. A salesperson deciding whether to repeat a
 * number on a call needs to know, in one hover, what kind of thing it is — and the
 * AGGREGATE wording is deliberate: this platform can say that demand exists, and can
 * never say who is behind it.
 */
const QUALITY_TITLES: Record<DataQuality, string> = {
  FACT: 'اندازه‌گیری مستقیم از داده‌های خودِ بایمر (سرچ کنسول / آنالیتیکس).',
  AGGREGATE: 'سیگنال تجمیعی روی تعداد زیادی جست‌وجو — هیچ فرد مشخصی قابل شناسایی نیست.',
  ESTIMATED: 'تخمین محاسبه‌شده توسط این سامانه، نه یک اندازه‌گیری.',
  IMPORTED: 'از فایل واردشده توسط کاربر — اعتبارش به اعتبار همان فایل است.',
  AI_INSIGHT: 'برداشت مدل زبانی از داده‌های موجود — پیش از استناد بررسی شود.',
  UNKNOWN: 'داده‌ای در دسترس نیست. عدد صفر نیست؛ اندازه‌گیری نشده است.',
};

const QUALITY_STYLES: Record<DataQuality, string> = {
  FACT: 'bg-success/10 text-success',
  AGGREGATE: 'bg-info/10 text-info',
  ESTIMATED: 'bg-warning/10 text-warning',
  IMPORTED: 'bg-accent/15 text-accent',
  AI_INSIGHT: 'bg-accent/15 text-accent',
  UNKNOWN: 'bg-surface-2 text-subtle',
};

export function QualityBadge({ quality, className = '' }: { quality: DataQuality; className?: string }) {
  const key = QUALITY_LABELS[quality] ? quality : 'UNKNOWN';
  return (
    <span className={`chip ${QUALITY_STYLES[key]} ${className}`} title={QUALITY_TITLES[key]}>
      {QUALITY_LABELS[key]}
    </span>
  );
}

/**
 * Renders a metric that may legitimately have no value.
 *
 * The rule from patch 17: a missing search volume is "unknown", never 0 and never an
 * estimate dressed up as a measurement. When only a relative signal exists, that is what
 * is shown.
 */
export function MetricOrUnknown({
  value,
  quality,
  suffix = '',
  relativeHint = 'فقط سیگنال نسبی',
}: {
  value: number | null | undefined;
  quality?: DataQuality | 'RELATIVE_SIGNAL';
  suffix?: string;
  relativeHint?: string;
}) {
  if (quality === 'RELATIVE_SIGNAL') {
    return (
      <span className="text-subtle" title="حجم مطلق جست‌وجو در دسترس نیست؛ فقط می‌دانیم تقاضا نسبتاً بالا است.">
        {relativeHint}
      </span>
    );
  }
  if (value === null || value === undefined) {
    return (
      <span className="text-subtle" title="اندازه‌گیری نشده است — این عدد صفر نیست.">
        نامشخص
      </span>
    );
  }
  return (
    <span className="tnum">
      {value.toLocaleString('fa-IR')}
      {suffix}
    </span>
  );
}
