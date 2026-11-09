'use client';
// Revenue in Hotel Pallav's own markup (resources/views/revenue/index.blade.php + cashbook/_card): search and New Deposit, four tiles,
// the Business filter card, entries grouped by day as expandable cards, and the deposit pop-up.
import { useState } from 'react';

import { formatINR, formatMonthLong, formatTime } from '@shared/dashboards/format';
import {
  canDeleteCashEntry, canEditCashEntry, cashActorOf, cashBooks, cashBusinessName, cashCopy, depositReceipt, entryLabel, istDateOf, istToday,
  type CashBook, type CashBookFilter, type CashDeposit, type CashList, type CashLookups, type DepositInput, type StampInput,
} from '@shared/dashboards/cash';

import { userMayEdit } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { errorText, useAsync, useDebounced, useSubmit, useToast, usePageSize } from '@/components/ui';
import { AmountTile, Button, DetailCard, DetailList, DetailNone, Dialog, EmptyState, Field, FormSection, Modal, Pager, PickGroup, pagerView, PmsSelect, wordsOf, ConflictNote, PageSkeleton, LoadError, Textarea } from '../../pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { useForceMode } from '../../pallav/forceMode';
import { dayLabel, groupByDay, money } from '../billing/listKit';
import { cashApi } from './api';
import { CashActions, CashDay, CashFilterBar, CashSearch, EntryStamp, istStamp } from './cashKit';
import { ReceiptPreview, newStamp, stampFromIso, useLastReady } from './shared';

import { tr, trf } from '@/lib/i18n/language';
const t = cashCopy.revenue;
const c = cashCopy.common;

