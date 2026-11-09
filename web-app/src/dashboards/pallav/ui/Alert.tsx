'use client';

// An inline notice in Bootstrap's `.alert` with Pallav's icon: info, warning, danger, success or neutral. Replaces the hand-written
// `<div className="alert alert-X d-flex align-items-start gap-2" role=...><Bi .../><div className="flex-grow-1">...</div></div>`.
import type { ReactNode } from 'react';

import { Bi } from '../Bi';

import { trn } from '@/lib/i18n/language';
export type AlertTone = 'info' | 'warning' | 'danger' | 'success' | 'neutral';

const CLASS: Record<AlertTone, string> = { info: 'alert-info', warning: 'alert-warning', danger: 'alert-danger', success: 'alert-success', neutral: 'alert-secondary' };
const ICON: Record<AlertTone, string> = { info: 'info-circle', warning: 'exclamation-triangle', danger: 'x-octagon', success: 'check-circle', neutral: 'info-circle' };

export interface AlertProps {
  tone?: AlertTone;
  /** Bootstrap icon name; the tone's own icon when omitted. */
  icon?: string;
  /** 'alert' (read at once) for danger, 'status' otherwise, unless set. */
  role?: 'alert' | 'status' | 'note';
  /** A button or link on the right (for example "Try again"). */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Alert({ tone = 'info', icon, role, action, className = '', children }: AlertProps) {
  return (
    <div className={`alert ${CLASS[tone]} d-flex align-items-start gap-2 ${className}`.trim()} role={role ?? (tone === 'danger' ? 'alert' : 'status')}>
      <Bi name={icon ?? ICON[tone]} className="mt-1" />
      <div className="flex-grow-1">{trn(children)}</div>
      {action ?? null}
    </div>
  );
}
