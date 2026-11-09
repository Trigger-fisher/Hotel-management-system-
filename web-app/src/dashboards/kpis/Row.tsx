'use client';

// The KPI row every page carries under its title: the shared figure strip of the Overview and the Ledger (HomeStats), filled from one small read per page.
import { useEffect, useState } from 'react';

import type { DashResult } from '@shared/dashboards/common';
import { formatCount, formatINR } from '@shared/dashboards/format';
import { HomeStats, type HomeStat } from '../groups/overview/HomeJobs';
import { tr, trf } from '@/lib/i18n/language';

export type { HomeStat };

export const num = (n: number) => formatCount(Math.round(n));
export const inr = (paise: number) => formatINR(Math.round(paise));
export const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? tr(one) : tr(many)}`;
export { trf };

/** One figure: a count by default; pass `money` for paise. */
export function card(label: string, value: number, note?: string, money = false, extra: Pick<HomeStat, 'icon' | 'tone' | 'onOpen'> = {}): HomeStat {
  return { id: label, label, value, format: money ? (n) => inr(n) : (n) => num(n), note, ...extra };
}

/** A figure that is a word or a time, not a number. */
export function wordCard(label: string, text: string, note?: string): HomeStat {
  return { id: label, label, value: 0, format: () => text, note };
}

export function KpiRow<T>({ load, cards, deps = [] }: { load: () => Promise<DashResult<T>>; cards: (data: T) => HomeStat[]; deps?: unknown[] }) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    load().then(
      (r) => {
        if (!live) return;
        if (r.ok) setData(r.data);
        else setFailed(true);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
    // `deps` stands for `load`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  if (failed && !data) return null;
  if (!data) {
    return (
      <div className="pk-row" aria-busy="true">
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="kpi">
              <span className="skel skel-small" />
              <span className="skel skel-value" />
              <span className="skel skel-small" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  const stats = cards(data);
  if (stats.length === 0) return null;
  return (
    <div className="pk-row">
      <HomeStats stats={stats} />
    </div>
  );
}
