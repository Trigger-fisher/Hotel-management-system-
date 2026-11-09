'use client';
// New / Edit Advance as Pallav's pop-up (bill_master/_advance-modal + _advance-fields): one scrolling form in sections, Cancel and Save below.
import { useState } from 'react';

import { formatINR } from '@shared/dashboards/format';
import { advanceToInput, billingCopy, billingHotel, currentYear, emptyAdvanceInput, validateAdvance, type Advance, type AdvanceCovers, type AdvanceInput, type BillingCompany } from '@shared/dashboards/billing';

import { useAsync, useSubmit, useToast } from '@/components/ui';
import { AmountTile, Button, Field, FormSection, Modal, PickGroup, PmsSelect, PmsDate, wordsOf, ConflictNote, Textarea } from '../../pallav/ui';
import { billingApi } from './api';

import { tr, trf } from '@/lib/i18n/language';
const t = billingCopy.advances;
const FIELDS = ['receiptNo', 'paymentDate', 'guestName', 'mobile', 'hotelPaise', 'foodPaise', 'referenceMobile', 'instruction'];

/** `onReload` runs after "Refresh" on the someone-else-changed-this note: close and load the current advance. */
export function AdvanceFormModal(props: { advance: Advance | null; onClose: () => void; onSaved: (a: Advance) => void; onReload?: () => void }) {
  const a = props.advance;
  const isNew = a === null;
  const [input, setInput] = useState<AdvanceInput>(() => (a ? advanceToInput(a) : emptyAdvanceInput()));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { busy, errors: serverErrors, conflict, submit } = useSubmit(FIELDS);
  const errors = { ...localErrors, ...serverErrors };
  const toast = useToast();
  const companyList = useAsync(() => billingApi.listCompanies(), []);
  const options = useAsync(() => billingApi.getBillingOptions(), []);
  const companies: BillingCompany[] = companyList.state.status === 'ready' ? companyList.state.data : [];
  const modes = options.state.status === 'ready' ? options.state.data.paymentModes : [];

  const set = <K extends keyof AdvanceInput>(key: K, value: AdvanceInput[K]) => setInput((p) => ({ ...p, [key]: value }));
  const hotel = input.covers !== 'food';
  const food = input.covers !== 'hotel';
  const total = (hotel ? input.hotelPaise ?? 0 : 0) + (food ? input.foodPaise ?? 0 : 0);

  const save = () => {
    const local = validateAdvance(input, isNew);
    setLocalErrors(local);
    if (Object.keys(local).length) return;
    void submit(
      () => (a ? billingApi.updateAdvance(a.id, input) : billingApi.createAdvance(input)),
      (x) => {
        toast.show({ tone: 'success', text: isNew ? t.toast.created : t.toast.updated });
        props.onSaved(x);
      },
    );
  };

  const modeSelect = (value: string | null, onChange: (m: string | null) => void) => (
    <PmsSelect value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{tr("None")}</option>
      {(value && !modes.includes(value) ? [...modes, value] : modes).map((m) => <option key={m} value={m}>{m}</option>)}
    </PmsSelect>
  );
  const side = (name: 'hotel' | 'food') => {
    const isHotel = name === 'hotel';
    return (
      <FormSection key={name} icon={isHotel ? 'building' : 'cup-hot'} title={trf("{0} amount", [isHotel ? billingHotel.name : billingHotel.foodName])}>
        <div className="row g-3">
          <AmountTile label={tr("Advance")} paise={(isHotel ? input.hotelPaise : input.foodPaise) ?? 0} error={errors[isHotel ? 'hotelPaise' : 'foodPaise']}
            onChange={(p) => set(isHotel ? 'hotelPaise' : 'foodPaise', p || null)} />
          <Field label={tr("Paid by")} col="col-md-6">{modeSelect(isHotel ? input.hotelMode : input.foodMode, (m) => set(isHotel ? 'hotelMode' : 'foodMode', m))}</Field>
        </div>
      </FormSection>
    );
  };

  return (
    <Modal
      open
      className="pay-form-modal cb-modal"
      staticBackdrop
      eyebrow={isNew ? 'Guest Advances · New' : 'Guest Advances · Edit'}
      title={isNew ? 'New advance' : `Edit advance ${a.receiptNo}`}
      onClose={props.onClose}
      onSubmit={save}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" icon="check2" disabled={busy}>{busy ? tr("Saving…") : isNew ? tr("Save advance") : tr("Save changes")}</Button>
        </>
      }
    >
      {conflict && <ConflictNote onReload={props.onReload ?? props.onClose} />}
      <div className="form-section">
        <div className="fs-head"><div className="fs-title"><i className="bi bi-buildings" /> {tr("What is the advance for?")}<span className="req">*</span></div></div>
        <PickGroup<AdvanceCovers> label={tr("What the advance is for")} value={input.covers} onChange={(v) => set('covers', v)} choices={[
          { value: 'hotel', icon: 'building', title: billingHotel.name, text: 'The room' },
          { value: 'food', icon: 'cup-hot', title: billingHotel.foodName, text: 'Food only' },
          { value: 'both', icon: 'plus-circle', title: 'Both', text: 'Room and food' },
        ]} />
      </div>

      <div className="form-section">
        <div className="fs-head"><div className="fs-title"><i className="bi bi-receipt-cutoff" /> {tr("Receipt and date")}</div></div>
        <div className="row g-3">
          <Field label={tr("Receipt number")} required col="col-md-6" error={errors.receiptNo}>
            {isNew ? (
              <>
                <div className="input-group">
                  <span className="input-group-text">{currentYear()} /</span>
                  <input className="form-control" value={input.receiptNo} maxLength={50} placeholder="814" onChange={(e) => set('receiptNo', e.target.value)} />
                </div>
                <div className="form-text">{tr("The year is added in front for you.")}</div>
              </>
            ) : (
              <>
                <input className="form-control" value={input.receiptNo} readOnly tabIndex={-1} />
                <div className="form-text">{tr("Cannot be changed once recorded.")}</div>
              </>
            )}
          </Field>
          <Field label={tr("Paid on")} required col="col-md-6" error={errors.paymentDate}>
            <PmsDate type="date" value={input.paymentDate} onChange={(e) => set('paymentDate', e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="form-section">
        <div className="fs-head"><div className="fs-title"><i className="bi bi-person" /> {tr("Guest and company")}</div></div>
        <div className="row g-3">
          <Field label={tr("Guest name")} required col="col-md-6" error={errors.guestName}>
            <input className="form-control" value={input.guestName} maxLength={255} onChange={(e) => set('guestName', e.target.value)} />
          </Field>
          <Field label={tr("Mobile number")} optional col="col-md-6" error={errors.mobile}>
            <input className="form-control" value={input.mobile} maxLength={15} inputMode="tel" onChange={(e) => set('mobile', e.target.value)} />
          </Field>
          <Field label={tr("Company")} col="col-md-6">
            <PmsSelect value={input.companyId ?? ''} onChange={(e) => set('companyId', e.target.value || null)}>
              <option value="">{tr("Walk-in guest")}</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </PmsSelect>
          </Field>
          <Field label={tr("Room number")} optional col="col-md-6">
            <input className="form-control" value={input.roomNo} maxLength={20} placeholder="e.g. 103" onChange={(e) => set('roomNo', e.target.value)} />
          </Field>
        </div>
      </div>

      {hotel && side('hotel')}
      {food && side('food')}

      {input.covers === 'both' && (
        <div className="ex-total">
          <span className="ex-total-label">{tr("Advance total")}</span>
          <span className="ex-total-words">{wordsOf(total)}</span>
          <span className="ex-total-value">{formatINR(total)}</span>
        </div>
      )}

      <FormSection icon="telephone" title={tr("Reference")} hint="Optional. Who to speak to about this advance.">
        <div className="row g-3">
          <Field label={tr("Reference name")} col="col-md-6">
            <input className="form-control" value={input.referenceName} maxLength={255} onChange={(e) => set('referenceName', e.target.value)} />
          </Field>
          <Field label={tr("Reference mobile")} col="col-md-6" error={errors.referenceMobile}>
            <input className="form-control" value={input.referenceMobile} maxLength={15} inputMode="tel" onChange={(e) => set('referenceMobile', e.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection icon="chat-left-text" title={tr("Instruction")}>
        <label className="form-label visually-hidden" htmlFor="adv-instruction">{tr("Instruction")}</label>
        <Textarea id="adv-instruction" rows={2} maxLength={255} placeholder={tr("Anything the front desk should know (optional)")} value={input.instruction} onChange={(e) => set('instruction', e.target.value)} />
        {errors.instruction && <div className="field-error">{errors.instruction}</div>}
      </FormSection>
    </Modal>
  );
}
