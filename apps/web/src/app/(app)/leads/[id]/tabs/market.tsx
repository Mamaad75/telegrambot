'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DemandBadge } from '@/components/badges';
import { Card, EmptyState, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { fa, faNumber } from '@/lib/format';
import type { LeadDetail } from '../types';

interface MarketSignal {
  id: string;
  serviceKey: string | null;
  serviceName: string | null;
  city: string | null;
  strength: string;
  score: number | null;
  basis: string;
  sourceLabels: string[];
  sampleSize: number;
}

/**
 * Market context for one lead: does the market actually want what we are about to sell
 * this business? This is the bridge between market intelligence and the individual call.
 */
export function MarketTab({ data }: { data: LeadDetail }) {
  const [signals, setSignals] = useState<MarketSignal[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ serviceDemand: MarketSignal[] }>('/api/market/overview', { city: data.lead.city ?? undefined })
      .then((res) => setSignals(res.serviceDemand))
      .catch(() => setSignals([]))
      .finally(() => setLoading(false));
  }, [data.lead.city]);

  if (loading) return <Loading />;

  const relevant = (signals ?? []).filter(
    (s) => s.serviceKey === data.lead.recommendedService || data.lead.secondaryServices.includes(s.serviceKey ?? ''),
  );
  const others = (signals ?? []).filter((s) => !relevant.includes(s)).slice(0, 8);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card
        title="تقاضای بازار برای خدمت پیشنهادی"
        subtitle={data.lead.city ? `شهر ${data.lead.city}` : 'بدون تفکیک شهر'}
      >
        {relevant.length === 0 ? (
          <EmptyState
            title="سیگنال تقاضایی برای این خدمت ثبت نشده است"
            description="سیگنال تقاضا از داده تجمیعی کلیدواژه و داده تبلیغاتی خود بایمر ساخته می‌شود. تا زمانی که داده‌ای وارد نشود، هیچ عددی ساخته نمی‌شود."
            action={
              <Link href="/market" className="btn-ghost btn-sm">
                بخش هوشمندی بازار
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {relevant.map((signal) => (
              <li key={signal.id} className="rounded-xl border border-border p-3.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{signal.serviceName ?? signal.serviceKey}</p>
                  <DemandBadge strength={signal.strength} />
                </div>
                <p className="text-[11px] leading-6 text-subtle">{signal.basis}</p>
                <p className="mt-1 text-[11px] text-subtle">
                  منابع: {signal.sourceLabels.join('، ') || '—'} • {faNumber(signal.sampleSize)} مشاهده
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="سایر تقاضاهای این شهر">
        {others.length === 0 ? (
          <p className="text-xs text-subtle">داده‌ای موجود نیست.</p>
        ) : (
          <ul className="space-y-2">
            {others.map((signal) => (
              <li key={signal.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted">{signal.serviceName ?? signal.serviceKey}</span>
                <span className="flex items-center gap-2">
                  {signal.score !== null && <span className="tnum text-subtle">{fa(signal.score)}</span>}
                  <DemandBadge strength={signal.strength} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 rounded-xl bg-surface-2 p-3 text-[11px] leading-6 text-subtle">
          این داده‌ها تجمیعی هستند و هیچ ارتباطی با فعالیت جست‌وجوی افراد مشخص ندارند. سامانه هرگز ادعا نمی‌کند که فردی
          عبارت خاصی را جست‌وجو کرده است.
        </p>
      </Card>
    </div>
  );
}
