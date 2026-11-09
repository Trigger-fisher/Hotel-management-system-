'use client';

// Small Pallav pieces the three account screens share: the "admins only" block and the "could not load" block.
import { useState, type ReactNode } from 'react';
import { adminCopy } from '@shared/dashboards/admin';
import type { AsyncState } from '@/components/ui';
import { Button, EmptyState, PageSkeleton } from '@/dashboards/pallav/ui';

import { tr } from '@/lib/i18n/language';
export function AdminOnly() {
  return (
    <div className="card reveal">
      <EmptyState icon="lock" title={adminCopy.common.adminOnly.title} text={adminCopy.common.adminOnly.body} />
    </div>
  );
}

export function LoadFail({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="card reveal">
      <EmptyState icon="wifi-off" title={tr("This did not load")} text="Check the connection and try again.">
        <Button variant="outline" icon="arrow-clockwise" className="mt-3" onClick={onRetry}>
          {tr("Try again")}
        </Button>
      </EmptyState>
    </div>
  );
}

/** Shows `children(data)` once the data is ready (and keeps showing the last data while it reloads, so an open pop-up stays open); the retry block when it fails. */
export function Ready<T>({ state, onRetry, children }: { state: AsyncState<T>; onRetry: () => void; children: (data: T) => ReactNode }) {
  const [kept, setKept] = useState(state);
  if (state.status !== 'loading' && state !== kept) setKept(state);
  const shown = state.status === 'loading' && kept.status === 'ready' ? kept : state;
  if (shown.status === 'ready') return <>{children(shown.data)}</>;
  if (shown.status === 'error') return <LoadFail onRetry={onRetry} />;
  // the first load shows the shared skeleton, never an empty page (D4)
  return <PageSkeleton tiles={false} />;
}
