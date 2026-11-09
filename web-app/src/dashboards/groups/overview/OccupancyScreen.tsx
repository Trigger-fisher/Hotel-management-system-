'use client';

// hotel.reports.occupancy - how full the hotel was each night of a month: the month's figures in plain words, then one row per night with a filled bar,
// the rooms sold out of the rooms in service, the room income, and who arrived and left. CSV on the real server.
import { useState } from 'react';
import { addMonths, istToday, monthOf, overviewCopy, type OccupancyReport } from '@shared/dashboards/overview';
import { formatINR, formatMonthLong, formatWeekdayDate } from '@shared/dashboards/format';
import { Bi, Button, EmptyState, LoadError, PageHead, PageSkeleton, PmsDate } from '@/dashboards/pallav/ui';
import { useAsync } from '@/components/ui';
import { apiMode } from '@/lib/api/mode';
import type { ScreenProps } from '../../types';
import { HomeStats, type HomeStat } from './HomeJobs';
import { overviewApi } from './api';

import { tr, trf } from '@/lib/i18n/language';
const pct = (n: number) => `${Math.round(n)}%`;
const rupees = (n: number) => formatINR(Math.round(n), { decimals: false });

export function MonthSwitch({ month, setMonth, thisMonth }: { month: string; setMonth: (m: string) => void; thisMonth: string }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  return (
    <div className="hu-month" role="group" aria-label={tr("Month")}>
      <Button variant="outline" icon="chevron-left" aria-label={trf("Previous month, {0}", [formatMonthLong(prev)])} onClick={() => setMonth(prev)} />
      <span className="hu-month-pick">
        <b>{formatMonthLong(month)}</b>
        <PmsDate type="month" className="form-control" value={month} max={thisMonth} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={tr("Choose a month")} />
      </span>
      {next <= thisMonth && <Button variant="outline" icon="chevron-right" aria-label={trf("Next month, {0}", [formatMonthLong(next)])} onClick={() => setMonth(next)} />}
      {month !== thisMonth && <Button variant="ghost" size="sm" onClick={() => setMonth(thisMonth)}>{tr("This month")}</Button>}
    </div>
  );
}

export function OccupancyScreen(_props: ScreenProps) {
  void _props;
  const c = overviewCopy.occupancy;
  const thisMonth = monthOf(istToday());
  const [month, setMonth] = useState(thisMonth);
  const { state, reload } = useAsync(() => overviewApi.getOccupancy(month), [month], { keep: true });
  const data: OccupancyReport | null = state.status === 'ready' ? state.data : null;
  const t = data?.totals;
  const busiest = data && data.days.length ? Math.max(...data.days.map((d) => d.occupancyPct)) : 0;

  const stats: HomeStat[] = t && data ? [
    { id: 'full', label: 'Rooms filled', value: t.occupancyPct, format: pct, note: trf("{0} of {1} room nights", [t.roomsSold, t.roomNights]) },
    { id: 'avg', label: 'Average price of a sold room', value: t.adrPaise, format: rupees, note: tr("A night, room income only") },
    { id: 'per', label: 'Income per room in service', value: t.revParPaise, format: rupees, note: trf("A night, over {0} rooms", [data.rooms]) },
    { id: 'income', label: 'Room income', value: t.roomRevenuePaise, format: rupees, note: trf("{0} arrived, {1} left", [t.arrivals, t.departures]) },
  ] : [];

  return (
    <>
      <PageHead sub={tr("How full the hotel was each night and what the rooms earned. Pick a month to look back.")}>
        {apiMode() === 'real' && data && data.days.length > 0 ? (
          <a className="btn btn-outline-p" href={`/api/v1/reports/occupancy/csv?month=${month}`} download>
            <Bi name="download" /> {c.csv}
          </a>
        ) : null}
      </PageHead>
      <MonthSwitch month={month} setMonth={setMonth} thisMonth={thisMonth} />
      {state.status === 'error' ? <LoadError error={state.error} onRetry={reload} /> : null}
      {!data && state.status === 'loading' ? <PageSkeleton /> : null}
      {data && t ? (
        <div aria-busy={state.status === 'loading'} className={state.status === 'loading' ? 'hu-dim' : undefined}>
          <HomeStats stats={stats} />
          {data.days.length === 0 ? (
            <div className="card"><EmptyState icon="calendar-x" title={tr("No nights yet")} text={month === thisMonth ? tr("Nights appear here from the first check-in of the month.") : tr("No guest stayed in this month.")} /></div>
          ) : (
            <section className="card hu-nights" aria-label={trf("Nights of {0}", [formatMonthLong(month)])}>
              <div className="hu-night hu-night-key" aria-hidden="true">
                <span>{tr("Night")}</span><span>{tr("Rooms filled")}</span><span>{tr("Room income")}</span><span>{tr("In / out")}</span>
              </div>
              <ol>
                {data.days.map((d) => (
                  <li key={d.date} className={`hu-night${d.occupancyPct === busiest && busiest > 0 ? ' is-top' : ''}`}>
                    <span className="hu-night-day">{formatWeekdayDate(d.date)}</span>
                    <span className="hu-night-fill">
                      <span className="hu-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, d.occupancyPct))}%` }} /></span>
                      <span className="hu-night-pct"><b>{pct(d.occupancyPct)}</b> <small>{trf("{0} of {1}", [d.roomsSold, data.rooms])}</small></span>
                    </span>
                    <span className="hu-night-amt">
                      <b>{rupees(d.roomRevenuePaise)}</b>
                      {d.roomsSold > 0 && <small>{trf("{0} a room", [rupees(d.roomRevenuePaise / d.roomsSold)])}</small>}
                    </span>
                    <span className="hu-night-io">
                      <span title={tr("Arrived")}><Bi name="box-arrow-in-right" /> {d.arrivals}</span>
                      <span title={tr("Left")}><Bi name="box-arrow-right" /> {d.departures}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      ) : null}
    </>
  );
}
