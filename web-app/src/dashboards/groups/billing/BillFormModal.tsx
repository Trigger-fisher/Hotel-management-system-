'use client';
// New / Edit Bill as Pallav's pop-up (bill_master/_modal + _bill-fields): steps Bill and guest, Charges, Stay and plan, Reference, with the
// bill total in figures and words beside Cancel and Save. Not built yet: the "Start from the invoices" reader (reads a PDF on this computer).
import { useState } from 'react';

import { formatINR } from '@shared/dashboards/format';
import {
  billToInput, billingCopy, billingHotel, currentYear, emptyBillInput, foodTotal, hotelTotal, isoToIst, istToIso, nightsBetween, planLabel, priceStay,
  stayFromDates, validateBill, type Advance, type Bill, type BillInput, type BillingCompany, type StaySegment,
} from '@shared/dashboards/billing';

import { toInt, useAsync, useSubmit, useToast } from '@/components/ui';
import { Button, Field, FootTotal, FormSection, Modal, RupeeInput, WizardNav, WizardSteps, PmsSelect, PmsDate, ConflictNote, Textarea, RemoveButton } from '../../pallav/ui';
import { billingApi } from './api';

import { tr } from '@/lib/i18n/language';
const t = billingCopy.bills;
const STEPS = ['Bill and guest', 'Charges', 'Stay and plan', 'Reference'];
const NONE = 'none';
const FIELDS = ['billNo', 'billDate', 'guestName', 'mobile', 'referenceMobile', 'gstin', 'persons', 'departureAt', 'charges', 'stay'];
const STEP_FIELDS: string[][] = [['billNo', 'billDate', 'guestName', 'mobile', 'gstin', 'persons', 'departureAt'], ['charges'], ['stay'], ['referenceMobile']];

/** `datetime-local` wants "2026-10-06T14:00" in local (IST) time. */
const toLocal = (iso: string | null): string => {
  if (!iso) return '';
  const p = isoToIst(iso);
  return `${p.date}T${p.time}`;
};
const fromLocal = (v: string): string | null => {
  if (!v) return null;
  const [date, time] = v.split('T');
  return date ? istToIso(date, time || '00:00') : null;
};

