'use client';

// hotel.reports.gst - GST summary for the accountant: the month's GST in figures, then every bill as a card (before tax, GST, total; opened: hotel and food
// with their rates). Company bills carry a GST number (GSTR-1 table 4), guest bills do not (table 7). CSV laid out for GSTR-1 on the real server.
import { useMemo, useState } from 'react';
import { istToday, monthOf, overviewCopy, type GstBillLine, type GstReport } from '@shared/dashboards/overview';
import { formatDate, formatINR, formatMonthLong } from '@shared/dashboards/format';
import { Bi, DetailCard, DetailList, EmptyState, FilterBar, ListSearch, LoadError, PageHead, PageSkeleton, Pager, useTableView } from '@/dashboards/pallav/ui';
import { useAsync } from '@/components/ui';
import { apiMode } from '@/lib/api/mode';
import type { ScreenProps } from '../../types';
import { HomeStats, type HomeStat } from './HomeJobs';
import { MonthSwitch } from './OccupancyScreen';
import { overviewApi } from './api';

import { tr, trf } from '@/lib/i18n/language';
type Tab = 'all' | 'company' | 'guest';
const rupees = (n: number) => formatINR(Math.round(n), { decimals: false });
const money = (paise: number) => (paise ? formatINR(paise) : '-');
const rate = (p: string | null) => (p ? ` (${p}%)` : '');

export function GstScreen(_props: ScreenProps) {
  void _props;
  const c = overviewCopy.gst;
  const thisMonth = monthOf(istToday());
  const [month, setMonth] = useState(thisMonth);
  const [tab, setTab] = useState<Tab>('all');
  const { state, reload } = useAsync(() => overviewApi.getGst(month), [month], { keep: true });
  const data: GstReport | null = state.status === 'ready' ? state.data : null;
  const rows = useMemo(() => (data?.bills ?? []).filter((b) => tab === 'all' || (tab === 'company') === Boolean(b.gstin)), [data, tab]);
  const view = useTableView(rows, {
    perPage: 25,
    match: (r: GstBillLine, q) => `${r.billNumber} ${r.guest} ${r.company ?? ''} ${r.gstin ?? ''}`.toLowerCase().includes(q),
  });
  const t = data?.totals;

  const stats: HomeStat[] = t ? [
    { id: 'gst', label: 'GST collected', value: t.gstPaise, format: rupees, note: trf("Hotel {0}, food {1}", [rupees(t.hotel.gstPaise), rupees(t.food.gstPaise)]) },
    { id: 'taxable', label: 'Billed before tax', value: t.taxablePaise, format: rupees, note: trf("{0} bills", [t.bills]) },
    { id: 'b2b', label: 'Company bills', value: t.b2b.bills, format: (n) => String(Math.round(n)), note: trf("With a GST number, {0} GST", [rupees(t.b2b.gstPaise)]) },
    { id: 'b2c', label: 'Guest bills', value: t.b2c.bills, format: (n) => String(Math.round(n)), note: trf("No GST number, {0} GST", [rupees(t.b2c.gstPaise)]) },
  ] : [];

  return (
    <>
      <PageHead sub={tr("The GST on every bill of the month, ready for the accountant. Company bills have a GST number, guest bills do not.")}>
        <ListSearch value={view.search} onChange={view.setSearch} onClear={() => view.setSearch('')} placeholder={tr("Search bill, guest, company or GST number")} />
        {apiMode() === 'real' && data && data.bills.length > 0 ? (
          <a className="btn btn-outline-p" href={`/api/v1/reports/gst/csv?month=${month}`} download>
            <Bi name="download" /> {tr("Download for GSTR-1")}
          </a>
        ) : null}
      </PageHead>
      <MonthSwitch month={month} setMonth={(m) => { setMonth(m); view.setSearch(''); }} thisMonth={thisMonth} />
      {state.status === 'error' ? <LoadError error={state.error} onRetry={reload} /> : null}
      {!data && state.status === 'loading' ? <PageSkeleton /> : null}
      {data && t ? (
        <div aria-busy={state.status === 'loading'} className={state.status === 'loading' ? 'hu-dim' : undefined}>
          <HomeStats stats={stats} />
          {data.bills.length === 0 ? (
            <div className="card"><EmptyState icon="receipt" title={c.empty.title} text={month === thisMonth ? tr("Bills appear here as guests check out this month.") : tr("No bill was made in this month.")} /></div>
          ) : (
            <>
              <FilterBar
                tabs={[
                  { id: 'all', label: 'All', count: t.bills },
                  { id: 'company', label: 'Company bills', count: t.b2b.bills },
                  { id: 'guest', label: 'Guest bills', count: t.b2c.bills },
                ]}
                active={tab}
                onTab={(id) => setTab(id as Tab)}
                summary={<><b>{view.total}</b> {view.total === 1 ? tr("bill") : tr("bills")} · {formatMonthLong(month)}</>}
                onReset={view.search || tab !== 'all' ? () => { view.setSearch(''); setTab('all'); } : undefined}
              />
              {view.rows.length === 0 ? (
                <div className="card"><EmptyState icon="search" title={tr("No bill matches")} text={tr("Try the bill number, the guest's name or the GST number.")} /></div>
              ) : (
                <div className="hu-dc-list reveal">
                  {view.rows.map((b) => {
                    const gst = b.hotelGstPaise + b.foodGstPaise;
                    const taxable = b.hotelTaxablePaise + b.foodTaxablePaise;
                    return (
                      <DetailCard className="hu-dc"
                        key={b.id}
                        label={trf("Bill {0}", [b.billNumber])}
                        lead={{ big: formatDate(b.date).slice(0, 2), small: formatDate(b.date).slice(3, 6), tag: b.gstin ? tr("Company") : tr("Guest"), muted: !b.gstin }}
                        facts={[
                          { label: tr("Bill"), value: b.billNumber, sub: b.company ? `${b.guest} · ${b.company}` : b.guest },
                          { label: tr("GST number"), value: b.gstin ?? tr("None"), tone: b.gstin ? undefined : 'muted' },
                          { label: tr("Before tax"), value: money(taxable) },
                          { label: tr("GST"), value: money(gst) },
                        ]}
                        amount={{ label: tr("Total"), value: formatINR(b.totalPaise) }}
                        sections={[
                          {
                            icon: 'receipt', title: tr("Hotel and food"),
                            content: (
                              <DetailList items={[
                                b.hotelTaxablePaise + b.hotelGstPaise !== 0 && { label: tr("Hotel before tax"), value: money(b.hotelTaxablePaise) },
                                b.hotelTaxablePaise + b.hotelGstPaise !== 0 && { label: `${tr("Hotel GST")}${rate(b.hotelGstPercent)}`, value: money(b.hotelGstPaise) },
                                b.foodTaxablePaise + b.foodGstPaise !== 0 && { label: tr("Food before tax"), value: money(b.foodTaxablePaise) },
                                b.foodTaxablePaise + b.foodGstPaise !== 0 && { label: `${tr("Food GST")}${rate(b.foodGstPercent)}`, value: money(b.foodGstPaise) },
                                { label: tr("Total"), value: formatINR(b.totalPaise), total: true },
                              ]} />
                            ),
                          },
                        ]}
                      />
                    );
                  })}
                </div>
              )}
              <Pager view={view} />
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
