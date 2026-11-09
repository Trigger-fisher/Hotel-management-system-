'use client';

// The company portal's top bar middle (MJ, 26 Oct 2026: "the header can be used", on phones too): what the company owes now, with the one job that follows
// (Due bills); nothing owed: a greeting. The same capsule as the guest's (guest-glass.css .gg-top-*), in PallavShell's `info` slot.
import { formatINR, istWallClock } from '@shared/dashboards/format';

import { useAsync } from '@/components/ui';
import { Bi } from '@/dashboards/pallav/ui';

import { useLinkedHotels } from '../portal/HotelParts';
import { HotelSwitch } from '../portal/HotelSwitch';

import { corporateApi } from './api';

import { tr } from '@/lib/i18n/language';
function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function CorporateTopInfo({ firstName, onGo }: { firstName: string; onGo: (viewId: string) => void }) {
  const { state } = useAsync(async () => {
    const res = await corporateApi.getDashboard();
    return res.ok ? { ok: true as const, data: { owed: res.data.cards.totalDuePaise, hh: istWallClock().hh } } : res;
  }, []);
  const hotels = useLinkedHotels('corporate');
  if (state.status !== 'ready') return <div className="tb-info gg-top" aria-hidden="true" />;
  const { owed, hh } = state.data;
  const due = owed > 0;
  return (
    <div className="tb-info gg-top">
      {/* the hotel drop-down, always in the top bar when the login has a hotel (MJ, 26 Oct 2026); with one hotel it says so when opened */}
      {hotels.length >= 1 ? <HotelSwitch kind="corporate" /> : null}
      <div className="gg-top-pill">
        <span className={`gg-top-status ${due ? 'is-due' : ''}`}>
          <span className="gg-top-dot" aria-hidden="true" />
          <span className="gg-top-lines">
            <span className="gg-top-lbl">{due ? tr("To pay") : tr("Welcome")}</span>
            <span className="gg-top-val">{due ? formatINR(owed) : `${greeting(hh)}, ${firstName}`}</span>
          </span>
        </span>
        {due ? (
          // check-shared-ignore: the top bar's capsule action (the shell's glass top bar look, not a page button of the kit)
          <button type="button" className="gg-top-act" onClick={() => onGo('corporate.bills')}>
            <Bi name="receipt" />
            <span>{tr("Bills")}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
