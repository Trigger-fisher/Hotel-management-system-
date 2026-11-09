'use client';

// hotel.fo.roomOrders - Dining orders in two parts: what staff take (at a restaurant table, or for a guest's room) and what guests order themselves. Each card says what
// to make and for where, and offers the next step (a step may be skipped from More, never undone); Cancel needs a reason. The guests' cancel window sits above their orders,
// and each guest order counts down what is left of it; staff orders are never held to it.
import { useEffect, useRef, useState } from 'react';

import { formatDateTime, formatINR, formatTime } from '@shared/dashboards/format';
import { userMayEdit } from '@shared/dashboards/features';
import { CANCEL_REASON_MAX, GUEST_CANCEL_MINUTES_MAX, mayChangeGuestCancelWindow, ROOM_ORDER_STEPS, roomServiceCopy, type DeskRoomOrder, type RoomOrderStatus } from '@shared/dashboards/roomService';

import { useAction, useAsync, usePageSize } from '@/components/ui';
import { Bi, Button, Dropdown, EmptyState, FieldError, FilterBar, LoadError, Modal, PageHead, Pager, pagerView, PageSkeleton, SegTabs, StatusChip, Textarea } from '../../pallav/ui';
import type { ScreenProps } from '../../types';
import { deskOrdersApi } from '../roomService/api';
import { DiningPos } from './DiningPos';
import { FoNav } from './foKit';

