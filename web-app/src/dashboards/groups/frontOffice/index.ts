// Front Office screens: board, reservations (list, form, detail), in house, check-in, stay account, rooms.
// View ids come from ui-shared/dashboards/nav.ts; the detail views are this group's own.
import type { ScreenMap } from '../../types';
import { BoardScreen } from './Board';
import { CheckInScreen } from './CheckInScreen';
import { InHouseScreen } from './InHouseScreen';
import { ReservationFormScreen } from './ReservationFormScreen';
import { ReservationScreen } from './ReservationScreen';
import { ReservationsScreen } from './ReservationsScreen';
import { RequestsScreen } from './RequestsScreen';
import { RoomsScreen } from './Rooms';
import { RoomOrdersScreen } from './RoomOrdersScreen';
import { GuestMessagesScreen } from './GuestMessagesScreen';
import { StayScreen } from './StayScreen';

export const screens: ScreenMap = {
  'hotel.fo.board': BoardScreen,
  'hotel.fo.reservations': ReservationsScreen,
  'hotel.fo.reservation': ReservationScreen,
  'hotel.fo.reservationForm': ReservationFormScreen,
  'hotel.fo.inHouse': InHouseScreen,
  'hotel.fo.checkIn': CheckInScreen,
  'hotel.fo.stay': StayScreen,
  'hotel.fo.requests': RequestsScreen,
  'hotel.fo.roomOrders': RoomOrdersScreen,
  'hotel.fo.guestMessages': GuestMessagesScreen,
  'hotel.fo.rooms': RoomsScreen,
};
