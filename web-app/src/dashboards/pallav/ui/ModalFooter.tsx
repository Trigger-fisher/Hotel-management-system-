'use client';

// The footer of a form modal: a quiet Cancel on the left and the main button on the right, with its "Saving…" state.
// Pass it to `<Modal footer={...}>`; the main button submits the Modal's form (`onSubmit` on the Modal) unless `onConfirm` is set.
import type { ReactNode } from 'react';

import { Bi } from '../Bi';

import { tr } from '@/lib/i18n/language';
export interface ModalFooterProps {
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  icon?: string;
  /** Red main button (delete, remove). */
  danger?: boolean;
  /** Without it the main button is a submit button of the Modal's form. */
  onConfirm?: () => void;
  /** Hide the Cancel button when omitted. */
  onCancel?: () => void;
  cancelLabel?: string;
  /** Extra content on the left, before Cancel (for example a "Back" button of a wizard). */
  before?: ReactNode;
}

export function ModalFooter({ confirmLabel, busyLabel, busy = false, disabled = false, icon, danger = false, onConfirm, onCancel, cancelLabel = 'Cancel', before }: ModalFooterProps) {
  return (
    <>
      {before}
      {onCancel ? (
        <button type="button" className="btn btn-ghost me-auto" onClick={onCancel} disabled={busy}>
          {tr(cancelLabel)}
        </button>
      ) : null}
      <button type={onConfirm ? 'button' : 'submit'} className={danger ? 'btn btn-danger' : 'btn btn-p'} onClick={onConfirm} disabled={busy || disabled}>
        {icon ? <Bi name={icon} /> : null} {tr(busy && busyLabel ? busyLabel : confirmLabel)}
      </button>
    </>
  );
}
