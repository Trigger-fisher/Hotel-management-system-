'use client';

// Pallav's "Narrow down" dropdown (pms-filterbar.js turns a <select data-label data-icon data-any> into this): an icon tile, the label over the
// chosen value, a menu with a tick on the chosen row, a Find box when there are more than seven choices, and an x that takes the choice off.
import { useEffect, useRef, useState } from 'react';

import { tr } from '@/lib/i18n/language';
export interface FilterChoice {
  value: string;
  label: string;
  /** How many rows this choice would show; a choice with none is faded. */
  count?: number;
}

export function FilterMenu({
  label,
  icon,
  any,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  /** Bootstrap Icons name, e.g. "credit-card". */
  icon: string;
  /** Text of the empty choice, e.g. "Any way". */
  any: string;
  ariaLabel: string;
  value: string;
  options: FilterChoice[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const all: FilterChoice[] = [{ value: '', label: any }, ...options];
  const chosen = value ? options.find((o) => o.value === value) : undefined;
  const find = all.length > 7;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const close = () => {
    setOpen(false);
    setTerm('');
  };
  const choose = (v: string) => {
    onChange(v);
    close();
    btn.current?.focus();
  };
  const items = () => [...(wrap.current?.querySelectorAll<HTMLElement>('.bm-dd-opt:not([hidden])') ?? [])];

  return (
    <div
      ref={wrap}
      className={`bm-dd ${open ? 'open' : ''} ${value ? 'on' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
          btn.current?.focus();
          return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLElement);
        list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      }}
    >
      <button ref={btn} type="button" className="bm-dd-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <i className={`bi bi-${icon} bm-dd-icon`} aria-hidden="true" />
        <span className="bm-dd-text">
          <span className="bm-dd-label">{label}</span>
          <span className="bm-dd-value">{chosen ? chosen.label : any}</span>
        </span>
        <i className="bi bi-chevron-down bm-dd-caret" aria-hidden="true" />
      </button>
      <button type="button" className="bm-dd-x" aria-label={tr("Clear")} title={tr("Clear")} onClick={() => choose('')}>
        <i className="bi bi-x-lg" />
      </button>
      {open && (
        <div className="bm-dd-menu" role="listbox">
          <div className="bm-dd-head">{ariaLabel}</div>
          {find && (
            <div className="bm-dd-find">
              <i className="bi bi-search" />
              <input type="search" placeholder={tr("Find…")} autoComplete="off" autoFocus value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
          )}
          <div className="bm-dd-list">
            {all.map((o) => {
              const on = o.value === value;
              const hidden = !!term.trim() && !o.label.toLowerCase().includes(term.trim().toLowerCase());
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  hidden={hidden}
                  className={`bm-dd-opt ${on ? 'on' : ''} ${o.value && o.count === 0 ? 'none' : ''}`}
                  onClick={() => choose(o.value)}
                >
                  <i className="bi bi-check2 bm-dd-check" aria-hidden="true" />
                  <span className="bm-dd-name">{o.label}</span>
                  {o.count !== undefined && <span className="bm-dd-count">{o.count}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
