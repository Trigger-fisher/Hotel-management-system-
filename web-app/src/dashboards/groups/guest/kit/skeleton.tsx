'use client';

// Placeholder shapes while a guest page loads (decision 71: skeletons, not spinners). Pass one to PtLoad's `skeleton` prop:
//   <PtLoad state={state} onRetry={reload} skeleton={<GgSkeleton variant="list" />}>{...}</PtLoad>
// The shimmer runs 1.2 s per loop and stops under reduced motion (guest-glass.css).
import type { ReactNode } from 'react';

import { tr } from '@/lib/i18n/language';
export type GgSkeletonVariant = 'home' | 'list' | 'bill' | 'menu' | 'account' | 'rows';

const Bar = ({ w, h = 12, round = false }: { w: string; h?: number; round?: boolean }) => <span className={`gg-sk${round ? ' round' : ''}`} style={{ width: w, height: h }} />;

function Rows({ n }: { n: number }) {
  return (
    <div className="gg-card gg-sk-card">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="gg-sk-row">
          <Bar w="40px" h={40} round />
          <span className="gg-sk-lines">
            <Bar w={`${48 + ((i * 17) % 30)}%`} h={13} />
            <Bar w={`${26 + ((i * 11) % 22)}%`} h={10} />
          </span>
          <Bar w="64px" h={13} />
        </div>
      ))}
    </div>
  );
}

const SHAPES: Record<GgSkeletonVariant, () => ReactNode> = {
  home: () => (
    <>
      <div className="gg-card gg-sk-hero">
        <Bar w="38%" h={12} />
        <Bar w="62%" h={30} />
        <Bar w="48%" h={13} />
        <Bar w="100%" h={8} />
      </div>
      <div className="gg-sk-capsule">
        <Bar w="100%" h={48} round />
        <Bar w="100%" h={48} round />
        <Bar w="100%" h={48} round />
      </div>
      <Rows n={3} />
    </>
  ),
  list: () => (
    <>
      <Bar w="44%" h={14} />
      <Rows n={3} />
      <Bar w="38%" h={14} />
      <Rows n={2} />
    </>
  ),
  bill: () => (
    <>
      <div className="gg-card gg-sk-hero">
        <Bar w="40%" h={12} />
        <Bar w="55%" h={30} />
        <Bar w="30%" h={13} />
      </div>
      <Rows n={4} />
    </>
  ),
  menu: () => (
    <>
      <div className="gg-sk-capsule row">
        <Bar w="90px" h={36} round />
        <Bar w="90px" h={36} round />
        <Bar w="90px" h={36} round />
      </div>
      <Rows n={5} />
    </>
  ),
  account: () => (
    <>
      <div className="gg-card gg-sk-hero center">
        <Bar w="72px" h={72} round />
        <Bar w="40%" h={16} />
        <Bar w="56%" h={11} />
      </div>
      <Rows n={5} />
    </>
  ),
  rows: () => <Rows n={4} />,
};

/** The loading shape of a guest page: `home`, `list` (two groups), `bill`, `menu`, `account` or plain `rows`. */
export function GgSkeleton({ variant = 'rows' }: { variant?: GgSkeletonVariant }) {
  return (
    <div className={`gg-skeleton gg-skeleton-${variant}`} role="status" aria-busy="true" aria-label={tr("Loading")}>
      {SHAPES[variant]()}
    </div>
  );
}
