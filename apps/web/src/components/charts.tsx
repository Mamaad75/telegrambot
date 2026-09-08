'use client';

import { fa, faNumber } from '@/lib/format';

/**
 * Charts, drawn as plain SVG.
 *
 * A charting library would add hundreds of kilobytes to every page for shapes this simple,
 * and the platform has to run comfortably on a 2 CPU / 4 GB VPS. Each chart states its own
 * empty case rather than rendering an empty axis that reads as "zero".
 */

export interface Datum {
  label: string;
  count: number;
  color?: string;
}

const SERIES_COLORS = [
  'rgb(var(--accent))',
  'rgb(var(--medium))',
  'rgb(var(--success))',
  'rgb(var(--warm))',
  'rgb(var(--info))',
  'rgb(var(--hot))',
  'rgb(var(--subtle))',
];

function NoData({ hint }: { hint?: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
      <p className="text-xs text-subtle">هنوز داده‌ای برای نمایش وجود ندارد</p>
      {hint && <p className="max-w-xs text-[11px] leading-5 text-subtle/80">{hint}</p>}
    </div>
  );
}

/** Horizontal bars — the right shape for category names in Persian, which need width. */
export function BarList({ data, hint, max = 8 }: { data: Datum[]; hint?: string; max?: number }) {
  const items = data.filter((d) => d.count > 0).slice(0, max);
  if (!items.length) return <NoData hint={hint} />;
  const peak = Math.max(...items.map((d) => d.count));

  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-xs text-muted" title={item.label}>
              {item.label}
            </span>
            <span className="tnum shrink-0 text-xs font-medium text-fg">{faNumber(item.count)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(3, (item.count / peak) * 100)}%`,
                background: item.color ?? SERIES_COLORS[i % SERIES_COLORS.length],
                transition: 'width 400ms ease',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Donut for two-to-five category splits. */
export function Donut({ data, hint, size = 180 }: { data: Datum[]; hint?: string; size?: number }) {
  const items = data.filter((d) => d.count > 0);
  const total = items.reduce((s, d) => s + d.count, 0);
  if (!total) return <NoData hint={hint} />;

  const radius = size / 2 - 14;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="نمودار دایره‌ای">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {items.map((item, i) => {
            const fraction = item.count / total;
            const dash = circumference * fraction;
            const circle = (
              <circle
                key={item.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={item.color ?? SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth="16"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return circle;
          })}
        </g>
        <text x="50%" y="46%" textAnchor="middle" className="tnum fill-current text-fg" style={{ fontSize: 22, fontWeight: 600 }}>
          {faNumber(total)}
        </text>
        <text x="50%" y="60%" textAnchor="middle" className="fill-current text-subtle" style={{ fontSize: 11 }}>
          مجموع
        </text>
      </svg>

      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: item.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }}
            />
            <span className="text-muted">{item.label}</span>
            <span className="tnum font-medium text-fg">{faNumber(item.count)}</span>
            <span className="text-subtle">({fa(Math.round((item.count / total) * 100))}٪)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Pipeline funnel — each stage as a proportional bar, so drop-off is visible at a glance. */
export function Funnel({ data, hint }: { data: Datum[]; hint?: string }) {
  const peak = Math.max(...data.map((d) => d.count), 0);
  if (!peak) return <NoData hint={hint} />;

  return (
    <ul className="space-y-1.5">
      {data.map((stage, i) => {
        const width = Math.max(2, (stage.count / peak) * 100);
        const previous = i > 0 ? data[i - 1].count : null;
        const dropOff = previous && previous > 0 ? Math.round(((previous - stage.count) / previous) * 100) : null;
        return (
          <li key={stage.label} className="group flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-xs text-muted" title={stage.label}>
              {stage.label}
            </span>
            <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-surface-2">
              <div
                className="h-full rounded-lg bg-accent/70 transition-[width] duration-500"
                style={{ width: `${width}%` }}
              />
              <span className="tnum absolute inset-y-0 start-2 flex items-center text-[11px] font-medium text-fg">
                {faNumber(stage.count)}
              </span>
            </div>
            <span className="w-14 shrink-0 text-end text-[11px] text-subtle">
              {dropOff !== null && dropOff > 0 ? `−${fa(dropOff)}٪` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Compact KPI tile. `hint` explains what the number means and where it came from. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'hot' | 'warm' | 'success' | 'danger';
  icon?: React.ReactNode;
  href?: string;
}) {
  const toneClass = {
    default: 'text-fg',
    hot: 'text-hot',
    warm: 'text-warm',
    success: 'text-success',
    danger: 'text-danger',
  }[tone];

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        {icon && <span className="text-base opacity-50">{icon}</span>}
      </div>
      <p className={`tnum mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-5 text-subtle">{hint}</p>}
    </>
  );

  const className = 'card card-pad transition-colors';
  return href ? (
    <a href={href} className={`${className} hover:border-accent/40`}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}