function DepositCard({ d, canEdit, canDelete, onView, onEdit, onDelete }: { d: CashDeposit; canEdit: boolean; canDelete: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const biz = cashBusinessName[d.book];
  return (
    <DetailCard
      className={`hu-dc hu-cash hu-cash-${d.book}`}
      label={trf("Deposit {0}", [entryLabel(d.entryNo)])}
      lead={{ big: formatTime(d.at), tag: d.book === 'hotel' ? 'Hotel' : 'Food', title: `${biz} · ${istStamp(d.at)}` }}
      facts={[
        { label: 'Reg. no.', value: entryLabel(d.entryNo) },
        { label: 'Depositor', value: d.depositor },
        { label: 'Instruction', value: d.instruction, text: true, wide: true },
      ]}
      amount={{ label: 'Deposited', value: `+${formatINR(d.amountPaise)}`, tone: 'ok' }}
      sections={[
        { icon: 'card-list', title: 'Details', content: (
          <>
            <DetailList items={[
              { label: 'Business', value: biz },
              { label: 'Date and time', value: istStamp(d.at) },
              { label: 'Depositor', value: d.depositor },
              { label: 'Recorded by', value: d.recordedBy.name },
            ]} />
            <div className="cb-words">{wordsOf(d.amountPaise)}</div>
          </>
        ) },
        { icon: 'chat-left-text', title: 'Instruction', content: d.instruction ? <p className="hu-notes mt-0">{d.instruction}</p> : <DetailNone>{tr("Nothing written.")}</DetailNone> },
      ]}
      meta={trf("Recorded {0} by {1}", [istStamp(d.createdAt), d.recordedBy.name])}
      actions={<CashActions what={entryLabel(d.entryNo)} canEdit={canEdit} canDelete={canDelete} onView={onView} onEdit={onEdit} onDelete={onDelete} />}
    />
  );
}
export function RevenueScreen({ user }: ScreenProps) {
  const toast = useToast();
  const actor = cashActorOf(user);
  const [book, setBook] = useState<CashBookFilter>('all');
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed, 250);
  const [page, setPage] = useState(1);
  const pageSize = usePageSize(25);
  const list = useAsync(() => cashApi.listDeposits({ book, search, page, pageSize }), [book, search, page, pageSize]);
  const lookups = useAsync(() => cashApi.getLookups(), []);
  const data = useLastReady<CashList<CashDeposit>>(list.state);

  const [form, setForm] = useState<{ deposit: CashDeposit | null } | null>(null);
  const [receipt, setReceipt] = useState<CashDeposit | null>(null);
  const [del, setDel] = useState<CashDeposit | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  async function remove() {
    if (!del) return;
    setDelBusy(true);
    const res = await cashApi.deleteDeposit(del.id, actor, del.version);
    setDelBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: t.deleted(entryLabel(del.entryNo)) });
      list.reload();
    } else {
      toast.show({ tone: 'error', text: res.error.details?.fields?.date ?? res.error.details?.fields?.form ?? errorText(res.error) });
      if (res.error.code === 'CONFLICT') list.reload();
    }
    setDel(null);
  }

  const narrowed = book !== 'all' || typed !== '';
  const reset = () => { setTyped(''); setBook('all'); setPage(1); };
  const scope = { all: 'Both businesses', ...cashBusinessName }[book];
  const month = formatMonthLong(istToday().slice(0, 7));
  const groups = groupByDay(data?.items ?? [], (d) => istDateOf(d.at));
  const newDeposit = () => setForm({ deposit: null });
  const stats = data?.stats;

  return (
    <>
      <div className="page-head page-tools">
        <div><p className="pms-sub">{tr("Money deposited into the hotel and food books. Open a line to see who deposited it.")}</p></div>
        <div className="cb-head-actions">
          <CashSearch value={typed} onChange={(v) => { setTyped(v); setPage(1); }} onClear={() => { setTyped(''); setPage(1); }} placeholder={tr("Search deposits")} operators />
          {userMayEdit('revenue') && <Button icon="plus-lg" className="cb-new" onClick={newDeposit}>{tr("New deposit")}</Button>}
        </div>
      </div>

      {!data && (list.state.status === 'error' ? <LoadError error={list.state.error} onRetry={list.reload} /> : <PageSkeleton />)}

      {stats && (
        <HomeStats
          stats={[
            { id: 'today', label: 'Deposited today', value: stats.todayPaise, format: (n) => money(Math.round(n)), note: scope },
            { id: 'month', label: 'This month', value: stats.monthPaise, format: (n) => money(Math.round(n)), note: `${month} · ${scope}` },
            { id: 'hotel', label: trf("{0} this month", [cashBusinessName.hotel]), value: stats.hotelMonthPaise, format: (n) => money(Math.round(n)) },
            { id: 'food', label: trf("{0} this month", [cashBusinessName.food]), value: stats.foodMonthPaise, format: (n) => money(Math.round(n)) },
          ]}
        />
      )}
      <CashFilterBar book={book} onBook={(b) => { setBook(b); setPage(1); }} total={data?.total ?? null} noun="deposits" narrowed={narrowed} onReset={reset} />

      {data && data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="cash-coin"
            title={typed !== '' ? `No deposits match "${typed}"` : `No deposits ${book === 'all' ? 'yet' : `in ${scope} yet`}`}
            text="When cash is handed in, record it here with who deposited it and where it came from."
          >
            {userMayEdit('revenue') && <Button icon="plus-lg" className="mt-3" onClick={newDeposit}>{tr("New deposit")}</Button>}
          </EmptyState>
        </div>
      ) : (
        data && (
          <>
            {groups.map((g) => (
              <CashDay key={g.date} label={dayLabel(g.date)} count={g.items.length} noun="deposit" total={money(g.items.reduce((n, d) => n + d.amountPaise, 0))}>
                {g.items.map((d) => (
                  <DepositCard key={d.id} d={d} canEdit={canEditCashEntry(d, actor) && userMayEdit('revenue')} canDelete={canDeleteCashEntry(actor) && userMayEdit('revenue')}
                    onView={() => setReceipt(d)} onEdit={() => setForm({ deposit: d })} onDelete={() => setDel(d)} />
                ))}
              </CashDay>
            ))}
            <div className="card cb-pager-card"><Pager view={pagerView(data, { setPage })} /></div>
          </>
        )
      )}

      {form && (
        <DepositForm
          deposit={form.deposit}
          lookups={lookups.state.status === 'ready' ? lookups.state.data : null}
          lookupsFailed={lookups.state.status === 'error'}
          actor={actor}
          defaultBook={book === 'all' ? 'hotel' : book}
          onClose={() => setForm(null)}
          onReload={() => { setForm(null); list.reload(); }}
          onSaved={(d, isNew) => {
            toast.show({ tone: 'success', text: isNew ? t.saved(entryLabel(d.entryNo)) : t.updated(entryLabel(d.entryNo)) });
            setForm(null);
            list.reload();
          }}
        />
      )}
      <ReceiptPreview open={receipt !== null} receipt={receipt ? depositReceipt(receipt) : null} onClose={() => setReceipt(null)} />
      <Dialog
        open={del !== null}
        title={del ? `Delete ${entryLabel(del.entryNo)}?` : ''}
        message="This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={delBusy}
        onConfirm={() => void remove()}
        onCancel={() => setDel(null)}
      />
    </>
  );
}

