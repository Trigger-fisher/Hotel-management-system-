'use client';

// Pallav's confirmation dialog (pms-ui.js confirmDialog): it names the action on its button, is red for a destructive
// one, and focus starts on Cancel so a stray Enter never deletes anything.
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { tr } from '@/lib/i18n/language';
export interface DialogProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger' | 'warning';
  icon?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ICONS = { danger: 'trash3', warning: 'exclamation-triangle', primary: 'question-circle' } as const;

export function Dialog({ open, title, message, confirmLabel = 'Continue', cancelLabel = 'Cancel', tone = 'primary', icon, busy = false, onConfirm, onCancel }: DialogProps) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const cancelFn = useRef(onCancel);
  useEffect(() => {
    cancelFn.current = onCancel;
  });
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.classList.add('pms-dialog-open');
    cancel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelFn.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('pms-dialog-open');
      previous?.focus?.({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div
      className="pms-dialog-backdrop in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={`pms-dialog tone-${tone}`} role="alertdialog" aria-modal="true" aria-labelledby={`${id}t`} aria-describedby={message ? `${id}m` : undefined}>
        <div className="pd-icon">
          <i className={`bi bi-${icon ?? ICONS[tone]}`} aria-hidden="true" />
        </div>
        <div className="pd-body">
          <h2 className="pd-title" id={`${id}t`}>
            {title}
          </h2>
          {message && (
            <p className="pd-message" id={`${id}m`}>
              {message}
            </p>
          )}
        </div>
        <div className="pd-actions">
          <button type="button" className="btn btn-ghost pd-cancel" ref={cancel} onClick={onCancel} disabled={busy}>
            {tr(cancelLabel)}
          </button>
          <button type="button" className={`btn pd-confirm ${tone === 'danger' ? 'btn-danger-solid' : 'btn-p'}`} onClick={onConfirm} disabled={busy}>
            {busy && <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />}
            {tr(confirmLabel)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
