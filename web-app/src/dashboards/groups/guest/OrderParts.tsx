'use client';

// Room service, the pieces around the menu (decision 71):
//   HotelChooser: "All hotels" with several hotels: the hotel to order from (only hotels where the guest is in house can be chosen).
//   OrdersView / YourOrders: the guest's room-service orders as live cards (status steps that grow in, the cancel countdown, "For 25 Oct 2026 at 7:30 pm" for a
//   scheduled one), "Coming up" for the scheduled ones and the delivered and cancelled ones folded under "Past orders". The status refreshes itself every
//   30 seconds while an order is live (kit/orders.tsx useLiveOrdersPoll). Layouts: `strip` (a phone: cards side by side, live first), `column` (the desktop side
//   column), `compact` (Home: live orders only, with a link to Room service; nothing when none), `past` (the folded past orders) and `page` (Dining's
//   Your orders tab: live and coming up as cards in a grid, past orders as rows).
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { formatDate, formatDateTime, formatTime } from '@shared/dashboards/format';
import { mmss } from '@shared/dashboards/guestCopy/order';
import { orderCopyByLanguage } from '@shared/dashboards/guestCopy/order.lang';
import { portalHotelStore } from '@shared/dashboards/portalHotel';
import type { GuestHotelSummary, PortalUnavailableHotel } from '@shared/dashboards/portalHotels';
import { ROOM_ORDER_STEPS, roomServiceCopy, type RoomOrder } from '@shared/dashboards/roomService';

import { errorText, useToast } from '@/components/ui';
import { Bi, Dialog, EmptyState } from '@/dashboards/pallav/ui';

import { inr } from '../portal/parts';
import { UnavailableNote } from '../portal/HotelParts';
import { guestOrdersApi } from '../roomService/api';
import { GgPage } from './kit/GgPage';
import { GgRow } from './kit/rows';
import { GgSkeleton } from './kit/skeleton';
import { isLiveOrder, useLiveOrdersPoll } from './kit/orders';
import { refreshGuest } from './kit/refresh';
import { useCopy } from '@/lib/i18n/language';


/** "All hotels" chosen with several hotels: pick the hotel to order from. Only hotels where the guest is in house can be chosen. */
export function HotelChooser({ hotels, unavailable }: { hotels: Pick<GuestHotelSummary, 'hotelId' | 'name' | 'inHouse' | 'roomNumber'>[]; unavailable: PortalUnavailableHotel[] }) {
  const orderCopy = useCopy(orderCopyByLanguage);
  const oc = orderCopy;
  const staying = hotels.filter((h) => h.inHouse);
  // in no room anywhere (an arriving guest, after a stay): every hotel opens its menu to look at; ordering opens at check-in
  const browse = staying.length === 0;
  // MJ, 26 Oct 2026 (the hotel comes from the side menu, no picking on the page): staying at one hotel, its menu opens straight away (the side menu follows)
  const only = staying.length === 1 ? staying[0]?.hotelId : undefined;
  useEffect(() => {
    if (only) portalHotelStore.set(only);
  }, [only]);
  if (only) return <GgSkeleton variant="menu" />;
  return (
    <GgPage title={oc.title} status={oc.chooseHotel} className="gg-order">
      <UnavailableNote hotels={unavailable} />
      <section className="gg-card" aria-label={oc.chooseHotel}>
        <div className="gg-list">
          {hotels.map((h) => (
            <GgRow
              key={h.hotelId}
              icon="building"
              title={h.name}
              sub={h.inHouse ? `Room ${h.roomNumber ?? ''}`.trim() : browse ? oc.seeMenu : oc.notHere}
              onPress={h.inHouse || browse ? () => portalHotelStore.set(h.hotelId) : undefined}
              chevron={h.inHouse || browse}
              className={h.inHouse || browse ? '' : 'go-off'}
            />
          ))}
        </div>
        {staying.length === 0 ? <EmptyState look="portal" icon="door-closed" text={oc.noneInHouse} /> : null}
      </section>
    </GgPage>
  );
}

/** A clock that ticks every second while `active` (the cancel countdown); still otherwise. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Live: an ink capsule; delivered: an ink check; cancelled: muted (red when the hotel cancelled it, with its reason under it). */
function chipTone(o: RoomOrder): string {
  if (o.status === 'cancelled') return o.cancelledBy === 'hotel' ? 'gg-chip-bad' : 'gg-chip-muted';
  return o.status === 'delivered' ? 'gg-chip-ok' : 'gg-chip-ink';
}

const linesText = (o: RoomOrder): string => o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ');

/** "7:10 pm" today, else "24 Oct 2026, 7:10 pm". */
function whenText(iso: string, now: number): string {
  return formatDate(iso) === formatDate(new Date(now).toISOString()) ? formatTime(iso) : formatDateTime(iso);
}

/** Scheduled for later than now (the "Coming up" orders). */
const isComingUp = (o: RoomOrder, now: number): boolean => isLiveOrder(o) && o.scheduledFor !== null && Date.parse(o.scheduledFor) > now;

