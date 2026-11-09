'use client';

// Pallav's password pieces (public/assets/password.js + partials/_password-rules, _password-suggest):
// the reveal button, the rules ticked off live, the "matches" line and "Suggest a strong password".
import { useState, type ReactNode } from 'react';

import { tr } from '@/lib/i18n/language';
const RULES: { id: string; label: string; test: (v: string) => boolean }[] = [
  { id: 'length', label: '8 or more characters', test: (v) => v.replace(/\s/g, '').length >= 8 },
  { id: 'upper', label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { id: 'digit', label: 'A number', test: (v) => /\d/.test(v) },
  { id: 'symbol', label: 'A symbol, like ! @ # $', test: (v) => /[!@#$%^&*()_+\-=[\]{};:'",.<>/?\|`~]/.test(v) },
];

/** True when the password meets every rule `PwRules` shows (and has no spaces). */
export function passwordPasses(v: string): boolean {
  return RULES.every((r) => r.test(v)) && !/\s/.test(v);
}

/** `.input-icon` with a lock icon, the box and the eye button that shows the password. */
export function PwInput({
  id,
  value,
  onChange,
  icon = 'lock',
  autoComplete,
  invalid,
  matchWith,
  children,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  icon?: string;
  autoComplete: string;
  invalid?: boolean;
  /** Draws Pallav's "Passwords match" line under the box (data-pw-match). */
  matchWith?: string;
  children?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <>
      <div className="input-icon">
        <i className={`bi bi-${icon}`} />
        <input
          type={shown ? 'text' : 'password'}
          id={id}
          className={`form-control ${invalid ? 'is-invalid' : ''}`.trim()}
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => setCaps(e.getModifierState('CapsLock'))}
          onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
        />
        <button type="button" className="reveal-btn" aria-label={shown ? 'Hide password' : 'Show password'} onClick={() => setShown((x) => !x)}>
          <i className={`bi bi-${shown ? 'eye-slash' : 'eye'}`} />
        </button>
        {children}
      </div>
      {caps ? (
        <div className="caps-note">
          <i className="bi bi-capslock-fill" /> {tr("Caps Lock is on")}
        </div>
      ) : null}
      {matchWith !== undefined && value ? (
        <div className={`pw-match ${value === matchWith ? 'ok' : 'bad'}`} aria-live="polite">
          {value === matchWith ? (
            <>
              <i className="bi bi-check-circle-fill" /> {tr("Passwords match")}
            </>
          ) : (
            <>
              <i className="bi bi-x-circle" /> {tr("Does not match the new password yet")}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

/** `partials/_password-rules`: ticks off as the new password is typed; `checked` turns what is missing red after a try to save. */
export function PwRules({ value, checked = false }: { value: string; checked?: boolean }) {
  return (
    <ul className={`pw-rules ${checked ? 'checked' : ''}`.trim()} aria-live="polite">
      {RULES.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.id} className={ok ? 'ok' : ''}>
            <i className={`bi ${ok ? 'bi-check-circle-fill' : 'bi-circle'}`} /> {r.label}
          </li>
        );
      })}
      {/\s/.test(value) ? (
        <li>
          <i className="bi bi-x-circle" /> {tr("No spaces")}
        </li>
      ) : null}
    </ul>
  );
}

function strongPassword(): string {
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)] ?? '';
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?'];
  const all = sets.join('');
  const chars = [...sets.map(pick), ...Array.from({ length: 8 }, () => pick(all))];
  return chars.sort(() => Math.random() - 0.5).join('');
}

/** `partials/_password-suggest`: fills the new-password box (and its repeat) with one that meets the rules. */
export function PwSuggest({ onFill }: { onFill: (password: string) => void }) {
  return (
    <button type="button" className="pw-suggest" onClick={() => onFill(strongPassword())}>
      <i className="bi bi-stars" /> {tr("Suggest a strong password")}
    </button>
  );
}
