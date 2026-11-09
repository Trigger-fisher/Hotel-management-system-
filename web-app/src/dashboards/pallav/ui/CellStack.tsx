'use client';

// A table cell's main line and the small lines under it (`.cell-main` / `.cell-sub`): name, then web address or a pill.
// Replaces the hand-written span pairs in the list tables.
import type { ReactNode } from 'react';

export function CellStack({ main, sub, children }: { main: ReactNode; sub?: ReactNode | ReactNode[]; children?: ReactNode }) {
  const subs = Array.isArray(sub) ? sub : sub ? [sub] : [];
  return (
    <>
      <span className="cell-main">{main}</span>
      {subs.map((s, i) => (
        <span className="cell-sub" key={i}>
          {s}
        </span>
      ))}
      {children}
    </>
  );
}
