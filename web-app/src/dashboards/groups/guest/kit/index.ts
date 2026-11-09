// The guest portal's kit (decision 71, foundation): import every shared guest piece from here.
//   Frame and rows: GgPage, GgRow, GgChip, BillRow, StayGroup
//   Choosing: GgSegments, MoneySegments, GgChips, GgHotelChips, useHotelChoice
//   Overlays and bars: GgSheet, GgActionBar
//   Loading: GgSkeleton (pass it to PtLoad's `skeleton`)
//   Home's stage pieces: StayHero, ActionCapsule, MoneySummary, HotelInfoCard, useHotelSite
//   Data and rules: useGuestHotels, pickHotel, useGuestBadges, useLiveOrdersPoll, isLiveOrder, refreshGuest, useGuestRefresh, canPayOnline, useCanPayOnline
//   Contact and activity: CallReception, useReceptionPhone, telHref, ActivityRow
//   Room service's order views for other pages: LiveOrders (Home, compact), OrderTracker (kit/orders.tsx over OrderParts.tsx). The pay sheet is GuestPaySheet (parts.tsx).
// Pure rules (stage, money, stays, seller name, status line, tabs) are in ui-shared/dashboards/guestStage.ts.
export { GgPage, type GgPageProps } from './GgPage';
export { GgRow, GgChip, BillRow, StayGroup, type GgRowProps } from './rows';
export { GgChips, GgHotelChips, GgSegments, MoneySegments, useHotelChoice, type GgChipItem, type GgSegmentItem } from './chips';
export { GgSheet, GgActionBar, type GgSheetProps } from './sheet';
export { GgSkeleton, type GgSkeletonVariant } from './skeleton';
export { StayHero, ActionCapsule, MoneySummary, type StayHeroProps, type CapsuleAction } from './stage';
export { HotelInfoCard, useHotelSite, clockText, type HotelSite } from './hotelInfo';
export { useGuestHotels, useGuestHotelCount, pickHotel } from './hotels';
export { useGuestBadges, type GuestBadges } from './badges';
export { useLiveOrdersPoll, isLiveOrder, LiveOrders, OrderTracker, LIVE_ORDERS_POLL_MS } from './orders';
export { refreshGuest, useGuestRefresh, GG_REFRESH } from './refresh';
export { canPayOnline, useCanPayOnline } from './mode';
export { useGuestChrome } from './chrome';
export { CallReception, useReceptionPhone, telHref } from './contact';
export { ActivityRow } from './activity';
export { GuestTopInfo } from './topInfo';
