'use client';
// Accounting years (hotel.books): the open year with Start next year, what was carried forward, every year as a card.
// Removing the newest year is the Super Admin's alone (in More); a Hotel Admin never sees it.
import { useState } from 'react';

import { formatDate, formatINR } from '@shared/dashboards/format';
import { currentYear, overviewCopy as c, removeConfirmText, yearSpan, yearTotal, type BooksOverview } from '@shared/dashboards/overview';

import type { ScreenProps } from '../../types';
import { errorText, fieldErrors, useAsync, useToast } from '@/components/ui';
import { Button, DetailCard, DetailList, DetailNone, Dialog, Dropdown, EmptyState, ListSearch, Loaded, Modal, PageHead, FieldError, RequiredMark } from '../../pallav/ui';
import { HomeStats } from './HomeJobs';
import { overviewApi } from './api';

import { tr, trf } from '@/lib/i18n/language';
const b = c.books;

export function BooksScreen({ user, navigate }: ScreenProps) {
  const { state, reload } = useAsync(() => overviewApi.getBooks(), [user.role]);
  const [search, setSearch] = useState('');
  return (
    <>
      <PageHead sub={tr('A year runs from 1 April to 31 March. Only the open year takes new entries; earlier years stay, read-only, and what they left open carries forward.')}>
        <ListSearch value={search} onChange={setSearch} onClear={() => setSearch('')} placeholder={tr("Search years")} />
      </PageHead>
      <Loaded state={state} onRetry={reload}>
        {(data: BooksOverview) => <Body key={data.years.map((y) => `${y.id}:${y.current}`).join('|')} data={data} search={search} role={user.role} reload={reload} navigate={navigate} />}
      </Loaded>
    </>
  );
}

