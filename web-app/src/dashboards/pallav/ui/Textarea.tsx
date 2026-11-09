'use client';

// A multi-line text box in Bootstrap's `.form-control`. Props are the plain <textarea> props; `invalid` adds the red state.
// Replaces hand-written `<textarea className="form-control ...">`.
import type { ComponentPropsWithoutRef } from 'react';

export interface TextareaProps extends ComponentPropsWithoutRef<'textarea'> {
  invalid?: boolean;
  /** 'portal' draws the Guest / Corporate `.pt-input` box instead of Bootstrap's `.form-control`. */
  look?: 'dashboard' | 'portal';
}

export function Textarea({ invalid = false, look = 'dashboard', className = '', ...rest }: TextareaProps) {
  const base = look === 'portal' ? ['pt-input', 'pt-textarea'] : ['form-control'];
  const classes = [...base, ...className.split(/\s+/).filter((c) => c && !base.includes(c)), ...(invalid ? ['is-invalid'] : [])].join(' ');
  return <textarea {...rest} className={classes} aria-invalid={invalid || rest['aria-invalid'] ? true : undefined} />;
}
