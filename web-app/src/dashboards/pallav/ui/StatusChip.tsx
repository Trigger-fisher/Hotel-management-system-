'use client';

// A small status word: `.pill` on the dashboards (green live, grey locked, amber unlocked), `.pt-badge` in the portals.
// Replaces the hand-written `<span className="pill pill-live">` (and the PILL / DOTS maps kept in several screens).
import type { ReactNode } from 'react';

import { trn } from '@/lib/i18n/language';
export type ChipTone = 'ok' | 'neutral' | 'warn' | 'danger';
const DASH: Record<ChipTone, string> = { ok: 'pill pill-live', neutral: 'pill pill-locked', warn: 'pill pill-unlocked', danger: 'pill pill-danger' };
const PORTAL: Record<ChipTone, string> = { ok: 'pt-badge ok', neutral: 'pt-badge', warn: 'pt-badge warn', danger: 'pt-badge bad' };

export interface StatusChipProps {
  tone?: ChipTone;
  /** 'portal' draws the Guest / Corporate portal badge. */
  look?: 'dashboard' | 'portal';
  title?: string;
  className?: string;
  children: ReactNode;
}

export function StatusChip({ tone = 'neutral', look = 'dashboard', title, className = '', children }: StatusChipProps) {
  return (
    <span className={`${(look === 'portal' ? PORTAL : DASH)[tone]} ${className}`.trim()} title={title}>
      {trn(children)}
    </span>
  );
}
