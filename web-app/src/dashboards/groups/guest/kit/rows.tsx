'use client';

// Full-width tappable rows (decision 71): a settings or list row with an icon, two lines, a value and a chevron, 52 px or taller, the whole row one target.
// GgRow draws the portal's `.pt-row` markup itself (PtRow stays as it is for the company portal). BillRow is one bill; StayGroup is the bills of one stay,
// folded for older stays.
import { useId, useState, type ReactNode } from 'react';

import { billNumberText, billState, billStateLabel, billTotals, stayRange, type GuestBill } from '@shared/dashboards/guest';
import { sellerName, type StaySummary } from '@shared/dashboards/guestStage';

import { Bi } from '@/dashboards/pallav/ui';

import { inr } from '../../portal/parts';

import { tr } from '@/lib/i18n/language';
export interface GgRowProps {
  /** Bootstrap icon name in the round icon well; leave out for a row without one. */
  icon?: string;
  title: ReactNode;
  sub?: ReactNode;
  /** The value at the right (an amount, a chip, a switch). */
  right?: ReactNode;
  /** Draws the chevron. Default: on when the row opens something (onPress or href). */
  chevron?: boolean;
  onPress?: () => void;
  /** A link instead of a button (tel:, mailto:, a PDF); opens in this tab unless `external`. */
  href?: string;
  external?: boolean;
  /** coral = something pending, red = a problem: tints the value and the icon. */
  tone?: 'warn' | 'bad';
  disabled?: boolean;
  /** The accessible name when the visible words are not enough. */
  label?: string;
  className?: string;
  /** A disclosure row (onPress opens and folds a part under it): its state (aria-expanded) and the id of that part; the chevron points down and turns. */
  expanded?: boolean;
  controls?: string;
}

export function GgRow({ icon, title, sub, right, chevron, onPress, href, external, tone, disabled, label, className = '', expanded, controls }: GgRowProps) {
  const fold = expanded !== undefined;
  const opens = Boolean(onPress || href);
  const cls = `pt-row gg-listrow${opens ? ' gg-tap' : ''}${tone ? ` ${tone}` : ''}${className ? ` ${className}` : ''}`;
  const inner = (
    <>
      {icon ? (
        <span className="pt-row-ico" aria-hidden="true">
          <Bi name={icon} />
        </span>
      ) : null}
      <span className="pt-row-main">
        <span className="pt-row-title">{title}</span>
        {sub ? <span className="pt-row-sub">{sub}</span> : null}
      </span>
      {right !== undefined && right !== null ? <span className="gg-row-end">{right}</span> : null}
      {fold ? <Bi name="chevron-down" className="gg-chev gg-fold" aria-hidden="true" /> : (chevron ?? opens) ? <Bi name="chevron-right" className="gg-chev" aria-hidden="true" /> : null}
    </>
  );
  if (href && !disabled) {
    return (
      <a className={cls} href={href} aria-label={label} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {inner}
      </a>
    );
  }
  if (onPress) {
    return (
      // check-shared-ignore: the kit's full-width row (pt-row markup, the class is built above)
      <button type="button" className={cls} onClick={onPress} disabled={disabled} aria-label={label} aria-expanded={fold ? expanded : undefined} aria-controls={fold ? controls : undefined}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

/** A small status capsule: coral for pending, red for a problem, muted otherwise (an ink check when done). */
export function GgChip({ tone = 'muted', children }: { tone?: 'warn' | 'bad' | 'ok' | 'muted'; children: ReactNode }) {
  return <span className={`gg-chip gg-chip-${tone}`}>{children}</span>;
}

/**
 * One bill: the seller's real name, the bill number (or "Running bill") and, with `showHotel`, the hotel; at the right the amount still to pay (or the total) and a
 * chip only when the bill is not paid (To pay in coral, Overdue in red, Cancelled muted).
 */
export function BillRow({ bill, today, onOpen, showHotel = false }: { bill: GuestBill; today: string; onOpen: () => void; showHotel?: boolean }) {
  const t = billTotals(bill);
  const st = billState(bill, today);
  const chip = st === 'paid' ? null : <GgChip tone={st === 'overdue' ? 'bad' : st === 'due' ? 'warn' : 'muted'}>{billStateLabel[st]}</GgChip>;
  const amount = st === 'due' || st === 'overdue' ? t.duePaise : t.totalPaise;
  return (
    <GgRow
      icon={bill.business === 'hotel' ? 'building' : 'cup-hot'}
      title={sellerName(bill)}
      sub={[billNumberText(bill.number), showHotel ? bill.hotelName : null].filter(Boolean).join(' · ')}
      right={
        <>
          <span className={`gg-amt${st === 'cancelled' ? ' muted' : ''}`}>{inr(amount)}</span>
          {chip}
        </>
      }
      tone={st === 'overdue' ? 'bad' : st === 'due' ? 'warn' : undefined}
      onPress={onOpen}
      className="gg-billrow"
    />
  );
}

/**
 * The bills of one stay under a head "Hotel Sunrise, Rajkot · 03 – 06 Oct 2026 · Room 204" with what is still to pay there. `defaultOpen` false folds it
 * (older stays); the head is a button that opens and closes it.
 */
export function StayGroup({ stay, defaultOpen = true, children }: { stay: StaySummary; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const parts = [stay.hotelName, stayRange(stay.from, stay.to), stay.roomNumber && stay.roomNumber !== '—' ? `Room ${stay.roomNumber}` : null].filter(Boolean);
  return (
    <section className={`gg-card gg-staygroup${open ? ' open' : ''}`}>
      {/* check-shared-ignore: the fold button of a stay group (a disclosure head, not a page action) */}
      <button type="button" className="gg-staygroup-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
        <span className="gg-staygroup-txt">
          <span className="gg-staygroup-title">{parts.join(' · ')}</span>
          <span className="gg-staygroup-sub">{stay.bills.length === 1 ? tr("1 bill") : `${stay.bills.length} bills`}</span>
        </span>
        {stay.money.duePaise > 0 ? <span className="gg-amt warn">{inr(stay.money.duePaise)}</span> : null}
        <Bi name="chevron-down" className="gg-fold" aria-hidden="true" />
      </button>
      <div id={bodyId} className="gg-list" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
