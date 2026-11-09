'use client';
// What Pallav's Bills and Guest Advances lists share: the day headings, the Room/Food capsule, the filter card and the pager adapter.
import { formatDate, formatINR } from '@shared/dashboards/format';
import { todayIst, type FilterOptions } from '@shared/dashboards/billing';
import type { Kpi } from '@shared/dashboards/common';
import type { HomeStat } from '../overview/HomeJobs';
import { FilterMenu, ListTabs, TextAction } from '../../pallav/ui';
import type { ListFilters } from './shared';

import { tr } from '@/lib/i18n/language';
export const money = (p: number) => formatINR(p);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The list's figures for the HomeStats row every list page carries. */
export const kpiStats = (kpis: Kpi[]): HomeStat[] =>
  kpis.slice(0, 4).map((k) => ({ id: k.id, label: k.label, value: k.value, format: (n: number) => (k.kind === 'money' ? money(Math.round(n)) : k.kind === 'percent' ? `${Math.round(n)}%` : String(Math.round(n))), note: k.hint }));

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const formatMonthLong = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1] ?? ''} ${ym.slice(0, 4)}`;

/** "Today", "Yesterday", else "Monday, 06 Oct 2026". */
export function dayLabel(date: string): string {
  if (!date) return 'No date';
  const today = todayIst();
  if (date === today) return 'Today';
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (date === yesterday) return 'Yesterday';
  return `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}, ${formatDate(date)}`;
}

/** Rows are already newest first: consecutive rows of one day form a group. */
export function groupByDay<T>(rows: T[], dateOf: (r: T) => string): { date: string; items: T[] }[] {
  const groups: { date: string; items: T[] }[] = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.date === dateOf(r)) g.items.push(r);
    else groups.push({ date: dateOf(r), items: [r] });
  }
  return groups;
}

/** The capsule under the room number: Room, Room + Food, or Food alone (_kind.blade.php). */
export function Kind({ hotel, food }: { hotel: number; food: number }) {
  let room = hotel > 0;
  const meal = food > 0;
  if (!room && !meal) room = true;
  const both = room && meal;
  return (
    <span className={`sh-shift bm-kind ${both ? 'both' : meal ? 'food' : 'room'}`} title={both ? 'Room and food' : meal ? 'Food only' : 'Room only'}>
      {room && (
        <>
          <i className="bi bi-door-closed" aria-hidden="true" /> {tr("Room")}{' '}
        </>
      )}
      {both && <span className="bm-kind-plus">+</span>}
      {meal && (
        <>
          <i className="bi bi-cup-hot" aria-hidden="true" /> {tr("Food")}
        </>
      )}
    </span>
  );
}

export interface FilterTab {
  id: string;
  label: string;
  /** Colour of the dot before the label (bm-dot paid | due | settled | muted). */
  dot?: string;
  count: number;
}

/** One card for every way to narrow the list: status tabs on top, then payment, company and month. */
export function ListFilterBar({
  f, options, tabs, total, all, noun, ariaLabel, paymentAria, companyAria, monthAria,
}: {
  f: ListFilters;
  options: FilterOptions;
  tabs: FilterTab[];
  /** Rows that match the filters. */
  total: number;
  /** Rows on record before any filter. */
  all: number;
  noun: string;
  ariaLabel: string;
  paymentAria: string;
  companyAria: string;
  monthAria: string;
}) {
  return (
    <div className="bm-fbar reveal" role="search" aria-label={ariaLabel}>
      <div className="bm-fbar-top">
        <ListTabs label={tr("Status")} active={f.tab} onChange={f.setTab} tabs={tabs.map((x) => ({ id: x.id, label: x.label, count: x.count, dot: x.dot }))} />
        <div className="bm-fbar-summary">
          {/* bill-master.js: "All <b>N</b> bills", or "Showing <b>n</b> of N bills" while a filter is on (the noun follows N). */}
          <span aria-live="polite">
            {f.active ? <>{tr("Showing")} <b>{total}</b> {tr("of")} {all}</> : <>{tr("All")} <b>{all}</b></>} {all === 1 ? noun : `${noun}s`}
          </span>
          {f.active && (
            <TextAction kind="reset" onClick={f.reset}>{tr("Reset")}</TextAction>
          )}
        </div>
      </div>
      <div className="bm-fbar-row">
        <span className="bm-fbar-label"><i className="bi bi-sliders2" /> {tr("Narrow down")}</span>
        <FilterMenu label={tr("Payment")} icon="credit-card" any="Any way" ariaLabel={paymentAria} value={f.mode} onChange={f.setMode}
          options={options.modes.map((m) => ({ value: m, label: m, count: options.counts?.modes[m] }))} />
        <FilterMenu label={tr("Company")} icon="building" any="Any company" ariaLabel={companyAria} value={f.companyId} onChange={f.setCompany}
          options={[{ value: 'walkin', label: 'Walk-in guests', count: options.counts?.companies.walkin }, ...options.companies.map((c) => ({ value: c.id, label: c.name, count: options.counts?.companies[c.id] }))]} />
        <FilterMenu label={tr("Month")} icon="calendar3" any="Any month" ariaLabel={monthAria} value={f.month} onChange={f.setMonth}
          options={options.months.map((m) => ({ value: m, label: formatMonthLong(m), count: options.counts?.months[m] }))} />
      </div>
    </div>
  );
}
