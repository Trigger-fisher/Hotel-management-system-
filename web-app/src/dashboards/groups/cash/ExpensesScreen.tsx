'use client';
// Expenses in Hotel Pallav's own markup (resources/views/expense/index.blade.php + cashbook/_card): search and New Entry, four tiles,
// the Business and Kind filter card, entries grouped by day as expandable cards, and the entry pop-up for the three kinds.
import { useState } from 'react';

import { formatINR, formatMonthLong, formatTime } from '@shared/dashboards/format';
import {
  canDeleteCashEntry, canEditCashEntry, cashActorOf, cashBooks, cashBusinessName, cashCopy, entryLabel, expenseKindNames, expenseReceipt, expenseTypeNames, istDateOf, istToday, lineFigures,
  linesTotalPaise, quantityLabel, type CashBook, type CashBookFilter, type CashExpense, type CashList, type CashLookups, type ExpenseInput, type ExpenseKind, type ExpenseLineInput, type StampInput,
} from '@shared/dashboards/cash';

import { userMayEdit } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { errorText, useAsync, useDebounced, useSubmit, useToast, usePageSize } from '@/components/ui';
import { AmountTile, Button, DetailCard, DetailList, DetailNone, Dialog, EmptyState, Field, FormSection, Modal, Pager, PickGroup, pagerView, PmsSelect, PmsDate, wordsOf, ConflictNote, PageSkeleton, LoadError, Textarea, RemoveButton, TextAction } from '../../pallav/ui';
import { useForceMode } from '../../pallav/forceMode';
import { HomeStats } from '../overview/HomeJobs';
import { dayLabel, groupByDay, money } from '../billing/listKit';
import { cashApi } from './api';
import { CashActions, CashDay, CashFilterBar, CashSearch, EntryStamp, istStamp } from './cashKit';
import { ReceiptPreview, newStamp, stampFromIso, useLastReady } from './shared';

import { tr, trf } from '@/lib/i18n/language';
const t = cashCopy.expenses;
const c = cashCopy.common;

const kindPills = [
  { value: 'withdrawal', label: 'Withdrawals', icon: 'box-arrow-up-right' },
  { value: 'misc', label: 'Miscellaneous expenses', icon: 'basket' },
  { value: 'advance', label: 'Staff advances', icon: 'people' },
];