import { tr, trf } from '@/lib/i18n/language';
type Tab = 'open' | 'all' | 'delivered' | 'cancelled';
type Part = 'staff' | 'guest';
type Step = Exclude<RoomOrderStatus, 'cancelled' | 'placed'>;
const TABS: { id: Tab; label: string }[] = [
  { id: 'open', label: 'To do' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];
const TONE: Record<RoomOrderStatus, 'ok' | 'warn' | 'neutral' | 'danger'> = { placed: 'danger', accepted: 'warn', preparing: 'warn', on_the_way: 'warn', delivered: 'ok', cancelled: 'neutral' };
const NEXT_LABEL: Record<Step, string> = { accepted: 'Accept order', preparing: 'Start preparing', on_the_way: 'Send it out', delivered: 'Mark delivered' };
const SKIP_LABEL: Record<Step, string> = { accepted: 'Accepted', preparing: 'Skip to preparing', on_the_way: 'Skip to on the way', delivered: 'Skip to delivered' };
const STEP_LABEL: Record<Step, string> = { accepted: 'Accepted', preparing: 'Preparing', on_the_way: 'On the way', delivered: 'Delivered' };
const WAIT_WARN_MIN = 10;

export function RoomOrdersScreen({ user, navigate }: ScreenProps) {
  const [part, setPart] = useState<Part>('staff');
  const [taking, setTaking] = useState(false);
  const [tab, setTab] = useState<Tab>('open');
  const [page, setPage] = useState(1);
  const pageSize = usePageSize(25);
  const [version, setVersion] = useState(0);
  const list = useAsync(async () => {
    const res = await deskOrdersApi.list({ status: tab, source: part, page, pageSize });
    return res.ok ? { ...res, data: { ...res.data, now: Date.now() } } : res;
  }, [tab, part, page, pageSize, version], { keep: true });
  const data = list.state.status === 'ready' ? list.state.data : null;
  const [cancelling, setCancelling] = useState<DeskRoomOrder | null>(null);
  const [billing, setBilling] = useState<DeskRoomOrder | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);
  const canEdit = userMayEdit('pms');
  const mayChangeWindow = canEdit && mayChangeGuestCancelWindow(user.role);
  const { busy, run } = useAction();
  const reload = () => setVersion((n) => n + 1);
  const move = (o: DeskRoomOrder, status: Step) =>
    void run(() => deskOrdersApi.setStatus(o.id, status), { success: trf("Order {0}: {1}.", [o.orderNo, roomServiceCopy.statusLabel[status]]), onOk: reload });
  const openByPart = data?.openByPart;

  return (
    <>
      <PageHead sub={tr("Take orders for the restaurant and for rooms, and look after what guests order themselves.")}>
        <FoNav active="roomOrders" navigate={navigate} />
      </PageHead>

      <SegTabs
        className="hu-parts"
        label="Dining orders"
        active={part}
        onChange={(id) => { setPart(id as Part); setTab('open'); setPage(1); setTaking(false); }}
        tabs={[
          { id: 'staff', label: <>{tr("Staff orders")}{openByPart && openByPart.staff > 0 ? <span className="hu-part-n">{openByPart.staff}</span> : null}</>, icon: 'person-badge' },
          { id: 'guest', label: <>{tr("Guest orders")}{openByPart && openByPart.guest > 0 ? <span className="hu-part-n">{openByPart.guest}</span> : null}</>, icon: 'phone' },
        ]}
      />

      {part === 'staff' && !taking && (
        <div className="hu-take">
          <div className="hu-take-text">
            <b>{tr("Taking an order for the restaurant or a room?")}</b>
            <small>{tr("Pick the table or the room, add the dishes, send it to the kitchen.")}</small>
          </div>
          {canEdit && <Button icon="plus-lg" onClick={() => setTaking(true)}>{tr("Take an order")}</Button>}
        </div>
      )}
      {part === 'staff' && taking && <DiningPos onClose={() => setTaking(false)} onPlaced={() => { setTaking(false); setTab('open'); reload(); }} />}

      {part === 'guest' && data && (
        <div className="hm-q hu-oneline">
          <Bi name="clock-history" className="hu-oneline-ic" />
          <div className="hm-q-text">
            <b>{data.guestCancelMinutes === 0 ? tr("Guests cannot cancel their own orders") : trf("Guests may cancel within {0} minutes of ordering", [data.guestCancelMinutes])}</b>
            <small>{tr("After that only the hotel can cancel.")}</small>
          </div>
          {mayChangeWindow && <Button variant="outline" size="sm" onClick={() => setWindowOpen(true)}>{tr("Change")}</Button>}
        </div>
      )}

      {!(part === 'staff' && taking) && <FilterBar
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, count: t.id === 'open' && data ? data.openByPart[part] : undefined }))}
        active={tab}
        onTab={(id) => {
          setTab(id as Tab);
          setPage(1);
        }}
        summary={data ? <><b>{data.total}</b> {data.total === 1 ? tr("order") : tr("orders")}</> : null}
      />}
      {!(part === 'staff' && taking) && !data && list.state.status === 'loading' ? <PageSkeleton /> : null}
      {!(part === 'staff' && taking) && !data && list.state.status === 'error' ? <LoadError error={list.state.error} onRetry={list.reload} /> : null}
      {!(part === 'staff' && taking) && data && data.items.length === 0 ? (
        <div className="card reveal">
          <EmptyState
            icon="cup-hot"
            title={tab === 'open' ? tr("Nothing to make right now") : tr("No orders here")}
            text={part === 'staff' ? tr("Orders taken at a table or for a room show here until they are served.") : tr("Orders guests place from their portal show here for the kitchen and the front desk.")}
          />
        </div>
      ) : !(part === 'staff' && taking) && data ? (
        <>
          <div className="hu-orders reveal">
            {data.items.map((o) => <OrderCard key={o.id} order={o} now={data.now} canEdit={canEdit} busy={busy} onMove={move} onCancel={setCancelling} onBill={setBilling} onExpired={reload} />)}
          </div>
          <Pager view={pagerView(data, { setPage })} server />
        </>
      ) : null}
      {billing ? <BillTable order={billing} onClose={() => setBilling(null)} onDone={() => { setBilling(null); reload(); }} /> : null}
      {cancelling ? (
        <CancelOrder
          order={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            reload();
          }}
        />
      ) : null}
      {windowOpen && mayChangeWindow ? <CancelWindow onClose={() => setWindowOpen(false)} onSaved={() => { setWindowOpen(false); reload(); }} /> : null}
    </>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

/** What is left of the guest's cancel window, counting down by the second (the server decides the end; this only shows it). */
function CancelCountdown({ until, onExpired }: { until: string; onExpired: () => void }) {
  const end = new Date(until).getTime();
  const now = useNow(true);
  const left = Math.max(0, Math.ceil((end - now) / 1000));
  const fired = useRef(false);
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onExpired();
    }
  }, [left, onExpired]);
  if (left === 0) return null;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return (
    <span className="hu-countdown" role="timer" aria-label={trf("The guest can still cancel for {0} minutes {1} seconds", [mm, left % 60])}>
      <Bi name="hourglass-split" /> {trf("Guest can cancel for {0}", [`${mm}:${ss}`])}
    </span>
  );
}

