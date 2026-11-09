'use client';

// One way to run a save from a form: busy flag, field errors for the fields the form shows,
// every other problem as an error toast (never a raw error).
import { useState } from 'react';
import type { DashResult } from '@shared/dashboards/common';
import { errorText } from './dashErrors';
import { useToast } from './Toast';

export type FieldErrors = Record<string, string>;

export function useSubmit(shownFields: readonly string[]) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  /** The record changed under the user (stale version): show a `ConflictNote` with a Refresh action, no toast. */
  const [conflict, setConflict] = useState(false);

  async function submit<T>(call: () => Promise<DashResult<T>>, onDone: (data: T) => void): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErrors({});
    setConflict(false);
    const res = await call();
    setBusy(false);
    if (res.ok) {
      onDone(res.data);
      return;
    }
    // A stale version carries currentVersion; any other CONFLICT is the server's own sentence (month not over ...): toast it.
    if (res.error.code === 'CONFLICT' && res.error.details?.currentVersion !== undefined) {
      setConflict(true);
      return;
    }
    const fields = res.error.details?.fields ?? {};
    const shown: FieldErrors = {};
    const other: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (shownFields.includes(k)) shown[k] = v;
      else other.push(v);
    }
    setErrors(shown);
    if (other.length) toast.show({ tone: 'error', text: other.join(' ') });
    else if (!Object.keys(shown).length) toast.show({ tone: 'error', text: errorText(res.error) });
  }

  return { busy, errors, setErrors, conflict, submit };
}

/** Whole numbers typed in a text input ("" -> fallback). */
export function toInt(v: string, fallback = 0): number {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Decimal numbers typed in a text input ("" -> NaN). */
export function toNum(v: string): number {
  return v.trim() === '' ? Number.NaN : Number(v);
}
