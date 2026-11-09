'use client';

// Pieces of Pallav's forms (Blade: `.form-section`, `.fs-head`, `.form-label`, `.input-group`, `[data-wizard]`, `.sh-foot-total`).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatINR } from '@shared/dashboards/format';
import { wordsOf } from './money';

import { tr, trn, trf } from '@/lib/i18n/language';
/**
 * `<div class="form-section"><div class="fs-head"><div class="fs-title"><i></i> title</div><div class="fs-hint">..</div></div> ..`
 * With `aside` (or `row`) the head is Blade's `<div class="fs-head sh-fs-row"><div>title + hint</div>aside</div>`; without, title and hint
 * sit straight in `.fs-head`, as the Blade writes them.
 */
export function FormSection({ icon, title, hint, aside, row = false, className = '', children }: { icon: string; title: ReactNode; hint?: ReactNode; aside?: ReactNode; /** `.sh-fs-row` head even with no aside (bill_master/_settle-fields "Money received"). */ row?: boolean; className?: string; children: ReactNode }) {
  const head = (
    <>
      <div className="fs-title">
        <i className={`bi bi-${icon}`} /> {trn(title)}
      </div>
      {hint && <div className="fs-hint">{trn(hint)}</div>}
    </>
  );
  return (
    <div className={`form-section ${className}`.trim()}>
      {aside || row ? (
        <div className="fs-head sh-fs-row">
          <div>{head}</div>
          {aside}
        </div>
      ) : (
        <div className="fs-head">{head}</div>
      )}
      {children}
    </div>
  );
}

/** A labelled field in Bootstrap's grid: `col` is the column classes ("col-sm-6"). The message draws as Pallav's `.field-error`. */
/**
 * Links a field's label to its control: the first visible input, select or textarea inside `box` gets an id unless it has one (or `skip`), the
 * label points at it, and an error becomes the control's description. Runs after every render (the control may change); flatpickr date boxes are
 * linked by PmsDate itself once they exist.
 */
export function useLabelLink(box: React.RefObject<HTMLElement | null>, error: string | undefined, skip = false): string {
  const base = useId();
  const errId = `${base}-err`;
  useEffect(() => {
    if (skip) return;
    const control = box.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea');
    if (!control) return;
    if (!control.id) control.id = `${base}-c`;
    box.current?.querySelector('label')?.setAttribute('for', control.id);
    // a control's own description (data-describedby) stays beside the error's
    const ids = [error ? errId : null, control.getAttribute('data-describedby')].filter(Boolean).join(' ');
    if (error) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
    if (ids) control.setAttribute('aria-describedby', ids);
    else control.removeAttribute('aria-describedby');
  });
  return errId;
}

export function Field({ label, col = 'col-12', optional = false, required = false, error, children }: { label: ReactNode; col?: string; optional?: boolean; required?: boolean; error?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const errId = useLabelLink(box, error);
  return (
    <div className={col} ref={box}>
      <label className="form-label">
        {trn(label)}
        {required && <span className="req">*</span>}
        {optional && (
          <>
            {' '}
            <span className="wz-optional">{tr("optional")}</span>
          </>
        )}
      </label>
      {children}
      {error && <div className="field-error" id={errId} role="alert">{tr(error)}</div>}
    </div>
  );
}
const rupees = (paise: number): string => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2).replace(/0$/, ''));

/** Text of an amount box that follows `paise`, so "1." and "1.0" survive while typing (the box is the source until the amount changes from outside). */
function useRupeeText(paise: number, onChange: (paise: number) => void) {
  const [text, setText] = useState(paise ? rupees(paise) : '');
  const typed = Math.round((parseFloat(text) || 0) * 100);
  if (typed !== paise) setText(paise ? rupees(paise) : '');
  return {
    text,
    type: (v: string) => {
      setText(v);
      onChange(Math.max(0, Math.round((parseFloat(v) || 0) * 100)));
    },
  };
}

/** `.input-group` with the rupee sign and a number box; the value is paise. */
export function RupeeInput({ paise, onChange, placeholder, ariaLabel, ariaDescribedBy, disabled = false }: { paise: number; onChange: (paise: number) => void; placeholder?: string; ariaLabel?: string; ariaDescribedBy?: string; disabled?: boolean }) {
  const box = useRupeeText(paise, onChange);
  return (
    <div className="input-group">
      <span className="input-group-text">₹</span>
      <input type="number" step="0.01" min="0" className="form-control" inputMode="decimal" placeholder={placeholder} aria-label={ariaLabel} aria-describedby={ariaDescribedBy} data-describedby={ariaDescribedBy} disabled={disabled} value={box.text} onChange={(e) => box.type(e.target.value)} />
    </div>
  );
}

