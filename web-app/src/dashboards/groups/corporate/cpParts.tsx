'use client';

// The company portal's own small pieces (look: "Company portal redesign" block in hms-overrides.css): part and section headings, the quiet figures row
// of the account lists, and the status pill of a bill.
import type { ReactNode } from 'react';

import { Bi } from '@/dashboards/pallav/ui';
import { KpiCard } from '../overview/HomeJobs';
import { tr, trn } from '@/lib/i18n/language';

/** A part of a page ("To pay", "Your account"): a heading and one line under it. */
export function CpPart({ title, note }: { title: string; note?: string }) {
  return (
    <div className="cp-part">
      <h2>{tr(title)}</h2>
      {note ? <span>{tr(note)}</span> : null}
    </div>
  );
}

/** A section heading inside a part, with an optional link to the full page at the right. */
export function CpSec({ title, link, onLink }: { title: string; link?: string; onLink?: () => void }) {
  return (
    <div className="cp-sec">
      <h3>{tr(title)}</h3>
      {link && onLink ? (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onLink();
          }}
        >
          {tr(link)} <Bi name="arrow-right-short" />
        </a>
      ) : null}
    </div>
  );
}

export interface CpFigure {
  id: string;
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'warn' | 'bad';
}

/** One quiet row of figures over a list (the server's own totals), as KPI cards. */
export function CpFigures({ figures }: { figures: CpFigure[] }) {
  if (figures.length === 0) return null;
  return (
    <div className={`kpi-grid n-${figures.length}`}>
      {figures.map((f) => (
        <KpiCard key={f.id} label={f.label} value={f.value} note={f.note} tone={f.tone === 'bad' ? 'out' : f.tone === 'warn' ? 'due' : undefined} num={f.tone ? 1 : 0} />
      ))}
    </div>
  );
}

const PILL = { due: ['pay-pending', 'hourglass-split', 'Due'], overdue: ['pay-failed', 'exclamation-circle', 'Overdue'], paid: ['pay-paid', 'check-circle', 'Paid'] } as const;

/** Due, overdue or paid as the hotel's payment pill (pms.css .pay-pill). */
export function BillPill({ status }: { status: keyof typeof PILL }) {
  const [cls, icon, word] = PILL[status];
  return (
    <span className={`pay-pill ${cls}`}>
      <Bi name={icon} />
      {tr(word)}
    </span>
  );
}
