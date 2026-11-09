'use client';

// One way to show a saved secret (an app password, an API key) in every settings form (MJ, 18 Oct): once saved, the box shows only a mask (no length hint) with
// "A password is saved · saved on <date>" and two small actions, Change and Remove. Typing a new value is the only way to change it, with an eye to see what is
// typed; Save with the box untouched keeps the saved one. The typed value lives only in the parent's state: the parent clears it after a successful save.
import { useState } from 'react';

import { Bi } from '../Bi';

import { tr } from '@/lib/i18n/language';
export interface SecretFieldProps {
  id: string;
  /** What is typed (empty = keep what is saved). */
  value: string;
  onChange: (v: string) => void;
  /** A secret is saved on the server. */
  isSet: boolean;
  /** When it was last saved, already formatted ("12 Oct 2026"); left out when the server does not say. */
  savedOn?: string | null;
  /** Remove the saved secret on Save. Left out = the form cannot remove it, so no Remove action. */
  removed?: boolean;
  onRemoveChange?: (removed: boolean) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** "password" or "key": the noun in the sentences. */
  noun?: string;
  placeholder?: string;
}

const aOrAn = (noun: string): string => (/^[aeiou]/i.test(noun) ? 'An' : 'A');

export function SecretField({ id, value, onChange, isSet, savedOn, removed = false, onRemoveChange, disabled, invalid, noun = 'password', placeholder }: SecretFieldProps) {
  const [changing, setChanging] = useState(!isSet);
  const [shown, setShown] = useState(false);

  if (isSet && removed) {
    return (
      <div role="status">
        <p className="mb-1 small text-danger"><Bi name="trash" /> {tr("The saved")} {noun} {tr("will be removed when you save.")}</p>
        <button type="button" className="btn btn-link btn-sm p-0" disabled={disabled} onClick={() => onRemoveChange?.(false)}>{tr("Keep it")}</button>
      </div>
    );
  }

  if (isSet && !changing) {
    return (
      <div>
        <input id={id} type="password" className="form-control" value="••••••••" readOnly disabled={disabled} aria-describedby={`${id}-state`} autoComplete="new-password" />
        <div id={`${id}-state`} className="form-text d-flex flex-wrap align-items-center gap-2">
          <span><Bi name="shield-check" /> {aOrAn(noun)} {noun} {tr("is saved")}{savedOn ? ` · saved on ${savedOn}` : ''}</span>
          <button type="button" className="btn btn-link btn-sm p-0" disabled={disabled} onClick={() => { onChange(''); setChanging(true); }}>{tr("Change")}</button>
          {onRemoveChange ? <button type="button" className="btn btn-link btn-sm p-0 text-danger" disabled={disabled} onClick={() => onRemoveChange(true)}>{tr("Remove")}</button> : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="input-group">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          className={`form-control${invalid ? ' is-invalid' : ''}`}
          value={value}
          placeholder={placeholder}
          autoComplete="new-password"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={500}
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="btn btn-outline-secondary" aria-label={shown ? `Hide the ${noun}` : `Show the ${noun}`} aria-pressed={shown} disabled={disabled} onClick={() => setShown((s) => !s)}>
          <Bi name={shown ? 'eye-slash' : 'eye'} />
        </button>
      </div>
      {isSet ? (
        <div className="form-text">
          {tr("Type the new")} {noun}{tr(". Leave it empty to keep the saved one.")}{' '}
          <button type="button" className="btn btn-link btn-sm p-0" disabled={disabled} onClick={() => { onChange(''); setShown(false); setChanging(false); }}>{tr("Cancel")}</button>
        </div>
      ) : null}
    </div>
  );
}
