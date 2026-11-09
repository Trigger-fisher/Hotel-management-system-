import "server-only";
import type { GuestLookupMatch } from "@shared/dashboards/frontOffice";
import type { ReservationRecord, StayRecord } from "../../repos/frontOffice";
import { istDate } from "./rules";

// HMS: a past guest of this hotel found by mobile for the check-in form. The desk types the number it has; the records that end with those
// digits are grouped by their last ten digits (one guest, however the number was written), newest first; the newest record names the guest,
// the newest STAY gives the register fields (a reservation has none).

/** The digits of what the desk typed, at most the last ten (what the mobile indexes hold). */
export const mobileDigits = (typed: string): string => typed.replace(/[^0-9]/g, "").slice(-10);

const last10 = (mobile: string | null): string => (mobile ?? "").replace(/[^0-9]/g, "").slice(-10);

interface Group {
  at: number;
  newest: StayRecord | ReservationRecord;
  stays: StayRecord[];
}

/** The matches, newest guest first, at most `max`; `roomNumber` names the last room by its id. */
export function groupGuests(stays: readonly StayRecord[], reservations: readonly ReservationRecord[], roomNumber: (roomId: string) => string | null, max: number): GuestLookupMatch[] {
  const groups = new Map<string, Group>();
  const add = (key: string, at: number, record: StayRecord | ReservationRecord, stay: StayRecord | null): void => {
    const g = groups.get(key) ?? { at, newest: record, stays: [] };
    if (at > g.at) Object.assign(g, { at, newest: record });
    if (stay) g.stays.push(stay);
    groups.set(key, g);
  };
  for (const s of stays) add(last10(s.mobile), s.checkInAt.getTime(), s, s);
  for (const r of reservations) add(last10(r.mobile), r.createdAt.getTime(), r, null);
  return [...groups.values()]
    .sort((a, b) => b.at - a.at)
    .slice(0, max)
    .map((g) => {
      const stay = [...g.stays].sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime())[0] ?? null;
      const lastOut = g.stays.map((s) => s.checkOutAt).filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      return {
        guestName: g.newest.guestName,
        mobile: g.newest.mobile ?? "",
        email: g.newest.email ?? stay?.email ?? "",
        address: stay?.address ?? "",
        city: stay?.city ?? "",
        nationality: stay?.nationality ?? "",
        idProofType: stay?.idProofType ?? "",
        idProofNumber: stay?.idProofNumber ?? "",
        dateOfBirth: stay?.guestDetails?.dateOfBirth ?? "",
        stays: g.stays.length,
        lastRoomNumber: stay ? roomNumber(stay.roomId) : null,
        lastCheckOut: lastOut ? istDate(lastOut) : null,
        companyId: g.newest.companyId ?? stay?.companyId ?? null,
      };
    });
}
