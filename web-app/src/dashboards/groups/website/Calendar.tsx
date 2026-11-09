'use client';
// hotel.web.calendar: a week at a time, rooms open and prices by day. Changed boxes are collected and saved together.
// A wide screen shows the week as a grid; a phone shows one day at a time with the same boxes.
import { useState } from 'react';

import { addDays, todayIst, type WebBlockedRange, type WebCalendarCell, type WebCalendarChanges, type WebCalendarRoom, type WebCalendarWeek, type WebOccupancy } from '@shared/dashboards/website';
import { errorText, useAction, useAsync, useToast } from '@/components/ui';
import { Bi, Dropdown, EmptyState, FieldError, FieldHint, FormSection, LoadError, Modal, PageSkeleton, PmsDate, RequiredMark, Button, Select, ListTabs, Table } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { webApi } from './api';
import { Linked, WaNav, dayShort, dM, dMY, paiseOf, plural, rangeText, rupees } from './parts';

import { tr, trf } from '@/lib/i18n/language';
interface Prefill { roomIds: string[]; start: string; end: string }
const SUB = 'Rooms open and the price of each plan, day by day. Change a box, then Save changes. A confirmed stay holds its room from check-in up to the day before check-out.';
const occWord = (occ: WebOccupancy) => (occ === 'single' ? tr('1 guest') : tr('2 guests'));

