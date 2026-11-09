// The in-memory mock of roomService.ts (dev and local-demo builds only): the guest's orders and the hotel's desk over ONE demo store, with the server's rules (forward-only
// statuses; staff cancel until delivered with a reason; a guest cancel only while placed and inside the window, by the mock's clock). Nothing here is a real guest.
import type { DashResult, MockClock } from './common';
import { mockCall, mockError, ok } from './common';
import {
  CANCEL_REASON_MAX, GUEST_CANCEL_MINUTES_DEFAULT, GUEST_CANCEL_MINUTES_MAX, ROOM_ORDER_STEPS, roomServiceCopy,
  type DeskRoomOrder, type DeskRoomOrderPage, type GuestRoomOrders, type PlaceOrderInput, type PosSetup, type RoomOrder, type RoomOrderStatus, type RoomServiceSettings,
} from './roomService';

interface Stored extends Omit<DeskRoomOrder, 'statusByName' | 'cancellableUntil'> {
  hotelId: string;
  hotelName: string;
  statusByName: string | null;
}

const HOTEL = { hotelId: 'h-1', hotelName: 'Hotel Sunrise, Rajkot' };
const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();

function seed(): Stored[] {
  const line = (name: string, qty: number, rupees: number) => ({ name, qty, amountPaise: qty * rupees * 100 });
  const base = (id: string, no: string, status: RoomOrderStatus, ago: number, lines: ReturnType<typeof line>[], extra: Partial<Stored> = {}): Stored => ({
    id, orderNo: no, status, placedAt: minutesAgo(ago), scheduledFor: null, note: null, totalPaise: lines.reduce((t, l) => t + l.amountPaise, 0), lines, statusAt: minutesAgo(Math.max(0, ago - 2)),
    cancelledBy: null, cancelReason: null, roomNumber: '204', guestName: 'Amit Joshi', tableLabel: null, source: 'guest', statusByName: null, ...HOTEL, ...extra,
  });
  return [
    base('ro-1', 'O-3F2A1C', 'placed', 1, [line('Masala Tea', 2, 40), line('Veg Sandwich', 1, 180)]),
    base('ro-2', 'O-7B9D20', 'preparing', 25, [line('Gujarati Thali', 1, 320)], { statusByName: 'Kamal Cook' }),
    base('ro-3', 'O-11C4E8', 'delivered', 180, [line('Laundry: Shirt', 3, 40)], { statusByName: 'Kamal Cook' }),
    base('ro-4', 'O-90AA31', 'cancelled', 300, [line('Paneer Tikka', 1, 260)], { cancelledBy: 'hotel', cancelReason: 'The kitchen ran out of paneer', statusByName: 'Kamal Cook' }),
    base('ro-5', 'O-5521FD', 'placed', 8, [line('Cold Coffee', 2, 120)], { roomNumber: '102', guestName: 'Bina Shah' }),
    base('ro-6', 'O-A41B07', 'preparing', 14, [line('Paneer Butter Masala', 1, 280), line('Butter Naan', 3, 50)], { roomNumber: null, guestName: '', tableLabel: '5', source: 'staff', statusByName: 'Kamal Cook' }),
    base('ro-7', 'O-C8E012', 'accepted', 6, [line('Veg Sandwich', 1, 180)], { roomNumber: '102', guestName: 'Bina Shah', source: 'staff', statusByName: 'You' }),
  ];
}

const MENU: [string, string, string, 'yes' | 'no' | 'unknown', number][] = [
  ['m-1', 'Masala Tea', 'Beverages', 'yes', 40], ['m-2', 'Cold Coffee', 'Beverages', 'yes', 120], ['m-3', 'Fresh Lime Soda', 'Beverages', 'yes', 90],
  ['m-4', 'Veg Sandwich', 'Snacks', 'yes', 180], ['m-5', 'Paneer Tikka', 'Snacks', 'yes', 260], ['m-6', 'Chicken Tikka', 'Snacks', 'no', 320],
  ['m-7', 'Gujarati Thali', 'Meals', 'yes', 320], ['m-8', 'Paneer Butter Masala', 'Meals', 'yes', 280], ['m-9', 'Butter Naan', 'Meals', 'yes', 50], ['m-10', 'Dal Khichdi', 'Meals', 'yes', 190],
];

