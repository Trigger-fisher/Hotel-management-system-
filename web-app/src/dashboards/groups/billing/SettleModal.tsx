'use client';
// Settle a debit bill as Pallav's pop-up (bill_master/_settle-fields): what is owed, one row per payment received (up to five),
// the reference. Paying more than is owed is allowed; the extra is kept as an advance.
import { useState } from 'react';

import { formatDate, formatINR } from '@shared/dashboards/format';
import { MAX_INSTALLMENTS, billingCopy, emptyInstallment, settlementReceived, validateSettle, type Bill, type Installment, type SettleInput } from '@shared/dashboards/billing';

import { useAsync, useSubmit, useToast } from '@/components/ui';
import { Button, Field, FootTotal, FormSection, Modal, RupeeInput, PmsSelect, PmsDate, ConflictNote, Textarea, RemoveButton } from '../../pallav/ui';
import { billingApi } from './api';

import { tr, trf } from '@/lib/i18n/language';
export function SettleModal(props: { bill: Bill; onClose: () => void; onSaved: (b: Bill) => void; onReload?: () => void }) {
  const b = props.bill;
  // H6 part payments: a bill that still owes after a settlement takes more instalments; what was received stays, the reference is prefilled
  const already = b.settlement?.installments.length ?? 0;
  const more = already > 0;
  const sc = billingCopy.bills.settle;
  const [input, setInput] = useState<SettleInput>({ installments: [emptyInstallment()], referenceName: b.settlement?.referenceName ?? '', referenceMobile: b.settlement?.referenceMobile ?? '', instruction: b.settlement?.instruction ?? '', version: b.version });
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { busy, errors: serverErrors, conflict, submit } = useSubmit(['referenceMobile', 'installments', ...input.installments.map((_, i) => `inst.${i}`)]);
  const errors = { ...localErrors, ...serverErrors };
  const toast = useToast();
  const options = useAsync(() => billingApi.getBillingOptions(), []);
  const modes = options.state.status === 'ready' ? options.state.data.paymentModes : [];

  const setRow = (i: number, patch: Partial<Installment>) =>
    setInput((p) => ({ ...p, installments: p.installments.map((x, n) => (n === i ? { ...x, ...patch } : x)) }));
  const hotelIn = input.installments.reduce((n, x) => n + x.hotelPaise, 0);
  const foodIn = input.installments.reduce((n, x) => n + x.foodPaise, 0);
  const owed = b.balanceHotelPaise + b.balanceFoodPaise;
  const over = Math.max(0, hotelIn - b.balanceHotelPaise) + Math.max(0, foodIn - b.balanceFoodPaise);
  const left = Math.max(0, b.balanceHotelPaise - hotelIn) + Math.max(0, b.balanceFoodPaise - foodIn);

  const save = () => {
    const local = validateSettle(input, { alreadyRecorded: already });
    setLocalErrors(local);
    if (Object.keys(local).length) return;
    void submit(() => billingApi.settleBill(b.id, input), (x) => {
      toast.show({ tone: 'success', text: more ? billingCopy.bills.toast.payment : billingCopy.bills.toast.settled });
      props.onSaved(x);
    });
  };

  const modeSelect = (value: string | null, onChange: (m: string | null) => void) => (
    <PmsSelect value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{tr("None")}</option>
      {(value && !modes.includes(value) ? [...modes, value] : modes).map((m) => <option key={m} value={m}>{m}</option>)}
    </PmsSelect>
  );

  return (
    <Modal
      open
      scrollable={false}
      size="lg"
      className="pay-form-modal sh-modal bm-modal"
      staticBackdrop
      eyebrow={more ? sc.moreEyebrow : 'Debit · Settle'}
      title={more ? sc.moreTitle(b.billNo) : sc.title(b.billNo)}
      onClose={props.onClose}
      onSubmit={save}
      footerClass="sh-modal-foot"
      footer={
        <>
          <FootTotal label={tr("Received")} paise={hotelIn + foodIn} />
          <Button variant="ghost" onClick={props.onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" icon="check2" disabled={busy}>{busy ? tr("Saving…") : more ? sc.more : sc.save}</Button>
        </>
      }
    >
      {conflict && <ConflictNote onReload={props.onReload ?? props.onClose} />}
      <FormSection icon="cash-stack" title={tr("What is owed")} hint={`${b.guestName}${b.companyName ? ` · ${b.companyName}` : ''} · billed ${b.billDate ? formatDate(b.billDate) : '-'}`}>
        <div className="bm-owed">
          <div><span>{tr("Hotel")}</span><strong>{formatINR(b.balanceHotelPaise)}</strong></div>
          <div><span>{tr("Food")}</span><strong>{formatINR(b.balanceFoodPaise)}</strong></div>
          <div className="all"><span>{tr("In all")}</span><strong>{formatINR(owed)}</strong></div>
          {more ? <div><span>{sc.alreadyReceived}</span><strong>{formatINR(settlementReceived(b.settlement))}</strong></div> : null}
        </div>
      </FormSection>

      <FormSection icon="calendar-check" title={tr("Money received")} hint={more ? sc.moreHint : sc.hint} row>
        <div className="bm-installments">
          {input.installments.map((row, i) => (
            <div key={i} className="bm-inst">
              <div className="bm-inst-head">
                <span className="bm-inst-no">{i + 1}</span>
                <span>{tr("Installment")} {i + 1}</span>
                {i > 0 && (
                  <RemoveButton className="ms-auto" title={tr("Remove this installment")} aria-label={trf("Remove installment {0}", [i + 1])}
                    onClick={() => setInput((p) => ({ ...p, installments: p.installments.filter((_, n) => n !== i) }))} />
                )}
              </div>
              <div className="row g-2">
                <Field label={tr("Received on")} required={i === 0} col="col-sm-4" error={errors[`inst.${i}`]}>
                  <PmsDate type="date" value={row.date} onChange={(e) => setRow(i, { date: e.target.value })} />
                </Field>
                <Field label={tr("Hotel")} col="col-sm-4 col-6"><RupeeInput paise={row.hotelPaise} placeholder="0.00" onChange={(p) => setRow(i, { hotelPaise: p })} /></Field>
                <Field label={tr("Food")} col="col-sm-4 col-6"><RupeeInput paise={row.foodPaise} placeholder="0.00" onChange={(p) => setRow(i, { foodPaise: p })} /></Field>
                <Field label={tr("Hotel paid by")} col="col-sm-6">{modeSelect(row.hotelMode, (m) => setRow(i, { hotelMode: m }))}</Field>
                <Field label={tr("Food paid by")} col="col-sm-6">{modeSelect(row.foodMode, (m) => setRow(i, { foodMode: m }))}</Field>
              </div>
            </div>
          ))}
        </div>
        {already + input.installments.length < MAX_INSTALLMENTS && (
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setInput((p) => ({ ...p, installments: [...p.installments, emptyInstallment()] }))}>
            <i className="bi bi-plus-lg" /> {tr("Add installment")}
          </Button>
        )}
        {errors.installments && <div className="field-error mt-2">{errors.installments}</div>}
      </FormSection>

      <FormSection icon="telephone" title={tr("Reference")} hint="Who arranged the payment.">
        <div className="row g-3">
          <Field label={tr("Reference name")} optional col="col-sm-6">
            <input className="form-control" maxLength={100} value={input.referenceName} onChange={(e) => setInput((p) => ({ ...p, referenceName: e.target.value }))} />
          </Field>
          <Field label={tr("Reference mobile")} optional col="col-sm-6" error={errors.referenceMobile}>
            <input className="form-control" maxLength={15} inputMode="tel" value={input.referenceMobile} onChange={(e) => setInput((p) => ({ ...p, referenceMobile: e.target.value }))} />
          </Field>
          <Field label={tr("Instruction")} optional>
            <Textarea rows={2} placeholder={tr("Cheque number, transfer reference, anything accounts should know")} value={input.instruction} onChange={(e) => setInput((p) => ({ ...p, instruction: e.target.value }))} />
          </Field>
        </div>
      </FormSection>

      {(left > 0 || over > 0) && (
        <div className="bm-left">
          {left > 0 ? `Still to receive: ${formatINR(left)}` : ''}
          {left > 0 && over > 0 ? ' · ' : ''}
          {over > 0 ? `Over what is owed: ${formatINR(over)}, kept as an advance` : ''}
        </div>
      )}
    </Modal>
  );
}