function DepositForm({
  deposit, lookups, lookupsFailed, actor, defaultBook, onClose, onReload, onSaved,
}: {
  deposit: CashDeposit | null;
  lookups: CashLookups | null;
  lookupsFailed: boolean;
  actor: ReturnType<typeof cashActorOf>;
  defaultBook: CashBook;
  onClose: () => void;
  /** The row changed under the user: close the form and refresh the list. */
  onReload: () => void;
  onSaved: (d: CashDeposit, isNew: boolean) => void;
}) {
  const isNew = deposit === null;
  const force = useForceMode();
  const [book, setBook] = useState<CashBook>(deposit?.book ?? defaultBook);
  const [depositor, setDepositor] = useState(deposit?.depositor ?? '');
  const [amount, setAmount] = useState<number>(deposit?.amountPaise ?? 0);
  const [instruction, setInstruction] = useState(deposit?.instruction ?? '');
  const [touched, setTouched] = useState(false);
  const [stamp, setStamp] = useState<StampInput>(deposit ? stampFromIso(deposit.at) : newStamp());
  const { busy, errors, conflict, submit } = useSubmit(['depositor', 'amount', 'instruction', 'date', 'time']);
  const names = lookups?.depositors[book] ?? [];
  const options = [...names, ...(deposit && deposit.book === book && !names.includes(deposit.depositor) ? [deposit.depositor] : [])];

  const save = () => {
    const input: DepositInput = { book, depositor, amountPaise: amount || null, instruction, stamp: touched ? stamp : null, version: deposit?.version };
    void submit(
      () => (deposit ? cashApi.updateDeposit(deposit.id, input, actor) : cashApi.createDeposit(input, actor)),
      (d) => onSaved(d, isNew),
    );
  };

  return (
    <Modal
      open
      className="pay-form-modal cb-modal"
      staticBackdrop
      eyebrow={isNew ? 'Revenue · New' : 'Revenue · Edit'}
      title={deposit ? `Edit deposit ${entryLabel(deposit.entryNo)}` : 'New deposit'}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" icon="check2" disabled={busy || !lookups}>{busy ? tr("Saving…") : isNew ? tr("Save deposit") : tr("Save changes")}</Button>
        </>
      }
    >
      {conflict && <ConflictNote onReload={onReload} />}
      {lookupsFailed && <div className="alert alert-danger">{c.lookupsFailed}</div>}
      <div className="form-section">
        <div className="fs-head"><div className="fs-title"><i className="bi bi-buildings" /> {tr("Which business")}<span className="req">*</span></div></div>
        <PickGroup<CashBook> label={tr("Which business")} value={book} onChange={(v) => { if (isNew) { setBook(v); setDepositor(''); } }}
          choices={cashBooks.map((b) => ({ value: b, icon: b === 'hotel' ? 'building' : 'cup-hot', title: cashBusinessName[b], text: 'Its own depositors' }))} />
      </div>

      <div className="form-section">
        <div className="fs-head"><div className="fs-title"><i className="bi bi-person" /> {tr("Who and when")}</div></div>
        {force.on && (
          <div className="alert alert-warning d-flex align-items-start gap-2"><i className="bi bi-shield-exclamation" /><span>{c.forceMode}</span></div>
        )}
        <div className="row g-3">
          <EntryStamp canSet={actor.canBackdate ?? false} stamp={stamp} onChange={(s) => { setStamp(s); setTouched(true); }} saved={!isNew} error={errors.date ?? errors.time} />
          <Field label={tr("Depositor")} required col="col-md-6" error={errors.depositor}>
            <PmsSelect value={depositor} onChange={(e) => setDepositor(e.target.value)}>
              <option value="">{tr("Choose a depositor…")}</option>
              {options.map((n) => <option key={n} value={n}>{n}</option>)}
            </PmsSelect>
            {lookups && options.length === 0 && (
              <div className="form-text cb-depositor-empty"><i className="bi bi-info-circle" /> <span>{tr("No depositors are set up for")} {cashBusinessName[book]} {tr("yet.")} {actor.isAdmin ? tr("Add them in Lists and rates.") : tr("Ask your Hotel Admin to add them in Lists and rates.")}</span></div>
            )}
          </Field>
        </div>
      </div>

      <FormSection icon="cash-stack" title={tr("Amount")}>
        <AmountTile col="" label={tr("Amount deposited")} paise={amount} onChange={setAmount} error={errors.amount} />
      </FormSection>

      <FormSection icon="chat-left-text" title={tr("Instruction")} hint="Optional. Anything worth knowing about this entry.">
        <label className="form-label visually-hidden" htmlFor="rev-instruction">{tr("Instruction")}</label>
        <Textarea id="rev-instruction" rows={3} maxLength={500} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        {errors.instruction && <div className="field-error">{errors.instruction}</div>}
      </FormSection>
    </Modal>
  );
}
