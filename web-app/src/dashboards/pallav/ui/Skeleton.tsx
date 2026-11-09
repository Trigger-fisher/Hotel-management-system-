'use client';

// Still placeholder blocks while a call runs (`.skel`, no sweeping animation). `lines` is a stack of text-like bars, `tiles` the four KPI tiles,
// `rows` card-shaped rows. `portal` draws them inside the portal card. Replaces PageSkeleton / PtSkeleton variants written by hand.
export interface SkeletonProps {
  look?: 'dashboard' | 'portal';
  tiles?: boolean;
  rows?: number;
  /** Plain bars only (a field or a paragraph still loading). */
  lines?: number;
  label?: string;
}

const widthOf = (i: number) => `${50 + ((i * 13) % 35)}%`;

export function Skeleton({ look = 'dashboard', tiles = false, rows = 0, lines = 0, label = 'Loading' }: SkeletonProps) {
  if (lines > 0) {
    return (
      <div aria-busy="true" aria-label={label} role="status">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="skel skel-line mb-2" style={{ width: widthOf(i) }} />
        ))}
      </div>
    );
  }
  if (look === 'portal') {
    return (
      <div className="pt-card" role="status" aria-busy="true" aria-label={label}>
        {Array.from({ length: rows || 3 }, (_, i) => (
          <div key={i} className="pt-row">
            <div className="skel skel-line" style={{ width: widthOf(i) }} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div aria-busy="true" aria-label={label} role="status">
      {tiles ? (
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="kpi">
              <div className="skel skel-line mb-3" style={{ width: '55%' }} />
              <div className="skel skel-value mb-2" style={{ width: '70%' }} />
              <div className="skel skel-small" style={{ width: '40%' }} />
            </div>
          ))}
        </div>
      ) : null}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card mb-2 p-3">
          <div className="skel skel-title" style={{ width: widthOf(i) }} />
        </div>
      ))}
    </div>
  );
}
