'use client';

// The filter bar under the folder tabs of the Email page (and the platform's channel screens): a Filters button that opens a panel of option groups (rowFilters.ts), one-click saved
// views for the questions the front desk asks every day, a removable chip for everything that is on (the chosen options and the operators typed in the search), and "Showing x of y".
// The desk's WhatsApp page has no filter bar (All / Unread / Done only).
import { useState } from 'react';

import { Bi } from '@/dashboards/pallav/ui';

import { countChosen, type FilterGroup, type FilterSel } from './rowFilters';

import { tr, trf } from '@/lib/i18n/language';
export interface QuickView {
  key: string;
  label: string;
  icon: string;
  onPick: () => void;
}
export interface ExtraChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export function FilterBar({ groups, sel, onSel, views, extra, shown, total, onClear }: { groups: FilterGroup[]; sel: FilterSel; onSel: (s: FilterSel) => void; views: QuickView[]; extra?: ExtraChip[]; shown: number; total: number; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const chosen = countChosen(sel);
  const toggle = (key: string, value: string) => {
    const now = sel[key] ?? [];
    onSel({ ...sel, [key]: now.includes(value) ? now.filter((v) => v !== value) : [...now, value] });
  };
  const chips: ExtraChip[] = [
    ...(extra ?? []),
    ...groups.flatMap((g) => (sel[g.key] ?? []).map((v) => ({ key: `${g.key}:${v}`, label: `${g.label}: ${g.options.find((o) => o.value === v)?.label ?? v}`, onRemove: () => toggle(g.key, v) }))),
  ];
  return (
    <div className="cvf" onKeyDown={(e) => { if (e.key === 'Escape' && open) setOpen(false); }}>
      <div className="cvf-row">
        <button type="button" className={`cvf-btn${open ? ' is-open' : ''}`} aria-expanded={open} aria-controls="cvf-panel" onClick={() => setOpen((v) => !v)}>
          <Bi name="funnel" /> {tr("Filters")}
          {chosen > 0 ? <span className="cvf-n">{chosen}</span> : null}
        </button>
        {views.map((v) => (
          <button key={v.key} type="button" className="cvf-view" onClick={v.onPick}>
            <Bi name={v.icon} /> {v.label}
          </button>
        ))}
        <span className="cvf-grow" />
        {chips.length > 0 || shown !== total ? <span className="cvf-count" aria-live="polite">{tr("Showing")} {shown} {tr("of")} {total}</span> : null}
      </div>
      {open ? (
        <div id="cvf-panel" className="cvf-panel" role="group" aria-label={tr("Filters")}>
          {groups.map((g) => (
            <fieldset key={g.key}>
              <legend>{g.label}</legend>
              <div className="cvf-opts">
                {g.options.map((o) => {
                  const on = (sel[g.key] ?? []).includes(o.value);
                  return (
                    <button key={o.value} type="button" className={`cvf-opt${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle(g.key, o.value)}>
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="cvf-active">
          {chips.map((c) => (
            <button key={c.key} type="button" className="cvf-chip" aria-label={trf("Remove {0}", [c.label])} onClick={c.onRemove}>
              {c.label} <Bi name="x-lg" />
            </button>
          ))}
          <button type="button" className="cvf-clear" onClick={onClear}>{tr("Clear all")}</button>
        </div>
      ) : null}
    </div>
  );
}
