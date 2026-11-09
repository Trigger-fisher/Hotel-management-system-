'use client';

// What a page shows while its data loads or when the data cannot be had, in Pallav's own blocks (`.skel`, `.kpi`, `.card`, `.empty-state`).
// The blocks are plain and still: nothing sweeps across them.
import type { ReactNode } from 'react';

import { errorText } from '@/components/ui';
import type { DashError } from '@shared/dashboards/common';
import { Bi } from '../Bi';

import { tr } from '@/lib/i18n/language';
/** Four tile-shaped blocks and a few row-shaped ones: the shape of a list page. */
export function PageSkeleton({ tiles = true, rows = 4 }: { tiles?: boolean; rows?: number }) {
  return (
    <div aria-busy="true" aria-label={tr("Loading")}>
      {tiles && (
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="kpi">
              <div className="skel" style={{ height: 14, width: '55%', marginBottom: 14 }} />
              <div className="skel" style={{ height: 28, width: '70%', marginBottom: 12 }} />
              <div className="skel" style={{ height: 12, width: '40%' }} />
            </div>
          ))}
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card mb-2" style={{ padding: 16 }}>
          <div className="skel" style={{ height: 16, width: `${50 + ((i * 13) % 35)}%` }} />
        </div>
      ))}
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: DashError; onRetry: () => void }) {
  return (
    <div className="card">
      <div className="empty-state">
        <div className="es-icon"><Bi name="exclamation-triangle" /></div>
        <div className="es-title">{tr("This page could not be loaded")}</div>
        <div className="es-text">{errorText(error)}</div>
        <button type="button" className="btn btn-outline-p mt-3" onClick={onRetry}><Bi name="arrow-clockwise" /> {tr("Try again")}</button>
      </div>
    </div>
  );
}

type State<T> = { status: 'loading' } | { status: 'error'; error: DashError } | { status: 'ready'; data: T };

/** Loading blocks, then the error with Try again, then the page. */
export function Loaded<T>({ state, onRetry, tiles, children }: { state: State<T>; onRetry: () => void; tiles?: boolean; children: (data: T) => ReactNode }) {
  if (state.status === 'loading') return <PageSkeleton tiles={tiles} />;
  if (state.status === 'error') return <LoadError error={state.error} onRetry={onRetry} />;
  return <>{children(state.data)}</>;
}
