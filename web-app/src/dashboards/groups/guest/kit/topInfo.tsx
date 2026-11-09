'use client';

// The guest's top bar middle (MJ, 26 Oct 2026: "the header can be used"): what matters now, with one action, in place of the staff dashboards' greeting
// and clock (PallavShell's `info` slot; every other dashboard keeps TodayStrip). In a stay: "In stay · Room 204" and Room service; money due and no stay:
// the amount and Bills; otherwise the greeting. Data from the tab-bar badges store (no extra request).
import { usePathname } from 'next/navigation';

import { formatINR } from '@shared/dashboards/format';

import { Bi } from '@/dashboards/pallav/ui';

import { useLinkedHotels } from '../../portal/HotelParts';
import { HotelSwitch } from '../../portal/HotelSwitch';

import { useGuestBadges } from './badges';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function GuestTopInfo({ firstName, onGo }: { firstName: string; onGo: (viewId: string) => void }) {
  const b = useGuestBadges();
  const hotels = useLinkedHotels('guest');
  const path = usePathname() ?? '';
  if (!b.ready) return <div className="tb-info gg-top" aria-hidden="true" />;
  const staying = b.room !== null;
  const due = b.outstandingPaise > 0;
  const line = staying ? `Room ${b.room}` : due ? `${formatINR(b.outstandingPaise)} to pay` : `${greeting(new Date().getHours())}, ${firstName}`;
  // the hotel after the room on a wider screen (a phone shows the room alone: its top bar is short)
  const more = staying && b.hotelName ? ` · ${b.hotelName}` : null;
  const lbl = staying ? 'In stay' : due ? 'Bills' : 'Welcome';
  const target = staying ? { id: 'guest.order', path: '/guest/orders', icon: 'cup-hot', text: 'Dining' } : due ? { id: 'guest.bills', path: '/guest/bills', icon: 'receipt', text: 'Bills' } : null;
  // no button to the page already on screen
  const action = target && !path.includes(target.path) ? target : null;
  return (
    <div className="tb-info gg-top">
      {/* the hotel drop-down, always in the top bar when the login has a hotel (MJ, 26 Oct 2026); with one hotel it says so when opened */}
      {hotels.length >= 1 ? <HotelSwitch kind="guest" /> : null}
      <div className="gg-top-pill">
        <span className={`gg-top-status ${staying ? 'is-stay' : due ? 'is-due' : ''}`}>
          <span className="gg-top-dot" aria-hidden="true" />
          <span className="gg-top-lines">
            <span className="gg-top-lbl">{lbl}</span>
            <span className="gg-top-val">
              {line}
              {more ? <span className="gg-top-more">{more}</span> : null}
            </span>
          </span>
        </span>
        {action ? (
          // check-shared-ignore: the top bar's capsule action (the shell's glass top bar look, not a page button of the kit)
          <button type="button" className="gg-top-act" onClick={() => onGo(action.id)}>
            <Bi name={action.icon} />
            <span>{action.text}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
