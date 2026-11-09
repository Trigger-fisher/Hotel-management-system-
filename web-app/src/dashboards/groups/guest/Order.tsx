'use client';
// Dining (guest.order): two jobs on two tabs. Menu: the kitchen card, search and Veg only, sticky section chips, dishes with Add / stepper, the cart (a sheet
// over the cart bar on a phone, a sticky side card on a desktop) and one "on the way" line while an order is live. Your orders (?view=orders): live, coming up
// and past orders. No "Pay now" while the hotel has no online payment set up (useCanPayOnline).
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';

import { formatDate, formatTime } from '@shared/dashboards';
import { MAX_ITEM_QTY, cartSummary, type CurrentStay, type MenuGroup, type MenuItem, type OrderPayWith } from '@shared/dashboards/guest';
import { guestCopyByLanguage } from '@shared/dashboards/guest.lang';
import { hoursShort, kitchenOpensText, orderModeOf, orderStatusLine, scheduleDays, type OrderMode } from '@shared/dashboards/guestCopy/order';
import { orderCopyByLanguage } from '@shared/dashboards/guestCopy/order.lang';
import { insideHours, type OrderInfo, type OrderInfoAllHotels } from '@shared/dashboards/guestPortal';
import { guestPortalOrderCopyByLanguage } from '@shared/dashboards/guestPortal.lang';
import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';

import { errorText, useAsync, useMedia, useToast } from '@/components/ui';
import { apiMode } from '@/lib/api/mode';
import { roomServiceCopy } from '@shared/dashboards/roomService';
import { Bi, EmptyState, ListSearch, PortalButton, SegTabs, Select, Textarea } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { guestApi, guestToday } from './api';
import { biOf, inr, PtLoad } from '../portal/parts';
import { usePortalHotel } from '../portal/HotelSwitch';
import { guestHotelsApi } from '../portal/hotelsApi';
import { guestPortalApi } from './portalApi';
import { GgActionBar, GgChips, GgPage, GgSheet, GgSkeleton, CallReception, useCanPayOnline, refreshGuest, telHref, useGuestRefresh, useLiveOrdersPoll, useReceptionPhone } from './kit';
import { HotelChooser, OrdersView } from './OrderParts';
import { gpWordsByLanguage } from './kit/words';
import { useCopy, tr } from '@/lib/i18n/language';



type Menu = { stay: CurrentStay | null; profileName: string; menu: MenuGroup[] };

type Go = ScreenProps['navigate'];

/** The hotel's clock, "19:05" (India time): the kitchen's hours are the hotel's. */
const hotelClock = (): string => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

/**
 * "Now" for the 15-minute rule of a scheduled order. Real server: the real clock. The demo: its own day (guestToday, the stay's early-October dates) at the
 * hotel's clock time, so a time later in the demo stay can be chosen (the real clock is weeks past the demo stay).
 */
const nowForSchedule = (): number => (apiMode() === 'mock' ? Date.parse(`${guestToday()}T${hotelClock()}:00+05:30`) : Date.now());

const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

type View = 'menu' | 'orders';