export function WebsiteCalendar({ navigate }: ScreenProps) {
  const [start, setStart] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const { state, reload } = useAsync(() => webApi.getCalendar(start), [start, version], { keep: true });
  const [room, setRoom] = useState('all');
  const [day, setDay] = useState<string | null>(null);
  const [modal, setModal] = useState<'bulk' | 'block' | 'unblock' | null>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [cap, setCap] = useState<Record<string, string>>({});
  const [price, setPrice] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const toast = useToast();
  const week = state.status === 'ready' ? state.data : null;
  const refresh = () => setVersion((v) => v + 1);
  const count = Object.keys(cap).length + Object.keys(price).length;

  if (!week) {
    return (
      <>
        <div className="page-head reveal"><div><p className="pms-sub">{tr(SUB)}</p></div></div>
        <WaNav active="calendar" navigate={navigate} />
        {state.status === 'error' ? <LoadError error={state.error} onRetry={reload} /> : <PageSkeleton tiles={false} />}
      </>
    );
  }

  const blocked = week.blocked;
  const rooms = room === 'all' ? week.rooms : week.rooms.filter((r) => r.roomId === room);
  const shownDay = day && week.days.includes(day) ? day : week.days.includes(week.today) ? week.today : week.days[0] ?? '';
  const dayIndex = Math.max(0, week.days.indexOf(shownDay));
  const thisWeek = week.days.includes(week.today);

  function save() {
    const changes: WebCalendarChanges = { inventory: [], rates: [] };
    for (const [key, v] of Object.entries(cap)) {
      const [roomId = '', date = ''] = key.split('|');
      changes.inventory.push({ roomId, date, capacity: Number.parseInt(v, 10) });
    }
    for (const [key, v] of Object.entries(price)) {
      const [planId = '', date = '', occ = 'single'] = key.split('|');
      changes.rates.push({ planId, date, occ: occ as WebOccupancy, pricePaise: paiseOf(v) ?? 0 });
    }
    void run(() => webApi.saveCalendar(changes), {
      onOk: (r) => {
        if (r.saved > 0) toast.show({ tone: 'success', text: trf('{0} {1} saved. They are live on the website.', [r.saved, plural(r.saved, 'change')]) });
        if (r.error) toast.show({ tone: 'error', text: r.error });
        setCap({});
        setPrice({});
        refresh();
      },
    });
  }

  const setCapOf = (r: WebCalendarRoom, a: WebCalendarCell, v: string) => {
    const key = `${r.roomId}|${a.date}`;
    setCap((p) => {
      const { [key]: _drop, ...rest } = p;
      void _drop;
      return v === '' || v === String(a.capacity) ? rest : { ...rest, [key]: v };
    });
  };
  const clampCap = (r: WebCalendarRoom, a: WebCalendarCell, v: string) => {
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) return;
    const c = Math.max(a.sold, Math.min(r.totalCount, n));
    if (c !== n) setCapOf(r, a, String(c));
  };
  const capOf = (r: WebCalendarRoom, a: WebCalendarCell) => cap[`${r.roomId}|${a.date}`] ?? String(a.capacity);
  const setPriceOf = (key: string, original: string, v: string) =>
    setPrice((q) => {
      const { [key]: _drop, ...rest } = q;
      void _drop;
      return v === '' || v === original ? rest : { ...rest, [key]: v };
    });

  async function toggle(r: WebCalendarRoom, date: string, undo = false) {
    const res = await webApi.toggleBlock(r.roomId, date);
    if (!res.ok) return toast.show({ tone: 'error', text: errorText(res.error) });
    refresh();
    if (undo) return;
    toast.show({
      tone: 'success',
      text: res.data.blocked ? trf('{0} closed on {1}: guests cannot book it.', [r.roomName, dMY(date)]) : trf('{0} open again on {1}.', [r.roomName, dMY(date)]),
      action: { label: 'Undo', onClick: () => void toggle(r, date, true) },
    });
  }

  async function reopen(b: WebBlockedRange) {
    const res = await webApi.unblockRanges([{ roomId: b.roomId, start: b.start, end: b.end }]);
    if (!res.ok) return toast.show({ tone: 'error', text: errorText(res.error) });
    refresh();
    toast.show({
      tone: 'success',
      text: trf('{0}, {1} is open for booking again.', [b.roomName, rangeText(b)]),
      action: { label: 'Undo', onClick: () => void webApi.blockRange({ roomIds: [b.roomId], start: b.start, end: b.end }).then(refresh) },
    });
  }

  const closeWith = (p: Prefill | null) => {
    setPrefill(p);
    setModal('block');
  };

  const capBox = (r: WebCalendarRoom, a: WebCalendarCell, cls: string) => (
    <input
      type="number"
      inputMode="numeric"
      className={`${cls}${a.blocked ? ' is-blocked' : ''}${`${r.roomId}|${a.date}` in cap ? ' is-dirty' : ''}`}
      min={a.sold}
      max={r.totalCount}
      value={capOf(r, a)}
      disabled={a.blocked}
      aria-label={trf('Rooms open, {0}, {1}', [r.roomName, dMY(a.date)])}
      title={trf("Can't go below {0} (already confirmed) or above {1} (rooms in this category).", [a.sold, r.totalCount])}
      onChange={(e) => setCapOf(r, a, e.target.value)}
      onBlur={(e) => clampCap(r, a, e.target.value)}
    />
  );
  const priceBox = (planId: string, occ: WebOccupancy, pr: { date: string; pricePaise: number; dated: boolean }, label: string, cls: string) => {
    const key = `${planId}|${pr.date}|${occ}`;
    const original = rupees(pr.pricePaise);
    return (
      <input
        type="number"
        inputMode="decimal"
        min={0}
        className={`${cls}${pr.dated ? ' is-recent' : ''}${key in price ? ' is-dirty' : ''}`}
        value={price[key] ?? original}
        aria-label={label}
        onChange={(e) => setPriceOf(key, original, e.target.value)}
      />
    );
  };
  const blockButton = (r: WebCalendarRoom, a: WebCalendarCell, cls: string) =>
    a.sold > 0 ? (
      <span className={`${cls} is-booked`} title={tr('Cancel the booking to free this date.')}>{tr('Booked')}</span>
    ) : (
      // check-shared-ignore: a calendar cell's own small switch, no kit equivalent
      <button type="button" className={`${cls}${a.blocked ? ' on' : ''}`} onClick={() => void toggle(r, a.date)}>
        {a.blocked ? tr('Open') : tr('Close')}
      </button>
    );

  return (
    <>
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">{tr(SUB)}</p>
        </div>
        <div className="sh-head-actions">
          {week.rooms.length > 0 ? (
            <>
              <Dropdown align="end" button={(p) => <Button variant="ghost" icon="three-dots" {...p}>{tr('More')}</Button>}>
                <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); navigate('hotel.web.rates'); }}><Bi name="tags" className="me-2" />{tr('Rate plans')}</a>
                {blocked.length > 0 ? <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setModal('unblock'); }}><Bi name="unlock" className="me-2" />{tr('Open dates again')}</a> : null}
                <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); closeWith(null); }}><Bi name="slash-circle" className="me-2" />{tr('Close dates')}</a>
              </Dropdown>
              <Button icon="currency-rupee" onClick={() => setModal('bulk')}>{tr('Change prices for dates')}</Button>
            </>
          ) : null}
        </div>
      </div>

      <WaNav active="calendar" navigate={navigate} />

      {week.rooms.length === 0 ? (
        <div className="card reveal">
          <EmptyState icon="calendar-week" title={tr('No room categories yet')} text={tr('Add a room category and give it a rate; its days show here.')}>
            <Button icon="plus-lg" className="mt-3" onClick={() => navigate('hotel.web.roomForm')}>{tr('Add room category')}</Button>
          </EmptyState>
        </div>
      ) : (
        <div className="ha-stack reveal">
          {week.rooms.length > 1 ? <ListTabs label={tr('Room')} active={room} onChange={setRoom} tabs={[{ id: 'all', label: 'All rooms' }, ...week.rooms.map((r) => ({ id: r.roomId, label: r.roomName }))]} /> : null}

          <div className="card wc-cal">
            <div className="wc-bar">
              <Button variant="outline" size="sm" icon="chevron-left" aria-label={tr('Previous week')} onClick={() => setStart(week.prevStart)} />
              <strong>{dM(week.days[0] ?? '')} - {dMY(week.days[6] ?? '')}</strong>
              {!thisWeek ? <Button variant="ghost" size="sm" onClick={() => { setStart(undefined); setDay(null); }}>{tr('This week')}</Button> : null}
              <Button variant="outline" size="sm" icon="chevron-right" aria-label={tr('Next week')} onClick={() => setStart(week.nextStart)} />
            </div>

            <div className="wc-days" role="tablist" aria-label={tr('Day')}>
              {week.days.map((d) => (
                // check-shared-ignore: a day chip of the phone calendar
                <button key={d} type="button" role="tab" aria-selected={d === shownDay} className={`wc-day${d === shownDay ? ' active' : ''}${d === week.today ? ' is-today' : ''}`} onClick={() => setDay(d)}>
                  <small>{dayShort(d)}</small>
                  <b>{d.slice(8, 10)}</b>
                </button>
              ))}
            </div>

            <div className="wc-phone">
              {rooms.map((r) => {
                const a = r.cells[dayIndex];
                if (!a) return null;
                const n = Number.parseInt(capOf(r, a), 10) || 0;
                return (
                  <section className={`wc-room${a.blocked ? ' is-closed' : ''}`} key={r.roomId} aria-label={trf('{0} on {1}', [r.roomName, dMY(a.date)])}>
                    <div className="wc-room-head">
                      <h3>{r.roomName}</h3>
                      {blockButton(r, a, 'wc-close')}
                    </div>
                    <div className="wc-line">
                      <span>{tr('Rooms open')}<small>{a.blocked ? tr('Closed to booking') : trf('{0} sold of {1}', [a.sold, r.totalCount])}</small></span>
                      <div className="wc-step">
                        <Button variant="outline" size="sm" icon="dash-lg" aria-label={tr('One fewer')} disabled={a.blocked || n <= a.sold} onClick={() => setCapOf(r, a, String(n - 1))} />
                        {capBox(r, a, 'wc-num')}
                        <Button variant="outline" size="sm" icon="plus-lg" aria-label={tr('One more')} disabled={a.blocked || n >= r.totalCount} onClick={() => setCapOf(r, a, String(n + 1))} />
                      </div>
                    </div>
                    {r.plans.length === 0 ? <p className="wc-none">{tr('No rate plan yet.')}</p> : null}
                    {r.plans.flatMap((p) =>
                      p.rows.map((row) => {
                        const pr = row.prices[dayIndex];
                        if (!pr) return null;
                        return (
                          <div className="wc-line" key={`${p.planId}-${row.occ}`}>
                            <span><b className="wa-badge">{p.code}</b> {p.name}<small>{occWord(row.occ)}</small></span>
                            <div className="input-group wc-price">
                              <span className="input-group-text">₹</span>
                              {priceBox(p.planId, row.occ, pr, trf('{0}, {1}, {2}', [p.name, occWord(row.occ), dMY(pr.date)]), 'form-control')}
                            </div>
                          </div>
                        );
                      }),
                    )}
                  </section>
                );
              })}
            </div>

            <div className="wc-wide">
              <Table className="wa-cal">
                <thead>
                  <tr>
                    <th>{tr('Rooms and plans')}</th>
                    {week.days.map((d) => (
                      <th key={d} className={d === week.today ? 'is-today' : ''}><small>{dayShort(d)}</small>{' '}{dM(d)}</th>
                    ))}
                  </tr>
                </thead>
                {rooms.map((r) => (
                  <tbody key={r.roomId}>
                    <tr className="wa-cal-room">
                      <td><div className="wa-cal-name">{r.roomName}</div><div className="wa-cal-hint">{tr('Rooms open')}</div></td>
                      {r.cells.map((a) => (
                        <td key={a.date}>
                          {capBox(r, a, 'cal-inv')}
                          <div className="wa-cal-sold">{a.sold} {tr('sold')}</div>
                          {blockButton(r, a, 'cal-block')}
                        </td>
                      ))}
                    </tr>
                    {r.plans.length === 0 ? (
                      <tr><td colSpan={8} className="wc-none">{tr('No rate plan yet.')}</td></tr>
                    ) : null}
                    {r.plans.flatMap((p) =>
                      p.rows.map((row) => (
                        <tr className="wa-cal-plan" key={`${p.planId}-${row.occ}`}>
                          <td>
                            <span className="wa-badge">{p.code}</span> <b className="small">{p.name}</b>
                            <div className="wa-cal-hint">{occWord(row.occ)}</div>
                          </td>
                          {row.prices.map((pr) => <td key={pr.date}>{priceBox(p.planId, row.occ, pr, trf('{0}, {1}, {2}', [p.name, occWord(row.occ), dMY(pr.date)]), '')}</td>)}
                        </tr>
                      )),
                    )}
                  </tbody>
                ))}
              </Table>
            </div>
            <p className="wc-key"><span className="wc-key-dot is-recent" /> {tr('Price set for that day')} <span className="wc-key-dot is-dirty" /> {tr('Not saved yet')}</p>
          </div>

          <section className="card ha-card" aria-labelledby="wc-closed-h">
            <h2 className="ha-card-h" id="wc-closed-h">{tr('Closed dates')}</h2>
            {blocked.length === 0 ? (
              <EmptyState icon="calendar-check" title={tr('Nothing is closed')} text={tr('Every room can be booked. Close dates from More when a room is out of use.')} />
            ) : (
              <ul className="wc-closed">
                {blocked.map((b) => (
                  <li key={`${b.roomId}-${b.start}`}>
                    <span><b>{b.roomName}</b><small>{rangeText(b)} · {b.nights} {plural(b.nights, 'night')}</small></span>
                    <Button size="sm" variant="ghost" onClick={() => closeWith({ roomIds: [b.roomId], start: b.start, end: b.end })}>{tr('Change')}</Button>
                    <Button size="sm" variant="outline" icon="unlock" onClick={() => void reopen(b)}>{tr('Open again')}</Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className={`wa-cal-save wc-save ${count > 0 ? 'show' : ''}`} role="status">
            <span className="small fw-bold">{count} {tr('unsaved')} {plural(count, 'change')}</span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setCap({}); setPrice({}); }}>{tr('Discard')}</Button>
            <Button size="sm" icon="check2" disabled={busy} onClick={save}>{busy ? tr('Saving…') : tr('Save changes')}</Button>
          </div>
        </div>
      )}

      {modal === 'bulk' ? <BulkModal week={week} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} /> : null}
      {modal === 'block' ? <BlockModal week={week} prefill={prefill} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} /> : null}
      {modal === 'unblock' ? <UnblockModal rows={blocked} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} /> : null}
    </>
  );
}

