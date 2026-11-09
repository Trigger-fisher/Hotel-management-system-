'use client';

// partials/_phone-field.blade.php + the country list of pms-forms.js: a country-code chip that opens a searchable list, and the number beside it.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PhoneCountry } from '@shared/dashboards/payrollCore';
import { Bi } from '../Bi';

import { tr, trf } from '@/lib/i18n/language';
export function PhoneField({
  id,
  country,
  number,
  countries,
  onCountry,
  onNumber,
  required,
  invalid,
}: {
  id?: string;
  country: string;
  number: string;
  countries: PhoneCountry[];
  onCountry: (dial: string) => void;
  onNumber: (digits: string) => void;
  required?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const current = countries.find((c) => c.dial === country) ?? countries[0];

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setShown(true));
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => {
      cancelAnimationFrame(raf);
      setShown(false);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  const term = q.trim().toLowerCase();
  const list = countries.filter((c) => !term || `${c.name} ${c.iso} +${c.dial}`.toLowerCase().includes(term));

  return (
    <div className="phone-field">
      <button
        ref={button}
        type="button"
        className="phone-country"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={trf("Country code, {0} plus {1}. Change", [current?.name ?? '', current?.dial ?? ''])}
        onClick={() => {
          setQ('');
          const r = button.current?.getBoundingClientRect();
          if (r) setPos({ left: r.left, top: r.bottom + 6, width: Math.max(r.width, 300) });
          setOpen((o) => !o);
        }}
      >
        <span className="pc-iso">{current?.iso}</span>
        <span className="pc-dial">+{current?.dial}</span>
        <Bi name="chevron-down" />
      </button>
      <input
        type="tel"
        id={id}
        className={`form-control ${invalid ? 'is-invalid' : ''}`}
        inputMode="tel"
        autoComplete="off"
        placeholder={current?.sample}
        value={number}
        required={required}
        onChange={(e) => onNumber(e.target.value.replace(/\D/g, ''))}
      />
      {open && pos
        ? createPortal(
            <div ref={menu} className={`phone-menu ${shown ? 'open' : ''}`} style={{ left: pos.left, top: pos.top, width: pos.width }}>
              <div className="pm-search">
                <Bi name="search" />
                <input type="text" placeholder={tr("Search country or code")} aria-label={tr("Search country or code")} autoComplete="off" spellCheck={false} autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="pm-list" role="listbox">
                {list.map((c) => (
                  <button
                    key={c.dial + c.iso}
                    type="button"
                    role="option"
                    aria-selected={c.dial === country}
                    className={`pm-item ${c.dial === country ? 'selected' : ''}`}
                    onClick={() => {
                      onCountry(c.dial);
                      setOpen(false);
                      button.current?.focus();
                    }}
                  >
                    <span className="pm-iso">{c.iso}</span>
                    <span className="pm-name">{c.name}</span>
                    <span className="pm-code">+{c.dial}</span>
                  </button>
                ))}
              </div>
              {list.length === 0 ? <div className="pm-empty">{tr("No country matches that.")}</div> : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
