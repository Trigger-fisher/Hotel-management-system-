'use client';

// Plan Rates inside Master Data (Pallav: masters/_plan-rates.blade.php and _plan-rate-fields.blade.php).
import { Fragment, useState } from 'react';
import { adminCopy, type PlanRate, type PlanRatesPanel, type PlanChoice } from '@shared/dashboards/admin';
import { formatINR } from '@shared/dashboards/format';
import { errorText, useAsync, useSubmit, useToast } from '@/components/ui';
import { Bi, Button, Dialog, EmptyState, FootTotal, FormSection, Modal, RupeeInput, Select, MayEdit } from '@/dashboards/pallav/ui';
import { adminApi } from './api';
import { matchesWords } from './masterParts';

import { tr } from '@/lib/i18n/language';
const t = adminCopy.masters.plan;

/** 2026-10-06 -> "06 Oct 2026" (Pallav `format('d M Y')`). */
const dMY = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] ?? ''} ${y}`;
};

export function MastersPlanRates({ words, onGoMasters }: { words: string[]; onGoMasters: () => void }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const { state } = useAsync(() => adminApi.getPlanRates(), [version], { keep: true });
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ plan: string } | null>(null);
  const [removing, setRemoving] = useState<PlanRate | null>(null);
  const [busy, setBusy] = useState(false);
  if (state.status !== 'ready') return <div className="card"><div className="empty-state"><div className="es-text">{state.status === 'error' ? errorText(state.error) : '…'}</div></div></div>;
  const panel: PlanRatesPanel = state.data;
  const { plans, rates, today } = panel;
  const rowsOf = (p: PlanChoice): PlanRate[] => rates[p.value.toLowerCase()] ?? [];
  const nowOf = (rows: PlanRate[]): PlanRate | undefined => rows.find((r) => r.effectiveFrom <= today);
  const nextOf = (rows: PlanRate[]): PlanRate | undefined => rows.filter((r) => r.effectiveFrom > today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  const pricedToday = plans.filter((p) => nowOf(rowsOf(p))).length;
  const shown = plans.filter((p) => matchesWords(`${p.value} ${p.label}`, words));

  async function remove(r: PlanRate) {
    setBusy(true);
    const res = await adminApi.deletePlanRate(r.id);
    setBusy(false);
    setRemoving(null);
    if (res.ok) { toast.show({ tone: 'success', text: res.data.message }); setVersion((v) => v + 1); } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  const noMatch = words.length > 0 && shown.length === 0;

  return (
    <>
      {/* Shown above the rates when the search box matches nothing (master-search.js hides the plans, the card stays) */}
      {noMatch ? <div className="card"><EmptyState icon="search" title={adminCopy.masters.noMatch.title(words.join(' '))} text={adminCopy.masters.noMatch.text} /></div> : null}

      <div className="card reveal bm-rates-card">
        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span><Bi name="cup-hot" className="me-1" /> {t.title}</span>
          <MayEdit module="masters"><Button size="sm" icon="plus-lg" onClick={() => setForm({ plan: plans[0]?.value ?? '' })}>{t.newRate}</Button></MayEdit>
        </div>
        <div className="card-body">
          <p className="bm-rates-intro">{t.intro}</p>
          <div className="bm-rates-sum">
            <span><b>{pricedToday}</b> {t.priced(plans.length)}</span>
            <span>{t.owed} <b>{formatINR(panel.owedThisMonthPaise)}</b></span>
          </div>

          <div className="sh-day">
            <div className="sh-day-head"><span>{t.plans}</span><span className="sh-day-meta">{t.openOne}</span></div>

            {plans.length === 0 ? (
              <div className="card">
                <div className="empty-state">
                  <div className="es-icon"><Bi name="cup-hot" /></div>
                  <div className="es-title">{t.noPlansTitle}</div>
                  <div className="es-text">{t.noPlansText}</div>
                  <a className="btn btn-outline-p mt-3" href="#" onClick={(e) => { e.preventDefault(); onGoMasters(); }}>{t.goMasters}</a>
                </div>
              </div>
            ) : shown.map((p) => {
              const rows = rowsOf(p);
              const now = nowOf(rows);
              const next = nextOf(rows);
              return (
                <details
                  key={p.value}
                  className="sh-card bm-card bm-plan-card"
                  open={open === p.value}
                  onToggle={(e) => { const isOpen = (e.currentTarget as HTMLDetailsElement).open; setOpen((c) => (isOpen ? p.value : c === p.value ? null : c)); }}
                >
                  <summary>
                    <div className="sh-when">
                      <span className="bm-room">{p.value}</span>
                      <span className="sh-shift">{t.planWord}</span>
                    </div>
                    <div className="sh-cols">
                      <div className="sh-col"><span className="sh-lab">{t.planWord}</span><span className="sh-val">{p.label}</span></div>
                      <div className="sh-col">
                        <span className="sh-lab">{t.inForceSince}</span>
                        {now ? <span className="sh-val text">{dMY(now.effectiveFrom)}</span> : <span className="sh-val none">{t.noRateYet}</span>}
                      </div>
                      <div className="sh-col">
                        <span className="sh-lab">{t.nextChange}</span>
                        {next ? <span className="sh-val text">{formatINR(next.ratePaise)} {tr("from")} {dMY(next.effectiveFrom)}</span> : <span className="sh-val none">{t.nonePlanned}</span>}
                      </div>
                      <div className="sh-col"><span className="sh-lab">{t.history}</span><span className="sh-val text">{t.rates(rows.length)}</span></div>
                    </div>
                    <div className="sh-cash">
                      <small>{t.perNight}</small>
                      <strong>{now ? formatINR(now.ratePaise) : '-'}</strong>
                      {!now ? <span className="bm-state warn"><Bi name="exclamation-triangle" /> {t.setRate}</span> : null}
                    </div>
                    <Bi name="chevron-down" className="sh-caret" />
                  </summary>

                  <div className="sh-body">
                    {rows.length === 0 ? (
                      <p className="text-muted small mb-0">{t.noRateText(p.value)}</p>
                    ) : (
                      <dl className="bm-dl bm-rate-list">
                        {rows.map((r) => (
                          <Fragment key={r.id}>
                            <dt>{t.from(dMY(r.effectiveFrom))}</dt>
                            <dd>
                              <span className="bm-rate-line">
                                <b>{formatINR(r.ratePaise)}</b>
                                {now && r.id === now.id ? <span className="bm-state good">{t.inForce}</span> : r.effectiveFrom > today ? <span className="bm-state">{t.startsLater}</span> : <span className="bm-state muted">{t.earlier}</span>}
                                {r.note ? <span className="text-muted">{r.note}</span> : null}
                                <form className="d-inline ms-auto" onSubmit={(e) => e.preventDefault()}>
                                  <MayEdit module="masters"><Button variant="danger" size="sm" aria-label={t.removeTitle} onClick={() => setRemoving(r)}><Bi name="trash" /></Button></MayEdit>
                                </form>
                              </span>
                            </dd>
                          </Fragment>
                        ))}
                      </dl>
                    )}
                    <div className="sh-actions">
                      <span className="text-muted small me-auto">{t.footNote}</span>
                      <MayEdit module="masters"><Button variant="outline" size="sm" icon="plus-lg" onClick={() => setForm({ plan: p.value })}>{t.newRateFor(p.value)}</Button></MayEdit>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      </div>

      {form ? <RateForm plans={plans} today={today} plan={form.plan} onClose={() => setForm(null)} onSaved={(m) => { toast.show({ tone: 'success', text: m }); setForm(null); setVersion((v) => v + 1); }} /> : null}
      <Dialog open={removing !== null} tone="danger" title={t.removeTitle} message={t.removeBody} confirmLabel={adminCopy.masters.remove.label} busy={busy} onCancel={() => setRemoving(null)} onConfirm={() => { if (removing) void remove(removing); }} />
    </>
  );
}

function RateForm({ plans, today, plan: first, onClose, onSaved }: { plans: PlanChoice[]; today: string; plan: string; onClose: () => void; onSaved: (message: string) => void }) {
  const [plan, setPlan] = useState(first);
  const [rate, setRate] = useState(0);
  const [from, setFrom] = useState(today);
  const [note, setNote] = useState('');
  const { busy, errors, submit } = useSubmit(['plan', 'ratePaise', 'effectiveFrom', 'note']);
  return (
    <Modal
      open
      size="lg"
      className="pay-form-modal sh-modal bm-modal"
      staticBackdrop
      onClose={onClose}
      eyebrow={t.eyebrow}
      title={t.modalTitle}
      onSubmit={() => void submit(() => adminApi.savePlanRate({ plan, ratePaise: rate, effectiveFrom: from, note }), (d) => onSaved(d.message))}
      footerClass="sh-modal-foot"
      footer={
        <>
          <FootTotal label={t.perNight} paise={rate} />
          <Button variant="ghost" onClick={onClose}>{adminCopy.common.cancel}</Button>
          <Button type="submit" icon="check2" disabled={busy}>{t.save}</Button>
        </>
      }
    >
      <FormSection icon="cup-hot" title={t.theRate} hint={t.theRateHint}>
        <div className="row g-3">
          <div className="col-sm-6">
            <label className="form-label">{t.plan}<span className="req">*</span></label>
            <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
            {errors.plan ? <div className="field-error">{errors.plan}</div> : null}
          </div>
          <div className="col-sm-6">
            <label className="form-label">{t.rate}<span className="req">*</span></label>
            <RupeeInput paise={rate} onChange={setRate} placeholder="0.00" ariaLabel={t.rate} />
            {errors.ratePaise ? <div className="field-error">{errors.ratePaise}</div> : null}
          </div>
          <div className="col-sm-6">
            <label className="form-label">{t.startsOn}<span className="req">*</span></label>
            <input type="date" className="form-control" value={from} onChange={(e) => setFrom(e.target.value)} />
            <div className="form-text">{t.startsOnHint}</div>
            {errors.effectiveFrom ? <div className="field-error">{errors.effectiveFrom}</div> : null}
          </div>
          <div className="col-sm-6">
            <label className="form-label">{t.note} <span className="wz-optional">{t.optional}</span></label>
            <input className="form-control" maxLength={255} placeholder={t.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
            {errors.note ? <div className="field-error">{errors.note}</div> : null}
          </div>
        </div>
      </FormSection>
    </Modal>
  );
}
