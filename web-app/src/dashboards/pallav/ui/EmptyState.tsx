'use client';

// "Nothing here" block. `dashboard` is Pallav's `.empty-state`; `portal` is the Guest / Corporate `.pt-empty` line. One component for both
// (the older `EmptyState` in PmsTable.tsx and `PtEmpty` in portal/parts.tsx draw the same two looks).
import type { ReactNode } from 'react';

import { Bi } from '../Bi';

import { trn } from '@/lib/i18n/language';
export interface EmptyStateProps {
  icon: string;
  title?: string;
  /** The sentence under the title (dashboard) or the whole message (portal). */
  text?: ReactNode;
  look?: 'dashboard' | 'portal';
  /** A button or link under the text (for example "Add the first one"). */
  children?: ReactNode;
}

export function EmptyState({ icon, title, text, look = 'dashboard', children }: EmptyStateProps) {
  if (look === 'portal') {
    return (
      <div className="pt-empty">
        <Bi name={icon} />
        {title ? <strong className="d-block mb-1">{trn(title)}</strong> : null}
        {trn(text)}
        {children}
      </div>
    );
  }
  return (
    <div className="empty-state">
      <div className="es-icon">
        <Bi name={icon} />
      </div>
      {title ? <div className="es-title">{trn(title)}</div> : null}
      {text ? <div className="es-text">{trn(text)}</div> : null}
      {children}
    </div>
  );
}