export function createRoomServiceMock(clock: MockClock = {}) {
  const call = <T>(fn: () => DashResult<T>) => mockCall(fn, clock);
  const orders = seed();
  let window = GUEST_CANCEL_MINUTES_DEFAULT;
  const until = (o: Stored): string | null => {
    if (o.status !== 'placed' || window <= 0) return null;
    const t = Date.parse(o.placedAt) + window * 60_000;
    return t > Date.now() ? new Date(t).toISOString() : null;
  };
  const guestView = (o: Stored): RoomOrder => {
    const { roomNumber: _r, guestName: _g, statusByName: _s, tableLabel: _t, source: _o, ...rest } = o;
    void _r; void _g; void _s; void _t; void _o;
    return { ...rest, cancelReason: o.cancelledBy === 'hotel' ? o.cancelReason : null, cancellableUntil: until(o) };
  };
  const deskView = (o: Stored): DeskRoomOrder => {
    const { hotelId: _h, hotelName: _n, ...rest } = o;
    void _h; void _n;
    return { ...rest, cancellableUntil: o.source === 'guest' ? until(o) : null };
  };
  const isOpen = (o: Stored) => o.status !== 'delivered' && o.status !== 'cancelled';
  const cancel = (o: Stored, by: 'guest' | 'hotel', reason: string | null, who: string) => Object.assign(o, { status: 'cancelled' as const, cancelledBy: by, cancelReason: reason, statusAt: new Date().toISOString(), statusByName: who });
  // the demo guest's own orders (room 204)
  const mine = () => orders.filter((o) => o.guestName === 'Amit Joshi');
  /**
   * Decision 71 (demo only): the guest's live orders move on by themselves, so the 30-second refresh shows a living status. When the guest reads the list, an
   * order still "placed" after its cancel window is accepted, and an accepted, preparing or on-the-way order moves one step once a minute has passed since its
   * last change. The desk's own steps still win (forward only, never undone).
   */
  const STEP_AFTER_MS = 60_000;
  const advance = () => {
    const now = Date.now();
    for (const o of mine()) {
      if (o.status === 'cancelled' || o.status === 'delivered' || o.scheduledFor) continue;
      if (o.status === 'placed' && until(o) !== null) continue;
      if (now - Date.parse(o.statusAt) < STEP_AFTER_MS) continue;
      const next = ROOM_ORDER_STEPS[ROOM_ORDER_STEPS.indexOf(o.status) + 1];
      if (next) Object.assign(o, { status: next, statusAt: new Date(now).toISOString(), statusByName: 'Kamal Cook' });
    }
  };

  return {
    // ---------------------------------------------------------------- guest portal
    guest: {
      list(): Promise<DashResult<GuestRoomOrders>> {
        advance();
        return call(() => ok({ items: mine().sort((a, b) => b.placedAt.localeCompare(a.placedAt)).map(guestView), guestCancelMinutes: [{ hotelId: HOTEL.hotelId, minutes: window }], unavailable: [] }));
      },
      cancel(id: string): Promise<DashResult<RoomOrder>> {
        return call(() => {
          const o = mine().find((x) => x.id === id);
          if (!o) return mockError('NOT_FOUND');
          if (o.status === 'cancelled') return ok(guestView(o));
          if (o.status === 'delivered') return mockError('CONFLICT', undefined, { message: roomServiceCopy.alreadyDelivered });
          if (!until(o)) return mockError('CONFLICT', undefined, { message: roomServiceCopy.noLongerCancellable });
          return ok(guestView(cancel(o, 'guest', null, o.guestName)));
        });
      },
    },
    // ---------------------------------------------------------------- the hotel's desk
    desk: {
      list(q: { status?: RoomOrderStatus | 'open' | 'all'; source?: 'guest' | 'staff'; search?: string; page?: number; pageSize?: number } = {}): Promise<DashResult<DeskRoomOrderPage>> {
        return call(() => {
          const status = q.status ?? 'open';
          const s = (q.search ?? '').trim().toLowerCase();
          const rows = orders
            .filter((o) => (status === 'open' ? o.status !== 'delivered' && o.status !== 'cancelled' : status === 'all' ? true : o.status === status))
            .filter((o) => !q.source || o.source === q.source)
            .filter((o) => !s || `${o.orderNo} ${o.tableLabel ?? ''} ${o.roomNumber ?? ''} ${o.guestName} ${o.lines.map((l) => l.name).join(' ')}`.toLowerCase().includes(s))
            .sort((a, b) => (status === 'open' ? a.placedAt.localeCompare(b.placedAt) : b.placedAt.localeCompare(a.placedAt)));
          const pageSize = q.pageSize ?? 25;
          const page = Math.max(1, q.page ?? 1);
          return ok({ items: rows.slice((page - 1) * pageSize, page * pageSize).map(deskView), total: rows.length, page, pageSize, openCount: orders.filter(isOpen).length, openByPart: { guest: orders.filter((o) => isOpen(o) && o.source === 'guest').length, staff: orders.filter((o) => isOpen(o) && o.source === 'staff').length }, guestCancelMinutes: window });
        });
      },
      setStatus(id: string, status: Exclude<RoomOrderStatus, 'cancelled' | 'placed'>): Promise<DashResult<DeskRoomOrder>> {
        return call(() => {
          const o = orders.find((x) => x.id === id);
          if (!o) return mockError('NOT_FOUND');
          if (o.status === status) return ok(deskView(o));
          const from = ROOM_ORDER_STEPS.indexOf(o.status as (typeof ROOM_ORDER_STEPS)[number]);
          if (o.status === 'cancelled' || o.status === 'delivered' || ROOM_ORDER_STEPS.indexOf(status) <= from) return mockError('CONFLICT', { status: 'That step is not possible from where the order is now.' });
          Object.assign(o, { status, statusAt: new Date().toISOString(), statusByName: 'You' });
          return ok(deskView(o));
        });
      },
      cancel(id: string, reason: string): Promise<DashResult<DeskRoomOrder>> {
        return call(() => {
          const r = reason.replace(/\s+/g, ' ').trim();
          if (r.length < 3) return mockError('VALIDATION_FAILED', { reason: roomServiceCopy.reasonNeeded });
          if (r.length > CANCEL_REASON_MAX) return mockError('VALIDATION_FAILED', { reason: `Keep the reason under ${CANCEL_REASON_MAX} characters.` });
          const o = orders.find((x) => x.id === id);
          if (!o) return mockError('NOT_FOUND');
          if (o.status === 'cancelled') return ok(deskView(o));
          if (o.status === 'delivered') return mockError('CONFLICT', undefined, { message: roomServiceCopy.alreadyDelivered });
          return ok(deskView(cancel(o, 'hotel', r, 'You')));
        });
      },
      pos(): Promise<DashResult<PosSetup>> {
        return call(() => ok({
          menu: MENU.map(([id, name, category, veg, rupees]) => ({ id, name, category, veg, pricePaise: rupees * 100 })),
          tables: Array.from({ length: 12 }, (_, i) => String(i + 1)),
          rooms: [{ stayId: 'st-1', roomNumber: '102', guestName: 'Bina Shah' }, { stayId: 'st-2', roomNumber: '204', guestName: 'Amit Joshi' }, { stayId: 'st-3', roomNumber: '301', guestName: 'Kavita Mehta' }],
        }));
      },
      place(input: PlaceOrderInput): Promise<DashResult<DeskRoomOrder>> {
        return call(() => {
          const wanted = Object.entries(input.qty).filter(([, q]) => q > 0);
          if (wanted.length === 0) return mockError('VALIDATION_FAILED', { cart: 'Add at least one item.' });
          const lines = wanted.flatMap(([id, qty]) => {
            const m = MENU.find((x) => x[0] === id);
            return m ? [{ name: m[1], qty, amountPaise: qty * m[4] * 100 }] : [];
          });
          if (lines.length !== wanted.length) return mockError('VALIDATION_FAILED', { cart: 'One of the items is not on the menu now. Remove it and try again.' });
          const room = input.kind === 'room' ? [['st-1', '102', 'Bina Shah'], ['st-2', '204', 'Amit Joshi'], ['st-3', '301', 'Kavita Mehta']].find((r) => r[0] === input.stayId) : null;
          if (input.kind === 'room' && !room) return mockError('VALIDATION_FAILED', { stayId: 'Choose the room.' });
          if (input.kind === 'table' && !input.table.trim()) return mockError('VALIDATION_FAILED', { table: 'Choose the table.' });
          const now = new Date().toISOString();
          const o: Stored = {
            id: `ro-${orders.length + 1}`, orderNo: `O-${Math.random().toString(16).slice(2, 8).toUpperCase()}`, status: 'placed', placedAt: now, scheduledFor: null, note: input.note.trim() || null,
            totalPaise: lines.reduce((t, l) => t + l.amountPaise, 0), lines, statusAt: now, cancelledBy: null, cancelReason: null, roomNumber: room ? room[1] : null, guestName: room ? room[2] : '',
            tableLabel: input.kind === 'table' ? input.table.trim() : null, source: 'staff', statusByName: 'You', ...HOTEL,
          };
          orders.push(o);
          return ok(deskView(o));
        });
      },
      settings(): Promise<DashResult<RoomServiceSettings>> {
        return call(() => ok({ guestCancelMinutes: window, maxMinutes: GUEST_CANCEL_MINUTES_MAX }));
      },
      saveSettings(input: { guestCancelMinutes: number }): Promise<DashResult<RoomServiceSettings>> {
        return call(() => {
          const m = input.guestCancelMinutes;
          if (!Number.isInteger(m) || m < 0 || m > GUEST_CANCEL_MINUTES_MAX) return mockError('VALIDATION_FAILED', { guestCancelMinutes: `Choose between 0 and ${GUEST_CANCEL_MINUTES_MAX} minutes (0 = guests cannot cancel).` });
          window = m;
          return ok({ guestCancelMinutes: window, maxMinutes: GUEST_CANCEL_MINUTES_MAX });
        });
      },
    },
  };
}
