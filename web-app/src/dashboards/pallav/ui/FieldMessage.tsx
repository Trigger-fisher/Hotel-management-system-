'use client';

// The three small texts under or beside a form control: the error (`.field-error`, read by screen readers), the hint (`.form-text`)
// and the red star of a required field (`.req`). Replaces the hand-written divs and spans.
import type { ReactNode } from 'react';

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <div className="field-error" id={id} role="alert">
      {children}
    </div>
  );
}

export function FieldHint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div className="form-text" id={id}>
      {children}
    </div>
  );
}

export function RequiredMark() {
  return <span className="req" aria-hidden="true">*</span>;
}
