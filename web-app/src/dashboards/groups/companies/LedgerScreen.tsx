'use client';

// hotel.co.ledger - Company ledger: one card per company with what it was billed, paid and still owes, and how old its open bills are; the
// receivables by age for every company are one line above the list that opens their own dialog.
import { useMemo, useState } from 'react';
import { formatDate, formatINR } from '@shared/dashboards/format';
import { companiesCopy, type AgeingRow, type LedgerAgeing, type LedgerOverview, type LedgerSummary } from '@shared/dashboards/companies';
import { Bi, Button, DetailCard, DetailList, DetailNone, FilterBar, Modal, Pager, SearchField, useTableView } from '@/dashboards/pallav/ui';
import { apiMode } from '@/lib/api/mode';
import { PDF_ROUTES } from '@shared/dashboards/common';
import type { ScreenProps } from '../../types';
import { EmptyState, initials } from '../payrollCore/pms';
import { HomeStats } from '../overview/HomeJobs';
import { api, useActor } from './api';
import { Page } from './pageParts';
import { StaleNote, Wait, useLoaded, useMockPdf } from '../payrollCore/load';
import { monthYear } from './screenKit';

import { tr, trf } from '@/lib/i18n/language';
type Tab = 'all' | 'owing' | 'credit' | 'settled';
const TABS: { id: Tab; label: string; dot?: 'paid' | 'due' | 'settled' }[] = [
  { id: 'all', label: 'All' },
  { id: 'owing', label: 'Owing', dot: 'due' },
  { id: 'credit', label: 'In credit', dot: 'settled' },
  { id: 'settled', label: 'Settled', dot: 'paid' },
];
const A = companiesCopy.ledger.ageing;
const dayMonth = (iso: string) => formatDate(iso.slice(0, 10)).slice(0, 6);
const dash = (paise: number) => (paise > 0 ? formatINR(paise) : '-');
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? tr(one) : tr(more)}`;

export function LedgerScreen({ user, navigate }: ScreenProps) {
  useActor(user);
  const [tab, setTab] = useState<Tab>('all');
  const [ageOpen, setAgeOpen] = useState(false);
  const ledger = useLoaded(() => api.ledgerOverview({ tab, page: 1, pageSize: 1000 }), [tab]);
  const data: LedgerOverview | null = ledger.data;
  const onPdf = useMockPdf();
  const ageing = useLoaded(() => api.ledgerAgeing(), []);
  const aged: LedgerAgeing | null = ageing.data;
  const ageOf = useMemo(() => new Map((aged?.rows ?? []).map((r) => [r.companyId, r])), [aged]);

  const rows = useMemo(() => data?.page.items ?? [], [data]);
  const view = useTableView(rows, { perPage: 25, match: (r: LedgerSummary, q) => `${r.companyName} ${r.gstNumber}`.toLowerCase().includes(q) });
  const s = data?.stats;
  const month = monthYear();
  const narrowed = tab !== 'all' || view.search !== '';
  const counts = data?.counts ?? { all: 0, owing: 0, credit: 0, settled: 0 };
  const open = (id: string) => navigate('hotel.co.statement', { id });

  if (!data) return <Wait error={ledger.error} onRetry={ledger.reload} />;

  return (
    <Page
      sub="What each company has been billed, what it has paid, and what it still owes."
      headActions={
        <div className="sh-head-actions">
          <SearchField wrapClass="pay-toolbar" clear value={view.search} onChange={view.setSearch} placeholder={tr("Search company, GST or phone…")} label={tr("Search companies")} />
          <a className="btn btn-outline-p sh-new" href={PDF_ROUTES.ledgerSummary()} target="_blank" rel="noreferrer" onClick={onPdf('Company ledger summary')}>
            <Bi name="file-earmark-pdf" /> {tr("Download PDF")}
          </a>
        </div>
      }
      grid={false}
    >
      {s && (
        <HomeStats
          stats={[
            { id: 'owed', label: 'Owed to us', value: s.owedPaise, format: (n) => formatINR(Math.round(n)), note: s.owing ? trf("{0} owing", [many(s.owing, 'company', 'companies')]) : tr("Nothing outstanding") },
            { id: 'held', label: 'Held in advance', value: s.heldPaise, format: (n) => formatINR(Math.round(n)), note: s.holding ? trf("{0} in credit", [many(s.holding, 'company', 'companies')]) : tr("None in credit") },
            { id: 'billed', label: 'Billed this month', value: s.monthBilledPaise, format: (n) => formatINR(Math.round(n)), note: month },
            { id: 'recv', label: 'Received this month', value: s.monthReceivedPaise, format: (n) => formatINR(Math.round(n)), note: tr("Advances and payments") },
          ]}
        />
      )}
      <StaleNote error={ledger.error} onRetry={ledger.reload} />

      {aged && aged.totals.openBills > 0 ? (
        <div className="hm-q hu-oneline hu-after-stats">
          <i className={`hm-dot ${aged.totals.over90Paise > 0 ? 'tone-warn' : 'tone-info'}`} aria-hidden="true" />
          <div className="hm-q-text">
            <b>{trf("{0} on account in {1}", [formatINR(aged.totals.totalPaise), many(aged.totals.openBills, 'open bill', 'open bills')])}</b>
            <small>{aged.totals.over90Paise > 0 ? trf("{0} of it is over 90 days old", [formatINR(aged.totals.over90Paise)]) : trf("Nothing over 90 days. {0} {1}.", [A.asOf, formatDate(aged.asOf)])}</small>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAgeOpen(true)}>{tr("See by age")}</Button>
        </div>
      ) : null}

      <FilterBar
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, dot: t.dot, count: counts[t.id] }))}
        active={tab}
        onTab={(id) => setTab(id as Tab)}
        tabsLabel="Show which companies"
        summary={
          <>
            {narrowed ? tr("Showing ") : tr("All ")}
            <b>{view.total}</b> {view.total === 1 ? tr("company") : tr("companies")}
          </>
        }
        onReset={narrowed ? () => { setTab('all'); view.setSearch(''); } : undefined}
      />

      {view.total === 0 ? (
        <div className="card reveal">
          <EmptyState icon="journal-text" title={view.search ? 'No company matches that search' : tab !== 'all' ? `No company is ${TABS.find((t) => t.id === tab)?.label.toLowerCase()}` : 'No companies yet'} text={view.search ? 'Try part of the name, the GST number or a phone number.' : tab !== 'all' ? 'Every account is somewhere else right now.' : 'Add a company in Company Profiles. Its bills and advances will build its ledger here.'}>
            {view.search ? (
              <Button variant="outline" className="mt-3" onClick={() => view.setSearch('')}>{tr("Clear search")}</Button>
            ) : tab !== 'all' ? (
              <Button variant="outline" className="mt-3" onClick={() => setTab('all')}>{tr("Show all companies")}</Button>
            ) : (
              <Button icon="building-add" className="mt-3" onClick={() => navigate('hotel.co.profiles')}>{tr("Company Profiles")}</Button>
            )}
          </EmptyState>
        </div>
      ) : (
        <div className="hu-dc-list reveal">
          {view.rows.map((r) => <CompanyCard key={r.companyId} r={r} age={ageOf.get(r.companyId) ?? null} onOpen={() => open(r.companyId)} />)}
        </div>
      )}
      {view.total > 0 ? (
        <div className="card sh-pager-card">
          <Pager view={view} server />
        </div>
      ) : null}

      {ageOpen && aged ? <AgeingDialog data={aged} onClose={() => setAgeOpen(false)} onOpen={(id) => { setAgeOpen(false); open(id); }} /> : null}
    </Page>
  );
}

function CompanyCard({ r, age, onOpen }: { r: LedgerSummary; age: AgeingRow | null; onOpen: () => void }) {
  const state = r.balancePaise > 0 ? 'due' : r.balancePaise < 0 ? 'credit' : 'clear';
  const paid = r.paidPercent ?? 0;
  const old = age ? age.over90Paise > 0 : false;
  return (
    <DetailCard
      className="hu-dc hu-co"
      label={r.companyName}
      warn={old}
      lead={<span className="hu-avatar pf-initials" aria-hidden="true">{initials(r.companyName)}</span>}
      facts={[
        { label: 'Company', value: r.companyName, sub: !r.entries ? tr("No entries yet") : `${r.bills ? many(r.bills, 'bill', 'bills') : tr("No bills yet")}${r.lastDate ? ` · ${trf("last {0}", [dayMonth(r.lastDate)])}` : ''}`, wide: true },
        { label: 'Billed', value: formatINR(r.billedPaise) },
        { label: 'Received', value: formatINR(r.receivedPaise) },
        { label: 'Paid off', value: r.entries ? <span className="hu-meter" title={trf("{0}% of what was billed has been paid", [paid])}><span className="hu-meter-bar"><span style={{ width: `${paid}%` }} /></span>{paid}%</span> : null, empty: tr("No entries") },
      ]}
      amount={{ label: state === 'due' ? 'Owes' : state === 'credit' ? 'In credit' : 'Settled', value: formatINR(Math.abs(r.balancePaise)), tone: state === 'due' ? 'warn' : state === 'credit' ? 'ok' : 'muted', sub: r.openBills ? trf("{0} on account", [r.openBills]) : undefined }}
      sections={[
        { icon: 'journal-text', title: 'Account', content: (
          <DetailList items={[
            { label: 'Billed', value: formatINR(r.billedPaise) },
            { label: 'Received', value: formatINR(r.receivedPaise) },
            r.refundedPaise > 0 && { label: 'Refunded', value: formatINR(r.refundedPaise) },
            { label: state === 'credit' ? 'In credit' : 'Balance', value: <b>{formatINR(Math.abs(r.balancePaise))}</b>, total: true },
            r.gstNumber ? { label: 'GST', value: r.gstNumber } : undefined,
          ]} />
        ) },
        { icon: 'hourglass-split', title: A.title, tone: old ? 'warn' : undefined, content: age ? (
          <DetailList items={[
            { label: A.columns.current, value: dash(age.currentPaise) },
            { label: trf("{0} days", [A.columns.d31]), value: dash(age.days31to60Paise) },
            { label: trf("{0} days", [A.columns.d61]), value: dash(age.days61to90Paise) },
            { label: trf("{0} days", [A.columns.over90]), value: age.over90Paise > 0 ? <span className="hu-late">{formatINR(age.over90Paise)}</span> : '-' },
            { label: A.columns.total, value: <b>{formatINR(age.totalPaise)}</b>, total: true },
          ]} />
        ) : <DetailNone>{A.empty}</DetailNone> },
      ]}
      actions={<Button size="sm" icon="journal-text" onClick={onOpen}>{tr("Open statement")}</Button>}
    />
  );
}

function AgeingDialog({ data, onClose, onOpen }: { data: LedgerAgeing; onClose: () => void; onOpen: (companyId: string) => void }) {
  const t = data.totals;
  return (
    <Modal open size="lg" onClose={onClose} eyebrow={`${A.asOf} ${formatDate(data.asOf)}`} title={A.title}
      footer={
        <>
          {apiMode() === 'real' ? <a className="btn btn-outline-p" href="/api/v1/companies/ledger/ageing/csv" download><Bi name="download" /> {A.csv}</a> : null}
          <Button onClick={onClose}>{tr("Done")}</Button>
        </>
      }>
      <p className="pms-sub mt-0">{A.hint}</p>
      <HomeStats
        stats={[
          { id: 'c', label: A.columns.current, value: t.currentPaise, format: (n) => formatINR(Math.round(n)) },
          { id: 'd31', label: trf("{0} days", [A.columns.d31]), value: t.days31to60Paise, format: (n) => formatINR(Math.round(n)) },
          { id: 'd61', label: trf("{0} days", [A.columns.d61]), value: t.days61to90Paise, format: (n) => formatINR(Math.round(n)) },
          { id: 'o90', label: trf("{0} days", [A.columns.over90]), value: t.over90Paise, format: (n) => formatINR(Math.round(n)), note: many(t.openBills, 'bill on account', 'bills on account') },
        ]}
      />
      <div className="hm-queue mt-3">
        {data.rows.map((r) => (
          <div key={r.companyId} className="hm-q">
            <i className={`hm-dot ${r.over90Paise > 0 ? 'tone-warn' : 'tone-info'}`} aria-hidden="true" />
            <div className="hm-q-text">
              <b>{r.companyName}</b>
              <small>{formatINR(r.totalPaise)} · {many(r.openBills, 'bill', 'bills')}{r.over90Paise > 0 ? ` · ${trf("{0} over 90 days", [formatINR(r.over90Paise)])}` : ''}</small>
            </div>
            <Button variant="outline" size="sm" onClick={() => onOpen(r.companyId)}>{tr("Statement")}</Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
