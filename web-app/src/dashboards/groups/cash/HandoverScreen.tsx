'use client';
// Shift Handover in Hotel Pallav's own markup (resources/views/shift_handover/index.blade.php + _modal): search and New Handover, four tiles,
// handovers grouped by day as expandable cards (the shared DetailCard: cash count, notes, instructions), and the two-step pop-up (shift and cash, then notes).
import { useState } from 'react';

import { formatDate, formatINR, formatMonthLong, formatTime } from '@shared/dashboards/format';
import {
  canDeleteCashEntry, canEditCashEntry, cashActorOf, cashCopy, denominations, emptyCounts, entryLabel, handoverPieces, handoverReceipt, handoverTotalPaise, istDateOf, istToday, shiftAt, shifts,
  type DenominationCounts, type HandoverInput, type HandoverOptions, type HandoverList, type Shift, type ShiftHandover, type StampInput,
} from '@shared/dashboards/cash';

import { userMayEdit } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { errorText, useAsync, useDebounced, useSubmit, useToast, usePageSize } from '@/components/ui';
import { Button, DetailCard, DetailNone, Dialog, EmptyState, Field, FootTotal, FormSection, Modal, Pager, Point, RichPoints, WizardNav, WizardSteps, pagerView, pointText, PmsSelect, wordsOf, ConflictNote, PageSkeleton, LoadError, openPdf, RemoveButton, Table, type DetailSection } from '../../pallav/ui';
import { HANDOVER_PDF } from '@/lib/api/adapters/handover';
import { apiMode } from '@/lib/api/mode';
import { useForceMode } from '../../pallav/forceMode';
import { dayLabel, groupByDay, money, plural } from '../billing/listKit';
import { cashApi } from './api';
import { CashSearch, EntryStamp, istStamp } from './cashKit';
import { HomeStats } from '../overview/HomeJobs';
import { ReceiptPreview, newStamp, stampFromIso, useLastReady } from './shared';

import { tr } from '@/lib/i18n/language';
const t = cashCopy.handover;
const c = cashCopy.common;
const STEPS = ['Shift and cash', 'Notes and instructions'];