/** The room tick boxes the price and close forms share, every room ticked to start. */
function RoomChecks({ week, picked, onChange, error }: { week: WebCalendarWeek; picked: string[]; onChange: (ids: string[]) => void; error?: string }) {
  const every = picked.length === week.rooms.length;
  return (
    <div className="mb-3" role="group" aria-labelledby="cal_rooms_lab">
      <div className="d-flex align-items-center justify-content-between gap-2">
        <div className="form-label mb-0" id="cal_rooms_lab">{tr('Room categories')}<RequiredMark /></div>
        {week.rooms.length > 1 ? <Button size="sm" variant="ghost" onClick={() => onChange(every ? [] : week.rooms.map((r) => r.roomId))}>{every ? tr('None') : tr('All')}</Button> : null}
      </div>
      <div className="wc-checks">
        {week.rooms.map((r) => (
          <label className="form-check" key={r.roomId}>
            <input type="checkbox" className="form-check-input" checked={picked.includes(r.roomId)} onChange={(e) => onChange(e.target.checked ? [...picked, r.roomId] : picked.filter((x) => x !== r.roomId))} />{' '}
            <span className="form-check-label">{r.roomName}</span>
          </label>
        ))}
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}

function Dates({ from, to, setFrom, setTo, errors }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; errors: Record<string, string> }) {
  return (
    <div className="row g-3">
      <Linked className="col-6"><label className="form-label">{tr('From')}<RequiredMark /></label><PmsDate className="form-control" required value={from} onChange={(e) => setFrom(e.target.value)} aria-label={tr('From')} /><FieldError>{errors.start}</FieldError></Linked>
      <Linked className="col-6"><label className="form-label">{tr('To')}<RequiredMark /></label><PmsDate className="form-control" required value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label={tr('To')} /><FieldError>{errors.end}</FieldError></Linked>
    </div>
  );
}

