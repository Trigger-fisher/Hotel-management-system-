'use client';

// hotel.reports.daily - Daily Report (Pallav: reports/index.blade.php + reports/partials/daily-report.blade.php + _day-lines.blade.php).
import { useState } from 'react';
import { addDays, istToday, type DailyReport, type DayLine } from '@shared/dashboards/overview';
import { formatINR, formatWeekdayDate } from '@shared/dashboards/format';
import { Bi, Button, ListSearch, LoadError, PageHead, PageSkeleton, PmsDate, Table } from '@/dashboards/pallav/ui';
import { HomeStats, type HomeStat } from './HomeJobs';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { useAsync } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { overviewApi } from './api';
import { ReportPdfLink } from './ReportPdfLink';

import { rs, shortRef } from './reportFormat';
import { tr, trf } from '@/lib/i18n/language';
const rupees = (n: number) => formatINR(Math.round(n), { decimals: false });
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

function Lines({ rows, title, icon, head, tone, empty, first, footLabel, footAmount, bucket, hidden }: {
  rows: DayLine[];
  title: string;
  icon: string;
  head: string;
  tone: string;
  empty: string;
  first?: [string, number | null];
  footLabel: string;
  footAmount: number;
  bucket?: 'banked' | 'debit';
  hidden: (l: DayLine) => boolean;
}) {
  return (
    <div className="card">
      <div className="ds-head">
        <h3 className="ds-title">
          <Bi name={icon.split(' ')[0] ?? icon} className={icon.split(' ').slice(1).join(' ')} /> {title} <span className="dr-count">{rows.length}</span>
        </h3>
      </div>
      <Table className="dr-table">
        <colgroup>
          <col className="w-room" />
          <col className="w-ref" />
          <col />
          <col className="w-amt" />
        </colgroup>
        <thead>
          <tr>
            <th>{tr("Room")}</th>
            <th>{tr("Receipt")}</th>
            <th>{tr("What")}</th>
            <th className="num">{head}</th>
          </tr>
        </thead>
        <tbody>
          {first ? (
            <tr className="dr-carry">
              <td colSpan={3}>{first[0]}</td>
              <td className="num">{first[1] === null ? '' : rs(first[1])}</td>
            </tr>
          ) : null}
          {rows.length === 0 ? (
            <tr className="dr-none">
              <td colSpan={4}>{empty}</td>
            </tr>
          ) : null}
          {rows.map((l, at) => {
            const viaAdvance = l.amountPaise <= 0 && l.fromAdvancePaise > 0;
            const kind = l.note && l.note.toLowerCase().includes(l.kind.split(' ')[0]?.toLowerCase() ?? '') ? null : l.kind;
            const detail = [kind, l.note].filter(Boolean).join(' · ');
            return (
              <tr key={`${l.id}-${at}`} hidden={hidden(l)}>
                <td className="c-room">{l.room || '–'}</td>
                <td className="c-ref" title={l.ref ?? undefined}>{shortRef(l.ref) || '–'}</td>
                <td className="c-part">
                  <span className="dr-name">{l.particulars}</span>
                  <span className="dr-sub">
                    {bucket === 'banked' ? <span className="ds-mode">{l.mode}</span> : null}{' '}
                    {bucket === 'debit' && l.party ? (
                      <>
                        <Bi name="building" /> {l.party} ·{' '}
                      </>
                    ) : null}
                    {detail}
                  </span>
                </td>
                <td className={`num c-amt ${viaAdvance ? '' : tone}`}>
                  {viaAdvance ? (
                    <span className="dr-adv" title={tr("Already paid through the advance")}>
                      {tr("From advance")}
                    </span>
                  ) : (
                    rs(l.amountPaise)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="dr-foot">
        <span>{footLabel}</span>
        <b>{rs(footAmount)}</b>
      </div>
    </div>
  );
}

export function DailyReportScreen({ params, user }: ScreenProps) {
  const today = istToday();
  const [date, setDate] = useState(params.date && params.date <= today ? params.date : today);
  const [q, setQ] = useState('');
  const { state, reload } = useAsync(() => overviewApi.getDailyReport(date), [date]);
  // The day on screen stays until the next one has loaded, so moving a day does not blank the page.
  const [last, setLast] = useState<DailyReport | null>(null);
  if (state.status === 'ready' && state.data !== last) setLast(state.data);
  const data = state.status === 'ready' ? state.data : last;
  // While the next day loads, the old figures stay but are marked busy and dimmed, so they are not read as the new day's.
  const dim = state.status === 'loading' && last ? { 'aria-busy': true, style: { opacity: 0.55 } } : {};

  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const canNext = next <= today;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hidden = (l: DayLine) => {
    if (!words.length) return false;
    const text = [l.room, l.ref, l.particulars, l.party, l.note, l.kind, l.mode].filter(Boolean).join(' ').toLowerCase();
    return !words.every((w) => text.includes(w));
  };

  const t = data?.totals;
  const foodHidden = (g: DailyReport['foodPlan'][number]) => words.length > 0 && !words.every((w) => [g.room, g.bill, g.guest, g.company, g.plan].filter(Boolean).join(' ').toLowerCase().includes(w));
  const none = data && words.length > 0 && [data.cashIn, data.cashOut, data.banked, data.debit, data.complimentary].every((ls) => ls.every(hidden)) && data.foodPlan.every(foodHidden);

  const stats: HomeStat[] = t ? [
    { id: 'drawer', label: 'Cash in the drawer tonight', value: t.carryForwardPaise, format: rupees, note: tr("Tomorrow's opening balance") },
    { id: 'in', label: 'Taken in today', value: t.revenuePaise, format: rupees, note: trf("Cash {0}, online {1}, on credit {2}", [rupees(t.cashInPaise), rupees(t.bankedInPaise), rupees(t.debitPaise)]) },
    { id: 'out', label: 'Paid out today', value: t.paidOutPaise, format: rupees, note: trf("Cash {0}, food plan {1}", [rupees(t.cashOutPaise), rupees(t.foodPlanPaise)]) },
    { id: 'net', label: 'Net for the day', value: t.netPaise, format: rupees, note: tr("Taken in less paid out") },
  ] : [];

  return (
    <>
      <PageHead sub={tr("The day's money at the desk: cash in and out, tonight's food plan, online payments and bills on credit. Print it at the end of the day.")}>
        <ListSearch value={q} onChange={setQ} onClear={() => setQ('')} placeholder={tr("Search guest, room or bill")} />
        <ReportPdfLink url={PDF_ROUTES.dailyReport(date)} />
      </PageHead>
      <div className="hu-month" role="group" aria-label={tr("Day")}>
        <Button variant="outline" icon="chevron-left" aria-label={trf("Previous day, {0}", [formatWeekdayDate(prev)])} onClick={() => setDate(prev)} />
        <span className="hu-month-pick">
          <b>{date === today ? `${tr("Today")}, ${formatWeekdayDate(date)}` : formatWeekdayDate(date)}</b>
          <PmsDate type="date" className="form-control" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value > today ? today : e.target.value)} aria-label={tr("Choose a day")} />
        </span>
        {canNext && <Button variant="outline" icon="chevron-right" aria-label={trf("Next day, {0}", [formatWeekdayDate(next)])} onClick={() => setDate(next)} />}
        {date !== today && <Button variant="ghost" size="sm" onClick={() => setDate(today)}>{tr("Today")}</Button>}
      </div>

      {state.status === 'error' ? (
        <LoadError error={state.error} onRetry={reload} />
      ) : !data ? (
        <PageSkeleton tiles={false} rows={6} />
      ) : t ? (
        <>
          <div {...dim}><HomeStats stats={stats} /></div>

          <div className="dr-section reveal" {...dim}>
            <span className="dr-step">1</span>
            <div>
              <h3>{tr("Cash at the desk")}</h3>
              <p>{tr("Cash taken in on the left, cash paid out on the right. With tonight's food plan below, these decide what is left in the drawer.")}</p>
            </div>
          </div>
          <div className="day-split dr-pair reveal" {...dim}>
            <Lines rows={data.cashIn} title={tr("Cash received")} icon="arrow-down-left-circle" head="Received" tone="amount-in" empty="No cash taken in." first={['Opening balance (carried forward)', t.openingPaise]} footLabel="Cash in hand" footAmount={t.cashOnHandPaise} hidden={hidden} />
            <Lines rows={data.cashOut} title={tr("Cash paid out")} icon="arrow-up-right-circle" head="Paid" tone="amount-out" empty="Nothing paid out in cash." first={['Paid from the drawer', null]} footLabel="Total paid out" footAmount={t.cashOutPaise} hidden={hidden} />
          </div>

          <div className="dr-section reveal" {...dim}>
            <span className="dr-step">
              <Bi name="egg-fried" />
            </span>
            <div>
              <h3>{tr("Food plan for tonight")}</h3>
            </div>
          </div>
          <div className="dr-single reveal" {...dim}>
            <div className="card">
              <div className="ds-head">
                <h3 className="ds-title">
                  <Bi name="egg-fried" /> {tr("Plan meals")} <span className="dr-count">{data.foodPlan.length}</span>
                </h3>
              </div>
              <Table className="dr-table">
                <colgroup>
                  <col className="w-room" />
                  <col className="w-ref" />
                  <col />
                  <col className="w-amt" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{tr("Room")}</th>
                    <th>{tr("Bill")}</th>
                    <th>{tr("Guest")}</th>
                    <th className="num">{tr("Food plan")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.foodPlan.length === 0 ? (
                    <tr className="dr-none">
                      <td colSpan={4}>{tr("No guest on a meal plan tonight.")}</td>
                    </tr>
                  ) : null}
                  {data.foodPlan.map((g, at) => (
                    <tr key={`${g.id}-${at}`} hidden={foodHidden(g)}>
                      <td className="c-room">{g.room || '–'}</td>
                      <td className="c-ref" title={g.bill || undefined}>{shortRef(g.bill) || '–'}</td>
                      <td className="c-part">
                        <span className="dr-name">{g.guest}</span>
                        <span className="dr-sub">
                          <span className="ds-mode">{g.plan}</span> {g.persons} {plural(g.persons, 'person')} × {rs(g.ratePaise)}
                          {g.company ? ` · ${g.company}` : ''}
                        </span>
                      </td>
                      <td className="num c-amt amount-out">{rs(g.amountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="dr-foot">
                <span>{tr("Food plan for tonight")}</span>
                <b>{rs(t.foodPlanPaise)}</b>
              </div>
            </div>
          </div>

          <div className="dr-sum reveal" {...dim}>
            <div className="dr-sum-part">
              <span>{tr("Cash in hand")}</span>
              <b>{rs(t.cashOnHandPaise)}</b>
              <em>
                {tr("Opening")} {rs(t.openingPaise)} {tr("+ received")} {rs(t.cashInPaise)}
              </em>
            </div>
            <span className="dr-op">−</span>
            <div className="dr-sum-part">
              <span>{tr("Cash paid out")}</span>
              <b>{rs(t.cashOutPaise)}</b>
              <em>
                {data.cashOut.length} {plural(data.cashOut.length, 'payment')}
              </em>
            </div>
            <span className="dr-op">−</span>
            <div className="dr-sum-part">
              <span>{tr("Food plan")}</span>
              <b>{rs(t.foodPlanPaise)}</b>
              <em>
                {data.foodPlan.length} {plural(data.foodPlan.length, 'guest')} {tr("tonight")}
              </em>
            </div>
            <span className="dr-op">=</span>
            <div className="dr-sum-part result">
              <span>{tr("Cash in the drawer tonight")}</span>
              <b>{rs(t.carryForwardPaise)}</b>
              <em>{tr("Tomorrow's opening balance")}</em>
            </div>
          </div>

          <div className="dr-section reveal" {...dim}>
            <span className="dr-step">2</span>
            <div>
              <h3>{tr("Received online: card, UPI and booking sites")}</h3>
              <p>{tr("Paid straight into the bank, so none of it is in the drawer and it does not change the cash carry forward.")}</p>
            </div>
          </div>
          <div className="dr-single reveal" {...dim}>
            <Lines rows={data.banked} title={tr("Received online")} icon="credit-card text-success" head="Received" tone="amount-in" empty="Nothing received by card, UPI or booking sites." footLabel="Total received online" footAmount={t.bankedInPaise} bucket="banked" hidden={hidden} />
          </div>

          <div className="dr-section reveal" {...dim}>
            <span className="dr-step">3</span>
            <div>
              <h3>{tr("On credit: bills a company pays later")}</h3>
              <p>{tr("Bills given on credit today. No money has come in yet; the company pays later.")}</p>
            </div>
          </div>
          <div className="dr-single reveal" {...dim}>
            <Lines rows={data.debit} title={tr("Bills on credit")} icon="hourglass-split" head="To collect" tone="" empty="No bill left on debit today." footLabel="Total to collect" footAmount={t.debitPaise} bucket="debit" hidden={hidden} />
          </div>

          {data.complimentary.length > 0 ? (
            <>
              <div className="dr-section reveal" {...dim}>
                <span className="dr-step">4</span>
                <div>
                  <h3>{tr("Complimentary")}</h3>
                  <p>{tr("Bills settled free of charge. Shown for the record; no money moved.")}</p>
                </div>
              </div>
              <div className="dr-single reveal" {...dim}>
                <Lines rows={data.complimentary} title={tr("Complimentary")} icon="gift" head="Value" tone="" empty="" footLabel="Total given free" footAmount={t.complimentaryPaise} hidden={hidden} />
              </div>
            </>
          ) : null}

          <div className="dr-section reveal" {...dim}>
            <span className="dr-step">
              <Bi name="list-check" />
            </span>
            <div>
              <h3>{tr("Day summary")}</h3>
              <p>{tr("The three steps above in one place: what the business took in today, and what was paid out.")}</p>
            </div>
          </div>
          <div className="card dr-summary reveal" {...dim}>
            <Table className="dr-glance">
              <thead>
                <tr>
                  <th />
                  <th>{tr("Money in")}</th>
                  <th>{tr("Money out")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="dr-step sm">1</span> {tr("Cash at the desk")}
                  </td>
                  <td className="amount-in">{rs(t.cashInPaise)}</td>
                  <td className="amount-out">{rs(t.cashOutPaise)}</td>
                </tr>
                <tr>
                  <td>
                    <Bi name="egg-fried" className="dr-ico" /> {tr("Food plan")} <small>{tr("paid to")} {user.hotel?.foodName ?? tr("the food business")} {tr("from the drawer")}</small>
                  </td>
                  <td className="dr-dash">–</td>
                  <td className="amount-out">{rs(t.foodPlanPaise)}</td>
                </tr>
                <tr>
                  <td>
                    <span className="dr-step sm">2</span> {tr("Received online")} <small>{tr("Card, UPI, booking sites")}</small>
                  </td>
                  <td className="amount-in">{rs(t.bankedInPaise)}</td>
                  <td className="dr-dash">–</td>
                </tr>
                <tr>
                  <td>
                    <span className="dr-step sm">3</span> {tr("On credit")} <small>{tr("to collect later")}</small>
                  </td>
                  <td>{rs(t.debitPaise)}</td>
                  <td className="dr-dash">–</td>
                </tr>
                <tr className="dr-glance-total">
                  <td>{tr("Total for the day")}</td>
                  <td>{rs(t.revenuePaise)}</td>
                  <td>{rs(t.paidOutPaise)}</td>
                </tr>
              </tbody>
            </Table>
            <div className="dr-net">
              <div>
                <span className="dr-net-label">{tr("Net for the day")}</span>
                <span className="dr-net-hint">
                  {tr("Money in")} {rs(t.revenuePaise)} {tr("− money out")} {rs(t.paidOutPaise)}
                </span>
              </div>
              <b>{rs(t.netPaise)}</b>
            </div>
          </div>
        </>
      ) : null}

      {none ? (
        <div className="rp-nomatch">
          <Bi name="search" /> {tr("Nothing on this report matches your search.")}
        </div>
      ) : null}
    </>
  );
}
