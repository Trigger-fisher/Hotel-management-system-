'use client';

// hotel.reports.foodPlan - Meal plans: the meals each guest on a plan is owed in a month, what the food business charges the hotel for them, guest by guest
// (opened: night by night) and plan by plan. Only the nights inside the month count; a stay across two months is split.
import { useMemo, useState } from 'react';
import { istToday, mealPlans, monthOf, type FoodPlanMonthReport, type FoodPlanRow, type MealPlan } from '@shared/dashboards/overview';
import { formatINR, formatMonthLong } from '@shared/dashboards/format';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { DetailCard, DetailList, EmptyState, FilterBar, ListSearch, LoadError, PageHead, PageSkeleton, Pager, useTableView } from '@/dashboards/pallav/ui';
import { useAsync } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { HomeStats, type HomeStat } from './HomeJobs';
import { MonthSwitch } from './OccupancyScreen';
import { overviewApi } from './api';
import { ReportPdfLink } from './ReportPdfLink';

import { rs, dm, shortRef } from './reportFormat';
import { tr, trf } from '@/lib/i18n/language';
const PLAN_WORDS: Record<MealPlan, string> = { CP: 'Breakfast', MAP: 'Breakfast and dinner', AP: 'All meals' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const rupees = (n: number) => formatINR(Math.round(n), { decimals: false });
const rateText = (rates: number[]) => (rates.length === 1 ? rs(rates[0] ?? 0) : tr("Varies"));

export function FoodPlanScreen(_props: ScreenProps) {
  void _props;
  const thisMonth = monthOf(istToday());
  const [month, setMonth] = useState(thisMonth);
  const [plan, setPlan] = useState<MealPlan | ''>('');
  const { state, reload } = useAsync(() => overviewApi.getFoodPlan(month, plan || null), [month, plan]);
  const [last, setLast] = useState<FoodPlanMonthReport | null>(null);
  if (state.status === 'ready' && state.data !== last) setLast(state.data);
  const data = state.status === 'ready' ? state.data : last;
  const busy = state.status === 'loading' && last !== null;
  const shownMonth = data?.month ?? month;

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const view = useTableView(rows, {
    perPage: 25,
    match: (r: FoodPlanRow, q) => `${r.guest} ${r.room} ${r.bill} ${r.company ?? ''} ${r.plans.map((p) => `${p} ${PLAN_WORDS[p]}`).join(' ')}`.toLowerCase().includes(q),
  });
  const t = data?.totals;

  const stats: HomeStat[] = t && data ? [
    { id: 'amount', label: 'Food plan to charge the hotel', value: t.amountPaise, format: rupees, note: formatMonthLong(shownMonth) },
    { id: 'guests', label: 'Guests on a plan', value: t.guests, format: (n) => String(Math.round(n)), note: plural(t.nights, 'room night') },
    { id: 'meals', label: 'Person-nights', value: t.personNights, format: (n) => String(Math.round(n)), note: tr("One person for one night") },
    ...[...data.byPlan].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 1).map((p) => ({ id: 'top', label: 'Most taken', value: p.amountPaise, format: rupees, note: tr(PLAN_WORDS[p.plan]) })),
  ] : [];

  return (
    <>
      <PageHead sub={tr("What the food business charges the hotel for guests' meal plans, guest by guest. Only the nights in the month count.")}>
        <ListSearch value={view.search} onChange={view.setSearch} onClear={() => view.setSearch('')} placeholder={tr("Search guest, room, bill or company")} />
        <ReportPdfLink url={PDF_ROUTES.foodPlanReport(month, plan || undefined)} />
      </PageHead>
      <MonthSwitch month={month} setMonth={setMonth} thisMonth={thisMonth} />

      {state.status === 'error' ? (
        <LoadError error={state.error} onRetry={reload} />
      ) : !data ? (
        <PageSkeleton tiles={false} rows={6} />
      ) : t ? (
        <div aria-busy={busy} className={busy ? 'hu-dim' : undefined}>
          <HomeStats stats={stats} />
          <FilterBar
            tabs={[{ id: '', label: 'All plans' }, ...mealPlans.map((p) => ({ id: p, label: PLAN_WORDS[p] }))]}
            active={plan}
            onTab={(id) => setPlan(id as MealPlan | '')}
            summary={<><b>{view.total}</b> {view.total === 1 ? tr("guest") : tr("guests")} · {rs(t.amountPaise)}</>}
            onReset={view.search || plan ? () => { view.setSearch(''); setPlan(''); } : undefined}
          />
          {rows.length === 0 ? (
            <div className="card">
              <EmptyState icon="egg-fried" title={trf("No meal plans in {0}", [formatMonthLong(shownMonth)])} text={data.plan ? trf("No guest took {0} this month. Try All plans.", [tr(PLAN_WORDS[data.plan])]) : tr("Guests appear here when they are checked in with meals included.")} />
            </div>
          ) : view.rows.length === 0 ? (
            <div className="card"><EmptyState icon="search" title={tr("No guest matches")} text={tr("Try a different name, room, bill or company.")} /></div>
          ) : (
            <div className="hu-dc-list reveal">
              {view.rows.map((r) => (
                <DetailCard className="hu-dc"
                  key={r.id}
                  label={`${tr("Room")} ${r.room} ${r.guest}`}
                  lead={{ big: r.room || '-', tag: r.plans.map((p) => tr(PLAN_WORDS[p])).join(', ') }}
                  facts={[
                    { label: tr("Guest"), value: r.guest, sub: [r.bill ? trf("Bill {0}", [shortRef(r.bill) ?? r.bill]) : '', r.company ?? ''].filter(Boolean).join(' · ') || undefined },
                    { label: tr("Stay"), value: `${dm(r.arrival)} → ${dm(r.departure)}`, sub: r.outside > 0 ? trf("{0} in another month", [plural(r.outside, 'night')]) : undefined },
                    { label: tr("Nights here"), value: r.nightCount, sub: trf("{0} a night", [rateText(r.ratesPaise)]) },
                    { label: tr("People"), value: r.persons.join(' / ') },
                  ]}
                  amount={{ label: tr("To charge"), value: rs(r.amountPaise) }}
                  sections={[
                    {
                      icon: 'calendar3', title: tr("Night by night"), count: r.parts.length,
                      content: (
                        <DetailList items={[
                          ...r.parts.map((p) => ({
                            label: `${dm(p.from)}${p.nights > 1 ? ` – ${dm(p.to)}` : ''}`,
                            value: rs(p.amountPaise),
                            sub: `${tr(PLAN_WORDS[p.plan])}: ${p.persons} × ${rs(p.ratePaise)} × ${plural(p.nights, 'night')}`,
                          })),
                          { label: tr("Total"), value: rs(r.amountPaise), total: true },
                        ]} />
                      ),
                    },
                  ]}
                />
              ))}
            </div>
          )}
          <Pager view={view} />

          {data.byPlan.length > 0 && (
            <section className="card hu-card hu-plan-sum" aria-labelledby="hu-plan-sum-h">
              <h2 id="hu-plan-sum-h" className="hu-h hu-card-h">{trf("{0} by plan", [formatMonthLong(shownMonth)])}</h2>
              <DetailList items={[
                ...data.byPlan.map((p) => ({ label: tr(PLAN_WORDS[p.plan]), value: rs(p.amountPaise), sub: trf("{0} person-nights at {1}", [p.personNights, rateText(p.ratesPaise)]) })),
                { label: tr("Total to charge the hotel"), value: rs(t.amountPaise), total: true },
              ]} />
            </section>
          )}
        </div>
      ) : null}
    </>
  );
}
