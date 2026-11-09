'use client';

// M1(b)/(c) of the shared profiles (profileReview.ts, commit 9c8ec96) for the hotel's Customer and Company forms:
//  - a save that would change a profile shared by 2 or more hotels is refused with a 409 that carries the sentence ("This changes email and city for this guest at all 3 hotels.");
//    this asks "Cancel / Save for all hotels" and sends the same input again with confirmShared: true;
//  - 403 "Ask a manager to change the GSTIN." (or the company name) is shown under that field, not as a toast.
// The form's own useSubmit keeps doing the rest (field errors, success): a refusal this handles is answered to it as a quiet success, so it shows no toast.
import { useState } from 'react';

import type { DashResult } from '@shared/dashboards/common';
import { needsSharedConfirm } from '@shared/dashboards/profileReview';
import { Dialog } from '@/dashboards/pallav/ui';

const HELD = Symbol('held-for-confirm');
type Held = typeof HELD;

export const sharedConfirmCopy = {
  title: 'Change the shared profile?',
  save: 'Save for all hotels',
  cancel: 'Cancel',
} as const;

export type RefusedField = 'name' | 'gstNumber';

export function useSharedConfirm(options: { /** The field a 403 sentence belongs to (a company form); a form without it shows the 403 as usual. */ forbiddenField?: (message: string) => RefusedField; onRefused?: (field: RefusedField) => void } = {}) {
  const [message, setMessage] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ field: RefusedField; text: string } | null>(null);

  /** The save call, watched: hands back what the form's `submit` expects. */
  async function guard<T>(call: () => Promise<DashResult<T>>): Promise<DashResult<T | Held>> {
    setRefusal(null);
    const res = await call();
    if (res.ok) return res;
    if (needsSharedConfirm(res.error)) {
      setMessage(res.error.message);
      return { ok: true, data: HELD };
    }
    if (res.error.code === 'FORBIDDEN' && options.forbiddenField) {
      const field = options.forbiddenField(res.error.message);
      setRefusal({ field, text: res.error.message });
      options.onRefused?.(field);
      return { ok: true, data: HELD };
    }
    return res;
  }

  /** The form's success handler, skipped for a save that is waiting for the confirmation or was refused under a field. */
  const done =
    <T,>(onOk: (data: T) => void) =>
    (data: T | Held): void => {
      if (data !== HELD) onOk(data);
    };

  return { message, refusal, guard, done, close: () => setMessage(null), clearRefusal: () => setRefusal(null) };
}

/** The confirmation window. `onConfirm` sends the save again with confirmShared: true. */
export function SharedConfirmDialog({ shared, busy, onConfirm }: { shared: ReturnType<typeof useSharedConfirm>; busy: boolean; onConfirm: () => void }) {
  return (
    <Dialog
      open={shared.message !== null}
      tone="warning"
      icon="people"
      title={sharedConfirmCopy.title}
      message={shared.message ?? ''}
      confirmLabel={sharedConfirmCopy.save}
      cancelLabel={sharedConfirmCopy.cancel}
      busy={busy}
      onCancel={shared.close}
      onConfirm={() => {
        shared.close();
        onConfirm();
      }}
    />
  );
}
