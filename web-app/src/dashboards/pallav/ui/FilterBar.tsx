'use client';

// components/filter-bar.blade.php (styles pms-filterbar.css) and partials/_log-date-range.blade.php, for any list that narrows itself.
import { useState, type ReactNode } from 'react';
import { Bi } from '../Bi';
import { PmsDate } from './pickers';

import { tr } from '@/lib/i18n/language';
export interface FilterTab {
  id: string;
  label: string;
  icon?: string;
  count?: number;
  /** A red tab (e.g. "Not sent"). */
  danger?: boolean;
  /** A coloured dot before the label (`span.bm-dot`): `paid`, `due`, `settled`, `muted` (company ledger, bills, advances tabs). */
  dot?: 'paid' | 'due' | 'settled' | 'muted';
  /** A dot in the person's own colour (users list: the role's accent), as `style="background: .."` in the Blade. */
  dotColor?: string;
}

/**
 * `<x-filter-bar>`: status tabs, a summary line with Reset, and (as children) the dropdown row labelled "Narrow down".
 * `summary` takes the counts as nodes, e.g. `<>All <b>12</b> emails</>`.
 */
export function FilterBar({
  tabs,
  active,
  onTab,
  tabsLabel = 'Show',
  tabsTitle,
  summary,
  onReset,
  label = 'Narrow down',
  extra,
  children,
}: {
  /** `<x-slot:extra>`: drawn in `.bm-fbar-summary` before the summary, usually one `<FilterBarExtra>` (system/log: "Payroll log"). */
  extra?: ReactNode;
  tabs?: FilterTab[];
  active?: string;
  onTab?: (id: string) => void;
  tabsLabel?: string;
  tabsTitle?: string;
  summary?: ReactNode;
  /** Shown as Reset when set. */
  onReset?: () => void;
  label?: string;
  children?: ReactNode;
}) {
  // only a count line (no tabs, no narrowing row): drawn as a plain line, not an empty bar
  const bare = !tabs?.length && !children;
  return (
    <div className={`bm-fbar reveal${bare ? ' is-bare' : ''}`} role="search">
      {tabs || summary || onReset ? (
        <div className="bm-fbar-top">
          <div className="bm-tabs-wrap">
            {tabsTitle ? <span className="bm-tabs-title">{tabsTitle}</span> : null}
            <div className="bm-tabs" role="tablist" aria-label={tr(tabsLabel)} hidden={!tabs?.length}>
              {tabs?.map((t) => (
                <a
                  key={t.id}
                  className={`bm-tab ${active === t.id ? 'active' : ''} ${t.danger ? 'danger' : ''}`}
                  href="#"
                  role="tab"
                  aria-selected={active === t.id}
                  onClick={(e) => {
                    e.preventDefault();
                    onTab?.(t.id);
                  }}
                >
                  {t.dot || t.dotColor ? <span className={`bm-dot ${t.dot ?? ''}`.trim()} style={t.dotColor ? { background: t.dotColor } : undefined} aria-hidden="true" /> : null}
                  {t.icon ? <Bi name={t.icon} /> : null} <span>{tr(t.label)}</span>
                  {t.count !== undefined ? <span className="bm-tab-count">{t.count}</span> : null}
                </a>
              ))}
            </div>
          </div>
          <div className="bm-fbar-summary">
            {extra}
            {summary ? <span aria-live="polite">{summary}</span> : null}
            {onReset ? (
              <button type="button" className="bm-reset" onClick={onReset}>
                <Bi name="arrow-counterclockwise" /> {tr("Reset")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {children ? (
        <div className="bm-fbar-row">
          <span className="bm-fbar-label">
            <Bi name="sliders2" /> {tr(label)}
          </span>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** `<a class="bm-fbar-extra" title=".."><i class="bi bi-.."></i> label</a>`: the link Pallav puts in the filter bar's extra slot. */
export function FilterBarExtra({ icon, label, title, onPress }: { icon: string; label: ReactNode; title?: string; onPress: () => void }) {
  return (
    <a
      className="bm-fbar-extra"
      href="#"
      title={title}
      onClick={(e) => {
        e.preventDefault();
        onPress();
      }}
    >
      <Bi name={icon} /> {label}
    </a>
  );
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * `_log-date-range`: From and To side by side with the quick picks. A quick pick fills both and applies at once; the typed dates apply with the
 * "Apply dates" button (as Pallav's filter form does).
 */
export function DateRangeField({ from, to, today, onChange }: { from: string; to: string; today: string; onChange: (from: string, to: string) => void }) {
  const [draft, setDraft] = useState({ from, to });
  const [seen, setSeen] = useState({ from, to });
  // Follow the applied dates when they change from outside (Reset, a removed filter chip, a quick pick).
  if (seen.from !== from || seen.to !== to) {
    setSeen({ from, to });
    setDraft({ from, to });
  }
  const t = new Date(`${today}T00:00:00`);
  const back = (n: number) => iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - n));
  const presets: [string, string, string][] = [
    ['Today', today, today],
    ['7 days', back(6), today],
    ['30 days', back(29), today],
    ['This month', iso(new Date(t.getFullYear(), t.getMonth(), 1)), today],
  ];
  return (
    <>
      <div className="lf-field lf-when">
        <span className="form-label">{tr("Date")}</span>
        <div className="lf-date-row">
          <div className="lf-range">
            <label className="visually-hidden" htmlFor="lf_from">
              {tr("From")}
            </label>
            <PmsDate type="date" id="lf_from" className="form-control" value={draft.from} placeholder={tr("From")} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
            <Bi name="arrow-right" className="lf-range-sep" />
            <label className="visually-hidden" htmlFor="lf_to">
              {tr("To")}
            </label>
            <PmsDate type="date" id="lf_to" className="form-control" value={draft.to} placeholder={tr("To")} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          </div>
          <div className="lf-quick" role="group" aria-label={tr("Quick date ranges")}>
            {presets.map(([label, a, b]) => (
              <button key={label} type="button" className={from === a && to === b ? 'active' : ''} onClick={() => onChange(a, b)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button type="button" className="btn btn-p" onClick={() => onChange(draft.from, draft.to)}>
        <Bi name="funnel" /> {tr("Apply dates")}
      </button>
    </>
  );
}
