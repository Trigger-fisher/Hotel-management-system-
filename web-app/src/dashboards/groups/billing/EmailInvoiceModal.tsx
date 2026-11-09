'use client';
// "Email bill" and "Email receipt" (mail work, 17 Oct): a small pop-up with the address (empty = the address the hotel keeps for the guest, or type one), Send, then a
// plain status. The server answers 202 "queued": the mail goes out a moment later through the hotel's own mail server, so the status says queued, never "delivered";
// a failure is shown in Settings > Email as "Last mail failed". Used by the Bills and the Guest Advances screens.
import { useState } from 'react';

import { Button, Field, FormSection, Modal } from '../../pallav/ui';
import { useSubmit } from '@/components/ui';
import { billingApi } from './api';

import { tr, trf } from '@/lib/i18n/language';
export function EmailInvoiceModal(props: { kind: 'bill' | 'advance'; id: string; number: string; guestName: string; onClose: () => void }) {
  const isBill = props.kind === 'bill';
  const [to, setTo] = useState('');
  const [queuedTo, setQueuedTo] = useState<string | null>(null);
  const { busy, errors, submit } = useSubmit(['to']);
  const noun = isBill ? 'bill' : 'receipt';

  const send = () => {
    const address = to.trim();
    void submit(
      () => (isBill ? billingApi.emailBill(props.id, address || undefined) : billingApi.emailAdvance(props.id, address || undefined)),
      (r) => setQueuedTo(r.to),
    );
  };

  return (
    <Modal
      open
      scrollable={false}
      size="sm"
      className="pay-form-modal sh-modal bm-modal"
      staticBackdrop
      eyebrow={isBill ? 'Bills · Email' : 'Guest Advances · Email'}
      title={trf("Email {0} {1}", [noun, props.number])}
      onClose={props.onClose}
      onSubmit={queuedTo ? props.onClose : send}
      footerClass="sh-modal-foot"
      footer={
        queuedTo ? (
          <Button type="submit" icon="check2">{tr("Done")}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={props.onClose} disabled={busy}>{tr("Cancel")}</Button>
            <Button type="submit" icon="envelope" disabled={busy}>{busy ? tr("Sending…") : `Send ${noun}`}</Button>
          </>
        )
      }
    >
      {queuedTo ? (
        <FormSection icon="envelope-check" title={tr("Queued")} hint="Nothing more to do.">
          <p className="mb-2" role="status">
            {tr("The")} {noun} {tr("for")} {props.guestName} {tr("is queued for")} <strong>{queuedTo}</strong> {tr("and goes out within a minute, as a PDF.")}
          </p>
          <p className="text-muted small mb-0">{tr("If it does not arrive, the reason is shown in Settings > Email as “Last mail failed”.")}</p>
        </FormSection>
      ) : (
        <FormSection icon="envelope" title={tr("Send to")} hint={`A PDF of the ${noun} goes to this address.`}>
          <Field label={tr("Email address")} error={errors.to}>
            <input
              type="email"
              inputMode="email"
              autoComplete="off"
              className={`form-control${errors.to ? ' is-invalid' : ''}`}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={tr("Leave empty for the guest's address")}
              maxLength={254}
            />
            <div className="form-text">{tr("Empty: the email the hotel keeps for")} {props.guestName}{tr(". If there is none, type one here.")}</div>
          </Field>
        </FormSection>
      )}
    </Modal>
  );
}
