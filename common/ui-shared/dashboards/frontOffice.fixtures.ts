// Hotel Pallav's own scratch demo rows (docs/sessions/S08-fixtures: pms_rooms, pms_stays, pms_reservations, pms_charges, site_rooms, company_profiles)
// turned into the Front Office mock's store, so the Front Desk, Reservations, In House, Rooms and the stay account can be compared with Pallav on the
// same data. Only used when the dev preview asks for it (`?data=s08`). Dates stay as Pallav stores them.
import type {
  Charge, ChargeCategory, FrontOfficeStore, ReservationRow, ReservationSource, ReservationStatus, RoomRow, RoomType, StayRow,
} from './frontOffice';

type Row = Record<string, unknown>;

export interface FrontOfficeFixtures {
  rooms: Row[];
  stays: Row[];
  reservations: Row[];
  charges: Row[];
  siteRooms: Row[];
  companies: Row[];
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => Number(v ?? 0) || 0;
const paise = (v: unknown): number => Math.round(num(v) * 100);

/** "2026-10-04 13:30:00" read as Indian time (what Pallav stores and shows). */
function istInstant(stamp: unknown): string {
  const s = str(stamp);
  const [y = 1970, m = 1, d = 1] = s.slice(0, 10).split('-').map(Number);
  const [hh = 0, mm = 0, ss = 0] = (s.slice(11, 19) || '00:00:00').split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm, ss) - 330 * 60_000).toISOString();
}

export function frontOfficeStoreFromFixtures(f: FrontOfficeFixtures): FrontOfficeStore {
  const roomTypes: RoomType[] = f.siteRooms.map((r) => ({ id: `rt-${num(r.id)}`, name: str(r.name), plans: [] }));
  const companies = f.companies.map((c) => ({ id: String(num(c.id)), name: str(c.name) }));
  const co = (id: unknown): string | null => (id === null || id === undefined || id === '' ? null : String(num(id)));

  const rooms: RoomRow[] = f.rooms.map((r) => ({
    id: `rm-${num(r.id)}`, number: str(r.number), floor: str(r.floor) || null, roomTypeId: r.room_type_id ? `rt-${num(r.room_type_id)}` : null, notes: str(r.notes),
    hkStatus: str(r.hk_status) === 'dirty' ? 'dirty' : 'clean', outOfOrder: num(r.out_of_order) === 1, outOfOrderReason: str(r.out_of_order_reason) || null, sort: num(r.sort_order),
  }));

  const reservations: ReservationRow[] = f.reservations.map((r) => ({
    id: `res-${num(r.id)}`, reference: str(r.reference), guestName: str(r.guest_name), mobile: str(r.mobile), email: str(r.email), companyId: co(r.company_id),
    roomTypeId: `rt-${num(r.room_type_id)}`, rooms: num(r.rooms) || 1, plan: str(r.plan), ratePaise: paise(r.rate), adults: num(r.adults) || 1, children: num(r.children),
    checkIn: str(r.check_in).slice(0, 10), checkOut: str(r.check_out).slice(0, 10), source: ({ walk_in: 'walkIn', phone: 'phone', website: 'website', company: 'company', agent: 'agent' } as Record<string, ReservationSource>)[str(r.source)] ?? 'other', enquiryRef: null, notes: str(r.notes),
    status: ({ confirmed: 'confirmed', checked_in: 'checkedIn', checked_out: 'checkedOut', cancelled: 'cancelled', no_show: 'noShow' } as Record<string, ReservationStatus>)[str(r.status)] ?? 'confirmed',
    cancelReason: str(r.cancel_reason) || null, createdAt: istInstant(r.created_at), updatedAt: istInstant(r.updated_at),
  }));

  const stays: StayRow[] = f.stays.map((r) => {
    const charges: Charge[] = f.charges.filter((c) => num(c.stay_id) === num(r.id)).map((c) => ({
      id: `ch-${num(c.id)}`, category: (str(c.category) || 'other') as ChargeCategory, side: str(c.side) === 'food' ? 'food' : 'hotel', description: str(c.description),
      chargeDate: str(c.charge_date).slice(0, 10), quantity: num(c.quantity) || 1, unitPricePaise: paise(c.unit_price), amountPaise: paise(c.amount),
    }));
    return {
      id: `st-${num(r.id)}`, reservationId: r.reservation_id ? `res-${num(r.reservation_id)}` : null, roomId: `rm-${num(r.room_id)}`, grNumber: str(r.gr_number), guestName: str(r.guest_name),
      mobile: str(r.mobile), email: str(r.email), address: str(r.address), city: str(r.city), nationality: str(r.nationality), idProofType: str(r.id_proof_type), idProofNumber: str(r.id_proof_number),
      companyId: co(r.company_id), guestGstin: str(r.guest_gstin), adults: num(r.adults) || 1, children: num(r.children), plan: str(r.plan), ratePaise: paise(r.rate),
      checkInAt: istInstant(r.check_in_at), expectedCheckOut: str(r.expected_check_out).slice(0, 10), checkOutAt: r.check_out_at ? istInstant(r.check_out_at) : null,
      status: str(r.status) === 'checked_out' ? 'checkedOut' : 'inHouse', notes: str(r.notes), charges, bill: null,
    };
  });

  return { roomTypes, companies, rooms, reservations, advances: [], stays, seq: 1000, billSeq: 2002, receiptSeq: 1002 };
}