export function BillFormModal({ bill, onClose, onSaved, onReload }: { bill: Bill | null; onClose: () => void; onSaved: (b: Bill) => void; onReload: () => void }) {
  const isNew = bill === null;
  const toast = useToast();
  const [input, setInput] = useState<BillInput>(() => (bill ? billToInput(bill) : emptyBillInput()));
  const [step, setStep] = useState(0);
  const [advCompany, setAdvCompany] = useState('');
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { busy, errors: serverErrors, conflict, submit } = useSubmit(FIELDS);
  const errors = { ...localErrors, ...serverErrors };

  const options = useAsync(() => billingApi.getBillingOptions(), []);
  const companyList = useAsync(() => billingApi.listCompanies(), []);
  const openAdvances = useAsync(() => billingApi.listOpenAdvances(), []);
  const companies: BillingCompany[] = companyList.state.status === 'ready' ? companyList.state.data : [];
  const advances: Advance[] = openAdvances.state.status === 'ready' ? openAdvances.state.data : [];
  const plans = options.state.status === 'ready' ? options.state.data.plans : [];
  const modes = options.state.status === 'ready' ? options.state.data.paymentModes : [];
  const rates = options.state.status === 'ready' ? Object.fromEntries(plans.map((p) => [p.code, p.ratePaise])) : undefined;

  const set = <K extends keyof BillInput>(key: K, value: BillInput[K]) => setInput((p) => ({ ...p, [key]: value }));
  const setHotel = (patch: Partial<BillInput['hotel']>) => setInput((p) => ({ ...p, hotel: { ...p.hotel, ...patch } }));
  const setFood = (patch: Partial<BillInput['food']>) => setInput((p) => ({ ...p, food: { ...p.food, ...patch } }));
  const setPart = (i: number, patch: Partial<StaySegment>) => set('stay', input.stay.map((s, n) => (n === i ? { ...s, ...patch } : s)));

  const hTotal = hotelTotal(input.hotel);
  const fTotal = foodTotal(input.food);
  const total = hTotal + fTotal;
  const priced = priceStay(input.stay, rates);
  const advKey = (a: Advance) => a.companyId ?? 'walkin';
  const advanceGroups = new Map<string, Advance[]>();
  for (const a of advances) advanceGroups.set(advKey(a), [...(advanceGroups.get(advKey(a)) ?? []), a]);
  const advanceCompanies = companies.filter((c) => advanceGroups.has(c.id));
  const picked = advances.find((a) => a.id === input.advanceId);

  // Plans are free text in stored bills: a saved plan stays selectable even if the server's list does not offer it.
  const offered = plans.map((p) => p.code);
  const saved = [...new Set([input.hotel.plan, ...input.stay.map((s) => s.plan)])].filter((p): p is string => !!p && !offered.includes(p));
  const planChoices = [...plans.map((p) => ({ value: p.code as string, label: p.label })), ...saved.map((p) => ({ value: p, label: planLabel(p) }))];
  const modeChoices = (current: string | null) => (current && !modes.includes(current) ? [...modes, current] : modes);
  const toPlan = (v: string): string | null => (v === '' ? null : v);
  const toMode = (v: string): string | null => (v === '' ? null : v);

  const next = () => {
    const all = validateBill(input, isNew);
    const mine = Object.fromEntries(Object.entries(all).filter(([k]) => STEP_FIELDS[step]?.some((s) => k === s || k.startsWith(`${s}.`))));
    setLocalErrors(mine);
    if (!Object.keys(mine).length) setStep(step + 1);
  };

  const save = () => {
    const all = validateBill(input, isNew);
    setLocalErrors(all);
    if (Object.keys(all).length) {
      const first = STEP_FIELDS.findIndex((fs) => Object.keys(all).some((k) => fs.some((s) => k === s || k.startsWith(`${s}.`))));
      if (first >= 0) setStep(first);
      return;
    }
    void submit(
      () => (bill ? billingApi.updateBill(bill.id, input) : billingApi.createBill(input)),
      (b) => {
        toast.show({ tone: 'success', text: isNew ? t.toast.created : t.toast.updated });
        onSaved(b);
      },
    );
  };

  const last = step === STEPS.length - 1;
  const stepClass = (i: number) => `form-step ${i === step ? 'active' : ''}`;
  const planSelect = (value: string | null, onChange: (v: string) => void, label: string) => (
    <PmsSelect aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{tr("No plan")}</option>
      {planChoices.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
    </PmsSelect>
  );
  const modeSelect = (value: string | null, onChange: (v: string | null) => void) => (
    <PmsSelect value={value ?? ''} onChange={(e) => onChange(toMode(e.target.value))}>
      <option value="">{tr("None")}</option>
      {modeChoices(value).map((m) => <option key={m} value={m}>{m}</option>)}
    </PmsSelect>
  );

  return (
    <Modal
      open
      scrollable={false}
      size="xl"
      className="pay-form-modal sh-modal bm-modal"
      staticBackdrop
      eyebrow={isNew ? 'Bills · New' : 'Bills · Edit'}
      title={isNew ? 'New bill' : `Edit bill ${bill.billNo}`}
      onClose={onClose}
      onSubmit={last ? save : next}
      footerClass="sh-modal-foot"
      footer={
        <>
          <WizardNav index={step} last={last} onBack={() => setStep(step - 1)} onNext={next} />
          <FootTotal label={tr("Bill total")} paise={total} />
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          {last && (
            <Button type="submit" icon="check2" disabled={busy}>
              {busy ? tr("Saving…") : isNew ? tr("Create bill") : tr("Save changes")}
            </Button>
          )}
        </>
      }
    >
      {conflict && <ConflictNote onReload={onReload} />}
      <div>
        <WizardSteps names={STEPS} index={step} onGo={setStep} />

        <div className={stepClass(0)}>
          <FormSection icon="receipt" title={tr("The bill")} hint={isNew ? 'The year is added in front of the number for you.' : 'The bill number cannot be changed once the bill is made.'}>
            <div className="row g-3">
              <Field label={tr("Bill number")} required col="col-sm-4" error={errors.billNo}>
                {isNew ? (
                  <div className="input-group">
                    <span className="input-group-text">{currentYear()} /</span>
                    <input className="form-control" value={input.billNo} maxLength={50} placeholder="1188" onChange={(e) => set('billNo', e.target.value)} />
                  </div>
                ) : (
                  <input className="form-control" value={input.billNo} readOnly tabIndex={-1} aria-label={tr("Bill number")} />
                )}
              </Field>
              <Field label={tr("Bill date")} required col="col-sm-4" error={errors.billDate}>
                <PmsDate type="date" value={input.billDate} onChange={(e) => set('billDate', e.target.value)} />
              </Field>
              <Field label={tr("G.R. No.")} optional col="col-sm-4">
                <input className="form-control" value={input.grNo} maxLength={50} placeholder={tr("Guest register")} onChange={(e) => set('grNo', e.target.value)} />
              </Field>
              {isNew && (
                <>
                  <Field label={tr("Advance from")} optional col="col-sm-6">
                    {/* The picker draws nothing for an empty value, so "no choice" is the word NONE here and is turned back into '' below. */}
                    <PmsSelect aria-label={tr("Company the advance was paid for")} value={advCompany || NONE}
                      onChange={(e) => { setAdvCompany(e.target.value === NONE ? '' : e.target.value); set('advanceId', null); }}>
                      <option value={NONE}>{tr("No advance")}</option>
                      {advanceGroups.has('walkin') && <option value="walkin">{tr("Walk-in guests (")}{advanceGroups.get('walkin')?.length})</option>}
                      {advanceCompanies.map((c) => <option key={c.id} value={c.id}>{c.name} ({advanceGroups.get(c.id)?.length})</option>)}
                    </PmsSelect>
                  </Field>
                  <Field label={tr("Advance to take off")} col="col-sm-6">
                    <PmsSelect key={advCompany ? 'open' : 'closed'} value={input.advanceId ?? NONE} onChange={(e) => set('advanceId', e.target.value === NONE ? null : e.target.value)} disabled={!advCompany}>
                      <option value={NONE}>{advCompany ? tr("No advance") : tr("Choose a company first")}</option>
                      {(advanceGroups.get(advCompany) ?? []).map((a) => (
                        <option key={a.id} value={a.id}>{a.receiptNo} · {a.guestName} {tr("· left")} {formatINR(a.hotelBalancePaise + a.foodBalancePaise)}</option>
                      ))}
                    </PmsSelect>
                  </Field>
                  <div className="col-12 mt-1">
                    <div className="form-text">
                      {picked
                        ? `${picked.guestName}${picked.roomNo ? ` · room ${picked.roomNo}` : ''}: up to ${formatINR(picked.hotelBalancePaise + picked.foodBalancePaise)} is taken off this bill.`
                        : `What the guest paid ahead is taken off this bill, up to its total.${advances.length === 0 ? ' No advance has money left right now.' : ''}`}
                    </div>
                  </div>
                </>
              )}
            </div>
          </FormSection>

          <FormSection icon="person" title={tr("The guest")} hint="Who stayed, where from, and the company paying if there is one.">
            <div className="row g-3">
              <Field label={tr("Guest name")} required col="col-sm-6" error={errors.guestName}>
                <input className="form-control" value={input.guestName} maxLength={255} onChange={(e) => set('guestName', e.target.value)} />
              </Field>
              <Field label={tr("Mobile number")} optional col="col-sm-6" error={errors.mobile}>
                <input className="form-control" value={input.mobile} maxLength={15} inputMode="tel" onChange={(e) => set('mobile', e.target.value)} />
              </Field>
              <Field label={tr("Address")} optional col="col-sm-8">
                <input className="form-control" value={input.address} maxLength={255} placeholder={tr("City, or the full address")} onChange={(e) => set('address', e.target.value)} />
              </Field>
              <Field label={tr("Guest GSTIN")} optional col="col-sm-4" error={errors.gstin}>
                <input className="form-control text-uppercase" value={input.gstin} maxLength={20} onChange={(e) => set('gstin', e.target.value)} />
              </Field>
              <Field label={tr("Company")} optional col="col-sm-6">
                <PmsSelect value={input.companyId ?? ''} onChange={(e) => set('companyId', e.target.value || null)}>
                  <option value="">{tr("Walk-in guest")}</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </PmsSelect>
              </Field>
              <Field label={tr("Room")} optional col="col-sm-3 col-6">
                <input className="form-control" value={input.roomNo} maxLength={20} placeholder="e.g. 205" onChange={(e) => set('roomNo', e.target.value)} />
              </Field>
              <Field label={tr("Persons")} optional col="col-sm-3 col-6" error={errors.persons}>
                <input type="number" className="form-control" min={1} max={99} value={input.persons ?? ''} onChange={(e) => set('persons', e.target.value.trim() ? toInt(e.target.value, 1) : null)} />
              </Field>
              <Field label={tr("Arrived")} optional col="col-sm-6">
                <PmsDate type="datetime-local" value={toLocal(input.arrivalAt)} onChange={(e) => set('arrivalAt', fromLocal(e.target.value))} />
              </Field>
              <Field label={tr("Left")} optional col="col-sm-6" error={errors.departureAt}>
                <PmsDate type="datetime-local" value={toLocal(input.departureAt)} onChange={(e) => set('departureAt', fromLocal(e.target.value))} />
              </Field>
            </div>
          </FormSection>
        </div>

        <div className={stepClass(1)}>
          {errors.charges && <div className="field-error mb-2">{errors.charges}</div>}
          <div className="sh-two">
            <FormSection icon="building" title={tr("Hotel")} hint="Room, extra bed, laundry, paid-outs and GST, as on the hotel invoice.">
              <div className="row g-3">
                <Field label={tr("Plan")}>{planSelect(input.hotel.plan, (v) => setHotel({ plan: toPlan(v) }), 'Plan')}</Field>
                <Field label={tr("Room (tariff)")} col="col-6"><RupeeInput paise={input.hotel.roomPaise} onChange={(p) => setHotel({ roomPaise: p })} /></Field>
                <Field label={tr("Plan amount")} col="col-6"><RupeeInput paise={input.hotel.planPaise} onChange={(p) => setHotel({ planPaise: p })} /></Field>
                <Field label={tr("Extra bed")} col="col-6"><RupeeInput paise={input.hotel.extraBedPaise} onChange={(p) => setHotel({ extraBedPaise: p })} /></Field>
                <Field label={tr("Laundry")} col="col-6"><RupeeInput paise={input.hotel.laundryPaise} onChange={(p) => setHotel({ laundryPaise: p })} /></Field>
                <Field label={tr("V.P.O. (paid out)")} col="col-6"><RupeeInput paise={input.hotel.vpoPaise} onChange={(p) => setHotel({ vpoPaise: p })} /></Field>
                <Field label={tr("GST (CGST + SGST)")} col="col-6"><RupeeInput paise={input.hotel.gstPaise} onChange={(p) => setHotel({ gstPaise: p })} /></Field>
                <Field label={tr("Paid by")}>{modeSelect(input.hotel.mode, (m) => setHotel({ mode: m }))}</Field>
              </div>
              <div className="bm-subtotal">{tr("Hotel total")} <strong>{formatINR(hTotal)}</strong></div>
            </FormSection>

            <FormSection icon="cup-hot" title={tr("Food")} hint={`What the guest was billed by ${billingHotel.foodName}, before and with GST.`}>
              <div className="row g-3">
                <Field label={tr("Food amount")} col="col-6"><RupeeInput paise={input.food.foodPaise} onChange={(p) => setFood({ foodPaise: p })} /></Field>
                <Field label={tr("Plan amount")} col="col-6"><RupeeInput paise={input.food.planPaise} onChange={(p) => setFood({ planPaise: p })} /></Field>
                <Field label={tr("Laundry")} col="col-6"><RupeeInput paise={input.food.laundryPaise} onChange={(p) => setFood({ laundryPaise: p })} /></Field>
                <Field label={tr("GST (CGST + SGST)")} col="col-6"><RupeeInput paise={input.food.gstPaise} onChange={(p) => setFood({ gstPaise: p })} /></Field>
                <Field label={tr("Paid by")}>{modeSelect(input.food.mode, (m) => setFood({ mode: m }))}</Field>
              </div>
              <div className="bm-subtotal">{tr("Food total")} <strong>{formatINR(fTotal)}</strong></div>
            </FormSection>
          </div>
        </div>

        <div className={stepClass(2)}>
          <FormSection
            icon="moon-stars"
            title={tr("Nights, plan and people")}
            hint="Filled from the invoice and the arrival and departure. If the plan or the number of people changed during the stay, split it: each part is priced at its own plan and people, night by night, at the rate in force that night."
            row
          >
            {errors.stay && <div className="field-error mb-2">{errors.stay}</div>}
            <div className="bm-stay">
              <div className="bm-stay-head" aria-hidden="true">
                <span>{tr("From night of")}</span><span>{tr("Until morning of")}</span><span>{tr("Plan")}</span><span>{tr("Persons")}</span><span>{tr("Nights × rate")}</span><span className="text-end">{tr("Owed")}</span><span />
              </div>
              <div>
                {input.stay.map((s, i) => {
                  const p = priced.segments[i];
                  return (
                    <div key={i} className="bm-stay-row">
                      <PmsDate type="date" aria-label={tr("From the night of")} value={s.from} onChange={(e) => setPart(i, { from: e.target.value })} />
                      <PmsDate type="date" aria-label={tr("Until the morning of")} value={s.to} onChange={(e) => setPart(i, { to: e.target.value })} />
                      {planSelect(s.plan, (v) => setPart(i, { plan: toPlan(v) }), 'Plan')}
                      <input type="number" className="form-control" min={1} max={99} aria-label={tr("Persons")} value={s.persons} onChange={(e) => setPart(i, { persons: toInt(e.target.value, 1) })} />
                      <span className="bm-stay-calc">{nightsBetween(s.from, s.to)} {nightsBetween(s.from, s.to) === 1 ? tr("night") : tr("nights")} × {p?.ratePaise === null ? tr("changing rate") : formatINR(p?.ratePaise ?? 0)}</span>
                      <strong className="bm-stay-amt">{formatINR(p?.amountPaise ?? 0)}</strong>
                      <RemoveButton title={tr("Remove this part")} aria-label={tr("Remove this part")} onClick={() => set('stay', input.stay.filter((_, n) => n !== i))} />
                    </div>
                  );
                })}
              </div>
              <div className="bm-stay-actions">
                <Button variant="outline" size="sm" onClick={() => set('stay', [...input.stay, { from: input.stay.at(-1)?.to ?? input.billDate, to: input.stay.at(-1)?.to ?? input.billDate, plan: input.hotel.plan, persons: input.persons ?? 1 }])}>
                  <i className="bi bi-scissors" /> {tr("Plan or people changed")}
                </Button>
                {/* check-shared-ignore: a text link inside the form, not a toolbar button */}
                <button type="button" className="sh-link-btn" onClick={() => set('stay', stayFromDates(input))}>
                  <i className="bi bi-arrow-counterclockwise" /> {tr("Rebuild from the dates")}
                </button>
              </div>
              <div className="bm-stay-notes" />
              <div className="bm-stay-total">
                <span>{tr("Owed to")} {billingHotel.foodName} {tr("for the plan's meals")}<small>{tr("Kept apart from the guest's bill; the bill still matches the invoice.")}</small></span>
                <strong>{formatINR(priced.totalPaise)}</strong>
              </div>
            </div>
          </FormSection>
        </div>

        <div className={stepClass(3)}>
          <FormSection icon="telephone" title={tr("Reference")} hint="Who to speak to about this bill.">
            <div className="row g-3">
              <Field label={tr("Reference name")} optional col="col-sm-6">
                <input className="form-control" value={input.referenceName} maxLength={100} onChange={(e) => set('referenceName', e.target.value)} />
              </Field>
              <Field label={tr("Reference mobile")} optional col="col-sm-6" error={errors.referenceMobile}>
                <input className="form-control" value={input.referenceMobile} maxLength={15} inputMode="tel" onChange={(e) => set('referenceMobile', e.target.value)} />
              </Field>
              <Field label={tr("Instruction")} optional>
                <Textarea rows={3} placeholder={tr("Anything the front desk or accounts should know")} value={input.instruction} onChange={(e) => set('instruction', e.target.value)} />
              </Field>
            </div>
          </FormSection>
        </div>
      </div>
    </Modal>
  );
}