export function GuestOrder({ navigate, params }: ScreenProps) {
  const view: View = params.view === 'orders' ? 'orders' : 'menu';
  const choice = usePortalHotel();
  const hotels = useAsync(() => guestApi.listHotels(), []);
  const list = hotels.state.status === 'ready' ? hotels.state.data : [];
  const pickFirst = choice === PORTAL_ALL_HOTELS && list.length > 1;
  const info = useAsync(() => guestPortalApi.getOrderInfo() as Promise<Awaited<ReturnType<typeof guestPortalApi.getOrderInfo>>>, [choice], { keep: true });
  // "All hotels" with several hotels: the guest first picks the hotel they are staying at (the server answers all:true, or the summary tells where they are in house)
  const summary = useAsync(() => guestHotelsApi.summary(), [pickFirst]);
  // the preview's stage switch, a placed order: read again behind what is on screen
  useGuestRefresh(info.reload);
  const skeleton = <GgSkeleton variant="menu" />;
  if (hotels.state.status === 'loading') return <PtLoad state={hotels.state} onRetry={hotels.reload} skeleton={skeleton}>{() => null}</PtLoad>;
  if (pickFirst) {
    return (
      <PtLoad state={summary.state} onRetry={summary.reload} skeleton={skeleton}>
        {(s) => <HotelChooser hotels={s.hotels} unavailable={s.unavailable} />}
      </PtLoad>
    );
  }
  const hotelName = list.find((h) => h.hotelId === choice)?.name ?? (list.length === 1 ? (list[0]?.name ?? null) : null);
  return (
    <PtLoad state={info.state} onRetry={info.reload} skeleton={skeleton}>
      {(raw) => {
        const all = raw as OrderInfo | OrderInfoAllHotels;
        if (all.all === true) return <HotelChooser hotels={all.hotels.map((h) => ({ hotelId: h.hotelId, name: h.hotelName, inHouse: h.inHouse, roomNumber: h.roomNumber }))} unavailable={all.unavailable} />;
        return <OrderMenu info={all} hotelName={all.hotelName ?? hotelName} navigate={navigate} view={view} />;
      }}
    </PtLoad>
  );
}

function OrderMenu({ info, hotelName, navigate, view }: { info: OrderInfo; hotelName: string | null; navigate: Go; view: View }) {
  const { state, reload } = useAsync(() => guestApi.getMenu(), [], { keep: true });
  useGuestRefresh(reload);
  return (
    <PtLoad state={state} onRetry={reload} skeleton={<GgSkeleton variant="menu" />}>
      {(d) => {
        const mode = orderModeOf(info.staying, d.stay);
        // nothing to show at all: no stay and no menu kept by the hotel
        if (mode === 'browse' && !d.menu.some((g) => g.items.length > 0)) return <NothingYet navigate={navigate} />;
        return <OrderBody data={d} info={info} mode={mode} hotelName={hotelName} initialView={view} />;
      }}
    </PtLoad>
  );
}

/** No stay and no menu to look at: what happens next, and where to look meanwhile. */
function NothingYet({ navigate }: { navigate: Go }) {
  const orderCopy = useCopy(orderCopyByLanguage);
  const oc = orderCopy;
  const guestPortalCopy = useCopy(guestPortalOrderCopyByLanguage);
  const p = guestPortalCopy;
  const guestCopy = useCopy(guestCopyByLanguage);
  const phone = useReceptionPhone();
  return (
    <GgPage title={oc.title} className="gg-order">
      <section className="gg-card">
        <EmptyState look="portal" icon="door-closed">
          <b>{p.notStayingTitle}</b>
          <div>{p.notStayingBody}</div>
          <div className="d-flex gap-2 flex-wrap justify-content-center mt-3">
            <PortalButton variant="line" icon="receipt" onClick={() => navigate('guest.bills')}>
              {guestCopy.nav.bills}
            </PortalButton>
            <CallReception phone={phone} showNumber={false} />
          </div>
        </EmptyState>
      </section>
    </GgPage>
  );
}

/** A note above the menu when something stands in the way of ordering now. */
function Banner({ icon, title, sub, tone, children }: { icon: string; title: string; sub?: string; tone?: 'warn'; children?: ReactNode }) {
  return (
    <section className={`gg-card go-banner${tone ? ` ${tone}` : ''}`} role="status">
      <span className="pt-row-ico" aria-hidden="true">
        <Bi name={icon} />
      </span>
      <div className="go-banner-txt">
        <b>{title}</b>
        {sub ? <span>{sub}</span> : null}
      </div>
      {children ? <div className="go-banner-act">{children}</div> : null}
    </section>
  );
}

const matchText = (item: MenuItem, g: MenuGroup) => `${item.name} ${item.note ?? ''} ${item.category ?? ''} ${g.label}`.toLowerCase();

/** One menu section: the kitchen's category (or the group's name when an item has none), with its dishes in the hotel's order. */
interface Section {
  id: string;
  label: string;
  items: { item: MenuItem; group: MenuGroup }[];
}