function OrderCard({ o, now, showHotel, compact, onCancel }: { o: RoomOrder; now: number; showHotel: boolean; compact?: boolean; onCancel: (o: RoomOrder) => void }) {
  const orderCopy = useCopy(orderCopyByLanguage);
  const oc = orderCopy;
  const stepAt = ROOM_ORDER_STEPS.indexOf(o.status as (typeof ROOM_ORDER_STEPS)[number]);
  const left = o.cancellableUntil ? Date.parse(o.cancellableUntil) - now : 0;
  const meta = [
    o.scheduledFor && isLiveOrder(o) ? oc.forWhen(formatDate(o.scheduledFor), formatTime(o.scheduledFor)) : oc.placedAt(whenText(o.placedAt, now)),
    inr(o.totalPaise),
    showHotel ? o.hotelName : null,
  ].filter(Boolean);
  return (
    <article className={`go-card${compact ? ' compact' : ''}`} aria-label={oc.orderNo(o.orderNo)}>
      <div className="go-card-head">
        <span className="go-card-no">{oc.orderNo(o.orderNo)}</span>
        <span className={`gg-chip ${chipTone(o)}`}>{roomServiceCopy.statusLabel[o.status]}</span>
      </div>
      <p className="go-card-lines">{linesText(o)}</p>
      <p className="go-card-meta">{meta.join(' · ')}</p>
      {o.status !== 'cancelled' ? (
        <ol className="go-steps" aria-label={oc.progress}>
          {ROOM_ORDER_STEPS.map((s, i) => (
            <li key={s} className={i <= stepAt ? 'done' : ''} aria-current={i === stepAt ? 'step' : undefined}>
              <span className="visually-hidden">{roomServiceCopy.statusLabel[s]}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="go-card-meta">{o.cancelledBy === 'hotel' && o.cancelReason ? roomServiceCopy.cancelledByHotel(o.cancelReason) : roomServiceCopy.cancelledByYou}</p>
      )}
      {compact ? null : o.status === 'placed' && o.cancellableUntil && left > 0 ? (
        <div className="go-card-foot">
          {/* check-shared-ignore: the order card's small text action (a capsule link look), opens the cancel confirm */}
          <button type="button" className="go-cancel" onClick={() => onCancel(o)}>
            {oc.cancel}
          </button>
          <span className="go-card-meta" aria-live="off">
            {oc.cancelLeft(mmss(left))}
          </span>
        </div>
      ) : isLiveOrder(o) ? (
        <p className="go-card-meta go-card-foot">{oc.callToChange}</p>
      ) : null}
    </article>
  );
}

function PastOrders({ items, now, showHotel }: { items: RoomOrder[]; now: number; showHotel: boolean }) {
  const orderCopy = useCopy(orderCopyByLanguage);
  const oc = orderCopy;
  if (items.length === 0) return null;
  return (
    <details className="gg-card go-past">
      <summary>
        <span className="pt-row-ico" aria-hidden="true">
          <Bi name="clock-history" />
        </span>
        <span className="go-past-title">{oc.pastOrders(items.length)}</span>
        <Bi name="chevron-down" className="go-past-chev" aria-hidden="true" />
      </summary>
      <div className="gg-list">
        {items.slice(0, 10).map((o) => (
          <GgRow
            key={o.id}
            title={`${oc.orderNo(o.orderNo)} · ${inr(o.totalPaise)}`}
            sub={`${linesText(o)} · ${whenText(o.placedAt, now)}${showHotel ? ` · ${o.hotelName}` : ''}`}
            right={<span className={`gg-chip ${chipTone(o)}`}>{roomServiceCopy.statusLabel[o.status]}</span>}
            chevron={false}
          />
        ))}
      </div>
    </details>
  );
}

export type OrdersLayout = 'strip' | 'column' | 'compact' | 'past' | 'page';

/** The orders as one page shows them (see the file head); the data comes from one `useLiveOrdersPoll()` the page holds. `page`: Dining's own Your orders tab. */
export function OrdersView({
  poll,
  layout,
  limit = 5,
  link,
  empty,
}: {
  poll: ReturnType<typeof useLiveOrdersPoll>;
  layout: OrdersLayout;
  limit?: number;
  link?: { label: string; onPress: () => void };
  empty?: ReactNode;
}) {
  const orderCopy = useCopy(orderCopyByLanguage);
  const oc = orderCopy;
  const toast = useToast();
  const [asking, setAsking] = useState<RoomOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const { items } = poll;
  const now = useNow(items.some((o) => o.status === 'placed' && o.cancellableUntil !== null));
  const showHotel = new Set(items.map((o) => o.hotelId)).size > 1;
  const live = items.filter((o) => isLiveOrder(o) && !isComingUp(o, now));
  const coming = items.filter((o) => isComingUp(o, now)).sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''));
  const past = items.filter((o) => !isLiveOrder(o));

  const cancel = async () => {
    if (!asking) return;
    setBusy(true);
    const res = await guestOrdersApi.cancel(asking.id);
    setBusy(false);
    setAsking(null);
    if (res.ok) toast.show({ tone: 'success', text: oc.cancelled(res.data.orderNo) });
    else toast.show({ tone: 'error', text: errorText(res.error) });
    poll.reload();
    refreshGuest();
  };
  const confirm = (
    <Dialog
      open={asking !== null}
      tone="danger"
      icon="x-circle"
      title={asking ? oc.cancelTitle(asking.orderNo) : ''}
      message={oc.cancelBody}
      confirmLabel={oc.cancel}
      cancelLabel={oc.keep}
      busy={busy}
      onConfirm={() => void cancel()}
      onCancel={() => setAsking(null)}
    />
  );
  const card = (o: RoomOrder, compact = false) => <OrderCard key={o.id} o={o} now={now} showHotel={showHotel} compact={compact} onCancel={setAsking} />;

  if (layout === 'past') return <PastOrders items={past} now={now} showHotel={showHotel} />;

  if (layout === 'page') {
    if (poll.state.status === 'loading' && items.length === 0) return <GgSkeleton variant="list" />;
    if (items.length === 0) return <>{empty ?? null}</>;
    const group = (id: string, title: string, list: RoomOrder[]) =>
      list.length > 0 ? (
        <section className="gp-orders-sec" aria-labelledby={id}>
          <h2 id={id} className="gp-sec-h">
            {title} <span className="gp-count">{list.length}</span>
          </h2>
          <div className="gp-orders-grid">{list.map((o) => card(o))}</div>
        </section>
      ) : null;
    return (
      <div className="go-orders gp-orders">
        {group('gp-orders-live', oc.liveTitle, live)}
        {group('gp-orders-coming', oc.comingUp, coming)}
        {past.length > 0 ? (
          <section className="gp-orders-sec" aria-labelledby="gp-orders-past">
            <h2 id="gp-orders-past" className="gp-sec-h">
              {oc.pastOrders(past.length)}
            </h2>
            <div className="gg-card gp-orders-past">
              <div className="gg-list">
                {past.slice(0, 20).map((o) => (
                  <GgRow
                    key={o.id}
                    icon={o.status === 'cancelled' ? 'x-circle' : 'check2-circle'}
                    title={`${oc.orderNo(o.orderNo)} · ${inr(o.totalPaise)}`}
                    sub={`${linesText(o)} · ${whenText(o.placedAt, now)}${showHotel ? ` · ${o.hotelName}` : ''}`}
                    right={<span className={`gg-chip ${chipTone(o)}`}>{roomServiceCopy.statusLabel[o.status]}</span>}
                    chevron={false}
                  />
                ))}
              </div>
            </div>
          </section>
        ) : null}
        {confirm}
      </div>
    );
  }

  if (layout === 'compact') {
    const shown = [...live, ...coming].slice(0, limit);
    if (shown.length === 0) return null;
    return (
      <section className="gg-card go-orders compact" aria-label={oc.liveTitle}>
        <div className="gg-card-head">
          <h2>{oc.liveTitle}</h2>
          {link ? (
            <a
              href="#"
              className="gg-more"
              onClick={(e) => {
                e.preventDefault();
                link.onPress();
              }}
            >
              {link.label} <Bi name="chevron-right" />
            </a>
          ) : null}
        </div>
        <div className="go-stack">{shown.map((o) => card(o, true))}</div>
      </section>
    );
  }

  if (layout === 'strip') {
    const shown = [...live, ...coming];
    if (shown.length === 0) return null;
    return (
      <section className="go-orders strip" aria-label={oc.liveTitle}>
        <h2 className="go-h">{oc.liveTitle}</h2>
        <div className="go-strip">{shown.map((o) => card(o))}</div>
        {confirm}
      </section>
    );
  }

  // column (desktop side)
  if (items.length === 0) return null;
  return (
    <section className="go-orders column" aria-label={oc.liveTitle}>
      {live.length > 0 ? (
        <div className="gg-card">
          <div className="gg-card-head">
            <h2>{oc.liveTitle}</h2>
          </div>
          <div className="go-stack">{live.slice(0, limit).map((o) => card(o))}</div>
        </div>
      ) : null}
      {coming.length > 0 ? (
        <div className="gg-card">
          <div className="gg-card-head">
            <h2>{oc.comingUp}</h2>
          </div>
          <div className="go-stack">{coming.map((o) => card(o))}</div>
        </div>
      ) : null}
      <PastOrders items={past} now={now} showHotel={showHotel} />
      {confirm}
    </section>
  );
}

/**
 * The guest's orders with their own 30-second refresh (Home's live orders through kit/orders.tsx LiveOrders, and any older caller). `activeOnly` draws the compact
 * live list (nothing when none); `version` reads again when it changes.
 */
export function YourOrders({ version = 0, activeOnly = false, limit = 5, link, layout }: { version?: number; activeOnly?: boolean; limit?: number; link?: { label: string; onPress: () => void }; layout?: OrdersLayout }) {
  const poll = useLiveOrdersPoll();
  const { reload } = poll;
  const seen = useRef(version);
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    reload();
  }, [version, reload]);
  return <OrdersView poll={poll} layout={layout ?? (activeOnly ? 'compact' : 'column')} limit={limit} link={link} />;
}
