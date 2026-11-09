'use client';

// The filter tabs above a list (Pallav's `.bm-tabs`: a status or business switch, optionally with a count badge or a coloured dot), and the
// `.fb-pills` variant ("Every kind", "Cash", ...). Replaces hand-written `<button className="bm-tab ...">` rows. SegTabs is the other tab look
// (`ul.nav.seg-tabs`, used on detail pages); this one is the list filter bar's.
//   <ListTabs label="Status" active={tab} onChange={setTab} tabs={[{ id: 'all', label: 'All', count: 12 }, { id: 'paid', label: 'Paid', dot: 'ok', count: 4 }]} />
import type { ReactNode } from 'react';

import { trn, tr } from '@/lib/i18n/language';
export interface ListTab {
  id: string;
  label: ReactNode;
  /** Badge after the label. */
  count?: number | string;
  /** Colour class of the small dot before the label (`bm-dot <dot>`). */
  dot?: string;
  /** Bootstrap icon name before the label. */
  icon?: string;
  /** Anything drawn before the label instead of a dot or icon (e.g. a role's own coloured dot). */
  leading?: ReactNode;
  title?: string;
  /** Extra class on this tab only. */
  className?: string;
}

export interface ListTabsProps {
  tabs: ListTab[];
  active: string;
  onChange: (id: string) => void;
  /** The tab list's accessible name. */
  label: string;
  /** 'tabs' = `.bm-tabs` / `.bm-tab`; 'pills' = `.fb-pills` / `.fb-pill`. */
  look?: 'tabs' | 'pills';
  className?: string;
  id?: string;
}

export function ListTabs({ tabs, active, onChange, label, look = 'tabs', className = '', id }: ListTabsProps) {
  const [list, item] = look === 'pills' ? ['fb-pills', 'fb-pill'] : ['bm-tabs', 'bm-tab'];
  return (
    <div className={`${list} ${className}`.trim()} id={id} role="tablist" aria-label={tr(label)}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={active === t.id} title={t.title} className={`${item} ${t.className ?? ''} ${active === t.id ? 'active' : ''}`.replace(/\s+/g, ' ').trim()} onClick={() => onChange(t.id)}>
          {t.leading ?? (t.dot ? <span className={`bm-dot ${t.dot}`} aria-hidden="true" /> : t.icon ? <i className={`bi bi-${t.icon}`} aria-hidden="true" /> : null)}
          <span>{trn(t.label)}</span>
          {t.count !== undefined && <span className="bm-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}