function BulkModal({ week, onClose, onDone }: { week: WebCalendarWeek; onClose: () => void; onDone: () => void }) {
  const names = useAsync(() => webApi.listPlanNames(), []);
  const list = names.state.status === 'ready' ? names.state.data : [];
  const [picked, setPicked] = useState<string[]>(week.rooms.map((r) => r.roomId));
  const [plan, setPlan] = useState('');
  const [from, setFrom] = useState(todayIst());
  const [to, setTo] = useState(addDays(todayIst(), 6));
  const [single, setSingle] = useState('');
  const [dbl, setDbl] = useState('');
  const [extra, setExtra] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const planName = plan || list[0] || '';

  async function apply() {
    setBusy(true);
    const res = await webApi.bulkRates({ roomIds: picked, planName, start: from, end: to, singlePaise: paiseOf(single), doublePaise: paiseOf(dbl), extraPaise: paiseOf(extra) });
    setBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: res.data.message });
      onDone();
    } else {
      const f = res.error.details?.fields;
      if (f) setErrors(f);
      else toast.show({ tone: 'error', text: errorText(res.error) });
    }
  }
  const box = (label: string, value: string, set: (v: string) => void) => (
    <Linked className="col-4">
      <label className="form-label">{label}</label>
      <div className="input-group"><span className="input-group-text">₹</span><input type="number" inputMode="decimal" min={0} className="form-control" value={value} onChange={(e) => set(e.target.value)} /></div>
    </Linked>
  );

  return (
    <Modal
      open
      className="pay-form-modal"
      staticBackdrop
      eyebrow={tr('Calendar')}
      title={tr('Change prices for dates')}
      onClose={onClose}
      onSubmit={() => void apply()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button>
          <Button icon="check2" type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Change prices')}</Button>
        </>
      }
    >
      <FormSection icon="calendar-range" title={tr('Which rooms and days')} hint={tr('Starts with every room and the next seven days.')}>
        <RoomChecks week={week} picked={picked} onChange={setPicked} error={errors.roomIds} />
        <Linked className="mb-3">
          <label className="form-label">{tr('Rate plan')}<RequiredMark /></label>
          <Select className="form-select" value={planName} onChange={(e) => setPlan(e.target.value)}>
            {list.length === 0 ? <option value="">{tr('No rate plans yet')}</option> : null}
            {list.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
          <FieldError>{errors.planName}</FieldError>
        </Linked>
        <Dates from={from} to={to} setFrom={setFrom} setTo={setTo} errors={errors} />
      </FormSection>
      <FormSection icon="currency-rupee" title={tr('New prices per night')} hint={tr('Fill only what should change; an empty box keeps its price.')}>
        <div className="row g-3">
          {box(tr('1 guest'), single, setSingle)}
          {box(tr('2 guests'), dbl, setDbl)}
          {box(tr('Extra person'), extra, setExtra)}
        </div>
        <FieldError>{errors.prices}</FieldError>
      </FormSection>
    </Modal>
  );
}

