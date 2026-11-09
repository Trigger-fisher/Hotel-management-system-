'use client';
// Bill Master > Bills in Hotel Pallav's own markup (resources/views/bill_master/bills.blade.php): intro row, four tiles, one filter card,
// bills grouped by day, each a shared DetailCard that opens for the charges. Data, filters and paging come from the billing mock API.
import { useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import {
  billBalance, billModes, billSac, billStatus, billTotal, billingCopy, billingHotel, isPartPaid, settlementReceived,
  type Bill, type BillList, type BillStatus, type BillTab,
} from '@shared/dashboards/billing';

import { PDF_ROUTES } from '@shared/dashboards/common';
import { userMayEdit } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { errorText, useAsync, useToast } from '@/components/ui';
import { Button, DetailCard, DetailList, DetailNone, Dialog, PdfButton, EmptyState, SearchField, PageHead, Pager, pagerView, type DetailSection, PageSkeleton } from '../../pallav/ui';
import { billingApi } from './api';
import { Kind, dayLabel, groupByDay, kpiStats, ListFilterBar, money, plural } from './listKit';
import { HomeStats } from '../overview/HomeJobs';
import { BillFormModal } from './BillFormModal';
import { SettleModal } from './SettleModal';
import { QuickPay } from './QuickPay';
import { EmailInvoiceModal } from './EmailInvoiceModal';
import { useLast, useListFilters } from './shared';
import { RecordHistory } from '../admin/RecordHistory';

import { tr, trf } from '@/lib/i18n/language';
const t = billingCopy.bills;
/** "GST 12%" with the rate stored on the bill (the invoice prints the same rate); "GST" on an older bill without one. */
const gstLabel = (rate: number | null | undefined): string => (rate === null || rate === undefined ? tr("GST") : trf("GST {0}%", [Number(rate.toFixed(2))]));
const tabDefs: { id: BillTab; label: string; dot?: BillStatus }[] = [
  { id: 'all', label: 'All bills' },
  { id: 'paid', label: 'Paid', dot: 'paid' },
  { id: 'due', label: 'Debit waiting', dot: 'due' },
  { id: 'settled', label: 'Debit settled', dot: 'settled' },
];

function BillCard({ b, user, navigate, onPaid, onSettle, onReverse, onEdit, onDelete }: {
  b: Bill; user: ScreenProps['user']; navigate: ScreenProps['navigate']; onPaid: () => void; onSettle: () => void; onReverse: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [mailing, setMailing] = useState(false);
  const state = billStatus(b);
  const total = billTotal(b);
  const balance = billBalance(b);
  const modes = billModes(b);
  const paid = b.settlement?.installments ?? [];
  // H6: a settlement that left money owing is "part paid": the row keeps its balance and its pay buttons until the bill is cleared
  const partPaid = isPartPaid(b);
  const owes = state === 'due' || partPaid;
  const sc = billingCopy.bills.settle;
  const quickPay = (layout: 'row' | 'compact') => <QuickPay target={{ kind: 'bill', bill: b }} user={user} navigate={navigate} onPaid={onPaid} onMore={layout === 'row' ? onSettle : undefined} layout={layout} />;
  const f = b.food;
  const h = b.hotel;
  const sac = billSac(b);

  // Where the bill stands, as one chip (was under the Payment column; a paid bill now says so too)
  const standing = partPaid ? (
    <span className="bm-state warn"><i className="bi bi-hourglass-split" /> {sc.partPaid}</span>
  ) : state === 'due' ? (
    <span className="bm-state warn"><i className="bi bi-hourglass-split" /> {tr("Debit waiting")}</span>
  ) : state === 'settled' ? (
    <span className="bm-state good"><i className="bi bi-check2" /> {tr("Debit settled")}</span>
  ) : (
    <span className="bm-state good"><i className="bi bi-check2" /> {tr("Paid")}</span>
  );

  const sections: DetailSection[] = [
    {
      icon: 'building', title: tr("Hotel"),
      content: (
        <DetailList items={[
          !!h.plan && { label: tr("Plan"), value: h.plan },
          { label: tr("Room amount"), value: money(h.roomPaise) },
          h.planPaise > 0 && { label: tr("Plan amount"), value: money(h.planPaise) },
          h.extraBedPaise > 0 && { label: tr("Extra bed"), value: money(h.extraBedPaise) },
          { label: tr("Laundry"), value: money(h.laundryPaise) },
          h.vpoPaise > 0 && { label: 'V.P.O.', value: money(h.vpoPaise) },
          { label: 'HSN/SAC', value: sac.hotel },
          { label: gstLabel(b.hotelGstPercent), value: money(h.gstPaise) },
          { label: tr("Paid by"), value: h.mode || '-' },
          { label: tr("Total"), value: money(b.hotelTotalPaise), total: true },
        ]} />
      ),
    },
    {
      icon: 'cup-hot', title: tr("Food"),
      content: (
        <DetailList items={[
          { label: tr("Food amount"), value: money(f.foodPaise) },
          { label: tr("Plan amount"), value: money(f.planPaise) },
          { label: tr("Laundry"), value: money(f.laundryPaise) },
          { label: 'HSN/SAC', value: sac.food },
          { label: gstLabel(b.foodGstPercent), value: money(f.gstPaise) },
          { label: tr("Paid by"), value: f.mode || '-' },
          { label: tr("Total"), value: money(b.foodTotalPaise), total: true },
        ]} />
      ),
    },
    {
      icon: 'info-circle', title: tr("Details"),
      content: (
        <DetailList items={[
          { label: tr("Bill date"), value: b.billDate ? formatDate(b.billDate) : '-' },
          !!b.grNo && { label: tr("G.R. No."), value: b.grNo },
          (b.arrivalAt || b.departureAt)
            ? {
              label: tr("Stayed"),
              value: <>{b.arrivalAt ? formatDateTime(b.arrivalAt) : '?'} {tr("to")} {b.departureAt ? formatDateTime(b.departureAt) : '?'}{b.persons ? ` · ${plural(b.persons, 'person')}` : ''}</>,
            }
            : !!b.persons && { label: tr("Persons"), value: b.persons },
          !!b.address && { label: tr("Address"), value: b.address },
          !!b.gstin && { label: tr("Guest GSTIN"), value: b.gstin },
          !!b.advance && { label: tr("Advance used"), value: b.advance.receiptNo },
          !!b.advance && { label: tr("Advance taken"), value: <>{tr("Hotel")} {money(b.advance.hotelPaise)} {tr("· Food")} {money(b.advance.foodPaise)}</> },
          !!(b.referenceName || b.referenceMobile) && { label: tr("Reference"), value: [b.referenceName, b.referenceMobile].filter(Boolean).join(' · ') },
          !!b.instruction && { label: tr("Instruction"), value: b.instruction },
        ]} />
      ),
    },
  ];
  if (b.stay.length > 0) {
    sections.push({
      icon: 'moon-stars', title: <>{tr("Plan meals owed to")} {billingHotel.foodName}</>, wide: true,
      content: (
        <DetailList items={[
          ...b.stay.map((part, i) => ({
            key: `part-${i}`,
            label: <>{formatDate(part.from).slice(0, 6)} {tr("to")} {formatDate(part.to).slice(0, 6)}</>,
            value: <>{part.plan || tr("No plan")} · {plural(part.nights, 'night')} × {plural(part.persons, 'person')} × {part.ratePaise !== null ? money(part.ratePaise) : tr("changing rate")} = <b>{money(part.amountPaise)}</b></>,
          })),
          { label: tr("Owed"), value: money(b.planFoodOwedPaise), total: true },
        ]} />
      ),
    });
  }
  if (state !== 'paid') {
    sections.push(
      {
        icon: 'hourglass-split', title: tr("On debit"), tone: owes ? 'warn' : undefined,
        content: (
          <DetailList items={[
            { label: tr("Hotel balance"), value: money(b.balanceHotelPaise) },
            { label: tr("Food balance"), value: money(b.balanceFoodPaise) },
            { label: tr("Still owed"), value: money(balance), total: true },
          ]} />
        ),
      },
      {
        icon: 'cash-coin', title: tr("Money received"), count: paid.length > 0 ? paid.length : undefined,
        content: paid.length === 0 ? (
          <DetailNone>{tr("Nothing received yet.")}</DetailNone>
        ) : (
          <DetailList items={[
            ...paid.map((i, n) => ({
              key: `paid-${n}`,
              label: i.date ? formatDate(i.date) : `Installment ${n + 1}`,
              value: (
                <>
                  {i.hotelPaise > 0 && <>{tr("Hotel")} {money(i.hotelPaise)}{i.hotelMode ? ` (${i.hotelMode})` : ''}</>}
                  {i.hotelPaise > 0 && i.foodPaise > 0 && ' · '}
                  {i.foodPaise > 0 && <>{tr("Food")} {money(i.foodPaise)}{i.foodMode ? ` (${i.foodMode})` : ''}</>}
                </>
              ),
            })),
            !!(b.settlement?.referenceName || b.settlement?.referenceMobile) && { label: tr("Reference"), value: [b.settlement?.referenceName, b.settlement?.referenceMobile].filter(Boolean).join(' · ') },
            !!b.settlement?.instruction && { label: tr("Instruction"), value: b.settlement.instruction },
            !!b.settlement?.excessReceiptNo && { label: tr("Overpaid"), value: <>{tr("Kept as advance")} {b.settlement.excessReceiptNo}</> },
          ]} />
        ),
      },
    );
  }

  return (
    <DetailCard className="hu-dc"
      label={`${tr("Bill")} ${b.billNo}`}
      leadWidth="lg"
      warn={owes}
      lead={
        <>
          <span className={`dc-lead-big${b.roomNo ? '' : ' muted'}`}>{b.roomNo || '-'}</span>
          <Kind hotel={b.hotelTotalPaise} food={b.foodTotalPaise} />
        </>
      }
      facts={[
        { label: tr("Bill No."), value: b.billNo },
        { label: tr("Guest"), value: b.guestName, sub: b.mobile || undefined },
        { label: tr("Company"), value: b.companyName || null, text: true, empty: tr("Walk-in") },
        { label: tr("Payment"), value: modes.join(' · ') || tr("Not set"), text: true },
        { label: tr("Status"), value: standing },
      ]}
      amount={owes ? {
        label: tr("Balance due"), value: money(balance), tone: 'warn',
        sub: <><span>{tr("Bill")} <b>{money(total)}</b></span>{partPaid ? <span>{tr("Received")} <b>{money(settlementReceived(b.settlement))}</b></span> : null}</>,
        extra: userMayEdit('bills') ? <span className="bm-pay">{quickPay('compact')}</span> : undefined,
      } : {
        label: tr("Bill total"), value: money(total),
        sub: <><span>{tr("Hotel")} <b>{money(b.hotelTotalPaise)}</b></span><span>{tr("Food")} <b>{money(b.foodTotalPaise)}</b></span></>,
      }}
      sections={sections}
      meta={<>{tr("Recorded")} {formatDateTime(b.createdAt)}</>}
      actions={
        <>
          <PdfButton url={PDF_ROUTES.bill(b.id)} title={tr("View the bill as a PDF")} />
          <Button variant="outline" size="sm" icon="envelope" title={tr("Email this bill as a PDF")} onClick={() => setMailing(true)}>{tr("Email bill")}</Button>
          {mailing && <EmailInvoiceModal kind="bill" id={b.id} number={b.billNo} guestName={b.guestName} onClose={() => setMailing(false)} />}
          {owes && quickPay('row')}
          {b.settlement && userMayEdit('bills') && (
            <Button variant="secondary" size="sm" icon="arrow-counterclockwise" onClick={onReverse}>{tr("Reverse settlement")}</Button>
          )}
          {!b.settlement ? (
            userMayEdit('bills') && <>
              <Button variant="outline" size="sm" onClick={onEdit}><i className="bi bi-pencil-square" /> {tr("Edit")}</Button>
              <Button variant="danger" size="sm" onClick={onDelete}><i className="bi bi-trash" /> {tr("Delete")}</Button>
            </>
          ) : (
            <span className="bm-state muted"><i className="bi bi-lock" /> {tr("Locked while settled")}</span>
          )}
        </>
      }
    >
      <RecordHistory id={b.id} />
    </DetailCard>
  );
}

type Ask = { kind: 'delete' | 'reverse'; bill: Bill } | null;

export function BillsScreen({ params, user, navigate }: ScreenProps) {
  const f = useListFilters(params.search ?? '');
  const { state, reload } = useAsync(() => billingApi.listBills({ ...f.query, tab: f.tab as BillTab }), [JSON.stringify(f.query)]);
  const data = useLast<BillList>(state.status === 'ready' ? state.data : null);
  const [settling, setSettling] = useState<Bill | null>(null);
  /** undefined = closed, null = a new bill, a bill = editing it. */
  const [editing, setEditing] = useState<Bill | null | undefined>(undefined);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const newBill = () => setEditing(null);
  const confirm = async () => {
    if (!ask) return;
    setBusy(true);
    const { kind, bill } = ask;
    const res = kind === 'reverse' ? await billingApi.reverseSettlement(bill.id, bill.version) : await billingApi.deleteBill(bill.id, bill.version);
    setBusy(false);
    setAsk(null);
    if (!res.ok) {
      toast.show({ tone: 'error', text: res.error.details?.fields?.form ?? errorText(res.error) });
      if (res.error.code === 'CONFLICT') reload();
      return;
    }
    toast.show({ tone: 'success', text: kind === 'reverse' ? t.toast.reversed : t.toast.deleted });
    reload();
  };

  const groups = groupByDay(data?.page.items ?? [], (b) => b.billDate);

  return (
    <>
      <PageHead className="reveal" sub="Every guest bill, newest first, including those on debit. Open one for the charges, and to settle a debit.">
        <SearchField wrapClass="pay-toolbar" value={f.searchText} onChange={f.setSearch} placeholder={tr("Search bill, guest, room, company…")} label={tr("Search bills")} />
        {userMayEdit('bills') && <Button icon="plus-lg" className="sh-new" onClick={newBill}>{tr("New bill")}</Button>}
      </PageHead>

      {data && (
        <HomeStats stats={kpiStats(data.kpis)} />
      )}

      {data === null ? (
        state.status === 'error' ? (
          <div className="card reveal"><EmptyState icon="exclamation-triangle" title={tr("Could not load the bills")} text={errorText(state.error)}>
            <Button variant="outline" className="mt-3" onClick={reload}>{tr("Try again")}</Button>
          </EmptyState></div>
        ) : (
          <PageSkeleton />
        )
      ) : data.all === 0 ? (
        <div className="card reveal">
          <EmptyState icon="receipt" title={tr("No bills yet")} text="When a guest checks out, create their bill here. Each one is listed under the day it was billed.">
            {userMayEdit('bills') && <Button icon="plus-lg" className="mt-3" onClick={newBill}>{tr("New bill")}</Button>}
          </EmptyState>
        </div>
      ) : (
        <>
          <ListFilterBar f={f} options={data.options} total={data.page.total} all={data.all} noun="bill" ariaLabel="Filter bills"
            tabs={tabDefs.map((x) => ({ ...x, count: data.counts[x.id] }))} paymentAria="How it was paid" companyAria="Billed to" monthAria="Billed in" />
          {data.page.total === 0 ? (
            <div className="card reveal bm-no-match">
              <EmptyState icon="funnel" title={tr("No bill matches")} text="Try another word, or clear the filters. Search looks at the bill number, guest, room, company and amount.">
                <Button variant="outline" className="mt-3" onClick={f.reset}>{tr("Clear filters")}</Button>
              </EmptyState>
            </div>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.date} className="sh-day reveal">
                  <div className="sh-day-head">
                    <span>{dayLabel(g.date)}</span>
                    <span className="sh-day-meta">{plural(g.items.length, 'bill')} · {money(g.items.reduce((n, b) => n + billTotal(b), 0))}</span>
                  </div>
                  {g.items.map((b) => (
                    <BillCard
                      key={b.id}
                      b={b}
                      user={user}
                      navigate={navigate}
                      onPaid={reload}
                      onSettle={() => setSettling(b)}
                      onReverse={() => setAsk({ kind: 'reverse', bill: b })}
                      onEdit={() => setEditing(b)}
                      onDelete={() => setAsk({ kind: 'delete', bill: b })}
                    />
                  ))}
                </div>
              ))}
              <div className="card sh-pager-card"><Pager view={pagerView(data.page, f)} /></div>
            </>
          )}
        </>
      )}

      {editing !== undefined && (
        <BillFormModal
          bill={editing}
          onClose={() => setEditing(undefined)}
          onReload={() => { setEditing(undefined); reload(); }}
          onSaved={() => { setEditing(undefined); reload(); }}
        />
      )}
      {settling && (
        <SettleModal
          bill={settling}
          onClose={() => setSettling(null)}
          onReload={() => { setSettling(null); reload(); }}
          onSaved={() => { setSettling(null); reload(); }}
        />
      )}
      <Dialog
        open={ask !== null}
        title={ask?.kind === 'reverse' ? 'Reverse this settlement?' : `Delete bill ${ask?.bill.billNo ?? ''}?`}
        message={ask?.kind === 'reverse' ? 'The bill goes back to having a balance due.' : 'This cannot be undone.'}
        confirmLabel={ask?.kind === 'reverse' ? 'Reverse' : 'Delete'}
        tone={ask?.kind === 'reverse' ? 'warning' : 'danger'}
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setAsk(null)}
      />
    </>
  );
}
