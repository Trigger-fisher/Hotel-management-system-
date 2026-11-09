'use client';

// The staff's order taker inside Dining orders: pick the table or the guest's room, add items, send to the kitchen. A room order is charged to the guest's room bill;
// a table order is billed at the table (from its card). The server checks the menu, the stay and the quantities.
import { useMemo, useState } from 'react';

import { formatINR } from '@shared/dashboards/format';
import type { PlaceOrderInput, PosSetup } from '@shared/dashboards/roomService';

import { useAction, useAsync } from '@/components/ui';
import { Bi, Button, EmptyState, FieldError, LoadError, PageSkeleton, SegTabs, Textarea } from '../../pallav/ui';
import { deskOrdersApi } from '../roomService/api';

import { tr, trf } from '@/lib/i18n/language';
type Where = 'table' | 'room';

export function DiningPos({ onClose, onPlaced }: { onClose: () => void; onPlaced: () => void }) {
  const setup = useAsync(() => deskOrdersApi.pos(), []);
  const data = setup.state.status === 'ready' ? setup.state.data : null;
  return (
    <section className="card reveal hu-pos" aria-label={tr("Take an order")}>
      <header className="hu-pos-head">
        <h2 className="hu-pos-title">{tr("Take an order")}</h2>
        <Button variant="ghost" size="sm" icon="x-lg" onClick={onClose}>{tr("Back to orders")}</Button>
      </header>
      {!data && setup.state.status === 'loading' ? <PageSkeleton /> : null}
      {!data && setup.state.status === 'error' ? <LoadError error={setup.state.error} onRetry={setup.reload} /> : null}
      {data ? <PosForm setup={data} onPlaced={onPlaced} /> : null}
    </section>
  );
}