/** A thin strip of each note's own colour, so the eye finds the row (the Blade's $noteColours). */
// check-shared-ignore: denomination colours tell notes apart (data, not theme)
const noteColours: Record<string, string> = { d500: '#7C7F6E', d200: '#E9A23B', d100: '#8E7CC3', d50: '#2FA8CF', d20: '#9DB83C', d10: '#9A5B3A', d5: '#3F9A5C', coins: '#C99A1C' };

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/** One handover as the shared DetailCard: time and shift, the key facts, the cash at the right; cash count, notes and instructions when open. */
function HandoverCard({ h, canEdit, canDelete, onView, onEdit, onDelete }: { h: ShiftHandover; canEdit: boolean; canDelete: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const clock = formatTime(h.at);
  const to = h.handedTo?.name ?? null;
  const firstNote = h.notes.length ? pointText(h.notes[0] ?? '') : '';
  const firstInstruction = h.instructions[0] ?? '';
  const hasInstructions = h.instructions.length > 0;

  const sections: DetailSection[] = [
    {
      icon: 'cash-coin',
      title: tr("Cash count"),
      content: (
        <>
          <Table className="sh-count-table">
            <tbody>
              {denominations.filter((d) => h.counts[d.key] > 0).map((d) => (
                <tr key={d.key}>
                  <td>{d.label}</td>
                  <td className="text-muted">{d.key === 'coins' ? `${h.counts.coins} in coins` : `× ${h.counts[d.key]}`}</td>
                  <td className="text-end">{formatINR(h.counts[d.key] * d.rupees * 100)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>{tr("Total")}</td><td className="text-end">{formatINR(h.totalPaise)}</td></tr></tfoot>
          </Table>
          <div className="sh-words">{wordsOf(h.totalPaise)}</div>
        </>
      ),
    },
    {
      icon: 'sticky',
      title: tr("Notes for the next shift"),
      count: h.notes.length,
      content: h.notes.length ? <ul className="sh-points">{h.notes.map((n, i) => <Point key={i} html={n} />)}</ul> : <DetailNone>{tr("No notes.")}</DetailNone>,
    },
  ];
  if (hasInstructions) {
    sections.push({
      icon: 'chat-left-text',
      title: tr("Instruction"),
      count: h.instructions.length,
      tone: 'warn',
      content: <ul className="sh-points warn">{h.instructions.map((p, i) => <li key={i}>{p}</li>)}</ul>,
    });
  }

  return (
    <DetailCard
      label={`${tr("Handover")} ${entryLabel(h.entryNo)}`}
      warn={hasInstructions}
      className="hu-dc hu-time"
      lead={{ big: clock, tag: h.shift, title: istStamp(h.at) }}
      facts={[
        { label: tr("Reg. no."), value: entryLabel(h.entryNo) },
        { label: tr("Handed over by"), value: h.handedBy.name },
        { label: tr("Handover to"), value: to },
        { label: tr("Notes"), count: h.notes.length, value: firstNote ? short(firstNote, 70) : null, title: firstNote, text: true, wide: true },
        {
          label: hasInstructions ? <><i className="bi bi-exclamation-triangle-fill" aria-hidden="true" /> {tr("Instruction")}</> : tr("Instruction"),
          count: h.instructions.length, value: firstInstruction ? short(firstInstruction, 70) : null, title: firstInstruction, tone: hasInstructions ? 'warn' : undefined, wide: true,
        },
      ]}
      amount={{ label: tr("Total cash"), value: money(h.totalPaise) }}
      sections={sections}
      meta={<>{tr("Handover time")} {clock} {tr("· Recorded")} {istStamp(h.createdAt)}{h.updatedAt > h.createdAt ? ` · Updated ${istStamp(h.updatedAt)}` : ''}</>}
      actions={
        <>
          <Button variant="outline" size="sm" title={tr("Open the sheet")} onClick={onView}><i className="bi bi-file-earmark-pdf" /> {tr("View")}</Button>
          {canEdit && <Button variant="outline" size="sm" title={tr("Edit")} onClick={onEdit}><i className="bi bi-pencil-square" /> {tr("Edit")}</Button>}
          {canDelete && <Button variant="danger" size="sm" onClick={onDelete}><i className="bi bi-trash" /> {tr("Delete")}</Button>}
        </>
      }
    />
  );
}

export function HandoverScreen({ user }: ScreenProps) {
  const toast = useToast();
  const actor = cashActorOf(user);
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed, 250);
  const [page, setPage] = useState(1);
  const pageSize = usePageSize(25);
  const list = useAsync(() => cashApi.listHandovers({ search, page, pageSize }), [search, page, pageSize]);
  const options = useAsync(() => cashApi.getHandoverOptions(), []);
  const data = useLastReady<HandoverList>(list.state);

  const [form, setForm] = useState<{ handover: ShiftHandover | null } | null>(null);
  const [receipt, setReceipt] = useState<ShiftHandover | null>(null);
  const [del, setDel] = useState<ShiftHandover | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  async function remove() {
    if (!del) return;
    setDelBusy(true);
    const res = await cashApi.deleteHandover(del.id, actor, del.version);
    setDelBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: t.deleted(entryLabel(del.entryNo)) });
      list.reload();
    } else toast.show({ tone: 'error', text: errorText(res.error) });
    setDel(null);
  }

  const stats = data?.stats;
  const latest = stats?.latest ?? null;
  const month = formatMonthLong(istToday().slice(0, 7));
  const groups = groupByDay(data?.items ?? [], (h) => istDateOf(h.at));
  const newHandover = () => setForm({ handover: null });
  const when = (iso: string) => {
    const d = istDateOf(iso);
    const label = dayLabel(d);
    return label === 'Today' || label === 'Yesterday' ? label : formatDate(d);
  };

  return (
    <>
      <div className="page-head page-tools">
        <div><p className="pms-sub">{tr("The cash counted and handed over at the end of each shift.")}</p></div>
        <div className="sh-head-actions">
          <CashSearch value={typed} onChange={(v) => { setTyped(v); setPage(1); }} onClear={() => { setTyped(''); setPage(1); }} placeholder={tr("Search handovers")} />
          {userMayEdit('handover') && <Button icon="plus-lg" className="sh-new" onClick={newHandover}>{tr("New handover")}</Button>}
        </div>
      </div>

      {!data && (list.state.status === 'error' ? <LoadError error={list.state.error} onRetry={list.reload} /> : <PageSkeleton />)}

      {stats && (
        <HomeStats
          stats={[
            { id: 'today', label: 'Handovers today', value: stats.todayCount, format: (n) => String(Math.round(n)), note: stats.todayCount ? 'Recorded' : 'None yet today' },
            { id: 'cash', label: 'Cash counted today', value: stats.todayCashPaise, format: (n) => money(Math.round(n)), note: "Across today's handovers" },
            { id: 'month', label: 'This month', value: stats.monthCount, format: (n) => String(Math.round(n)), note: month },
            { id: 'last', label: 'Last handover', value: 0, format: () => (latest ? `${latest.shift} · ${formatTime(latest.at)}` : 'None yet'), note: latest ? `${latest.handedBy.name} to ${latest.handedTo?.name ?? 'None'} · ${when(latest.at)}` : 'Record the first one' },
          ]}
        />
      )}

      {data && data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="arrow-left-right"
            title={typed !== '' ? 'No handover matches that search' : 'No handovers yet'}
            text={typed !== '' ? 'Try a different word, a date like 19-09-2026, a registration number like 5, or an amount.' : 'When a shift ends, count the cash and leave points for whoever takes over. They will all be listed here.'}
          >
            {typed !== '' ? (
              <Button variant="outline" className="mt-3" onClick={() => setTyped('')}>{tr("Clear search")}</Button>
            ) : (
              userMayEdit('handover') && <Button icon="plus-lg" className="mt-3" onClick={newHandover}>{tr("New handover")}</Button>
            )}
          </EmptyState>
        </div>
      ) : (
        data && (
          <>
            {groups.map((g) => (
              <div key={g.date} className="sh-day">
                <div className="sh-day-head">
                  <span>{dayLabel(g.date)}</span>
                  <span className="sh-day-meta">{plural(g.items.length, 'handover')}</span>
                </div>
                {g.items.map((h) => (
                  <HandoverCard key={h.id} h={h}
                    canEdit={canEditCashEntry({ isLatest: h.isLatest, recordedBy: h.handedBy }, actor) && userMayEdit('handover')} canDelete={canDeleteCashEntry(actor) && userMayEdit('handover')}
                    onView={() => (apiMode() === 'real' ? void openPdf(HANDOVER_PDF(h.id), (text) => toast.show({ tone: 'error', text })) : setReceipt(h))} onEdit={() => setForm({ handover: h })} onDelete={() => setDel(h)} />
                ))}
              </div>
            ))}
            <div className="card sh-pager-card"><Pager view={pagerView(data, { setPage })} /></div>
          </>
        )
      )}

      {form && (
        <HandoverForm
          handover={form.handover}
          options={options.state.status === 'ready' ? options.state.data : null}
          lookupsFailed={options.state.status === 'error'}
          actor={actor}
          onClose={() => setForm(null)}
          onReload={() => { setForm(null); list.reload(); }}
          onSaved={(h, isNew) => {
            toast.show({ tone: 'success', text: isNew ? t.saved(entryLabel(h.entryNo)) : t.updated(entryLabel(h.entryNo)) });
            setForm(null);
            list.reload();
          }}
        />
      )}
      <ReceiptPreview open={receipt !== null} receipt={receipt ? handoverReceipt(receipt) : null} onClose={() => setReceipt(null)} />
      <Dialog
        open={del !== null}
        title={del ? `Delete handover ${entryLabel(del.entryNo)}?` : ''}
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

function HandoverForm({ handover, options, lookupsFailed, actor, onClose, onReload, onSaved }: {
  handover: ShiftHandover | null;
  options: HandoverOptions | null;
  lookupsFailed: boolean;
  actor: ReturnType<typeof cashActorOf>;
  onClose: () => void;
  onReload: () => void;
  onSaved: (h: ShiftHandover, isNew: boolean) => void;
}) {
  const isNew = handover === null;
  const force = useForceMode();
  const [step, setStep] = useState(0);
  const [shift, setShift] = useState<Shift | ''>(handover?.shift ?? (options ? ((options.currentShift ?? '') as Shift | '') : shiftAt()));
  const [handedToId, setHandedToId] = useState(handover?.handedTo?.id ?? '');
  const [counts, setCounts] = useState<DenominationCounts>(handover?.counts ?? emptyCounts());
  const [notes, setNotes] = useState<string[]>(handover?.notes ?? []);
  const [instructions, setInstructions] = useState<string[]>(handover?.instructions?.length ? handover.instructions : ['']);
  const [touched, setTouched] = useState(false);
  const [stamp, setStamp] = useState<StampInput>(handover ? stampFromIso(handover.at) : newStamp());
  const [local, setLocal] = useState<Record<string, string>>({});
  const { busy, errors: server, conflict, submit } = useSubmit(['shift', 'handedToId', 'notes', 'instructions', 'date', 'time', ...denominations.map((d) => `count.${d.key}`)]);
  const errors = { ...local, ...server };
  const total = handoverTotalPaise(counts);
  const last = step === STEPS.length - 1;
  const setCount = (key: keyof DenominationCounts, n: number) => setCounts((p) => ({ ...p, [key]: Math.max(0, Math.min(1_000_000, n || 0)) }));

  const next = () => {
    const bad: Record<string, string> = {};
    if (!shift) bad.shift = 'Choose the shift.';
    if (!handedToId) bad.handedToId = 'Choose who is taking over.';
    setLocal(bad);
    if (!Object.keys(bad).length) setStep(step + 1);
  };

  // Pallav lets the handover be saved from the first step too: the shift and who takes over are checked first.
  const submitAll = () => {
    const bad: Record<string, string> = {};
    if (!shift) bad.shift = 'Choose the shift.';
    if (!handedToId) bad.handedToId = 'Choose who is taking over.';
    setLocal(bad);
    if (Object.keys(bad).length) {
      setStep(0);
      return;
    }
    save();
  };

  const save = () => {
    const input: HandoverInput = { shift, handedToId, counts, notes: notes.filter((n) => pointText(n).trim()), instructions: instructions.filter((n) => n.trim()), stamp: touched ? stamp : null, ...(handover?.version !== undefined ? { version: handover.version } : {}) };
    void submit(
      () => (handover ? cashApi.updateHandover(handover.id, input, actor) : cashApi.createHandover(input, actor)),
      (h) => onSaved(h, isNew),
    );
  };

  return (
    <Modal
      open
      scrollable={false}
      size="xl"
      className="pay-form-modal sh-modal"
      staticBackdrop
      eyebrow={isNew ? 'Handover · New' : 'Handover · Edit'}
      title={handover ? `Edit handover ${entryLabel(handover.entryNo)}` : 'New handover'}
      onClose={onClose}
      onSubmit={submitAll}
      footerClass="sh-modal-foot"
      footer={
        <>
          <WizardNav index={step} last={last} onBack={() => setStep(step - 1)} onNext={next} />
          <FootTotal label={`Total cash ${handoverPieces(counts) ? `(${t.pieces(handoverPieces(counts))})` : ''}`.trim()} paise={total} />
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" icon="check2" disabled={busy || !options}>{busy ? tr("Saving…") : tr("Save handover")}</Button>
        </>
      }
    >
      {conflict && <ConflictNote onReload={onReload} />}
      {lookupsFailed && <div className="alert alert-danger">{c.lookupsFailed}</div>}
      <div>
        <WizardSteps names={STEPS} index={step} onGo={setStep} />

        <div className={`form-step ${step === 0 ? 'active' : ''}`}>
          <FormSection icon="clock" title={tr("Which shift, and when")} hint="The shift that is ending and handing over the till.">
            <div className="row g-3">
              <EntryStamp col="col-sm-4" canSet={actor.canBackdate ?? false} stamp={stamp} onChange={(s) => { setStamp(s); setTouched(true); }} saved={!isNew} error={errors.date ?? errors.time} />
              <Field label={tr("Shift")} required col="col-sm-4" error={errors.shift}>
                <PmsSelect value={shift} onChange={(e) => setShift(e.target.value as Shift | '')}>
                  <option value="">{tr("None")}</option>
                  {(options?.shifts.length ? options.shifts : shifts).map((s) => <option key={s} value={s}>{s}</option>)}
                </PmsSelect>
                <div className="form-text">{t.shiftHint}</div>
              </Field>
              <Field label={tr("Handover to")} required col="col-sm-4" error={errors.handedToId}>
                <PmsSelect value={handedToId} onChange={(e) => setHandedToId(e.target.value)}>
                  <option value="">{tr("Choose who is taking over…")}</option>
                  {(options?.staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </PmsSelect>
                {options && options.staff.length === 0 && <div className="form-text cb-depositor-empty"><i className="bi bi-info-circle" /> <span>{tr("No staff are set up yet. Add them in Payroll first.")}</span></div>}
              </Field>
            </div>
            {force.on && <div className="alert alert-warning d-flex align-items-start gap-2 mt-3"><i className="bi bi-shield-exclamation" /><span>{c.forceMode}</span></div>}
          </FormSection>

          <FormSection icon="cash-coin" title={tr("Count the cash")} hint={<>{tr("Tap a note to add one, or type how many.")} <kbd>{tr("Enter")}</kbd> {tr("moves to the next.")}</>}
            aside={/* check-shared-ignore: a text link in the section header */ <button type="button" className="sh-link-btn" onClick={() => setCounts(emptyCounts())}><i className="bi bi-arrow-counterclockwise" /> {tr("Reset")}</button>}>
            <div className="cash-grid">
              {denominations.map((d) => {
                const coin = d.key === 'coins';
                return (
                  <div key={d.key} className={`cash-tile ${coin ? 'coin' : ''}`} style={{ '--note': noteColours[d.key] } as React.CSSProperties}>
                    <button /* check-shared-ignore: a coin or note tile, no kit equivalent */ type="button" className="cash-face" title={coin ? 'Add ₹1 in coins' : `Add one ₹${d.rupees} note`} tabIndex={-1} onClick={() => setCount(d.key, counts[d.key] + 1)}>
                      {coin ? (
                        <>
                          <span className="cash-coin"><i className="bi bi-coin" /></span>
                          <span className="cash-face-text"><strong>{tr("Coins")}</strong><small>{tr("total value")}</small></span>
                        </>
                      ) : (
                        <span className="cash-face-val">₹{d.rupees}</span>
                      )}
                      <span className="cash-face-plus"><i className="bi bi-plus-lg" /></span>
                    </button>
                    <div className="cash-controls">
                      <div className="sh-stepper">
                        <button type="button" aria-label={tr("One less")} tabIndex={-1} onClick={() => setCount(d.key, counts[d.key] - 1)}><i className="bi bi-dash" /></button>
                        <input type="number" min={0} max={1000000} step={1} inputMode="numeric" className="form-control" aria-label={`${d.label} ${coin ? 'value' : 'count'}`}
                          value={counts[d.key]} onChange={(e) => setCount(d.key, Number.parseInt(e.target.value, 10))} />
                        <button type="button" aria-label={tr("One more")} tabIndex={-1} onClick={() => setCount(d.key, counts[d.key] + 1)}><i className="bi bi-plus" /></button>
                      </div>
                      <span className="cash-amount">{formatINR(counts[d.key] * d.rupees * 100, { decimals: false })}</span>
                    </div>
                    {errors[`count.${d.key}`] && <div className="field-error">{errors[`count.${d.key}`]}</div>}
                  </div>
                );
              })}
            </div>
          </FormSection>
        </div>

        <div className={`form-step ${step === 1 ? 'active' : ''}`}>
          <div className="sh-two">
            <div className="form-section">
              <div className="fs-head">
                <div className="fs-title"><i className="bi bi-sticky" /> {tr("Notes for the next shift")} <span className="sh-count">{notes.length}</span></div>
                <div className="fs-hint">{tr("General notes for whoever takes over — anything useful to hand over. Each line is one point.")} <kbd>{tr("Enter")}</kbd> {tr("starts the next point,")} <kbd>{tr("Shift")}</kbd> + <kbd>{tr("Enter")}</kbd> {tr("breaks a line inside one.")}</div>
              </div>
              <RichPoints points={notes} onChange={setNotes} label={tr("Notes for the next shift")} />
              {errors.notes && <div className="field-error">{errors.notes}</div>}
            </div>

            <div className="form-section">
              <div className="fs-head">
                <div className="fs-title sh-warn-title"><i className="bi bi-exclamation-triangle" /> {tr("Instruction")} <span className="sh-count warn">{instructions.filter((p) => p.trim()).length}</span></div>
                <div className="fs-hint">{tr("Important — things the next shift must not miss. Each line is one point, highlighted here and on the PDF.")} <kbd>{tr("Enter")}</kbd> {tr("adds the next one.")}</div>
              </div>
              <ol className="sh-point-list">
                {instructions.map((p, i) => (
                  <li key={i} className="sh-point">
                    <span className="sh-point-no" aria-hidden="true" />
                    <input type="text" className="form-control" maxLength={2000} placeholder={tr("e.g. VIP guest in 301 — keep the suite ready by 11 am")} value={p}
                      onChange={(e) => setInstructions((a) => a.map((x, n) => (n === i ? e.target.value : x)))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setInstructions((a) => [...a.slice(0, i + 1), '', ...a.slice(i + 1)]); } }} />
                    <RemoveButton title={tr("Remove")} aria-label={tr("Remove instruction")}
                      onClick={() => setInstructions((a) => (a.length > 1 ? a.filter((_, n) => n !== i) : ['']))} />
                  </li>
                ))}
              </ol>
              {errors.instructions && <div className="field-error">{errors.instructions}</div>}
              <Button variant="outline" size="sm" className="sh-add-point" onClick={() => setInstructions((a) => [...a, ''])}><i className="bi bi-plus-lg" /> {tr("Add instruction")}</Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