function BlockModal({ week, prefill, onClose, onDone }: { week: WebCalendarWeek; prefill: Prefill | null; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>(prefill?.roomIds ?? week.rooms.map((r) => r.roomId));
  const [from, setFrom] = useState(prefill?.start ?? todayIst());
  const [to, setTo] = useState(prefill?.end ?? todayIst());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function block() {
    setBusy(true);
    const res = await webApi.blockRange({ roomIds: picked, start: from, end: to });
    setBusy(false);
    if (res.ok) {
      toast.show({ tone: res.data.blocked > 0 ? 'success' : 'info', text: res.data.message });
      onDone();
    } else {
      const f = res.error.details?.fields;
      if (f) setErrors(f);
      else toast.show({ tone: 'error', text: errorText(res.error) });
    }
  }

  return (
    <Modal
      open
      className="pay-form-modal"
      staticBackdrop
      eyebrow={tr('Calendar')}
      title={tr('Close dates')}
      onClose={onClose}
      onSubmit={() => void block()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button>
          <Button variant="danger" icon="slash-circle" type="submit" disabled={busy}>{busy ? tr('Closing…') : tr('Close these dates')}</Button>
        </>
      }
    >
      <FormSection icon="slash-circle" title={tr('Which rooms and days')} hint={tr('Guests cannot book these days. A day that already has a confirmed booking is left open.')}>
        <RoomChecks week={week} picked={picked} onChange={setPicked} error={errors.roomIds} />
        <Dates from={from} to={to} setFrom={setFrom} setTo={setTo} errors={errors} />
        <FieldHint>{tr('Open them again any time from Closed dates.')}</FieldHint>
      </FormSection>
    </Modal>
  );
}

function UnblockModal({ rows, onClose, onDone }: { rows: WebBlockedRange[]; onClose: () => void; onDone: () => void }) {
  const key = (b: WebBlockedRange) => `${b.roomId}|${b.start}|${b.end}`;
  const [picked, setPicked] = useState<string[]>(rows.map(key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  async function go() {
    setBusy(true);
    const res = await webApi.unblockRanges(rows.filter((b) => picked.includes(key(b))).map((b) => ({ roomId: b.roomId, start: b.start, end: b.end })));
    setBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: res.data.message });
      onDone();
    } else setError(res.error.details?.fields?.ranges ?? errorText(res.error));
  }

  return (
    <Modal
      open
      className="pay-form-modal"
      staticBackdrop
      eyebrow={tr('Calendar')}
      title={tr('Open dates again')}
      onClose={onClose}
      onSubmit={() => void go()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button>
          <Button icon="unlock" type="submit" disabled={busy || picked.length === 0}>{busy ? tr('Opening…') : picked.length === 1 ? tr('Open 1 stretch') : trf('Open {0} stretches', [picked.length])}</Button>
        </>
      }
    >
      <p className="text-muted small">{tr('Every closed stretch is ticked. Untick any that should stay closed.')}</p>
      <div className="wc-checks">
        {rows.map((b) => (
          <label className="form-check" key={key(b)}>
            <input type="checkbox" className="form-check-input" checked={picked.includes(key(b))} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, key(b)] : p.filter((x) => x !== key(b))))} />{' '}
            <span className="form-check-label">{b.roomName} · {rangeText(b)}</span>
          </label>
        ))}
      </div>
      <FieldError>{error}</FieldError>
    </Modal>
  );
}