/** The menu's sections in the order they first appear (the hotel's order); an item without a category joins its group's section. */
function sectionsOf(menu: MenuGroup[], otherSection: string): Section[] {
  const out: Section[] = [];
  const byLabel = new Map<string, Section>();
  for (const g of menu) {
    for (const item of g.items) {
      const label = item.category?.trim() || (menu.length > 1 ? g.label : otherSection);
      let s = byLabel.get(label);
      if (!s) {
        s = { id: `s${out.length}`, label, items: [] };
        byLabel.set(label, s);
        out.push(s);
      }
      s.items.push({ item, group: g });
    }
  }
  return out;
}

function OrderBody({ data, info, mode, hotelName, initialView }: { data: Menu; info: OrderInfo; mode: OrderMode; hotelName: string | null; initialView: View }) {
  const orderCopy = useCopy(orderCopyByLanguage);
  const oc = orderCopy;
  const w = useCopy(gpWordsByLanguage).order;
  const [view, setView] = useState<View>(initialView);
  const guestPortalCopy = useCopy(guestPortalOrderCopyByLanguage);
  const p = guestPortalCopy;
  const toast = useToast();
  const phone = useMedia('(max-width: 768px)');
  const reception = useReceptionPhone(info.hotelId);
  const poll = useLiveOrdersPoll();
  const today = guestToday();
  const [clock] = useState(hotelClock);
  const stay = data.stay;
  const room = info.roomNumber ?? stay?.roomNumber ?? null;
  const paused = !info.hours.accepting;
  const closedNow = paused || !info.hours.openNow;
  const canOrder = mode === 'order' && !paused;

  // arriving guests: "Ordering opens when you check in on 29 Oct 2026" (the overview's next booking, D1); read only when there is no stay
  const ov = useAsync(() => (mode === 'browse' ? guestApi.getOverview() : Promise.resolve({ ok: true as const, data: null })), [mode]);
  const upcoming = ov.state.status === 'ready' ? (ov.state.data?.upcoming ?? null) : null;

  // the menu (MJ, 26 Oct 2026: a food-app structure): sections are the kitchen's own categories (Starters, Mains, Drinks...), filtered by the search and
  // the "Veg only" switch; the section chips follow the scroll
  const [typed, setTyped] = useState('');
  const [vegOnly, setVegOnly] = useState(false);
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const sections = sectionsOf(data.menu, oc.otherSection);
  const shownItems = (s: Section) => s.items.filter(({ item, group }) => (!vegOnly || item.veg === 'yes') && words.every((w) => matchText(item, group).includes(w))).map((x) => x.item);
  const groups = sections.filter((s) => shownItems(s).length > 0);
  const dishCount = sections.reduce((n, s) => n + s.items.length, 0);
  // the sections on screen change with the search and the switch only
  const groupKey = groups.map((g) => g.id).join(',');
  const [active, setActive] = useState<string>(sections[0]?.id ?? '');
  const chipsRef = useRef<HTMLDivElement>(null);
  const jumping = useRef(0);

  // the cart
  const days = stay ? scheduleDays(stay.checkIn, stay.checkOut, today) : [];
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [later, setLater] = useState(closedNow);
  const [day, setDay] = useState(days[0]?.value ?? '');
  const [time, setTime] = useState('');
  const [payWith, setPayWith] = useState<OrderPayWith>('room_bill');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const cart = cartSummary(data.menu, qty);
  const step = (id: string, delta: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(MAX_ITEM_QTY, (q[id] ?? 0) + delta)) }));
  const scheduleError = !later || !day || !time || !stay ? null : day < stay.checkIn || day > stay.checkOut ? p.outsideStay : insideHours(info.hours.days, day, time) ? null : p.outsideHours;
  const payOnline = useCanPayOnline(usePortalHotel());

  // where the sticky chips stop: under the top bar when the top bar stays on screen, else at the screen's top edge (the phone's top bar scrolls away)
  const menuRef = useRef<HTMLDivElement>(null);
  const under = useRef<'bar' | 'edge'>('bar');
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('.main[data-hms-dash] .topbar');
    const pos = bar ? getComputedStyle(bar).position : 'static';
    under.current = pos === 'sticky' || pos === 'fixed' ? 'bar' : 'edge';
    if (menuRef.current) menuRef.current.dataset.under = under.current;
  }, [phone, view]);

  // the chip of the section on screen (the section under the sticky chips)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const top = under.current === 'edge' ? 0 : Number.parseInt(getComputedStyle(document.body).getPropertyValue('--pt-m-top'), 10) || 72;
    const els = groupKey.split(',').map((id) => document.getElementById(`go-g-${id}`)).filter((e): e is HTMLElement => e !== null);
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        if (Date.now() < jumping.current) return;
        const first = els.find((el) => seen.get(el.id));
        if (first) setActive(first.id.slice('go-g-'.length));
      },
      { rootMargin: `-${top + 60}px 0px -55% 0px`, threshold: 0 },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [groupKey, phone, view]);

  // keep the chosen chip in view inside its sideways row (never scrolls the page)
  useEffect(() => {
    const row = chipsRef.current?.querySelector<HTMLElement>('.gg-chips');
    const chip = row?.querySelector<HTMLElement>('.gg-chipbtn.on');
    if (!row || !chip) return;
    const left = chip.offsetLeft - (row.clientWidth - chip.clientWidth) / 2;
    row.scrollTo?.({ left: Math.max(0, left), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [active]);

  const jump = (id: string) => {
    setActive(id);
    jumping.current = Date.now() + 700;
    document.getElementById(`go-g-${id}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };

  const place = async () => {
    if (!stay) return;
    let scheduledFor: string | undefined;
    if (later) {
      if (!day || !time || scheduleError) {
        setError(scheduleError ?? p.later);
        return;
      }
      scheduledFor = `${day}T${time}:00+05:30`;
      if (Date.parse(scheduledFor) < nowForSchedule() + 15 * 60_000) {
        setError(p.tooSoon);
        return;
      }
    }
    const how: OrderPayWith = payOnline ? payWith : 'room_bill';
    setBusy(true);
    setError(null);
    const res = await guestApi.placeOrder({ qty, payWith: how, note: note.trim(), scheduledFor });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.details?.fields?.cart ?? res.error.details?.fields?.payWith ?? errorText(res.error));
      return;
    }
    const r = res.data;
    const roomNo = room ?? stay.roomNumber;
    toast.show({
      tone: 'success',
      text: how === 'pay_now' ? oc.paid(r.orderNo, r.etaMinutes) : scheduledFor ? oc.addedLater(r.orderNo, roomNo, formatDate(scheduledFor), formatTime(scheduledFor)) : oc.addedRoom(r.orderNo, roomNo, r.etaMinutes),
    });
    setSheet(false);
    setQty({});
    setNote('');
    setLater(closedNow);
    setTime('');
    // the new order shows at the top of the live orders; the tab bar's count and Home follow
    poll.reload();
    refreshGuest();
    window.scrollTo?.({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  // the Your orders tab only: on the menu the kitchen card already says the room, the hotel and the hours
  const status = orderStatusLine({ roomNumber: mode === 'order' ? room : null, hotelName, hours: hoursShort(info.hours, today, clock) });
  const opens = closedNow && !paused ? kitchenOpensText(info.hours.days, today, clock) : null;
  const noMatch = (words.length > 0 || vegOnly) && groups.length === 0;

  const actions = (
    <>
      {reception ? (
        <a className="pt-btn pt-btn-line go-icon" href={telHref(reception)} aria-label={`${oc.call} · ${reception}`}>
          <Bi name="telephone" />
          <span className={phone ? 'visually-hidden' : ''}>{oc.call}</span>
        </a>
      ) : null}
    </>
  );

  const cartBody = (
    <CartPanel
      cart={cart}
      room={room ?? stay?.roomNumber ?? ''}
      note={note}
      setNote={setNote}
      later={later}
      setLater={setLater}
      canNow={!closedNow}
      days={days}
      day={day}
      setDay={setDay}
      time={time}
      setTime={setTime}
      scheduleError={scheduleError}
      payOnline={payOnline}
      payWith={payWith}
      setPayWith={setPayWith}
      error={phone ? null : error}
      step={step}
      onClear={() => setQty({})}
    />
  );
  const placeLabel = payOnline && payWith === 'pay_now' ? oc.payAndPlace(inr(cart.totalPaise)) : oc.place;
  const placeButton = (
    <PortalButton icon={payOnline && payWith === 'pay_now' ? 'lock' : 'bag-check'} busy={busy} busyLabel={oc.placing} disabled={cart.count === 0 || !canOrder || (!later && closedNow) || (later && (!day || !time))} onClick={() => void place()}>
      {placeLabel}
    </PortalButton>
  );

  const live = poll.live;
  const showTabs = mode === 'order' || poll.items.length > 0;
  const tabs = showTabs ? (
    <SegTabs
      className="gp-order-tabs"
      label={w.tabsLabel}
      active={view}
      onChange={(id) => setView(id === 'orders' ? 'orders' : 'menu')}
      tabs={[
        { id: 'menu', label: w.menuTab, icon: 'journal-text' },
        { id: 'orders', label: live.length > 0 ? `${w.ordersTab} · ${live.length}` : w.ordersTab, icon: 'bag-check' },
      ]}
    />
  ) : null;

  if (view === 'orders') {
    return (
      <GgPage title={oc.title} status={status} actions={actions} className="gg-order gp-order">
        {tabs}
        <OrdersView
          poll={poll}
          layout="page"
          empty={
            <section className="gg-card gp-orders-empty">
              <EmptyState look="portal" icon="bag" title={w.noOrders} text={w.noOrdersBody}>
                <div className="mt-3">
                  <PortalButton variant="line" icon="journal-text" onClick={() => setView('menu')}>
                    {w.seeMenu}
                  </PortalButton>
                </div>
              </EmptyState>
            </section>
          }
        />
      </GgPage>
    );
  }

  const first = live[0];
  return (
    <GgPage title={oc.title} actions={phone ? actions : undefined} className="gg-order gp-order">
      {tabs}
      {first ? (
        <div className="hm-q gp-onway" role="status">
          <span className="hm-dot gp-dot" aria-hidden="true" />
          <span className="hm-q-text">
            <b>{w.onTheWay(live.length)}</b>
            <span>{`${oc.orderNo(first.orderNo)} · ${roomServiceCopy.statusLabel[first.status]}`}</span>
          </span>
          <PortalButton variant="line" icon="bag-check" onClick={() => setView('orders')}>
            {w.track}
          </PortalButton>
        </div>
      ) : null}
      {mode === 'browse' ? (
        <Banner icon="door-closed" title={upcoming ? oc.browseArriving(formatDate(upcoming.checkIn)) : oc.browseNone} sub={upcoming ? oc.browseArrivingSub : oc.browseNoneSub}>
          {upcoming ? null : <CallReception phone={reception} showNumber={false} />}
        </Banner>
      ) : paused ? (
        <Banner icon="pause-circle" tone="warn" title={oc.paused} sub={oc.pausedSub} />
      ) : closedNow ? (
        <Banner icon="clock" tone="warn" title={opens ? oc.closedOpens(opens) : oc.closedNoHours} sub={opens ? oc.closedSchedule : oc.closedNoHoursSub} />
      ) : null}

      <div className="go-layout">
        <div className="go-menu" ref={menuRef}>
          {/* the kitchen's header card (a food app's restaurant header): where it goes, whether it is open, how much there is */}
          <section className="gg-card go-kitchen" aria-label={oc.kitchen}>
            <div className="go-kitchen-main">
              <span className="go-kitchen-eyebrow">{oc.kitchen}</span>
              <h2 className="go-kitchen-name">{hotelName ?? oc.title}</h2>
              <div className="go-kitchen-facts">
                {mode === 'order' && room ? (
                  <span className="gg-chip gg-chip-ink">
                    <Bi name="door-open" /> {oc.deliverTo(room)}
                  </span>
                ) : null}
                <span className={`gg-chip ${closedNow ? 'gg-chip-warn' : 'gg-chip-muted'}`}>
                  <Bi name="clock" /> {hoursShort(info.hours, today, clock)}
                </span>
                <span className="gg-chip gg-chip-muted">
                  <Bi name="journal-text" /> {oc.dishes(dishCount)}
                </span>
              </div>
            </div>
            {/* a desktop has no large title row: Call sits on the kitchen's card */}
            {!phone && reception ? (
              <a className="pt-btn pt-btn-line go-kitchen-call" href={telHref(reception)} aria-label={`${oc.call} · ${reception}`}>
                <Bi name="telephone" />
                <span>{oc.call}</span>
              </a>
            ) : null}
          </section>

          <div className="go-tools" ref={chipsRef}>
            <div className="go-tools-top">
              <div className="go-search">
                <ListSearch theme="portal" value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={oc.search} />
              </div>
              {/* check-shared-ignore: the menu's "Veg only" switch (a food-app filter), no kit piece draws it */}
              <button type="button" className={`go-veg-switch${vegOnly ? ' on' : ''}`} role="switch" aria-checked={vegOnly} onClick={() => setVegOnly((v) => !v)}>
                <span className="go-veg veg" aria-hidden="true" />
                <span>{oc.vegOnly}</span>
                <span className="go-veg-knob" aria-hidden="true" />
              </button>
            </div>
            {groups.length > 1 ? (
              <div className="go-tools-row">
                <GgChips label={oc.menuLabel} value={active} onChange={jump} items={groups.map((g) => ({ id: g.id, label: g.label, count: shownItems(g).length }))} />
              </div>
            ) : null}
          </div>

          {noMatch ? (
            <section className="gg-card">
              <EmptyState look="portal" icon="search" text={oc.noMatch}>
                <PortalButton variant="line" className="mt-2" onClick={() => setTyped('')}>
                  {oc.clearSearch}
                </PortalButton>
              </EmptyState>
            </section>
          ) : null}

          {sections.length === 0 ? (
            <section className="gg-card">
              <p className="go-card-meta go-empty">{oc.emptyGroup}</p>
            </section>
          ) : null}
          {groups.map((g) => {
            const items = shownItems(g);
            return (
              <section key={g.id} id={`go-g-${g.id}`} className="gg-card go-group" aria-labelledby={`go-gh-${g.id}`}>
                <div className="go-group-head">
                  <h2 id={`go-gh-${g.id}`}>{g.label}</h2>
                  <span>{oc.dishes(items.length)}</span>
                </div>
                {items.map((item) => (
                  <ItemRow key={item.id} item={item} icon={biOf(g.items[0]?.group.icon ?? 'utensils')} n={qty[item.id] ?? 0} canOrder={canOrder} step={step} />
                ))}
              </section>
            );
          })}
        </div>

        {phone ? null : (
          <aside className="go-side">
            {mode === 'order' ? (
              <section className="gg-card go-cart" aria-label={oc.cartTitle}>
                <div className="gg-card-head">
                  <h2>{oc.cartTitle}</h2>
                  {room ? <span className="gg-card-sub"><Bi name="door-open" /> {tr("Room")} {room}</span> : null}
                </div>
                {cartBody}
                {cart.count > 0 ? <div className="go-cart-act">{placeButton}</div> : null}
              </section>
            ) : null}
          </aside>
        )}
      </div>

      {phone && canOrder && cart.count > 0 ? (
        <GgActionBar
          label={oc.cartTitle}
          summary={oc.cartBar(cart.count, inr(cart.totalPaise))}
          action={
            <PortalButton icon="bag" onClick={() => setSheet(true)}>
              {oc.viewCart}
            </PortalButton>
          }
        />
      ) : null}
      <GgSheet open={phone && sheet && cart.count > 0} title={oc.sheetTitle} onClose={() => setSheet(false)} 
        className="go-sheet"
        footer={
          <>
            {/* a phone: the order's error sits right above the button that caused it, never scrolled out of view */}
            {error ? (
              <div className="pt-alert err go-foot-err" role="alert">
                <Bi name="exclamation-circle" />
                <div>{error}</div>
              </div>
            ) : null}
            {placeButton}
          </>
        }
      >
        {cartBody}
      </GgSheet>
    </GgPage>
  );
}

/**
 * One dish in a food app's layout (MJ, 26 Oct 2026): at the left the veg mark, the name, the price and the note; at the right the photo with the Add button
 * over its lower edge, which turns into the stepper. Without a photo the button stands alone at the right. A dish that is off shows "Not available now".
 */
function ItemRow({ item, icon, n, canOrder, step }: { item: MenuItem; icon: string; n: number; canOrder: boolean; step: (id: string, delta: number) => void }) {
  const orderCopy = useCopy(orderCopyByLanguage);
  const oc = orderCopy;
  const guestCopy = useCopy(guestCopyByLanguage);
  const control =
    canOrder && item.available ? (
      n === 0 ? (
        // check-shared-ignore: the dish's Add button (becomes the stepper), no kit piece draws it
        <button type="button" className="go-add" aria-label={oc.add(item.name)} onClick={() => step(item.id, 1)}>
          <span>{oc.addShort}</span>
          <Bi name="plus-lg" />
        </button>
      ) : (
        <Stepper name={item.name} n={n} onStep={(d) => step(item.id, d)} />
      )
    ) : null;
  return (
    <div className={`go-item${item.available ? '' : ' off'}${n > 0 ? ' picked' : ''}${item.photoUrl ? ' has-photo' : ''}`}>
      <div className="go-item-main">
        {item.veg === 'yes' || item.veg === 'no' ? <span className={`go-veg ${item.veg === 'yes' ? 'veg' : 'nonveg'}`} role="img" aria-label={item.veg === 'yes' ? 'Vegetarian' : 'Non-vegetarian'} /> : null}
        <span className="go-item-name">{item.name}</span>
        <span className="go-item-price">{item.pricePaise > 0 ? inr(item.pricePaise) : oc.free}</span>
        {item.note || !item.available ? <span className="go-item-note">{item.available ? item.note : guestCopy.order.soldOut}</span> : null}
      </div>
      <div className="go-item-side">
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed-in photo from the API (the session cookie goes with it); next/image would fetch it from its own server */}
        {item.photoUrl ? <img className="go-photo" src={item.photoUrl} alt="" loading="lazy" decoding="async" /> : <span className="go-photo none" aria-hidden="true"><Bi name={icon} /></span>}
        {control ? <div className="go-item-ctl">{control}</div> : null}
      </div>
    </div>
  );
}

function Stepper({ name, n, onStep }: { name: string; n: number; onStep: (delta: number) => void }) {
  const guestCopy = useCopy(guestCopyByLanguage);
  return (
    <span className="go-step" role="group" aria-label={name}>
      {/* check-shared-ignore: the quantity stepper's minus (44px), no kit piece draws it */}
      <button type="button" className="go-step-btn" aria-label={`${guestCopy.order.less}: ${name}`} onClick={() => onStep(-1)}>
        <Bi name={n === 1 ? 'trash3' : 'dash-lg'} />
      </button>
      <span className="go-step-n" aria-live="polite">
        {n}
      </span>
      {/* check-shared-ignore: the quantity stepper's plus (44px), no kit piece draws it */}
      <button type="button" className="go-step-btn" aria-label={`${guestCopy.order.more}: ${name}`} disabled={n >= MAX_ITEM_QTY} onClick={() => onStep(1)}>
        <Bi name="plus-lg" />
      </button>
    </span>
  );
}

type CartPanelProps = {
  cart: ReturnType<typeof cartSummary>;
  room: string;
  note: string;
  setNote: (v: string) => void;
  later: boolean;
  setLater: (v: boolean) => void;
  canNow: boolean;
  days: { value: string; label: string }[];
  day: string;
  setDay: (v: string) => void;
  time: string;
  setTime: (v: string) => void;
  scheduleError: string | null;
  payOnline: boolean;
  payWith: OrderPayWith;
  setPayWith: (v: OrderPayWith) => void;
  error: string | null;
  step: (id: string, delta: number) => void;
  onClear: () => void;
};

/** The order: its lines (with steppers), GST and total, the note, when, and how it is paid. One copy on screen at a time (the sheet or the side card). */
function CartPanel(x: CartPanelProps) {
  const orderCopy = useCopy(orderCopyByLanguage);
  const oc = orderCopy;
  const guestCopy = useCopy(guestCopyByLanguage);
  if (x.cart.count === 0) return <p className="go-cart-empty">{oc.cartEmpty}</p>;
  return (
    <div className="go-cartbody">
      <div className="go-lines">
        {x.cart.lines.map((l) => (
          <div key={l.item.id} className="go-line">
            <span className="go-line-name">{l.item.name}</span>
            <Stepper name={l.item.name} n={l.qty} onStep={(d) => x.step(l.item.id, d)} />
            <span className="go-line-amt">{inr(l.amountPaise)}</span>
          </div>
        ))}
        <div className="go-line sub">
          <span>{guestCopy.order.gst}</span>
          <span className="go-line-amt">{inr(x.cart.gstPaise)}</span>
        </div>
        <div className="go-line total">
          <span>{guestCopy.order.total}</span>
          <span className="go-line-amt">{inr(x.cart.totalPaise)}</span>
        </div>
        {x.cart.parts.length > 1 ? <p className="go-card-meta">{oc.billedSplit}</p> : null}
      </div>

      <div className="pt-form go-field">
        <label htmlFor="go-note">{guestCopy.order.note}</label>
        <Textarea look="portal" id="go-note" rows={2} maxLength={200} value={x.note} onChange={(e) => x.setNote(e.target.value)} placeholder={guestCopy.order.notePlaceholder} />
      </div>

      <fieldset className="go-field go-choice">
        <legend>{oc.when}</legend>
        <label className={`go-opt${x.canNow ? '' : ' off'}`}>
          <input type="radio" name="go-when" checked={!x.later} disabled={!x.canNow} onChange={() => x.setLater(false)} />
          <span>{oc.now}</span>
        </label>
        <label className="go-opt">
          <input type="radio" name="go-when" checked={x.later} onChange={() => x.setLater(true)} />
          <span>{oc.later}</span>
        </label>
      </fieldset>
      {x.later ? (
        <div className="go-when">
          <div className="pt-form">
            <label htmlFor="go-when-day">{oc.day}</label>
            <Select id="go-when-day" className="pt-input" value={x.day} onChange={(e) => x.setDay(e.target.value)}>
              {x.days.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="pt-form">
            <label htmlFor="go-when-time">{oc.time}</label>
            <input id="go-when-time" type="time" className="pt-input" value={x.time} onChange={(e) => x.setTime(e.target.value)} />
          </div>
        </div>
      ) : null}
      {x.scheduleError ? (
        <p className="go-card-meta go-err" role="alert">
          {x.scheduleError}
        </p>
      ) : null}

      <fieldset className="go-field go-choice">
        <legend>{oc.payWith}</legend>
        {x.payOnline ? (
          <>
            <label className="go-opt">
              <input type="radio" name="go-pay" checked={x.payWith === 'room_bill'} onChange={() => x.setPayWith('room_bill')} />
              <span>
                {oc.roomBill(x.room)}
                <small>{oc.roomBillSub}</small>
              </span>
            </label>
            <label className="go-opt">
              <input type="radio" name="go-pay" checked={x.payWith === 'pay_now'} onChange={() => x.setPayWith('pay_now')} />
              <span>
                {oc.payNow}
                <small>{oc.payNowSub}</small>
              </span>
            </label>
          </>
        ) : (
          <div className="go-opt fixed">
            <Bi name="journal-plus" />
            <span>
              {oc.roomBill(x.room)}
              <small>{oc.roomBillSub}</small>
            </span>
          </div>
        )}
      </fieldset>

      {x.error ? (
        <div className="pt-alert err" role="alert">
          <Bi name="exclamation-circle" />
          <div>{x.error}</div>
        </div>
      ) : null}
      {/* check-shared-ignore: a quiet text action under the order (empties the cart) */}
      <button type="button" className="go-clear" onClick={x.onClear}>
        {oc.clear}
      </button>
    </div>
  );
}
