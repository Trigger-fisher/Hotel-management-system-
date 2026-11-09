'use client';
// Guest Advances in Hotel Pallav's own markup (resources/views/bill_master/advances.blade.php): intro row, four tiles, one filter card,
// advances grouped by day, each a shared DetailCard that opens for the amounts. Edit, Refund, Undo Refund and Delete are pop-ups and confirmations.
import { useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { advanceLeft, advanceStatus, advanceTaken, billingCopy, type Advance, type AdvanceList, type AdvanceTab } from '@shared/dashboards/billing';

import { PDF_ROUTES } from '@shared/dashboards/common';
import { userMayEdit } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { errorText, useAsync, useToast } from '@/components/ui';
import { Button, DetailCard, DetailList, Dialog, PdfButton, EmptyState, SearchField, PageHead, Pager, pagerView, PageSkeleton } from '../../pallav/ui';
import { billingApi } from './api';
import { EmailInvoiceModal } from './EmailInvoiceModal';
import { AdvanceFormModal } from './AdvanceFormModal';
import { Kind, dayLabel, groupByDay, kpiStats, ListFilterBar, money, plural } from './listKit';
import { HomeStats } from '../overview/HomeJobs';
import { RefundModal } from './RefundModal';
import { useLast, useListFilters } from './shared';
import { RecordHistory } from '../admin/RecordHistory';

import { tr } from '@/lib/i18n/language';
const t = billingCopy.advances;

const tabDefs: { id: AdvanceTab; label: string; dot?: string }[] = [
  { id: 'all', label: 'All advances' },
  { id: 'unused', label: 'Unused', dot: 'due' },
  { id: 'partly', label: 'Partly used', dot: 'settled' },
  { id: 'used', label: 'Used', dot: 'paid' },
  { id: 'refunded', label: 'Refunded', dot: 'muted' },
];

function StatusState({ a }: { a: Advance }) {
  switch (advanceStatus(a)) {
    case 'refunded':
      return <span className="bm-state muted"><i className="bi bi-arrow-return-left" /> {tr("Refunded")}</span>;
    case 'unused':
      return <span className="bm-state"><i className="bi bi-hourglass-split" /> {tr("Unused")}</span>;
    case 'partly':
      return <span className="bm-state warn"><i className="bi bi-pie-chart" /> {tr("Partly used")}</span>;
    default:
      return <span className="bm-state good"><i className="bi bi-check2" /> {tr("Used")}</span>;
  }
}

function AdvanceCard({ a, onEdit, onRefund, onUndo, onDelete }: { a: Advance; onEdit: () => void; onRefund: () => void; onUndo: () => void; onDelete: () => void }) {
  const [mailing, setMailing] = useState(false);
  const status = advanceStatus(a);
  const refunded = status === 'refunded';
  const unused = status === 'unused';
  const r = a.refund;
  return (
    <DetailCard className="hu-dc"
      label={`${tr("Advance")} ${a.receiptNo}`}
      leadWidth="lg"
      lead={
        <>
          <span className={`dc-lead-big${a.roomNo ? '' : ' muted'}`}>{a.roomNo || '-'}</span>
          <Kind hotel={a.hotelPaise} food={a.foodPaise} />
        </>
      }
      facts={[
        { label: tr("Receipt No."), value: a.receiptNo },
        { label: tr("Guest"), value: a.guestName, sub: a.mobile || undefined },
        { label: tr("Company"), value: a.companyName || null, text: true, empty: tr("Walk-in") },
        { label: tr("Status"), value: <StatusState a={a} /> },
      ]}
      amount={{
        label: tr("Balance left"), value: money(advanceLeft(a)), tone: refunded ? 'muted' : undefined,
        sub: <span>{tr("Taken")} <b>{money(advanceTaken(a))}</b></span>,
      }}
      sections={[
        {
          icon: 'building', title: tr("Hotel"),
          content: (
            <DetailList items={[
              { label: tr("Advance"), value: money(a.hotelPaise) },
              { label: tr("Paid by"), value: a.hotelMode || '-' },
              !!r && { label: tr("Refunded"), value: `${money(r.hotelPaise)}${r.hotelMode ? ` · ${r.hotelMode}` : ''}` },
              { label: tr("Balance left"), value: money(a.hotelBalancePaise), total: true },
            ]} />
          ),
        },
        {
          icon: 'cup-hot', title: tr("Food"),
          content: (
            <DetailList items={[
              { label: tr("Advance"), value: money(a.foodPaise) },
              { label: tr("Paid by"), value: a.foodMode || '-' },
              !!r && { label: tr("Refunded"), value: `${money(r.foodPaise)}${r.foodMode ? ` · ${r.foodMode}` : ''}` },
              { label: tr("Balance left"), value: money(a.foodBalancePaise), total: true },
            ]} />
          ),
        },
        {
          icon: 'info-circle', title: tr("Details"),
          content: (
            <DetailList items={[
              { label: tr("Paid on"), value: a.paymentDate ? formatDate(a.paymentDate) : '-' },
              !!(a.referenceName || a.referenceMobile) && { label: tr("Reference"), value: [a.referenceName, a.referenceMobile].filter(Boolean).join(' · ') },
              !!a.instruction && { label: tr("Instruction"), value: a.instruction },
              !!r && { label: tr("Refunded on"), value: formatDate(r.date) },
              !!r && !!(r.toName || r.toMobile) && { label: tr("Refunded to"), value: [r.toName, r.toMobile].filter(Boolean).join(' · ') },
              !!r && !!r.note && { label: tr("Refund note"), value: r.note },
            ]} />
          ),
        },
      ]}
      meta={<>{tr("Recorded")} {formatDateTime(a.createdAt)}</>}
      actions={
        <>
          <PdfButton url={PDF_ROUTES.advance(a.id)} title={tr("View the receipt as a PDF")} />
          <Button variant="outline" size="sm" icon="envelope" title={tr("Email this receipt as a PDF")} onClick={() => setMailing(true)}>{tr("Email receipt")}</Button>
          {mailing && <EmailInvoiceModal kind="advance" id={a.id} number={a.receiptNo} guestName={a.guestName} onClose={() => setMailing(false)} />}
          {unused && !refunded && userMayEdit('bills') && (
            <Button variant="outline" size="sm" onClick={onEdit}><i className="bi bi-pencil-square" /> {tr("Edit")}</Button>
          )}
          {!userMayEdit('bills') ? null : !refunded ? (
            <Button variant="outline" size="sm" onClick={onRefund}><i className="bi bi-arrow-return-left" /> {tr("Refund")}</Button>
          ) : (
            <Button variant="secondary" size="sm" icon="arrow-counterclockwise" onClick={onUndo}>{tr("Undo refund")}</Button>
          )}
          {unused && !refunded && userMayEdit('bills') && (
            <Button variant="danger" size="sm" onClick={onDelete}><i className="bi bi-trash" /> {tr("Delete")}</Button>
          )}
        </>
      }
    >
      <RecordHistory id={a.id} />
    </DetailCard>
  );
}

type Ask = { kind: 'delete' | 'undo'; adv: Advance } | null;

export function AdvancesScreen({ params }: ScreenProps) {
  const f = useListFilters(params.search ?? '');
  const { state, reload } = useAsync(() => billingApi.listAdvances({ ...f.query, tab: f.tab as AdvanceTab }), [JSON.stringify(f.query)]);
  const data = useLast<AdvanceList>(state.status === 'ready' ? state.data : null);
  /** undefined = closed, null = a new advance, an advance = editing it. */
  const [editing, setEditing] = useState<Advance | null | undefined>(undefined);
  const [refunding, setRefunding] = useState<Advance | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = async () => {
    if (!ask) return;
    setBusy(true);
    const { kind, adv } = ask;
    const res = kind === 'undo' ? await billingApi.undoRefund(adv.id, adv.version) : await billingApi.deleteAdvance(adv.id, adv.version);
    setBusy(false);
    setAsk(null);
    if (!res.ok) {
      toast.show({ tone: 'error', text: res.error.details?.fields?.form ?? errorText(res.error) });
      if (res.error.code === 'CONFLICT') reload();
      return;
    }
    toast.show({ tone: 'success', text: kind === 'undo' ? t.toast.undone : t.toast.deleted });
    reload();
  };

  const groups = groupByDay(data?.page.items ?? [], (a) => a.paymentDate);
  const newAdvance = () => setEditing(null);

  return (
    <>
      <PageHead className="reveal" sub="Money guests paid ahead of their bill. Open one to see what is left, or to refund it.">
        <SearchField wrapClass="pay-toolbar" value={f.searchText} onChange={f.setSearch} placeholder={tr("Search receipt, guest, room, company…")} label={tr("Search advances")} />
        {userMayEdit('bills') && <Button icon="plus-lg" className="sh-new" onClick={newAdvance}>{tr("New advance")}</Button>}
      </PageHead>

      {data && (
        <HomeStats stats={kpiStats(data.kpis)} />
      )}

      {data === null ? (
        state.status === 'error' ? (
          <div className="card reveal"><EmptyState icon="exclamation-triangle" title={tr("Could not load the advances")} text={errorText(state.error)}>
            <Button variant="outline" className="mt-3" onClick={reload}>{tr("Try again")}</Button>
          </EmptyState></div>
        ) : (
          <PageSkeleton />
        )
      ) : data.all === 0 ? (
        <div className="card reveal">
          <EmptyState icon="wallet2" title={tr("No advances yet")} text="When a guest pays before checking out, record it here so it can be taken off their bill.">
            {userMayEdit('bills') && <Button icon="plus-lg" className="mt-3" onClick={newAdvance}>{tr("New advance")}</Button>}
          </EmptyState>
        </div>
      ) : (
        <>
          <ListFilterBar f={f} options={data.options} total={data.page.total} all={data.all} noun="advance" ariaLabel="Filter advances"
            tabs={tabDefs.map((x) => ({ ...x, count: data.counts[x.id] }))} paymentAria="How it was paid" companyAria="Paid for" monthAria="Paid in" />
          {data.page.total === 0 ? (
            <div className="card reveal bm-no-match">
              <EmptyState icon="search" title={tr("No advance matches that search")} text="Try a receipt number, a guest's name, a room, a company or an amount." />
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.date} className="sh-day reveal">
                  <div className="sh-day-head">
                    <span>{dayLabel(g.date)}</span>
                    <span className="sh-day-meta">{plural(g.items.length, 'advance')} · {money(g.items.reduce((n, a) => n + advanceTaken(a), 0))}</span>
                  </div>
                  {g.items.map((a) => (
                    <AdvanceCard key={a.id} a={a} onEdit={() => setEditing(a)} onRefund={() => setRefunding(a)}
                      onUndo={() => setAsk({ kind: 'undo', adv: a })} onDelete={() => setAsk({ kind: 'delete', adv: a })} />
                  ))}
                </div>
              ))}
              <div className="card sh-pager-card"><Pager view={pagerView(data.page, f)} /></div>
            </>
          )}
        </>
      )}

      {editing !== undefined && (
        <AdvanceFormModal advance={editing} onClose={() => setEditing(undefined)}
          onReload={() => { setEditing(undefined); reload(); }} onSaved={() => { setEditing(undefined); reload(); }} />
      )}
      {refunding && (
        <RefundModal advance={refunding} onClose={() => setRefunding(null)}
          onReload={() => { setRefunding(null); reload(); }} onSaved={() => { setRefunding(null); reload(); }} />
      )}
      <Dialog
        open={ask !== null}
        title={ask?.kind === 'undo' ? 'Reverse this refund?' : `Delete advance ${ask?.adv.receiptNo ?? ''}?`}
        message={ask?.kind === 'undo' ? 'The advance goes back to unrefunded.' : 'This cannot be undone.'}
        confirmLabel={ask?.kind === 'undo' ? 'Reverse' : 'Delete'}
        tone={ask?.kind === 'undo' ? 'warning' : 'danger'}
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setAsk(null)}
      />
    </>
  );
}
