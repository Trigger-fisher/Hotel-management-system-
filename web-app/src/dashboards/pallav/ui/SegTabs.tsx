'use client';

// Pallav's segmented tabs: ul.nav.seg-tabs with buttons (Bootstrap's data-bs-toggle="tab" panes become state).
// `className` adds to the list, e.g. `mb-3` as users/index writes `<ul class="nav seg-tabs mb-3">`.
import type { ReactNode } from 'react';

import { tr, trn } from '@/lib/i18n/language';
export interface SegTab {
  id: string;
  label: ReactNode;
  icon?: string;
}

export function SegTabs({ tabs, active, onChange, label, className = '' }: { tabs: SegTab[]; active: string; onChange: (id: string) => void; label: string; className?: string }) {
  return (
    <ul className={`nav seg-tabs ${className}`.trim()} role="tablist" aria-label={tr(label)}>
      {tabs.map((t) => (
        <li key={t.id}>
          <button type="button" role="tab" className={active === t.id ? 'active' : ''} aria-selected={active === t.id} onClick={() => onChange(t.id)}>
            {t.icon && <i className={`bi bi-${t.icon}`} aria-hidden="true" />} {trn(t.label)}
          </button>
        </li>
      ))}
    </ul>
  );
}
