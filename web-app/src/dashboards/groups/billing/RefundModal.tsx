'use client';
// Refund what is left of an advance as Pallav's pop-up (bill_master/_refund-fields). Neither side can go past its balance.
import { useState } from 'react';

import { formatDate, formatINR } from '@shared/dashboards/format';
import { billingCopy, emptyRefundInput, validateRefund, type Advance, type RefundInput } from '@shared/dashboards/billing';

import { useAsync, useSubmit, useToast } from '@/components/ui';
import { Button, Field, FootTotal, FormSection, Modal, RupeeInput, PmsSelect, PmsDate, ConflictNote, Textarea } from '../../pallav/ui';
import { billingApi } from './api';

import { tr, trf } from '@/lib/i18n/language';
const t = billingCopy.advances;

export function RefundModal(props: { advance: Advance; onClose: () => void; onSaved: (a: Advance) => void; onReload?: () => void }) {
  const a = props.advance;
  const [input, setInput] = useState<RefundInput>(() => emptyRefundInput(a));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { busy, errors: serverErrors, conflict, submit } = useSubmit(['date', 'hotelPaise', 'foodPaise', 'toMobile']);
  const errors = { ...localErrors, ...serverErrors };
  const toast = useToast();
  const options = useAsync(() => billingApi.getBillingOptions(), []);
  const modes = options.state.status === 'ready' ? options.state.data.paymentModes : [];
  const set = <K extends keyof RefundInput>(key: K, value: RefundInput[K]) => setInput((p) => ({ ...p, [key]: value }));

  const save = () => {
    const local = validateRefund(input, a);
    setLocalErrors(local);
    if (Object.keys(local).length) return;
    void submit(() => billingApi.refundAdvance(a.id, input), (x) => {
      toast.show({ tone: 'success', text: t.toast.refunded });
      props.onSaved(x);
    });
  };

  const modeSelect = (value: string | null, onChange: (m: string | null) => void) => (
    <PmsSelect value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{tr("None")}</option>
      {(value && !modes.includes(value) ? [...modes, value] : modes).map((m) => <option key={m} value={m}>{m}</option>)}
    </PmsSelect>
  );
  const sub = `${a.guestName}${a.roomNo ? ` · Room ${a.roomNo}` : ''} · paid ${formatINR(a.hotelPaise + a.foodPaise)} on ${formatDate(a.paymentDate)}`;

  return (
    <Modal
      open
      scrollable={false}
      size="lg"
      className="pay-form-modal sh-modal bm-modal"
      staticBackdrop
      eyebrow="Guest Advances · Refund"
      title={trf("Refund {0}", [a.receiptNo])}
      onClose={props.onClose}
      onSubmit={save}
      footerClass="sh-modal-foot"
      footer={
        <>
          <FootTotal label={tr("Refund total")} paise={(input.hotelPaise ?? 0) + (input.foodPaise ?? 0)} />
          <Button variant="ghost" onClick={props.onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" icon="check2" disabled={busy}>{busy ? tr("Saving…") : tr("Process Refund")}</Button>
        </>
      }
    >
      {conflict && <ConflictNote onReload={props.onReload ?? props.onClose} />}
      <FormSection icon="safe" title={tr("What is left to give back")} hint={sub}>
        <div className="bm-owed">
          <div><span>{tr("Hotel")}</span><strong>{formatINR(a.hotelBalancePaise)}</strong></div>
          <div><span>{tr("Food")}</span><strong>{formatINR(a.foodBalancePaise)}</strong></div>
          <div className="all"><span>{tr("In all")}</span><strong>{formatINR(a.hotelBalancePaise + a.foodBalancePaise)}</strong></div>
        </div>
      </FormSection>

      <FormSection icon="arrow-return-left" title={tr("The refund")} hint="How much goes back on each side, and how it is paid.">
        <div className="sh-two">
          <div className="row g-3">
            <Field label={tr("Hotel refund")} error={errors.hotelPaise}>
              <RupeeInput paise={input.hotelPaise ?? 0} placeholder="0.00" disabled={a.hotelBalancePaise <= 0} onChange={(p) => set('hotelPaise', p || null)} />
              <div className="form-text">{tr("Up to")} {formatINR(a.hotelBalancePaise)}</div>
            </Field>
            <Field label={tr("Paid back by")}>{modeSelect(input.hotelMode, (m) => set('hotelMode', m))}</Field>
          </div>
          <div className="row g-3">
            <Field label={tr("Food refund")} error={errors.foodPaise}>
              <RupeeInput paise={input.foodPaise ?? 0} placeholder="0.00" disabled={a.foodBalancePaise <= 0} onChange={(p) => set('foodPaise', p || null)} />
              <div className="form-text">{tr("Up to")} {formatINR(a.foodBalancePaise)}</div>
            </Field>
            <Field label={tr("Paid back by")}>{modeSelect(input.foodMode, (m) => set('foodMode', m))}</Field>
          </div>
        </div>
      </FormSection>

      <FormSection icon="person-check" title={tr("Paid back to")} hint="Who took the money, and when.">
        <div className="row g-3">
          <Field label={tr("Refund date")} required col="col-sm-4" error={errors.date}>
            <PmsDate type="date" value={input.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label={tr("Name")} optional col="col-sm-4">
            <input className="form-control" maxLength={255} value={input.toName} onChange={(e) => set('toName', e.target.value)} />
          </Field>
          <Field label={tr("Mobile number")} optional col="col-sm-4" error={errors.toMobile}>
            <input className="form-control" maxLength={15} inputMode="tel" value={input.toMobile} onChange={(e) => set('toMobile', e.target.value)} />
          </Field>
          <Field label={tr("Instruction")} optional>
            <Textarea rows={2} maxLength={255} placeholder={tr("Why it is being refunded, or anything accounts should know")} value={input.note} onChange={(e) => set('note', e.target.value)} />
          </Field>
        </div>
      </FormSection>
    </Modal>
  );
}
