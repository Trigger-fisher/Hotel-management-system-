'use client';

// One button for every screen (Shared Component). Replaces the hand-written `<button className="btn btn-sm btn-outline-p">` family:
//   <Button>Save</Button>                              primary (btn-p)
//   <Button variant="outline" size="sm" icon="plus">   outline (btn-outline-p)
//   <Button variant="ghost">Cancel</Button>            quiet (btn-ghost)
//   <Button variant="danger">Delete</Button>           red outline (btn-outline-danger)
//   <Button variant="dangerSolid">Delete</Button>      red filled, for the final confirm of a destructive action (btn-danger-solid)
//   <Button variant="secondary">Undo</Button>          grey outline for a side action next to a primary one (btn-outline-secondary)
//   <Button busy busyLabel="Saving…">Save</Button>     disabled with a spinner while a request runs
//   <IconButton icon="pencil" label="Edit" />          square icon-only button (btn-icon), `tone="danger"` for the red one
// Always has a type (default "button"), so a button inside a form never submits by accident.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Bi } from '../Bi';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'dangerSolid' | 'secondary';

const VARIANT: Record<ButtonVariant, string> = { primary: 'btn-p', outline: 'btn-outline-p', ghost: 'btn-ghost', danger: 'btn-outline-danger', dangerSolid: 'btn-danger-solid', secondary: 'btn-outline-secondary' };

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  /** Bootstrap icon name, shown before the text. */
  icon?: string;
  /** While true the button is disabled and shows a spinner (and `busyLabel` when given). */
  busy?: boolean;
  busyLabel?: ReactNode;
  className?: string;
}

export function Button({ variant = 'primary', size = 'md', icon, busy = false, busyLabel, type = 'button', className = '', disabled, children, ...rest }: ButtonProps) {
  const classes = ['btn', VARIANT[variant], size === 'sm' ? 'btn-sm' : '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : icon ? <Bi name={icon} className="me-1" /> : null}
      {busy && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  icon: string;
  /** The accessible name (also the tooltip): an icon alone says nothing to a screen reader. */
  label: string;
  tone?: 'default' | 'danger';
  className?: string;
}

export function IconButton({ icon, label, tone = 'default', type = 'button', className = '', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={['btn-icon', tone === 'danger' ? 'danger' : '', className].filter(Boolean).join(' ')} aria-label={label} title={label} {...rest}>
      <Bi name={icon} />
    </button>
  );
}