function PosForm({ setup, onPlaced }: { setup: PosSetup; onPlaced: () => void }) {
  const [where, setWhere] = useState<Where>('table');
  const [table, setTable] = useState('');
  const [stayId, setStayId] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();

  const categories = useMemo(() => Array.from(new Set(setup.menu.map((m) => m.category))), [setup.menu]);
  const shown = setup.menu.filter((m) => !category || m.category === category);
  const picked = setup.menu.filter((m) => (qty[m.id] ?? 0) > 0);
  const count = picked.reduce((n, m) => n + (qty[m.id] ?? 0), 0);
  const total = picked.reduce((n, m) => n + (qty[m.id] ?? 0) * m.pricePaise, 0);
  const step = (id: string, d: number) => {
    setErrors((e) => ({ ...e, cart: '' }));
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(20, (q[id] ?? 0) + d)) }));
  };

  const send = () => {
    const input: PlaceOrderInput = where === 'table' ? { kind: 'table', table, qty, note } : { kind: 'room', stayId, qty, note };
    const e: Record<string, string> = {};
    if (where === 'table' && !table) e.table = tr("Choose the table.");
    if (where === 'room' && !stayId) e.stayId = tr("Choose the room.");
    if (count === 0) e.cart = tr("Add at least one item.");
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    void run(() => deskOrdersApi.place(input), {
      success: where === 'table' ? trf("Sent to the kitchen for table {0}.", [table]) : tr("Sent to the kitchen. It is on the room bill."),
      onOk: onPlaced,
      onFields: (f) => setErrors(f),
    });
  };

  return (
    <div className="hu-pos-body">
      <div className="hu-pos-main">
        <div className="hu-pos-step">
          <h3 className="hu-pos-q"><span className="hu-pos-n">1</span>{tr("Where is it for?")}</h3>
          <SegTabs
            label="Where is it for?"
            active={where}
            onChange={(id) => { setWhere(id as Where); setErrors({}); }}
            tabs={[{ id: 'table', label: 'Restaurant table', icon: 'cup-hot' }, { id: 'room', label: 'Hotel room', icon: 'door-open' }]}
          />
          {where === 'table' ? (
            <div className="hu-pos-chips" role="radiogroup" aria-label={tr("Table")}>
              {setup.tables.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={table === t} className={`hu-pos-chip${table === t ? ' is-on' : ''}`} onClick={() => { setTable(t); setErrors((e) => ({ ...e, table: '' })); }}>
                  {t}
                </button>
              ))}
            </div>
          ) : setup.rooms.length === 0 ? (
            <EmptyState icon="door-closed" title={tr("No guest is staying now")} text={tr("A room order can only be taken for a guest who is in the hotel.")} />
          ) : (
            <div className="hu-pos-rooms" role="radiogroup" aria-label={tr("Room")}>
              {setup.rooms.map((r) => (
                <button key={r.stayId} type="button" role="radio" aria-checked={stayId === r.stayId} className={`hu-pos-room${stayId === r.stayId ? ' is-on' : ''}`} onClick={() => { setStayId(r.stayId); setErrors((e) => ({ ...e, stayId: '' })); }}>
                  <b>{r.roomNumber}</b>
                  <small>{r.guestName}</small>
                </button>
              ))}
            </div>
          )}
          <FieldError>{where === 'table' ? errors.table : errors.stayId}</FieldError>
        </div>

        <div className="hu-pos-step">
          <h3 className="hu-pos-q"><span className="hu-pos-n">2</span>{tr("What did they order?")}</h3>
          {categories.length > 1 && (
            <div className="hu-pos-cats" role="group" aria-label={tr("Menu section")}>
              <button type="button" className={`hu-pos-cat${category === '' ? ' is-on' : ''}`} aria-pressed={category === ''} onClick={() => setCategory('')}>{tr("All")}</button>
              {categories.map((c) => (
                <button key={c} type="button" className={`hu-pos-cat${category === c ? ' is-on' : ''}`} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>
              ))}
            </div>
          )}
          {setup.menu.length === 0 ? (
            <EmptyState icon="journal-text" title={tr("The menu is empty")} text={tr("Add dishes to the restaurant menu first.")} />
          ) : (
            <ul className="hu-pos-menu">
              {shown.map((m) => {
                const n = qty[m.id] ?? 0;
                return (
                  <li key={m.id} className={n > 0 ? 'is-on' : ''}>
                    <span className="hu-pos-item">
                      <b>{m.name}</b>
                      <small>{formatINR(m.pricePaise)}</small>
                    </span>
                    <span className="hu-pos-step-btns" role="group" aria-label={m.name}>
                      <button type="button" className="hu-pos-sb" aria-label={trf("One less {0}", [m.name])} disabled={n === 0} onClick={() => step(m.id, -1)}><Bi name="dash-lg" /></button>
                      <output className="hu-pos-n-out" aria-live="polite">{n}</output>
                      <button type="button" className="hu-pos-sb" aria-label={trf("One more {0}", [m.name])} onClick={() => step(m.id, 1)}><Bi name="plus-lg" /></button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <FieldError>{errors.cart}</FieldError>
          <label className="form-label mt-3" htmlFor="pos-note">{tr("Note for the kitchen (optional)")}</label>
          <Textarea id="pos-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <aside className="hu-pos-bar" aria-label={tr("This order")}>
        <div className="hu-pos-sum">
          <b>{count === 0 ? tr("Nothing added yet") : count === 1 ? tr("1 item") : trf("{0} items", [count])}</b>
          <span>{formatINR(total)}</span>
        </div>
        {picked.length > 0 && (
          <ul className="hu-pos-picked">
            {picked.map((m) => (
              <li key={m.id}><span className="hu-qty">{qty[m.id]}×</span><span className="hu-item">{m.name}</span><span className="hu-line-amt">{formatINR((qty[m.id] ?? 0) * m.pricePaise)}</span></li>
            ))}
          </ul>
        )}
        <Button icon="send" busy={busy} busyLabel={tr("Sending…")} onClick={send} disabled={busy}>{tr("Send to kitchen")}</Button>
      </aside>
    </div>
  );
}