function OrderCard({ order: o, now, canEdit, busy, onMove, onCancel, onBill, onExpired }: { order: DeskRoomOrder; now: number; canEdit: boolean; busy: boolean; onMove: (o: DeskRoomOrder, s: Step) => void; onCancel: (o: DeskRoomOrder) => void; onBill: (o: DeskRoomOrder) => void; onExpired: () => void }) {
  const at = ROOM_ORDER_STEPS.indexOf(o.status as Step);
  const closed = o.status === 'cancelled' || o.status === 'delivered';
  const next = closed ? [] : (ROOM_ORDER_STEPS.slice(at + 1) as Step[]);
  const waited = Math.max(0, Math.floor((now - new Date(o.placedAt).getTime()) / 60000));
  const late = o.status === 'placed' && !o.scheduledFor && waited >= WAIT_WARN_MIN;
  const items = o.lines.reduce((n, l) => n + l.qty, 0);
  return (
    <article className={`card hu-order${late ? ' is-late' : ''}${closed ? ' is-closed' : ''}`} aria-label={trf("Order {0}", [o.orderNo])}>
      <div className="hu-order-head">
        <div className="hu-order-room">
          <small>{o.tableLabel ? tr("Table") : tr("Room")}</small>
          <b>{o.tableLabel ?? o.roomNumber ?? '–'}</b>
        </div>
        <div className="hu-order-who">
          <b>{o.tableLabel ? tr("Restaurant") : o.guestName}</b>
          <small>
            {trf("Order {0}", [o.orderNo])} · {o.scheduledFor ? trf("for {0}", [formatDateTime(o.scheduledFor)]) : trf("placed {0}", [formatTime(o.placedAt)])}
            {!closed && !o.scheduledFor && waited > 0 && <> · <span className={late ? 'hu-late' : undefined}>{trf("{0} min ago", [waited])}</span></>}
          </small>
        </div>
        <StatusChip tone={TONE[o.status]}>{roomServiceCopy.statusLabel[o.status]}</StatusChip>
      </div>

      {o.status !== 'cancelled' && (
        <ol className="hu-steps" aria-label={tr("Progress")}>
          {(ROOM_ORDER_STEPS as readonly Step[]).map((s, i) => (
            <li key={s} className={i <= at ? 'is-done' : ''} aria-current={i === at ? 'step' : undefined}>{tr(STEP_LABEL[s])}</li>
          ))}
        </ol>
      )}

      <ul className="hu-order-lines">
        {o.lines.map((l, i) => (
          <li key={`${l.name}-${i}`}>
            <span className="hu-qty">{l.qty}×</span>
            <span className="hu-item">{l.name}</span>
            <span className="hu-line-amt">{formatINR(l.amountPaise)}</span>
          </li>
        ))}
        {o.lines.length > 1 && (
          <li className="hu-order-total">
            <span className="hu-qty" />
            <span className="hu-item">{trf("{0} items", [items])}</span>
            <span className="hu-line-amt">{formatINR(o.totalPaise)}</span>
          </li>
        )}
      </ul>

      {o.note ? <p className="hu-notes"><Bi name="chat-left-text" /> {o.note}</p> : null}
      {o.cancellableUntil ? <CancelCountdown until={o.cancellableUntil} onExpired={onExpired} /> : null}

      <div className="hu-order-foot">
        <span className="hu-order-meta">
          {o.status === 'cancelled'
            ? `${o.cancelledBy === 'hotel' && o.cancelReason ? roomServiceCopy.cancelledByHotel(o.cancelReason) : tr("Cancelled by the guest.")}${o.statusByName ? ` · ${o.statusByName}` : ''}`
            : `${roomServiceCopy.statusLabel[o.status]} ${formatTime(o.statusAt)}${o.statusByName ? ` · ${o.statusByName}` : ''}`}
        </span>
        {canEdit && next.length > 0 ? (
          <span className="hu-order-acts">
            {o.tableLabel ? <Button size="sm" variant="outline" icon="receipt" disabled={busy} onClick={() => onBill(o)}>{tr("Bill")}</Button> : null}
            <Button size="sm" disabled={busy} onClick={() => onMove(o, next[0])}>{tr(NEXT_LABEL[next[0]])}</Button>
            <Dropdown align="end" button={(p) => <Button variant="outline" size="sm" icon="three-dots" aria-label={trf("More for order {0}", [o.orderNo])} disabled={busy} {...p}>{tr("More")}</Button>}>
              {next.slice(1).map((s) => (
                <a key={s} href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); onMove(o, s); }}>
                  <Bi name="skip-forward" /> {tr(SKIP_LABEL[s])}
                </a>
              ))}
              <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); onCancel(o); }}>
                <Bi name="x-circle" /> {tr("Cancel order")}
              </a>
            </Dropdown>
          </span>
        ) : null}
      </div>
    </article>
  );
}

