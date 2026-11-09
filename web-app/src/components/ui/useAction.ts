'use client';

// Runs one save/delete call at a time: busy flag, toast on success or failure, field errors back.
import { useCallback, useRef, useState } from 'react';
import type { DashResult } from '@shared/dashboards/common';
import { dashErrorText } from '@shared/dashboards/common';
import { errorText } from './dashErrors';
import { useToast } from './Toast';

export interface RunOptions<T> {
  /** Toast text on success (none when omitted). */
  success?: string | ((data: T) => string);
  onOk?: (data: T) => void;
  /** Field errors from VALIDATION_FAILED. */
  onFields?: (fields: Record<string, string>) => void;
}

export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = useCallback(
    async <T,>(call: () => Promise<DashResult<T>>, opts: RunOptions<T> = {}): Promise<boolean> => {
      if (running.current) return false;
      running.current = true;
      setBusy(true);
      try {
        const res = await call();
        if (res.ok) {
          opts.onFields?.({});
          if (opts.success) toast.show({ tone: 'success', text: typeof opts.success === 'string' ? opts.success : opts.success(res.data) });
          opts.onOk?.(res.data);
          return true;
        }
        const fields = res.error.details?.fields;
        if (res.error.code === 'VALIDATION_FAILED' && fields) opts.onFields?.(fields);
        toast.show({ tone: 'error', text: errorText(res.error) });
        return false;
      } catch {
        toast.show({ tone: 'error', text: dashErrorText.SERVER_ERROR });
        return false;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [toast],
  );

  return { busy, run };
}

/** Opens a link in a new tab (tel: and mailto: open in place). */
export function openUrl(url: string): void {
  if (typeof window === 'undefined') return;
  if (url.startsWith('tel:') || url.startsWith('mailto:')) window.location.href = url;
  else window.open(url, '_blank', 'noopener,noreferrer');
}
