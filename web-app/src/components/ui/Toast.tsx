'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { tr } from '@/lib/i18n/language';
export interface ToastInput {
  tone: 'success' | 'error' | 'info';
  text: string;
  /** One button in the toast (Undo); pressing it closes the toast. */
  action?: { label: string; onClick: () => void };
  /** How long it stays, in ms (default 4.2 s, errors 7 s). */
  ms?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (t: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const MAX = 4;

/** Pallav's toasts (pms.js Toast): glass cards at the bottom centre (announcements use the top notch), 4.2 s (errors 7 s), paused while the pointer rests on one. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((t: ToastInput) => {
    next.current += 1;
    const id = next.current;
    setItems((xs) => [...xs.slice(-(MAX - 1)), { ...t, id }]);
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <PmsToast key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const PALLAV_ICON = { success: 'check-lg', error: 'exclamation-lg', info: 'info-lg' } as const;

function PmsToast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const id = window.setTimeout(() => onDismiss(item.id), item.ms ?? (item.tone === 'error' ? 7000 : 4200));
    return () => window.clearTimeout(id);
  }, [paused, item.id, item.tone, item.ms, onDismiss]);
  return (
    <div className={`toast-item ${item.tone} in`} style={{ position: 'relative' }} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      <div className="ti-icon">
        <i className={`bi bi-${PALLAV_ICON[item.tone]}`} aria-hidden="true" />
      </div>
      <div className="ti-body">{tr(item.text)}</div>
      {item.action ? (
        <button /* check-shared-ignore: the toast's one action (Undo), drawn as the toast's own text button */ type="button" className="ti-action" onClick={() => { item.action?.onClick(); onDismiss(item.id); }}>
          {tr(item.action.label)}
        </button>
      ) : null}
      <button /* check-shared-ignore: the toast's own close button */ type="button" className="ti-close" aria-label={tr("Dismiss")} onClick={() => onDismiss(item.id)}>
        <i className="bi bi-x-lg" aria-hidden="true" />
      </button>
    </div>
  );
}

const fallback: ToastApi = {
  show: (t) => {
    if (process.env.NODE_ENV !== 'production') console.warn('useToast() used outside ToastProvider:', t.text);
  },
};

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? fallback;
}