function BillTable({ order, onClose, onDone }: { order: DeskRoomOrder; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const pay = () => void run(() => deskOrdersApi.setStatus(order.id, 'delivered'), { success: trf("Table {0} billed and closed.", [order.tableLabel ?? '']), onOk: onDone });
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      eyebrow={trf("Table {0}", [order.tableLabel ?? ''])}
      title={trf("Bill for order {0}", [order.orderNo])}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Not yet")}</Button>
          <Button icon="check-lg" onClick={pay} busy={busy} busyLabel={tr("Closing…")}>{tr("Paid, close the table")}</Button>
        </>
      }
    >
      <ul className="hu-order-lines">
        {order.lines.map((l, i) => (
          <li key={`${l.name}-${i}`}>
            <span className="hu-qty">{l.qty}×</span>
            <span className="hu-item">{l.name}</span>
            <span className="hu-line-amt">{formatINR(l.amountPaise)}</span>
          </li>
        ))}
        <li className="hu-order-total">
          <span className="hu-qty" />
          <span className="hu-item"><b>{tr("Total")}</b></span>
          <span className="hu-line-amt"><b>{formatINR(order.totalPaise)}</b></span>
        </li>
      </ul>
    </Modal>
  );
}

function CancelOrder({ order, onClose, onDone }: { order: DeskRoomOrder; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const send = () => {
    if (reason.trim().length < 3) {
      setError(roomServiceCopy.reasonNeeded);
      return;
    }
    void run(() => deskOrdersApi.cancel(order.id, reason.trim()), { success: trf("Order {0} cancelled.", [order.orderNo]), onOk: onDone, onFields: (f) => setError(f.reason ?? null) });
  };
  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={order.roomNumber ? trf("Room {0}", [order.roomNumber]) : undefined}
      title={trf("Cancel order {0}?", [order.orderNo])}
      onSubmit={send}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tr("Keep it")}
          </Button>
          <Button type="submit" variant="dangerSolid" icon="x-circle" busy={busy} busyLabel={tr("Cancelling…")}>
            {tr("Cancel order")}
          </Button>
        </>
      }
    >
      <label className="form-label" htmlFor="ro-reason">
        {tr("Reason (the guest sees it)")}
      </label>
      <Textarea id="ro-reason" rows={3} maxLength={CANCEL_REASON_MAX} invalid={Boolean(error)} value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} />
      <FieldError>{error}</FieldError>
      <p className="small text-muted mt-2 mb-0">
        <Bi name="info-circle" /> {tr("If the order is already on the room bill, its charge comes off.")}
      </p>
    </Modal>
  );
}

function CancelWindow({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const s = useAsync(() => deskOrdersApi.settings(), []);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const ready = s.state.status === 'ready' ? s.state.data : null;
  const max = ready?.maxMinutes ?? GUEST_CANCEL_MINUTES_MAX;
  const shown = value ?? (ready ? String(ready.guestCancelMinutes) : '');
  const save = () => {
    const n = Number(shown);
    if (!Number.isInteger(n) || n < 0 || n > max) {
      setError(trf("Enter a whole number from 0 to {0}.", [max]));
      return;
    }
    void run(() => deskOrdersApi.saveSettings({ guestCancelMinutes: n }), { success: n === 0 ? tr("Guests can no longer cancel their orders.") : trf("Guests may cancel within {0} minutes.", [n]), onOk: onSaved, onFields: (f) => setError(f.guestCancelMinutes ?? null) });
  };
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={tr("Guests' cancel window")}
      onSubmit={save}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" busy={busy} disabled={!ready || value === null}>{tr("Save")}</Button>
        </>
      }
    >
      {s.state.status === 'error' ? (
        <LoadError error={s.state.error} onRetry={s.reload} />
      ) : (
        <>
          <label htmlFor="ro-minutes" className="form-label">{tr("Guests may cancel within")}</label>
          <div className="d-flex align-items-center gap-2">
            <input id="ro-minutes" type="number" inputMode="numeric" min={0} max={max} className={`form-control hu-num${error ? ' is-invalid' : ''}`} value={shown} disabled={!ready || busy} onChange={(e) => { setValue(e.target.value); setError(null); }} />
            <span>{tr("minutes")}</span>
          </div>
          <FieldError>{error}</FieldError>
          <p className="small text-muted mt-2 mb-0">{trf("0 means guests cannot cancel; at most {0}. After the window only the hotel can cancel.", [max])}</p>
        </>
      )}
    </Modal>
  );
}