/** `_amount-field.blade.php`: a big amount tile that writes the amount in words as it is typed (what the receipt will carry). */
export function AmountTile({ label, paise, onChange, required = true, error, hint, col = 'col-md-6' }: { label: ReactNode; paise: number; onChange: (paise: number) => void; required?: boolean; error?: string; hint?: ReactNode; col?: string }) {
  const box = useRupeeText(paise, onChange);
  const id = useId();
  return (
    <div className={col}>
      <div className="amount-field amt-tile">
        <label className="form-label" htmlFor={id}>
          {label}
          {required && <span className="req">*</span>}
        </label>
        <div className="amt-box">
          <span className="amt-symbol" aria-hidden="true">₹</span>
          <input id={id} type="number" step="0.01" min="0" className="amt-input" inputMode="decimal" placeholder="0.00" autoComplete="off" value={box.text} onChange={(e) => box.type(e.target.value)} />
        </div>
        <div className="amt-words">
          <i className="bi bi-chat-quote" aria-hidden="true" />
          <span>{wordsOf(paise)}</span>
        </div>
        {hint && <div className="amt-hint">{hint}</div>}
        {error && <div className="field-error">{error}</div>}
      </div>
    </div>
  );
}

/** `cashbook/_picks.blade.php`: big radio choices, an icon, a title and a line under it. */
export function PickGroup<V extends string>({ label, value, onChange, choices, disabled = false }: { label: string; value: V; onChange: (v: V) => void; choices: { value: V; icon: string; title: string; text?: string }[]; disabled?: boolean }) {
  const name = useId();
  const tight = choices.every((c) => !c.text);
  return (
    <div className={`cb-picks ${choices.length > 2 ? 'cb-picks-3' : ''} ${tight ? 'cb-picks-tight' : ''}`.trim()} role="radiogroup" aria-label={label}>
      {choices.map((c) => (
        <label key={c.value}>
          <input type="radio" name={name} value={c.value} checked={value === c.value} disabled={disabled} onChange={() => onChange(c.value)} />
          <span className="cb-pick">
            <span className="cb-pick-icon"><i className={`bi bi-${c.icon}`} /></span>
            <span className="cb-pick-text">
              <strong>{c.title}</strong>
              {c.text && <small>{c.text}</small>}
            </span>
            <i className="bi bi-check-circle-fill cb-pick-tick" aria-hidden="true" />
          </span>
        </label>
      ))}
    </div>
  );
}

/** The total, in figures and words, that sits left of Cancel and Save (`.sh-foot-total`). */
export function FootTotal({ label, paise }: { label: string; paise: number }) {
  return (
    <div className="sh-foot-total">
      <span className="sh-foot-label">{label}</span>
      <strong>{formatINR(paise)}</strong>
      <span className="sh-foot-words" aria-live="polite">
        {wordsOf(paise)}
      </span>
    </div>
  );
}

/** The step header of `[data-wizard]` forms (pms.js wireWizards): numbered dots, ticks for steps done; a finished step can be revisited.
 *  Pallav hides the step names on phones (pms.css, 620px), so a phone gets one line instead: "Step 2 of 3 · Admin" (hms-overrides.css). */
export function WizardSteps({ names, index, onGo }: { names: string[]; index: number; onGo: (i: number) => void }) {
  return (
    <div className="wizard-steps" role="list" aria-label={trf("Step {0} of {1}", [index + 1, names.length])}>
      {names.map((n, i) => (
        <div key={n} role="listitem" aria-current={i === index ? 'step' : undefined} {...(i < index ? { tabIndex: 0, 'aria-label': `Back to step ${i + 1}: ${n}`, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(i); } } } : {})} className={`wz-step ${i === index ? 'current' : ''} ${i < index ? 'done' : ''}`} onClick={() => i < index && onGo(i)}>
          <span className="wz-dot">{i < index ? <i className="bi bi-check-lg" /> : i + 1}</span>
          <span className="wz-name">{n}</span>
        </div>
      ))}
      <span className="wz-phone-label">{trf("Step {0} of {1} · {2}", [index + 1, names.length, names[index] ?? ''])}</span>
    </div>
  );
}

/** Back and Continue, put first in the footer as Pallav's wizard does. */
export function WizardNav({ index, last, onBack, onNext }: { index: number; last: boolean; onBack: () => void; onNext: () => void }) {
  return (
    <>
      {index > 0 && (
        <button type="button" className="btn btn-outline-p wz-back" onClick={onBack}>
          <i className="bi bi-chevron-left" /> {tr("Back")}
        </button>
      )}
      {!last && (
        <button type="button" className="btn btn-p wz-next" onClick={onNext}>
          {tr("Continue")} <i className="bi bi-chevron-right" />
        </button>
      )}
    </>
  );
}

/** Someone else changed the record while the form was open (a stale version): Pallav's warning alert with the way out. */
export function ConflictNote({ onReload }: { onReload: () => void }) {
  return (
    <div className="alert alert-warning d-flex align-items-start gap-2" role="alert">
      <i className="bi bi-exclamation-triangle" aria-hidden="true" />
      <div className="flex-grow-1">
        {tr("Someone else changed this just now. Refresh and try again.")}
      </div>
      <button type="button" className="btn btn-sm btn-outline-p" onClick={onReload}>
        <i className="bi bi-arrow-clockwise" /> {tr("Refresh")}
      </button>
    </div>
  );
}
