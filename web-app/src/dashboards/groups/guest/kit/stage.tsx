'use client';

// The stage pieces of the guest's Home (decision 71): the stay hero for each stage, the action capsule (up to three big actions) and the money card that never
// pays (MJ: no paying on Home; it opens Bills). The Home page composes them; their look is in guest-glass.css (foundation).
import type { ReactNode } from 'react';

import { formatDate } from '@shared/dashboards';
import { stayProgress, stayRange, type CurrentStay, type UpcomingStay } from '@shared/dashboards/guest';
import { homeCopyByLanguage } from '@shared/dashboards/guestCopy/home.lang';
import { daysAwayText, type GuestMoney, type GuestStage, type StaySummary } from '@shared/dashboards/guestStage';

import { Bi } from '@/dashboards/pallav/ui';

import { inr } from '../../portal/parts';
import { useCanPayOnline } from './mode';
import { useCopy } from '@/lib/i18n/language';


export interface StayHeroProps {
  stage: GuestStage;
  stay?: CurrentStay | null;
  upcoming?: UpcomingStay | null;
  /** The newest stay (checked out) from staysFromBills. */
  lastStay?: StaySummary | null;
  /** The stay's hotel (the eyebrow and the checked-out line); left out when not known. */
  hotelName?: string | null;
  /** "11:00 am" from the hotel card (D4); the check-out day says "by" it only when known. */
  checkOutTime?: string | null;
  today: string;
  /** The action capsule (ActionCapsule) under the words. */
  children?: ReactNode;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function Pill({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <span className="gg-pill">
      <Bi name={icon} /> {children}
    </span>
  );
}

/** The hero of each stage: where and when, the facts as pills, the stay bar while staying; the capsule (children) under it. */
export function StayHero({ stage, stay, upcoming, lastStay, hotelName, checkOutTime, today, children }: StayHeroProps) {
  const homeCopy = useCopy(homeCopyByLanguage);
  const h = homeCopy.hero;
  let eyebrow: ReactNode = hotelName ?? null;
  let title: string;
  let sub: ReactNode = null;
  let chip: ReactNode = null;
  let pills: ReactNode = null;
  let bar: ReactNode = null;

  if (stage === 'arriving' && upcoming) {
    eyebrow = upcoming.hotelName || hotelName || null;
    title = h.arrivingTitle(formatDate(upcoming.checkIn));
    chip = <span className="gg-chip gg-chip-ink">{cap(daysAwayText(upcoming.checkIn, today))}</span>;
    sub = stayRange(upcoming.checkIn, upcoming.checkOut);
    pills = (
      <>
        {upcoming.roomType ? <Pill icon="door-open">{upcoming.roomType}</Pill> : null}
        <Pill icon="moon-stars">{h.nights(upcoming.nights)}</Pill>
        <Pill icon="people">{h.guests(upcoming.adults + upcoming.children)}</Pill>
        {upcoming.reference ? <Pill icon="bookmark">{h.booking(upcoming.reference)}</Pill> : null}
      </>
    );
  } else if ((stage === 'staying' || stage === 'checkoutDay') && stay) {
    const night = Math.min(stay.nights, stay.nightsDone + 1);
    title = stage === 'checkoutDay' ? (checkOutTime ? h.checkoutBy(checkOutTime) : h.checkoutTitle) : `${h.stayingTitle(stay.roomNumber)}${stay.roomType ? ` · ${stay.roomType}` : ''}`;
    sub = stage === 'checkoutDay' ? `${h.stayingTitle(stay.roomNumber)}${hotelName ? ` · ${hotelName}` : ''}` : h.nightOf(Math.max(1, night), stay.nights);
    pills = (
      <>
        <Pill icon="box-arrow-right">{h.checkOut(formatDate(stay.checkOut))}</Pill>
        <Pill icon="people">{h.guests(stay.adults + stay.children)}</Pill>
        {stay.bookingNo ? <Pill icon="bookmark">{h.booking(stay.bookingNo)}</Pill> : null}
      </>
    );
    if (stage === 'staying') {
      const pct = Math.round(stayProgress(stay) * 100);
      bar = (
        <>
          {/* the stay bar grows to the share of nights already stayed (a value, not a colour) */}
          <div className="gg-progress" role="progressbar" aria-label={h.stayBar} aria-valuemin={0} aria-valuemax={stay.nights} aria-valuenow={stay.nightsDone}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="gg-progress-ends">
            <span>{formatDate(stay.checkIn)}</span>
            <span>{formatDate(stay.checkOut)}</span>
          </div>
        </>
      );
    }
  } else if (stage === 'checkedOut' && lastStay) {
    eyebrow = lastStay.hotelName ?? hotelName ?? null;
    title = h.checkedOutTitle;
    sub = [stayRange(lastStay.from, lastStay.to), lastStay.roomNumber && lastStay.roomNumber !== '—' ? h.stayingTitle(lastStay.roomNumber) : null, lastStay.hotelName ?? hotelName].filter(Boolean).join(' · ');
  } else {
    title = h.noStayTitle;
    sub = h.noStayBody;
  }

  return (
    <section className={`gg-hero gg-hero-${stage}`} aria-label={title}>
      <div className="gg-hero-txt">
        {eyebrow ? <div className="gg-eyebrow">{eyebrow}</div> : null}
        <h2 className="gg-hero-h">{title}</h2>
        {chip}
        {sub ? <p className="gg-hero-sub">{sub}</p> : null}
        {pills ? <div className="gg-pills">{pills}</div> : null}
        {bar}
      </div>
      {children}
    </section>
  );
}

export interface CapsuleAction {
  id: string;
  label: string;
  icon: string;
  /** A short second line ("Review ₹3,171.00"). */
  sub?: string;
  onPress?: () => void;
  /** A link instead (tel:, a PDF). */
  href?: string;
  /** The stage's main action: solid ink (white by night). One per capsule. */
  primary?: boolean;
}

/** Up to three big actions (48 px or taller): full width on a phone, a row of capsules on a desktop. */
export function ActionCapsule({ actions, label = 'What you can do' }: { actions: CapsuleAction[]; label?: string }) {
  const shown = actions.slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <nav className={`gg-capsule n${shown.length}`} aria-label={label}>
      {shown.map((a) => {
        const inner = (
          <>
            <Bi name={a.icon} />
            <span className="gg-cap-txt">
              <span className="gg-cap-lbl">{a.label}</span>
              {a.sub ? <span className="gg-cap-sub">{a.sub}</span> : null}
            </span>
          </>
        );
        const cls = `gg-cap-btn${a.primary ? ' primary' : ''}`;
        return a.href ? (
          <a key={a.id} className={cls} href={a.href}>
            {inner}
          </a>
        ) : (
          // check-shared-ignore: a capsule action of the guest's Home (the kit's own big tap target)
          <button key={a.id} type="button" className={cls} onClick={a.onPress}>
            {inner}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The money of the stay, once: "To pay now ₹X" in coral with "₹Y paid of ₹Z" (overdue in red), else "All paid" or "Nothing to pay right now". It never pays:
 * the whole card opens Bills (`onReview`). Without the hotel's online payment the amount says "to pay at reception".
 */
export function MoneySummary({ money, onReview, title: given }: { money: GuestMoney; onReview?: () => void; title?: string }) {
  const homeCopy = useCopy(homeCopyByLanguage);
  const m = homeCopy.money;
  const title = given ?? m.toPay;
  const owing = money.duePaise > 0;
  const online = useCanPayOnline();
  const body = (
    <>
      <span className="gg-money-label">{owing ? title : money.chargedPaise > 0 ? m.allPaid : m.nothing}</span>
      {owing ? <span className="gg-money-amt warn">{inr(money.duePaise)}</span> : null}
      {money.chargedPaise > 0 ? <span className="gg-money-of">{m.paidOf(inr(money.paidPaise), inr(money.chargedPaise))}</span> : null}
      {money.overduePaise > 0 ? <span className="gg-money-bad">{m.overdue(inr(money.overduePaise))}</span> : null}
      {owing && !online ? <span className="gg-money-note">{m.atReception(inr(money.duePaise))}</span> : null}
    </>
  );
  if (!onReview) return <section className={`gg-card gg-moneycard${owing ? ' owing' : ''}`}>{body}</section>;
  return (
    // check-shared-ignore: the money card is one big tap target that opens Bills
    <button type="button" className={`gg-card gg-moneycard gg-tap${owing ? ' owing' : ''}`} onClick={onReview}>
      <span className="gg-money-body">{body}</span>
      <span className="gg-money-go">
        {m.review} <Bi name="chevron-right" />
      </span>
    </button>
  );
}
