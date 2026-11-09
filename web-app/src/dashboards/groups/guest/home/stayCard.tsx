'use client';

// Home's stay card: the room (or the date) in a lead block, what the stage means as the title, the stay's facts as a label / value grid, the stay bar.
import type { ReactNode } from 'react';

import { formatDate } from '@shared/dashboards';
import { nightsLeft, stayProgress, stayRange, type CurrentStay, type UpcomingStay } from '@shared/dashboards/guest';
import { homeCopyByLanguage } from '@shared/dashboards/guestCopy/home.lang';
import { daysAwayText, type GuestStage, type StaySummary } from '@shared/dashboards/guestStage';

import { useCopy } from '@/lib/i18n/language';

import { gpWordsByLanguage } from '../kit/words';

interface Fact {
  label: string;
  value: ReactNode;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function DateLead({ ymd, tag }: { ymd: string; tag?: string }) {
  const [day, month] = formatDate(ymd).split(' ');
  return (
    <div className="gp-lead" aria-hidden="true">
      <span className="gp-lead-big">{day}</span>
      <span className="gp-lead-tag">{tag ?? month}</span>
    </div>
  );
}

export function StayCard({
  stage,
  stay,
  upcoming,
  lastStay,
  hotelName,
  checkOutTime,
  today,
}: {
  stage: Exclude<GuestStage, 'none'>;
  stay: CurrentStay | null;
  upcoming: UpcomingStay | null;
  lastStay: StaySummary | null;
  hotelName: string | null;
  checkOutTime: string | null;
  today: string;
}) {
  const h = useCopy(homeCopyByLanguage).hero;
  const w = useCopy(gpWordsByLanguage).home;
  let lead: ReactNode = null;
  let title = '';
  let eyebrow: string | null = hotelName;
  let chip: string | null = null;
  let facts: Fact[] = [];
  let bar: ReactNode = null;

  if (stage === 'arriving' && upcoming) {
    eyebrow = upcoming.hotelName || hotelName;
    lead = <DateLead ymd={upcoming.checkIn} />;
    title = h.arrivingTitle(formatDate(upcoming.checkIn));
    chip = cap(daysAwayText(upcoming.checkIn, today));
    facts = [
      { label: w.checkIn, value: formatDate(upcoming.checkIn) },
      { label: w.checkOut, value: formatDate(upcoming.checkOut) },
      { label: w.guests, value: h.guests(upcoming.adults + upcoming.children) },
      { label: w.roomType, value: upcoming.roomType || h.nights(upcoming.nights) },
      ...(upcoming.reference ? [{ label: w.booking, value: upcoming.reference }] : []),
    ];
  } else if ((stage === 'staying' || stage === 'checkoutDay') && stay) {
    lead = (
      <div className="gp-lead" aria-hidden="true">
        <span className="gp-lead-big">{stay.roomNumber}</span>
        <span className="gp-lead-tag">{w.room}</span>
      </div>
    );
    const night = Math.max(1, Math.min(stay.nights, stay.nightsDone + 1));
    title = stage === 'checkoutDay' ? (checkOutTime ? h.checkoutBy(checkOutTime) : h.checkoutTitle) : h.nightOf(night, stay.nights);
    chip = stage === 'checkoutDay' ? null : nightsLeft(stay) <= 1 ? w.lastNight : w.nightsLeft(nightsLeft(stay));
    facts = [
      { label: w.checkIn, value: formatDate(stay.checkIn) },
      { label: w.checkOut, value: formatDate(stay.checkOut) },
      { label: w.guests, value: h.guests(stay.adults + stay.children) },
      ...(stay.roomType ? [{ label: w.roomType, value: stay.roomType }] : []),
      ...(stay.bookingNo ? [{ label: w.booking, value: stay.bookingNo }] : []),
    ];
    if (stage === 'staying') {
      const pct = Math.round(stayProgress(stay) * 100);
      bar = (
        <div className="gp-bar" role="progressbar" aria-label={h.stayBar} aria-valuemin={0} aria-valuemax={stay.nights} aria-valuenow={stay.nightsDone}>
          <span style={{ width: `${pct}%` }} />
        </div>
      );
    }
  } else if (stage === 'checkedOut' && lastStay) {
    eyebrow = lastStay.hotelName ?? hotelName;
    lead = <DateLead ymd={lastStay.to} />;
    title = h.checkedOutTitle;
    facts = [
      { label: w.stayed, value: stayRange(lastStay.from, lastStay.to) },
      ...(lastStay.roomNumber && lastStay.roomNumber !== '—' ? [{ label: w.room, value: lastStay.roomNumber }] : []),
    ];
  } else {
    title = h.noStayNowTitle;
  }

  return (
    <section className={`gg-card gp-stay gp-stay-${stage}`} aria-label={title}>
      <div className="gp-stay-top">
        {lead}
        <div className="gp-stay-head">
          {eyebrow ? <span className="gp-eyebrow">{eyebrow}</span> : null}
          <h2 className="gp-stay-title">{title}</h2>
          {chip ? <span className="gp-tag">{chip}</span> : null}
        </div>
      </div>
      {bar}
      {facts.length > 0 ? (
        <dl className="gp-facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
