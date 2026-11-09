'use client';

// hotel.co.statement - one company's ledger (Pallav: company_ledger/show.blade.php): opening balance, every bill and payment, closing balance.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { formatDate, formatINR } from '@shared/dashboards/format';
import { ledgerKinds, ledgerPeriods } from '@shared/dashboards/companies';
import { todayIst } from '@shared/dashboards/frontOffice';
import type { LedgerLine, LedgerPeriod, LedgerStatement } from '@shared/dashboards/companies';
import { Bi, Button, Pager, SearchField, PmsDate, PmsSelect, useTableView, Table } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { EmptyState, initials } from '../payrollCore/pms';
import { HomeStats } from '../overview/HomeJobs';
import { api, useActor } from './api';
import { StaleNote, Wait, useLoaded, useMockPdf } from '../payrollCore/load';
import { apiMode } from '@/lib/api/mode';

import { tr, trf } from '@/lib/i18n/language';
const rupees = (n: number) => formatINR(Math.round(n), { decimals: false });
const KIND_ICON: Record<string, string> = { bill: 'receipt', advance: 'wallet2', checkout: 'credit-card', adjusted: 'arrow-left-right', settlement: 'credit-card', refund: 'arrow-up' };
const owed = (paise: number) => (paise > 0 ? `${formatINR(paise)} due` : paise < 0 ? `${formatINR(Math.abs(paise))} in credit` : formatINR(0));
const side = (paise: number) => (paise > 0 ? 'due' : paise < 0 ? 'credit' : 'clear');
const long = (iso: string) => formatDate(iso.slice(0, 10));
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const weekday = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))).getUTCDay();
/** Carbon `format('F Y')`: "September 2026". */
const monthLong = (iso: string) => `${MONTHS_LONG[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`;

