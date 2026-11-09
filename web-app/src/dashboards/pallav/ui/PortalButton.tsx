'use client';

// The Guest and Corporate portals' button (`.pt-btn`): solid graphite or a quiet outlined one. Same API as Button (icon, busy), always typed.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Bi } from '../Bi';

export interface PortalButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: 'solid' | 'line' | 'ghost' | 'primary';
  /** Bootstrap icon name, shown before the text. */
  icon?: string;
  busy?: boolean;
  busyLabel?: ReactNode;
  className?: string;
}

export function PortalButton({ variant = 'solid', icon, busy = false, busyLabel, type = 'button', className = '', disabled, children, ...rest }: PortalButtonProps) {
  const classes = ['pt-btn', `pt-btn-${variant}`, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : icon ? <Bi name={icon} /> : null}
      {busy && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}