const yy = (iso: string) => iso.slice(2, 4);
/** PHP number_format($n): 1234 -> "1,234". */
const num = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function Body({ data, search, role, reload, navigate }: { data: BooksOverview; search: string; role: string; reload: () => void; navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const [confirmStart, setConfirmStart] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');
  // Page search: every word must be in the year's label ("2026-27"), its dates or its short form ("26/27"), case-insensitive.
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const years = words.length === 0 ? data.years : data.years.filter((y) => {
    const hay = `${y.label} ${formatDate(y.startsOn)} ${formatDate(y.endsOn)} ${yy(y.startsOn)}/${yy(y.endsOn)} ${y.startsOn} ${y.endsOn}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const latest = data.years[0];
  const prev = data.years[1];
  const cf = data.carried;
  const cur = currentYear(data);
  const isSuper = role === 'super_admin';
  const openCount = cf ? cf.bills.count + cf.advances.count + cf.payroll.count + cf.salaries.count : null;

  async function start() {
    setBusy(true);
    const res = await overviewApi.startNextYear();
    setBusy(false);
    setConfirmStart(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: res.data.message });
      reload();
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  async function remove() {
    setBusy(true);
    const res = await overviewApi.removeLatestYear(typed);
    setBusy(false);
    if (res.ok) {
      setRemoving(false);
      setTyped('');
      toast.show({ tone: 'success', text: res.data.message });
      reload();
    } else setFieldError(fieldErrors(res.error).confirm ?? errorText(res.error));
  }

  /** Closing the Remove pop-up (Cancel, X, Escape) forgets what was typed, so it reopens empty. */
  function closeRemove() {
    if (busy) return;
    setRemoving(false);
    setTyped('');
    setFieldError('');
  }

  const counts = (y: { counts: { key: string; name: string; count: number }[] }) => y.counts.filter((x) => x.count > 0);

  const carried: { icon: string; label: string; item: { count: number; amountPaise: number }; to?: [string, Record<string, string>] }[] = cf ? [
    { icon: 'credit-card-2-front', label: b.carried.bills, item: cf.bills, to: ['hotel.billing.bills', {}] },
    { icon: 'wallet2', label: b.carried.advances, item: cf.advances, to: ['hotel.billing.advances', {}] },
    { icon: 'cash-coin', label: b.carried.payroll, item: cf.payroll },
    { icon: 'people', label: b.carried.salaries, item: cf.salaries },
  ] : [];
  if (!cur) return <div className="bm-note">{tr("No accounting year has been started yet.")}</div>;

  return (
    <div className="ha-stack">
      <HomeStats
        stats={[
          { id: 'cash', label: tr('Cash brought forward'), value: cf && cf.cashPaise !== null ? cf.cashPaise : 0, format: (n) => (cf && cf.cashPaise !== null ? formatINR(Math.round(n)) : '-'), note: trf('Opening cash on {0}', [formatDate(cur.startsOn)]) },
          { id: 'open', label: tr('Still open from before'), value: openCount ?? 0, format: (n) => (openCount === null ? '-' : num(n)), note: trf('Carried into FY {0}', [cur.label]) },
          { id: 'entries', label: tr('Entries this year'), value: yearTotal(cur), format: (n) => num(n), note: yearSpan(cur) },
{ id: 'years', label: tr('Years on file'), value: data.years.length, format: (n) => num(n), note: tr('Accounting years') },
        ]}
      />

      <div className={`card by-start ${data.cannotStart ? '' : 'ready'}`}>
        <div className="by-start-body">
          <span className="by-start-icon"><i className={`bi ${data.cannotStart ? 'bi-hourglass' : 'bi-stars'}`} /></span>
          <div>
            <h3>{trf('FY {0} is open', [cur.label])}</h3>
            <p>{data.cannotStart ? trf('Next: FY {0}. {1}', [data.next.label, data.cannotStart]) : b.startReady(cur.label, formatDate(cur.endsOn))}</p>
          </div>
        </div>
        {!data.cannotStart && (
          <Button icon="stars" onClick={() => setConfirmStart(true)}>{trf('Start FY {0}', [data.next.label])}</Button>
        )}
      </div>

      {cf && (
        <section className="card ha-card" aria-label={trf('Carried forward into FY {0}', [cur.label])}>
          <h3 className="ha-card-h">{trf('Carried forward into FY {0}', [cur.label])}<small>{tr('Shown in this year\'s lists until finished')}</small></h3>
          <div className="by-carry">
            {carried.map((x) => (
              <div key={x.label} className={`by-carry-item ${x.item.count ? '' : 'none'}`}>
                <span className="by-carry-icon"><i className={`bi bi-${x.icon}`} /></span>
                <span className="by-carry-text"><b>{x.item.count}</b> {x.label}<small>{formatINR(x.item.amountPaise)}</small></span>
                {x.to && x.item.count > 0 && (
                  <Button size="sm" variant="outline" onClick={() => navigate(x.to![0], x.to![1])}>{tr('Open')}</Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div>
        {years.length === 0 && <div className="card"><EmptyState icon="search" title={tr('No accounting year matches that search')} text={tr('Try a year such as 2026-27.')} /></div>}
        {years.map((y) => {
          const isCurrent = y.current;
          const total = yearTotal(y);
          const removable = y.id === latest.id && isSuper;
          return (
            <DetailCard
              key={y.id}
              label={trf('FY {0}', [y.label])}
              defaultOpen={isCurrent}
              lead={{ big: <>{yy(y.startsOn)}<small>/{yy(y.endsOn)}</small></>, tag: isCurrent ? tr('Open') : tr('Closed'), muted: !isCurrent }}
              facts={[
                { label: tr('Year'), value: trf('FY {0}', [y.label]), sub: yearSpan(y) },
                { label: isCurrent ? tr('Started') : tr('Closed'), value: isCurrent ? formatDate(y.startsOn) : y.closedAt ? formatDate(y.closedAt.slice(0, 10)) : '' },
                { label: tr('Status'), value: isCurrent ? tr('Taking entries') : tr('Read-only'), tone: isCurrent ? 'ok' : 'muted' },
              ]}
              amount={{ label: tr('Entries'), value: num(total) }}
              sections={[
                {
                  icon: 'journal-text',
                  title: tr('What is in this year'),
                  wide: true,
                  content: total === 0 ? <DetailNone>{tr('Nothing dated in this year yet.')}</DetailNone> : <DetailList items={counts(y).map((x) => ({ label: x.name, value: num(x.count) }))} />,
                },
              ]}
              actions={
                removable ? (
                  <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for FY {0}', [y.label])} {...p}>{tr('More')}</Button>}>
                    <a
                      href="#"
                      className={`dropdown-item text-danger${data.cannotRemove ? ' disabled' : ''}`}
                      aria-disabled={data.cannotRemove ? true : undefined}
                      title={data.cannotRemove ?? undefined}
                      onClick={(e) => { e.preventDefault(); if (!data.cannotRemove) setRemoving(true); }}
                    >
                      <i className="bi bi-trash me-2" />{trf('Remove FY {0}', [y.label])}
                    </a>
                  </Dropdown>
                ) : undefined
              }
              meta={removable && data.cannotRemove ? data.cannotRemove : undefined}
            />
          );
        })}
      </div>
      <Dialog
        open={confirmStart}
        title={b.startConfirmTitle(data.next.label)}
        message={b.startConfirmBody(cur.label, formatDate(data.next.startsOn))}
        confirmLabel={b.startConfirm}
        tone="primary"
        busy={busy}
        onConfirm={() => void start()}
        onCancel={() => setConfirmStart(false)}
      />

      {latest && (
        <Modal
          open={removing}
          className="pay-form-modal"
          staticBackdrop
          scrollable={false}
          eyebrow={<span className="by-danger">{tr("Accounting years · Remove")}</span>}
          title={trf("Remove FY {0}?", [latest.label])}
          onClose={closeRemove}
          onSubmit={() => void remove()}
          footer={
            <>
              <Button variant="ghost" onClick={closeRemove} disabled={busy}>{tr("Cancel")}</Button>
              <Button type="submit" variant="dangerSolid" icon="trash" disabled={busy || typed !== removeConfirmText(latest.label)}>{tr("Remove FY")} {latest.label}</Button>
            </>
          }
        >
          <div className="bm-note bad mb-3"><i className="bi bi-exclamation-octagon" /> {b.removeWarn(latest.label, prev?.label ?? '')}</div>
          <div className="by-counts mb-3">
            {counts(latest).map((x) => <span key={x.key}><b>{num(x.count)}</b> {x.name}</span>)}
            {yearTotal(latest) === 0 && <span className="text-muted">{tr("Nothing is dated in this year yet.")}</span>}
          </div>
          <label className="form-label">{tr("Type")} <b>{removeConfirmText(latest.label)}</b> {tr("to confirm")}<RequiredMark /></label>
          <input className="form-control" autoComplete="off" placeholder={removeConfirmText(latest.label)} value={typed} onChange={(e) => { setTyped(e.target.value); setFieldError(''); }} />
          {fieldError && <FieldError>{fieldError}</FieldError>}
        </Modal>
      )}
    </div>
  );
}