function monthLabel(ym: string | null): string | null {
  if (!ym) return null;
  const [y, m] = ym.split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Number(m) - 1] ?? ym} ${y}`;
}

function ExpenseCard({ e, canEdit, canDelete, onView, onEdit, onDelete }: { e: CashExpense; canEdit: boolean; canDelete: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const staff = e.kind === 'advance';
  const biz = staff ? 'Staff' : cashBusinessName[e.book];
  const title = e.kind === 'withdrawal' ? (e.withdrawer ?? '') : staff ? (e.employee?.name ?? 'Staff member') : e.lines.length ? e.lines.map((l) => l.itemName).join(', ') : (e.expenseName ?? '');
  const nameLabel = e.kind === 'withdrawal' ? 'Received by' : e.kind === 'misc' ? 'Items' : 'Staff member';
  const kindLabel = expenseKindNames[e.kind];
  const month = monthLabel(e.yearMonth);
  const categories = [...new Set(e.lines.map((l) => l.categoryName))].join(', ');
  return (
    <DetailCard
      className={`hu-dc hu-cash hu-cash-${staff ? 'staff' : e.book}`}
      label={trf("Entry {0}", [entryLabel(e.entryNo)])}
      lead={{ big: formatTime(e.at), tag: kindLabel, title: istStamp(e.at) }}
      facts={[
        { label: 'Reg. no.', value: entryLabel(e.entryNo), sub: biz },
        { label: nameLabel, value: title },
        { label: 'Instruction', value: e.instruction, text: true, wide: true },
      ]}
      amount={{ label: 'Paid out', value: `-${formatINR(e.amountPaise)}`, tone: 'danger' }}
      sections={[
        { icon: 'card-list', title: 'Details', content: (
          <>
            <DetailList items={[
              { label: 'Business', value: biz },
              { label: 'Date and time', value: istStamp(e.at) },
              { label: e.kind === 'misc' ? 'Categories' : nameLabel, value: e.kind === 'misc' ? categories : title },
              { label: 'Kind', value: kindLabel },
              month ? { label: 'For month', value: month } : undefined,
              { label: 'Recorded by', value: e.recordedBy.name },
            ]} />
            <div className="cb-words">{wordsOf(e.amountPaise)}</div>
          </>
        ) },
        { icon: 'chat-left-text', title: 'Instruction', content: e.instruction ? <p className="hu-notes mt-0">{e.instruction}</p> : <DetailNone>{tr("Nothing written.")}</DetailNone> },
        ...(e.lines.length > 0
          ? [{ icon: 'basket', title: 'Items', count: e.lines.length, wide: true, content: (
              <ul className="hu-order-lines hu-exp-lines">
                {e.lines.map((l) => (
                  <li key={l.id}>
                    <span className="hu-qty">{quantityLabel(l.quantity)}×</span>
                    <span className="hu-item"><b>{l.itemName}</b> <small className="text-muted">{l.categoryName} · {formatINR(l.pricePaise)}</small></span>
                    <span className="hu-line-amt">{formatINR(l.totalPaise)}</span>
                  </li>
                ))}
                <li className="hu-order-total">
                  <span className="hu-qty" />
                  <span className="hu-item">{tr("Total")}</span>
                  <span className="hu-line-amt">{formatINR(e.amountPaise)}</span>
                </li>
              </ul>
            ) }]
          : []),
      ]}
      meta={trf("Recorded {0} by {1}", [istStamp(e.createdAt), e.recordedBy.name])}
      actions={<CashActions what={entryLabel(e.entryNo)} canEdit={canEdit} canDelete={canDelete} onView={onView} onEdit={onEdit} onDelete={onDelete} />}
    />
  );
}
export function ExpensesScreen({ user }: ScreenProps) {
  const toast = useToast();
  const actor = cashActorOf(user);
  const [book, setBook] = useState<CashBookFilter>('all');
  const [kind, setKind] = useState<ExpenseKind | 'all'>('all');
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed, 250);
  const [page, setPage] = useState(1);
  const pageSize = usePageSize(25);
  const list = useAsync(() => cashApi.listExpenses({ book, kind, search, page, pageSize }), [book, kind, search, page, pageSize]);
  const lookups = useAsync(() => cashApi.getLookups(), []);
  const data = useLastReady<CashList<CashExpense>>(list.state);

  const [form, setForm] = useState<{ expense: CashExpense | null } | null>(null);
  const [receipt, setReceipt] = useState<CashExpense | null>(null);
  const [del, setDel] = useState<CashExpense | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  async function remove() {
    if (!del) return;
    setDelBusy(true);
    const res = await cashApi.deleteExpense(del.id, actor, del.version);
    setDelBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: t.deleted(expenseTypeNames[del.type], entryLabel(del.entryNo)) });
      list.reload();
    } else toast.show({ tone: 'error', text: errorText(res.error) });
    setDel(null);
  }

  const narrowed = book !== 'all' || kind !== 'all' || typed !== '';
  const reset = () => { setTyped(''); setBook('all'); setKind('all'); setPage(1); };
  const scope = { all: 'All businesses', ...cashBusinessName }[book];
  const month = formatMonthLong(istToday().slice(0, 7));
  const groups = groupByDay(data?.items ?? [], (e) => istDateOf(e.at));
  const stats = data?.stats;
  const newEntry = () => setForm({ expense: null });

  return (
    <>
      <div className="page-head page-tools">
        <div><p className="pms-sub">{tr("Money paid out of the hotel and food books. Open a line to see what it was for.")}</p></div>
        <div className="cb-head-actions">
          <CashSearch value={typed} onChange={(v) => { setTyped(v); setPage(1); }} onClear={() => { setTyped(''); setPage(1); }} placeholder={tr("Search expenses")} operators />
          {userMayEdit('expense') && <Button icon="plus-lg" className="cb-new" onClick={newEntry}>{tr("New expense")}</Button>}
        </div>
      </div>

      {!data && (list.state.status === 'error' ? <LoadError error={list.state.error} onRetry={list.reload} /> : <PageSkeleton />)}

      {stats && (
        <HomeStats
          stats={[
            { id: 'today', label: 'Paid out today', value: stats.todayPaise, format: (n) => money(Math.round(n)), note: scope },
            { id: 'month', label: 'This month', value: stats.monthPaise, format: (n) => money(Math.round(n)), note: `${month} · ${scope}` },
            { id: 'hotel', label: trf("{0} this month", [cashBusinessName.hotel]), value: stats.hotelMonthPaise, format: (n) => money(Math.round(n)), note: 'Withdrawals and miscellaneous' },
            { id: 'food', label: trf("{0} this month", [cashBusinessName.food]), value: stats.foodMonthPaise, format: (n) => money(Math.round(n)), note: 'Withdrawals and miscellaneous' },
          ]}
        />
      )}
      <CashFilterBar book={book} onBook={(b) => { setBook(b); setPage(1); }} total={data?.total ?? null} noun="entries" narrowed={narrowed} onReset={reset}
        kinds={kindPills} kind={kind} onKind={(k) => { setKind(k as ExpenseKind | 'all'); setPage(1); }} />

      {data && data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="cash-stack"
            title={typed !== '' ? `No entries match "${typed}"` : `No expenses ${book === 'all' && kind === 'all' ? 'yet' : 'match this view'}`}
            text="Record cash that leaves the till: what was taken out, who took it, and what it was for."
          >
            {userMayEdit('expense') && <Button icon="plus-lg" className="mt-3" onClick={newEntry}>{tr("New expense")}</Button>}
          </EmptyState>
        </div>
      ) : (
        data && (
          <>
            {groups.map((g) => (
              <CashDay key={g.date} label={dayLabel(g.date)} count={g.items.length} noun="entry" total={money(g.items.reduce((n, e) => n + e.amountPaise, 0))}>
                {g.items.map((e) => (
                  <ExpenseCard key={e.id} e={e} canEdit={canEditCashEntry(e, actor) && userMayEdit('expense')} canDelete={canDeleteCashEntry(actor) && userMayEdit('expense')}
                    onView={() => setReceipt(e)} onEdit={() => setForm({ expense: e })} onDelete={() => setDel(e)} />
                ))}
              </CashDay>
            ))}
            <div className="card cb-pager-card"><Pager view={pagerView(data, { setPage })} /></div>
          </>
        )
      )}

      {form && (
        <ExpenseForm
          expense={form.expense}
          lookups={lookups.state.status === 'ready' ? lookups.state.data : null}
          lookupsFailed={lookups.state.status === 'error'}
          actor={actor}
          defaultBook={book === 'all' ? 'hotel' : book}
          onClose={() => setForm(null)}
          onReload={() => { setForm(null); list.reload(); }}
          onSaved={(e, isNew) => {
            const n = expenseTypeNames[e.type];
            toast.show({ tone: 'success', text: isNew ? t.saved(n, entryLabel(e.entryNo)) : t.updated(n, entryLabel(e.entryNo)) });
            setForm(null);
            list.reload();
          }}
        />
      )}
      <ReceiptPreview open={receipt !== null} receipt={receipt ? expenseReceipt(receipt) : null} onClose={() => setReceipt(null)} />
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

let lineSeq = 0;
const newLine = (): ExpenseLineInput => ({ key: `n${++lineSeq}`, lineId: null, categoryId: '', itemId: '', quantity: '1', pricing: 'listed', amountPaise: null });

function ExpenseForm({
  expense, lookups, lookupsFailed, actor, defaultBook, onClose, onReload, onSaved,
}: {
  expense: CashExpense | null;
  lookups: CashLookups | null;
  lookupsFailed: boolean;
  actor: ReturnType<typeof cashActorOf>;
  defaultBook: CashBook;
  onClose: () => void;
  onReload: () => void;
  onSaved: (e: CashExpense, isNew: boolean) => void;
}) {
  const isNew = expense === null;
  const force = useForceMode();
  const [kind, setKind] = useState<ExpenseKind>(expense?.kind ?? 'withdrawal');
  const [book, setBook] = useState<CashBook>(expense?.book ?? defaultBook);
  const [withdrawer, setWithdrawer] = useState(expense?.withdrawer ?? '');
  const [employeeId, setEmployeeId] = useState(expense?.employee?.id ?? '');
  const [yearMonth, setYearMonth] = useState(expense?.yearMonth ?? istToday().slice(0, 7));
  const [amount, setAmount] = useState<number>(expense && expense.kind !== 'misc' ? expense.amountPaise : 0);
  const [lines, setLines] = useState<ExpenseLineInput[]>(() =>
    expense && expense.kind === 'misc'
      ? expense.lines.map((l) => ({ key: l.id, lineId: l.id, categoryId: l.categoryId, itemId: l.itemId, quantity: String(l.quantity), pricing: l.pricing, amountPaise: l.pricing === 'custom' ? l.totalPaise : null }))
      : [newLine()],
  );
  const [instruction, setInstruction] = useState(expense?.instruction ?? '');
  const [touched, setTouched] = useState(false);
  const [stamp, setStamp] = useState<StampInput>(expense ? stampFromIso(expense.at) : newStamp());
  const { busy, errors, conflict, submit } = useSubmit(['withdrawer', 'employeeId', 'yearMonth', 'amount', 'lines', 'instruction', 'date', 'time', ...lines.flatMap((_, i) => [`lines.${i}.category`, `lines.${i}.item`, `lines.${i}.quantity`, `lines.${i}.amount`])]);
  const catalogue = lookups?.catalogue ?? [];
  const saved = expense?.lines ?? [];
  const total = kind === 'misc' ? linesTotalPaise(lines, catalogue, saved) : amount;
  const setLine = (i: number, patch: Partial<ExpenseLineInput>) => setLines((p) => p.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const staff = (lookups?.staff ?? []).filter((s) => s.book === book);
  const receivers = lookups?.receivers[book] ?? [];
  const receiverOptions = [...receivers, ...(expense?.withdrawer && !receivers.includes(expense.withdrawer) ? [expense.withdrawer] : [])];
  const cats = catalogue.filter((x) => x.book === book);

  const save = () => {
    const input: ExpenseInput = { kind, book, withdrawer, employeeId, yearMonth, amountPaise: amount || null, lines, instruction, stamp: touched ? stamp : null, version: expense?.version };
    void submit(
      () => (expense ? cashApi.updateExpense(expense.id, input, actor) : cashApi.createExpense(input, actor)),
      (e) => onSaved(e, isNew),
    );
  };

  return (
    <Modal
      open
      className="pay-form-modal cb-modal"
      staticBackdrop
      eyebrow={isNew ? 'Expenses · New' : 'Expenses · Edit'}
      title={expense ? t.formEdit(expenseTypeNames[expense.type], entryLabel(expense.entryNo)) : 'New expense'}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" icon="check2" disabled={busy || !lookups}>{busy ? tr("Saving…") : tr("Save entry")}</Button>
        </>
      }
    >
      {conflict && <ConflictNote onReload={onReload} />}
      {lookupsFailed && <div className="alert alert-danger">{c.lookupsFailed}</div>}
      <div className="form-section">
        <div className="fs-head"><div className="fs-title"><i className="bi bi-ui-radios-grid" /> {tr("What are you recording?")}<span className="req">*</span></div></div>
        <PickGroup<ExpenseKind> label={tr("Kind of entry")} value={kind} onChange={setKind} disabled={!isNew} choices={[
          { value: 'withdrawal', icon: 'box-arrow-up-right', title: 'Cash withdrawal', text: 'Cash out of the till' },
          { value: 'misc', icon: 'basket', title: 'Miscellaneous expense', text: 'Things bought, by item' },
          { value: 'advance', icon: 'people', title: 'Staff advance', text: 'Money given to staff' },
        ]} />
      </div>

      <div className="form-section">
        <div className="fs-head"><div className="fs-title"><i className="bi bi-buildings" /> {tr("Which business")}<span className="req">*</span></div></div>
        <PickGroup<CashBook> label={tr("Which business")} value={book} disabled={!isNew}
          onChange={(v) => { setBook(v); setWithdrawer(''); setEmployeeId(''); setLines([newLine()]); }}
          choices={cashBooks.map((b) => ({ value: b, icon: b === 'hotel' ? 'building' : 'cup-hot', title: cashBusinessName[b] }))} />
      </div>

      <div className="form-section">
        <div className="fs-head"><div className="fs-title"><i className="bi bi-person" /> {tr("Who and when")}</div></div>
        {force.on && <div className="alert alert-warning d-flex align-items-start gap-2"><i className="bi bi-shield-exclamation" /><span>{c.forceMode}</span></div>}
        <div className="row g-3">
          <EntryStamp canSet={actor.canBackdate ?? false} stamp={stamp} onChange={(s) => { setStamp(s); setTouched(true); }} saved={!isNew} error={errors.date ?? errors.time} />
          {kind === 'withdrawal' && (
            <Field label={tr("Received by")} required col="col-md-6" error={errors.withdrawer}>
              <PmsSelect value={withdrawer} onChange={(e) => setWithdrawer(e.target.value)}>
                <option value="">{tr("Choose a name…")}</option>
                {receiverOptions.map((n) => <option key={n} value={n}>{n}</option>)}
              </PmsSelect>
              {lookups && receiverOptions.length === 0 && <div className="form-text cb-depositor-empty"><i className="bi bi-info-circle" /> <span>{tr("No receiver names are set up for")} {cashBusinessName[book]} {tr("yet.")} {actor.isAdmin ? tr("Add them in Lists and rates.") : tr("Ask your Hotel Admin to add them in Lists and rates.")}</span></div>}
            </Field>
          )}
          {kind === 'advance' && (
            <Field label={tr("Staff member")} required col="col-md-6" error={errors.employeeId}>
              <PmsSelect value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">{tr("Choose a staff member…")}</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </PmsSelect>
              {lookups && staff.length === 0 && <div className="form-text cb-depositor-empty"><i className="bi bi-info-circle" /> <span>{t.staffEmpty}</span></div>}
            </Field>
          )}
        </div>
      </div>

      {kind === 'misc' && (
        <div className="form-section">
          <div className="fs-head">
            <div className="fs-title"><i className="bi bi-basket" /> {tr("Items")}<span className="req">*</span> <span className="co-count">{lines.length}</span></div>
            <div className="fs-hint">{tr("Pick a category, then an item. Add as many lines as you need.")}</div>
          </div>
          {errors.lines && <div className="field-error mb-2">{errors.lines}</div>}
          <div className="ex-lines">
            {lines.map((l, i) => {
              const fig = lineFigures(l, catalogue, saved);
              const cat = cats.find((x) => x.id === l.categoryId);
              const keep = l.itemId === 'keep';
              return (
                <div key={l.key} className="ex-line">
                  <div className="ex-line-head">
                    <span className="co-person-no">{i + 1}</span>
                    <span className="co-person-tag">{tr("Item")}</span>
                    <span className="ex-pricing" role="radiogroup" aria-label={tr("How this item is priced")}>
                      <button /* check-shared-ignore: a two-option radio pair drawn by .ex-pricing-opt */ type="button" role="radio" aria-checked={l.pricing === 'listed'} className={`ex-pricing-opt ${l.pricing === 'listed' ? 'active' : ''}`} title={tr("The price set for this item in Lists and rates")} onClick={() => setLine(i, { pricing: 'listed' })}>
                        <i className="bi bi-tag" /> {tr("Listed price")}
                      </button>
                      <button /* check-shared-ignore: a two-option radio pair drawn by .ex-pricing-opt */ type="button" role="radio" aria-checked={l.pricing === 'custom'} className={`ex-pricing-opt ${l.pricing === 'custom' ? 'active' : ''}`} title={tr("Type the quantity and the amount yourself")} onClick={() => setLine(i, { pricing: 'custom' })}>
                        <i className="bi bi-pencil" /> {tr("Custom amount")}
                      </button>
                    </span>
                    {lines.length > 1 && (
                      <RemoveButton look="person" aria-label={tr("Remove this item")} onClick={() => setLines((p) => p.filter((_, n) => n !== i))} />
                    )}
                  </div>
                  <div className="row g-3">
                    {keep ? (
                      <>
                        <Field label={tr("Category")} col="col-md-5 ex-col-category"><input className="form-control" value={fig.categoryName} readOnly /></Field>
                        <Field label={tr("Item")} col="col-md-4 ex-col-item"><input className="form-control" value={fig.itemName} readOnly /></Field>
                      </>
                    ) : (
                      <>
                        <Field label={tr("Category")} required col="col-md-5 ex-col-category" error={errors[`lines.${i}.category`]}>
                          <PmsSelect value={l.categoryId} onChange={(e) => setLine(i, { categoryId: e.target.value, itemId: '' })}>
                            <option value="">{tr("Category")}</option>
                            {cats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </PmsSelect>
                        </Field>
                        <Field label={tr("Item")} required col="col-md-4 ex-col-item" error={errors[`lines.${i}.item`]}>
                          <PmsSelect value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}>
                            <option value="">{tr("Item")}</option>
                            {(cat?.items ?? []).map((it) => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}
                          </PmsSelect>
                        </Field>
                      </>
                    )}
                    <Field label={tr("Quantity")} required col="col-md-3 ex-col-qty" error={errors[`lines.${i}.quantity`]}>
                      <input type="number" className="form-control" step="0.001" min="0.001" inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                    </Field>
                    {l.pricing === 'custom' && (
                      <Field label={tr("Amount (₹)")} required col="col-md-3 ex-col-amount" error={errors[`lines.${i}.amount`]}>
                        <input type="number" className="form-control" step="0.01" min="0.01" inputMode="decimal" placeholder="0.00"
                          value={l.amountPaise ? l.amountPaise / 100 : ''} onChange={(e) => setLine(i, { amountPaise: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null })} />
                      </Field>
                    )}
                  </div>
                  <div className="ex-line-sum">
                    <span>{tr("Price")} <b>{fig.pricePaise === null ? '-' : formatINR(fig.pricePaise)}</b></span>
                    <span className="ex-sum-total">{tr("Line total")} <b>{formatINR(fig.totalPaise)}</b></span>
                  </div>
                </div>
              );
            })}
          </div>
          {lookups && cats.length === 0 && (
            <div className="form-text cb-depositor-empty"><i className="bi bi-info-circle" /> <span>{tr("No categories are set up for this business yet. Your Hotel Admin adds them in Lists and rates.")}</span></div>
          )}
          <TextAction kind="add" onClick={() => setLines((p) => [...p, newLine()])}>{tr("Add another item")}</TextAction>
          <div className="ex-total">
            <span className="ex-total-label">{tr("Total")}</span>
            <span className="ex-total-words">{wordsOf(total)}</span>
            <span className="ex-total-value">{formatINR(total)}</span>
          </div>
        </div>
      )}

      {kind === 'advance' && (
        <div className="form-section">
          <div className="fs-head"><div className="fs-title"><i className="bi bi-calendar-month" /> {tr("Recovered from")}</div></div>
          <label className="form-label">{tr("For month")}<span className="req">*</span></label>
          <PmsDate type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} />
          {errors.yearMonth && <div className="field-error">{errors.yearMonth}</div>}
          <div className="form-text">{tr("Taken back from this month's salary.")}</div>
        </div>
      )}

      {kind !== 'misc' && (
        <FormSection icon="cash-stack" title={tr("Amount")}>
          <AmountTile col="" label={tr("Amount")} paise={amount} onChange={setAmount} error={errors.amount} />
        </FormSection>
      )}

      <FormSection icon="chat-left-text" title={tr("Instruction")} hint="Optional. Anything worth knowing about this entry.">
        <label className="form-label visually-hidden" htmlFor="exp-instruction">{tr("Instruction")}</label>
        <Textarea id="exp-instruction" rows={2} maxLength={1000} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        {errors.instruction && <div className="field-error">{errors.instruction}</div>}
      </FormSection>
    </Modal>
  );
}
