'use client';

// Bootstrap's modal, written the way Pallav's Blade writes it, without Bootstrap's JavaScript.
//   <div class="modal fade"><div class="modal-dialog modal-lg"><div class="modal-content">
//     <div class="modal-header"><h5 class="modal-title">..</h5><button class="btn-close"></button></div>
//     <div class="modal-body">..</div><div class="modal-footer">..</div></div></div></div>
// `.pms-modal` is added because pms.js (wireModals) adds it to every `.modal` at load. A form (onSubmit) sits inside `.modal-content`
// around header, body and footer, as bill_master/_modal and the other Blade form modals do.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { showMissingRequired } from './requiredCheck';

import { tr, trn } from '@/lib/i18n/language';
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** The `h5.modal-title`. Not needed when `header` draws the whole left side of the header. */
  title?: ReactNode;
  /**
   * The left side of `.modal-header` in place of the eyebrow + `h5.modal-title`, for a Blade header of its own shape (users/index: avatar,
   * name, a muted line). Given a function, it receives the id to put on its `h5.modal-title` (the dialog's accessible name).
   */
  header?: ReactNode | ((titleId: string) => ReactNode);
  /** modal-sm / (default) / modal-lg / modal-xl */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Extra classes on the outer `.modal`, where Pallav's Blade puts them (pay-form-modal, sh-modal, bm-modal, cb-modal ...): its CSS reads them from there. */
  className?: string;
  /** data-bs-backdrop="static": a click outside does not close it. */
  staticBackdrop?: boolean;
  /** `.modal-dialog-centered`. Default on (most Blade modals); pass false where the Blade has none (e.g. users/index account modal). */
  centered?: boolean;
  /** `.modal-dialog-scrollable`. Default on; pass false where the Blade has none (bill_master/_modal, users/access forms). */
  scrollable?: boolean;
  footer?: ReactNode;
  /** Small line above the title (`.pms-eyebrow`, as Pallav's Guest Billing forms). */
  eyebrow?: ReactNode;
  /** Extra class on `.modal-footer` (sh-modal-foot). */
  footerClass?: string;
  /** Wraps header, body and footer in a <form>, as the Blade forms do. */
  onSubmit?: () => void;
  children: ReactNode;
}

const FIELDS =
  'input:not([type=hidden]):not([type=file]):not([data-no-autofocus]):not(:disabled), select:not(:disabled), textarea:not(:disabled)';
const TABBABLE = `${FIELDS}, button:not(:disabled), a[href]`;

export function Modal({ open, onClose, title, header, size = 'md', className = '', staticBackdrop = false, centered = true, scrollable = true, footer, eyebrow, footerClass = '', onSubmit, children }: ModalProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.classList.add('modal-open');
    // The first real field gets focus, as pms.js does on shown.bs.modal.
    const first = dialog.current?.querySelector<HTMLElement>('.modal-body input:not([type=hidden]):not([type=file]):not([data-no-autofocus]):not(:disabled), .modal-body select:not(:disabled), .modal-body textarea:not(:disabled)');
    (first ?? dialog.current?.querySelector<HTMLElement>('.btn-close'))?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // Bootstrap's static backdrop only stops a click outside; Escape still closes (data-bs-keyboard stays true).
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
      if (e.key === 'Tab' && dialog.current) {
        const items = [...dialog.current.querySelectorAll<HTMLElement>(TABBABLE)].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z?.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (!document.querySelector('.modal.show')) document.body.classList.remove('modal-open');
      previous?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  // Class order as most Blade views write it: modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable.
  const dialogClass = `modal-dialog${size === 'md' ? '' : ` modal-${size}`}${centered ? ' modal-dialog-centered' : ''}${scrollable ? ' modal-dialog-scrollable' : ''}`;
  const titleBlock =
    header !== undefined ? (
      typeof header === 'function' ? header(titleId) : header
    ) : eyebrow ? (
      <div>
        <h5 className="modal-title" id={titleId}>
          {trn(title)}
        </h5>
        <div className="pms-eyebrow">{eyebrow}</div>
      </div>
    ) : (
      <h5 className="modal-title" id={titleId}>
        {trn(title)}
      </h5>
    );
  const wrap = (body: ReactNode) =>
    onSubmit ? (
      <form
        noValidate
        // Bootstrap's scrollable dialog scrolls `.modal-body` inside `.modal-content` (a flex column). A form wrapped around header, body and footer
        // sits in between: make it the flex column too, so a tall form scrolls its body and the footer stays in view (phones).
        style={scrollable ? { display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '100%' } : undefined}
        onSubmit={(e) => {
          e.preventDefault();
          // Early check (R46): a Save with a required field empty says which one and sends nothing. A step form checks the step on screen only.
          const form = e.currentTarget;
          if (!showMissingRequired(form.querySelector('.form-step.active') ?? form)) return;
          onSubmit();
        }}
      >
        {body}
      </form>
    ) : (
      body
    );
  return createPortal(
    <>
      <div
        className={`modal fade show pms-modal d-block ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        // Early check for every step form, however it counts its steps: Continue stops while a required field of the step on screen is empty.
        onClickCapture={(e) => {
          const button = e.target instanceof Element ? e.target.closest('button') : null;
          if (!button || button.type === 'submit' || !/^\s*Continue\b/.test(button.textContent ?? '')) return;
          const step = e.currentTarget.querySelector('.form-step.active');
          if (step && !showMissingRequired(step)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !staticBackdrop) onClose();
        }}
      >
        <div className={dialogClass} ref={dialog}>
          <div className="modal-content">
            {wrap(
              <>
                <div className="modal-header">
                  {titleBlock}
                  <button type="button" className="btn-close" aria-label={tr("Close")} onClick={onClose} />
                </div>
                <div className="modal-body">{children}</div>
                {footer && <div className={`modal-footer ${footerClass}`.trim()}>{footer}</div>}
              </>,
            )}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>,
    document.body,
  );
}
