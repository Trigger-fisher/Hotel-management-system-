// In-memory mock of the guest portal redesign (guestPortal.ts): every state of the order page. (Add member was removed, decision 59.)
import { mockCall, mockError, ok, type MockClock } from './common';
import { GUEST_TODAY } from './guest';
import { allDayHours, type GuestPortalApi, type OrderInfo, type OrderInfoAllHotels, type RestaurantApi, type RestaurantHours } from './guestPortal';
import { hotelParam } from './portalHotel';

/** The demo guest's two hotels (the same as guest.mock.ts): staying at the first. */
const MOCK_HOTELS = [
  { hotelId: 'h-1', hotelName: 'Hotel Sunrise, Rajkot' },
  { hotelId: 'h-2', hotelName: 'Sunrise Residency, Surat' },
];

const demoHours = (): RestaurantHours => ({ accepting: true, days: allDayHours().days.map((d) => ({ ...d, opens: '07:00', closes: '23:00' })) });

/** One set of hours for the whole mock session, so what the hotel admin saves is what the guest page shows. */
const demoRestaurant: { hours: RestaurantHours } = { hours: demoHours() };

/** Minutes of the day in India now, for "open now". */
function istMinutes(): { day: number; minutes: number } {
  const t = new Date(Date.now() + (5.5 * 60 + new Date().getTimezoneOffset()) * 60_000);
  return { day: (t.getDay() + 6) % 7, minutes: t.getHours() * 60 + t.getMinutes() };
}

const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function createRestaurantMock(clock: MockClock = {}, shared?: { hours: RestaurantHours }): RestaurantApi & { state: { hours: RestaurantHours } } {
  const state = shared ?? demoRestaurant;
  return {
    state,
    getHours: () => mockCall(() => ok(structuredClone(state.hours)), clock),
    saveHours: (h) =>
      mockCall(() => {
        state.hours = structuredClone(h);
        return ok(structuredClone(state.hours));
      }, clock),
  };
}

export function createGuestPortalMock(opts: { staying: boolean; hours?: { hours: RestaurantHours } }, clock: MockClock = {}): GuestPortalApi {
  const hoursState = opts.hours ?? demoRestaurant;
  let codeOn = false;

  return {
    getOrderInfo: () =>
      mockCall<OrderInfo | OrderInfoAllHotels>(() => {
        const h = hoursState.hours;
        const now = istMinutes();
        const today = h.days.find((d) => d.day === now.day);
        const openNow = h.accepting && !!today && !today.closed && now.minutes >= toMin(today.opens) && now.minutes <= toMin(today.closes);
        // the server's shape: "All hotels" (no hotel chosen) lists each hotel with whether the guest is staying there; one hotel answers its order info for the app bar
        const chosen = hotelParam();
        if (!chosen) {
          const all: OrderInfoAllHotels = { all: true, hotels: MOCK_HOTELS.map((x, i) => ({ ...x, inHouse: opts.staying && i === 0, roomNumber: opts.staying && i === 0 ? '204' : null })), unavailable: [] };
          return ok(all);
        }
        const hotel = MOCK_HOTELS.find((x) => x.hotelId === chosen) ?? MOCK_HOTELS[0];
        const here = opts.staying && hotel.hotelId === MOCK_HOTELS[0].hotelId;
        const info: OrderInfo = {
          all: false,
          hotelId: hotel.hotelId,
          hotelName: hotel.hotelName,
          guestName: 'Amit Joshi',
          roomNumber: here ? '204' : null,
          staying: here,
          stay: here ? { roomNumber: '204', checkIn: GUEST_TODAY, checkOut: '2099-01-01' } : null,
          hours: { accepting: h.accepting, openNow, days: h.days },
        };
        return ok(info);
      }, clock),

    setSignInCode: (enabled, password) =>
      mockCall(() => {
        if (!enabled && !password) return mockError('VALIDATION_FAILED', { password: 'Enter your current password to turn this off.' });
        codeOn = enabled;
        return ok({ signInCodeOn: codeOn });
      }, clock),
  };
}