export function StatementScreen({ user, params, navigate }: ScreenProps) {
  useActor(user);
  const id = params.id ?? '';
  const [period, setPeriod] = useState<LedgerPeriod>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const statement = useLoaded(() => api.ledgerStatement(id, { period, from: from || undefined, to: to || undefined, search, page: 1, pageSize: 5000 }), [id, period, from, to, search], id);
  const data: LedgerStatement | null = statement.data;
  const [companies, setCompanies] = useState<{ id: string; label: string }[]>([]);
  const onPdf = useMockPdf();

  useEffect(() => {
    let live = true;
    void api.lookupCompanies({}).then((res) => live && res.ok && setCompanies(res.data.map((c) => ({ id: c.id, label: c.label }))));
    return () => {
      live = false;
    };
  }, []);

  const lines = useMemo(() => data?.page.items ?? [], [data]);
  // company_ledger/show pages its lines with the server pager; the month totals count the whole month, the page shows its share.
  const view = useTableView(lines, { perPage: 25 });
  const totals = useMemo(() => {
    const out = new Map<string, { count: number; debit: number; credit: number }>();
    for (const l of lines) {
      const key = l.date.slice(0, 7);
      const m = out.get(key) ?? { count: 0, debit: 0, credit: 0 };
      m.count += 1;
      m.debit += l.debitPaise;
      m.credit += l.creditPaise;
      out.set(key, m);
    }
    return out;
  }, [lines]);
  const months = useMemo(() => {
    const out: { key: string; label: string; lines: LedgerLine[] }[] = [];
    for (const l of view.rows) {
      const key = l.date.slice(0, 7);
      let m = out.find((x) => x.key === key);
      if (!m) {
        m = { key, label: monthLong(l.date), lines: [] };
        out.push(m);
      }
      m.lines.push(l);
    }
    return out;
  }, [view.rows]);
  const firstPage = view.page === 1;
  const lastPage = view.page === view.pages;

  if (!data) return <Wait error={statement.error} onRetry={statement.reload} />;
  const d = data;
  const co = d.company;
  const closing = d.closingPaise;
  const charged = d.billedPaise + d.refundedPaise;
  const paid = charged > 0 ? Math.min(100, Math.floor((d.receivedPaise / charged) * 100)) : d.receivedPaise > 0 ? 100 : 0;
  const contact = [co.gstNumber ? `GST ${co.gstNumber}` : null, co.mobile, co.email].filter(Boolean);
  const periodLabel = period === 'custom' ? `${from ? long(from) : 'The start'} - ${to ? long(to) : 'today'}` : (ledgerPeriods.find((p) => p.id === period)?.label ?? 'All time');
  const reset = search || period !== 'all';

  return (
    <>
      <div className="page-head cl-head reveal">
        <div className="cl-title">
          <span className="cl-avatar lg" aria-hidden="true">
            {initials(co.name)}
          </span>
          <div className="min-w-0">
            <a className="hu-back" href="#" onClick={(e) => { e.preventDefault(); navigate('hotel.co.ledger'); }}>
              <Bi name="arrow-left" /> {tr("Company ledger")}
            </a>
            <h2 className="pms-title">{co.name}</h2>
            <p className="pms-sub">{contact.join(' · ') || tr("Every bill, advance and payment on this company's account.")}</p>
          </div>
        </div>
        <div className="sh-head-actions cl-tools">
          <SearchField wrapClass="pay-toolbar" clear value={search} onChange={setSearch} placeholder={tr("Search guest, room, bill or amount…")} label={tr("Search this account")} />
          <form className="cl-pick" onSubmit={(e) => e.preventDefault()}>
            {/* Pallav draws this with its own picker (.pms-select); a bare <select> grew to the longest company name and pushed the page sideways. */}
            <PmsSelect aria-label={tr("Show another company")} value={id} onChange={(e) => { if (e.target.value && e.target.value !== id) navigate('hotel.co.statement', { id: e.target.value }); }}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </PmsSelect>
          </form>
        </div>
      </div>

      <StaleNote error={statement.error} onRetry={statement.reload} />
      <HomeStats stats={[
        { id: 'balance', label: closing > 0 ? 'Owes us' : closing < 0 ? 'In credit' : 'Balance', value: Math.abs(closing), format: rupees, note: `${trf("{0}% of charges paid", [paid])} · ${d.openBills === 0 ? tr("All settled") : d.openBills === 1 ? tr("1 unpaid bill") : trf("{0} unpaid bills", [d.openBills])}` },
        { id: 'billed', label: 'Billed', value: d.billedPaise, format: rupees, note: periodLabel },
        { id: 'received', label: 'Received', value: d.receivedPaise, format: rupees, note: d.refundedPaise > 0 ? trf("{0} refunded", [rupees(d.refundedPaise)]) : tr("All payments") },
        period === 'all'
          ? { id: 'last', label: 'Last payment', value: d.lastPaid?.creditPaise ?? 0, format: (n) => (d.lastPaid ? rupees(n) : tr("None yet")), note: d.lastPaid ? long(d.lastPaid.date) : tr("Nothing received") }
          : { id: 'carried', label: 'Brought forward', value: Math.abs(d.openingPaise), format: rupees, note: `${d.openingPaise > 0 ? tr("Due") : d.openingPaise < 0 ? tr("In credit") : tr("Nothing carried")}${d.from ? ` ${tr("on")} ${long(d.from)}` : ''}` },
      ]} />

      <div className="cl-bar reveal">
        <div className="cb-seg hu-period" role="group" aria-label={tr("Show which period")}>
          {ledgerPeriods.map((p) => (
            <a
              key={p.id}
              href="#"
              className={period === p.id ? 'active' : ''}
              aria-current={period === p.id ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault();
                setPeriod(p.id);
              }}
            >
              {p.label}
            </a>
          ))}
        </div>
        <details className="cl-custom" open={period === 'custom'}>
          <summary className={period === 'custom' ? 'active' : ''}>
            <Bi name="calendar-range" /> {period === 'custom' ? periodLabel : tr("Pick dates")}
          </summary>
          <form
            className="cl-dates"
            onSubmit={(e) => {
              e.preventDefault();
              setPeriod('custom');
            }}
          >
            <label>
              <span>{tr("From")}</span>
              <PmsDate type="date" className="form-control" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              <span>{tr("To")}</span>
              <PmsDate type="date" className="form-control" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <Button type="submit">{tr("Show")}</Button>
          </form>
        </details>
        {search ? (
          <span className="sh-found">
            {d.page.total} {d.page.total === 1 ? tr("entry") : tr("entries")} {tr("found")}
          </span>
        ) : null}
        <a className="btn btn-p cl-statement" href={`/api/v1/companies/${id}/statement/pdf?from=${d.from ?? '2000-01-01'}&to=${d.to ?? todayIst()}`} target="_blank" rel="noreferrer" onClick={onPdf(`Statement of ${co.name}, ${periodLabel}`)}>
          <Bi name="file-earmark-pdf" /> {tr("Download statement")}
        </a>
        {apiMode() === 'real' && lines.length > 0 ? (
          <a className="btn btn-outline-p cl-statement" href={`/api/v1/companies/${id}/statement/csv?from=${d.from ?? '2000-01-01'}&to=${d.to ?? todayIst()}`} download>
            <Bi name="download" /> {tr("CSV")}
          </a>
        ) : null}
      </div>

      {lines.length === 0 ? (
        <div className="card reveal">
          <EmptyState icon="journal-text" title={search ? 'No entry matches that search' : period === 'all' ? 'Nothing on this account yet' : 'Nothing in this period'} text={search ? 'Try a guest name, a room, a bill number, a date like 19-09-2026, or an amount.' : period === 'all' ? `Bills and advances raised against ${co.name} in Billing will appear here.` : `Balance carried in: ${owed(d.openingPaise)}. Try another period.`}>
            {reset ? (
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setSearch('');
                  setPeriod('all');
                  setFrom('');
                  setTo('');
                }}
              >
                {search ? tr("Clear search") : tr("Show all time")}
              </Button>
            ) : null}
          </EmptyState>
        </div>
      ) : (
        <>
        <div className="cl-sheet reveal">
          <div className="cl-sheet-head" aria-hidden="true">
            <span>{tr("Date")}</span>
            <span>{tr("What")}</span>
            <span className="num">{tr("Charged")}</span>
            <span className="num">{tr("Paid")}</span>
            <span className="num">{tr("Balance")}</span>
            <span />
          </div>

          {!search && firstPage ? (
            <div className="cl-carry top">
              <span className="cl-carry-label">
                <Bi name="arrow-bar-down" /> {period === 'all' ? tr("Opening balance") : `Brought forward${d.from ? ` on ${long(d.from)}` : ''}`}
              </span>
              <strong className={side(d.openingPaise)}>{owed(d.openingPaise)}</strong>
            </div>
          ) : null}

          {months.map((m) => {
            const sum = totals.get(m.key) ?? { count: 0, debit: 0, credit: 0 };
            return (
            <Fragment key={m.key}>
              <div className="cl-month">
                <span>{m.label}</span>
                <span className="cl-month-meta">
                  {sum.count} {sum.count === 1 ? tr("entry") : tr("entries")}
                  <span className="dr">
                    {tr("Charged")} <b>{formatINR(sum.debit)}</b>
                  </span>
                  <span className="cr">
                    {tr("Paid")} <b>{formatINR(sum.credit)}</b>
                  </span>
                </span>
              </div>
              {m.lines.map((l) => {
                const kind = ledgerKinds[l.kind];
                const isDebit = l.debitPaise > 0;
                const amount = isDebit ? l.debitPaise : l.creditPaise;
                const refText = l.kind === 'bill' || l.kind === 'advance' ? l.ref.split(' ').slice(1).join(' ') || l.ref : l.ref;
                const sub = [l.guest, l.room ? `Room ${l.room}` : null, l.kind === 'bill' && l.mode?.toLowerCase() === 'debit' ? 'On credit' : l.mode].filter(Boolean).join(' · ');
                const bal = l.balancePaise;
                return (
                  <details key={l.id} className="cl-line">
                    <summary>
                      <span className="cl-date">
                        <b>{l.date.slice(8, 10)}</b>
                        <small>{WEEKDAYS_SHORT[weekday(l.date)]}</small>
                      </span>
                      <span className="cl-part">
                        <span className={`cl-ico ${l.kind}`} aria-hidden="true">
                          <Bi name={KIND_ICON[l.kind] ?? 'dot'} />
                        </span>
                        <span className="cl-part-text">
                          <strong>
                            {kind.label} <span className="cl-ref">{refText}</span>
                          </strong>
                          <small>{sub || `Entry #${l.entry}`}</small>
                        </span>
                      </span>
                      <span className="cl-num dr" data-label="Charged">
                        {isDebit ? formatINR(amount) : ''}
                      </span>
                      <span className="cl-num cr" data-label="Paid">
                        {isDebit ? '' : formatINR(amount)}
                      </span>
                      <span className={`cl-num bal ${side(bal)}`} data-label="Balance">
                        {formatINR(Math.abs(bal))}
                        <em>{bal > 0 ? tr("due") : bal < 0 ? tr("credit") : ''}</em>
                      </span>
                      <Bi name="chevron-down" className="cl-caret" />
                    </summary>
                    <div className="cl-detail">
                      <div>
                        <h6 className="sh-h">
                          <Bi name={KIND_ICON[l.kind] ?? 'dot'} /> {l.kind === 'bill' ? tr("What was billed") : tr("This entry")}
                        </h6>
                        <Table className="sh-count-table">
                          <tbody>
                            <tr>
                              <td>{tr("Amount")}</td>
                              <td className="text-end">{formatINR(amount)}</td>
                            </tr>
                            {l.mode ? (
                              <tr>
                                <td>{tr("Paid by")}</td>
                                <td className="text-end">{l.mode}</td>
                              </tr>
                            ) : null}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td>{isDebit ? tr("Added to the account") : tr("Taken off the account")}</td>
                              <td className="text-end">{formatINR(amount)}</td>
                            </tr>
                          </tfoot>
                        </Table>
                      </div>
                      <div>
                        <h6 className="sh-h">
                          <Bi name="info-circle" /> {tr("Details")}
                        </h6>
                        <dl className="cl-facts">
                          <dt>{tr("Entry")}</dt>
                          <dd>
                            #{l.entry} · {l.ref}
                          </dd>
                          <dt>{tr("Date")}</dt>
                          <dd>
                            {WEEKDAYS_LONG[weekday(l.date)]}, {long(l.date)}
                          </dd>
                          {l.guest ? (
                            <>
                              <dt>{tr("Guest")}</dt>
                              <dd>
                                {l.guest}
                                {l.room ? ` · Room ${l.room}` : ''}
                              </dd>
                            </>
                          ) : null}
                          <dt>{tr("Balance after")}</dt>
                          <dd>{owed(bal)}</dd>
                        </dl>
                        {l.note ? (
                          <ul className="sh-points mt-2">
                            <li>{l.note}</li>
                          </ul>
                        ) : null}
                      </div>
                      <div className="cl-detail-actions">
                        {l.kind === 'settlement' ? (
                          <Button variant="outline" size="sm" icon="credit-card-2-front" onClick={() => navigate('hotel.billing.bills')}>
                            {tr("Bills on credit")}
                          </Button>
                        ) : l.kind === 'advance' || l.kind === 'refund' ? (
                          <Button variant="outline" size="sm" icon="wallet2" onClick={() => navigate('hotel.billing.advances')}>
                            {tr("Advances")}
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" icon="receipt" onClick={() => navigate('hotel.billing.bills')}>
                            {tr("Bills")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </details>
                );
              })}
            </Fragment>
            );
          })}

          {!search && lastPage ? (
            <div className="cl-carry">
              <span className="cl-carry-label">
                <Bi name="flag" /> {period === 'all' ? tr("Balance today") : `Closing balance${d.to ? ` on ${long(d.to)}` : ''}`}
              </span>
              <strong className={side(closing)}>{owed(closing)}</strong>
            </div>
          ) : null}
        </div>

        <div className="card sh-pager-card">
          <Pager view={view} server />
        </div>
        </>
      )}
    </>
  );
}
