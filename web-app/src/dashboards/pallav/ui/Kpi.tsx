'use client';

// Pallav's stat tile (.kpi, pms-dash.css) and the row it sits in (.kpi-grid). Markup as in the Blade views:
//   <div class="kpi"><div class="kpi-top"><span class="kpi-icon in"><i class="bi bi-.."></i></span><span class="kpi-label">..</span></div>
//   <div class="kpi-value">..</div><div class="kpi-foot"><span class="kpi-chip up">..</span></div></div>
import type { ReactNode } from 'react';

import { trn } from '@/lib/i18n/language';
export type KpiIcon = 'in' | 'out' | 'month' | 'due';

export interface KpiChip {
  text: ReactNode;
  /** .up (green) or .down (rose); none = graphite. */
  tone?: 'up' | 'down';
  /** A Bootstrap Icons name shown before the text (graph-up-arrow for up/down). */
  icon?: string;
}

export function Kpi({
  icon,
  glyph,
  label,
  value,
  chips,
  small = false,
  warn = false,
  negative = false,
  onPress,
  className = '',
}: {
  /** Tile colour: in = green, out = rose, month = graphite, due = amber (Pallav's four). */
  icon: KpiIcon;
  /** Bootstrap Icons name inside the tile. */
  glyph: string;
  label: ReactNode;
  value: ReactNode;
  chips?: KpiChip[];
  /** .hd-kpi-small: a word or a time instead of a number. */
  small?: boolean;
  /** .warn: the figure is amber (something is open). */
  warn?: boolean;
  /** .hd-neg: the figure is rose (a negative amount). */
  negative?: boolean;
  /** Makes the tile a link, as Pallav's `<a class="kpi hd-kpi">`. */
  onPress?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <div className="kpi-top">
        <span className={`kpi-icon ${icon}`}>
          <i className={`bi bi-${glyph}`} aria-hidden="true" />
        </span>
        <span className="kpi-label">{trn(label)}</span>
      </div>
      <div className={`kpi-value ${small ? 'hd-kpi-small' : ''} ${negative ? 'hd-neg' : ''}`}>{value}</div>
      <div className="kpi-foot">
        {(chips ?? []).map((c, i) => (
          <span key={i} className={`kpi-chip ${c.tone ?? ''}`} title={typeof c.text === 'string' ? c.text : undefined}>
            {(c.icon || c.tone) && <i className={`bi bi-${c.icon ?? (c.tone === 'up' ? 'graph-up-arrow' : 'graph-down-arrow')}`} aria-hidden="true" />}
            {trn(c.text)}
          </span>
        ))}
      </div>
    </>
  );
  // Pallav puts .hd-kpi only on the dashboard's link tiles (`<a class="kpi reveal hd-kpi">`); a plain tile is `<div class="kpi">`.
  const cls = `kpi ${onPress ? 'hd-kpi' : ''} ${warn ? 'warn' : ''} ${className}`;
  if (onPress) {
    return (
      <a
        className={cls}
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onPress();
        }}
      >
        {body}
      </a>
    );
  }
  return <div className={cls}>{body}</div>;
}

/** `.kpi-grid`: 4 across, 2 under 1100px, 1 under 560px (Pallav's own CSS). */
export function KpiGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`kpi-grid ${className}`}>{children}</div>;
}
