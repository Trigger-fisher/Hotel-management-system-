'use client';
// Rooms, the housekeeping way (MJ's system preview, section 6): a card per room, the rooms that need cleaning first, one tap to mark a room clean or dirty,
// filters by state and floor. Add, add several, edit, out of order and delete stay, behind each card's More menu and the page head.
import { useState } from 'react';

import type { DashError } from '@shared/dashboards/common';
import { frontOfficeCopy as copy, type FrontOfficeOptions, type Room } from '@shared/dashboards/frontOffice';

import { userMayEdit } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { errorText, useAsync, useSubmit, useToast } from '@/components/ui';
import { Bi, Button, Dialog, Dropdown, EmptyState, Field, IconButton, ListTabs, Modal, PageHead, PmsSelect, PageSkeleton, SearchField, StatusChip } from '../../pallav/ui';
import { foApi } from './api';
import { FoNav, GoLink } from './foKit';

import { tr, trf } from '@/lib/i18n/language';
const c = copy.rooms;

/** The same fields the list search of the server matches: number, floor, category, guest, notes. */
const matches = (r: Room, s: string) => [r.number, r.floor ?? '', r.roomTypeName ?? '', r.currentStay?.guestName ?? '', r.notes].some((x) => x.toLowerCase().includes(s));

type RoomFilter = 'all' | 'dirty' | 'clean' | 'ooo';
const stateOf = (r: Room): Exclude<RoomFilter, 'all'> => (r.outOfOrder ? 'ooo' : r.hkStatus === 'dirty' ? 'dirty' : 'clean');
/** Rooms that need cleaning first, then out of order, then clean; by number inside each (numeric where the numbers are). */
const ORDER: Record<Exclude<RoomFilter, 'all'>, number> = { dirty: 0, ooo: 1, clean: 2 };
const byWork = (a: Room, b: Room) => ORDER[stateOf(a)] - ORDER[stateOf(b)] || a.number.localeCompare(b.number, undefined, { numeric: true });
const floorLabel = (f: string) => (/^\d+$/.test(f) ? trf('Floor {0}', [f]) : f);

export function RoomsScreen({ navigate, params }: ScreenProps) {
  const toast = useToast();
  // The top-bar search opens this list with the room number or category it found (`params.search`); the box filters the loaded rooms at once.
  const [search, setSearch] = useState(params.search ?? '');
  const [asked, setAsked] = useState(params.search);
  if (params.search !== asked) {
    // A new top-bar search while this screen is already open.
    setAsked(params.search);
    setSearch(params.search ?? '');
  }
  const list = useAsync(() => foApi.listRooms({ tab: 'all', search: '', page: 1, pageSize: 100 }), []);
  const opts = useAsync(() => foApi.getOptions(), []);
  const options = opts.state.status === 'ready' ? opts.state.data : null;
  const allRooms = list.state.status === 'ready' ? list.state.data.items : null;
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [floor, setFloor] = useState('');
  const needle = search.trim().toLowerCase();
  const floors = allRooms ? [...new Set(allRooms.map((r) => r.floor ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
  const counts = { dirty: 0, clean: 0, ooo: 0 };
  for (const r of allRooms ?? []) counts[stateOf(r)] += 1;
  const rooms = allRooms
    ? allRooms.filter((r) => (!needle || matches(r, needle)) && (filter === 'all' || stateOf(r) === filter) && (!floor || r.floor === floor)).sort(byWork)
    : null;
  const mayEdit = userMayEdit('pms');

  const [form, setForm] = useState<{ room: Room | null } | null>(null);
  const [bulk, setBulk] = useState(false);
  const [ooo, setOoo] = useState<Room | null>(null);
  const [del, setDel] = useState<Room | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const fail = (e: DashError) => toast.show({ tone: 'error', text: errorText(e) });

  async function toggleClean(r: Room) {
    setRowBusy(r.id);
    const res = await foApi.setHousekeeping(r.id, r.hkStatus === 'clean' ? 'dirty' : 'clean');
    setRowBusy(null);
    if (!res.ok) return fail(res.error);
    toast.show({ tone: 'success', text: res.data.hkStatus === 'clean' ? c.toast.nowClean(r.number) : c.toast.nowDirty(r.number) });
    list.reload();
  }

  async function backInService(r: Room) {
    setRowBusy(r.id);
    const res = await foApi.setService(r.id, false);
    setRowBusy(null);
    if (!res.ok) return fail(res.error);
    toast.show({ tone: 'success', text: c.toast.back(r.number) });
    list.reload();
  }

  async function remove() {
    if (!del) return;
    setDelBusy(true);
    const res = await foApi.deleteRoom(del.id);
    setDelBusy(false);
    if (!res.ok) fail(res.error);
    else {
      toast.show({ tone: 'success', text: c.toast.removed(res.data.number) });
      list.reload();
    }
    setDel(null);
  }

  return (
    <>
      <PageHead sub="Every room and whether it is ready. Rooms that need cleaning come first; one tap marks a room clean.">
        {mayEdit ? (
          <Dropdown align="end" button={(p) => <Button variant="outline" icon="plus-lg" {...p}>{tr("Add room")}</Button>}>
            <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setForm({ room: null }); }}><Bi name="plus-lg" /> {tr("One room")}</a>
            <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setBulk(true); }}><Bi name="collection" /> {tr("Add several")}</a>
          </Dropdown>
        ) : null}
        <FoNav active="rooms" navigate={navigate} />
      </PageHead>

      {options && options.roomTypes.length === 0 && (
        <div className="alert alert-warning small">There are no room categories yet. Add them under Website &rsaquo; Rooms (Deluxe, Super Deluxe...) so each room here can be given one.</div>
      )}

      {list.state.status === 'error' ? (
        <div className="card"><EmptyState icon="exclamation-triangle" title={tr("Could not load the rooms")} text={errorText(list.state.error)}>
          <Button variant="outline" className="mt-3" onClick={list.reload}>{tr("Try again")}</Button>
        </EmptyState></div>
      ) : !rooms || !allRooms ? (
        <PageSkeleton tiles={false} />
      ) : allRooms.length === 0 ? (
        <div className="card"><EmptyState icon="door-open" title={tr("No rooms yet")} text={'Add the room numbers, one by one or several at once ("101-110").'} /></div>
      ) : (
        <>
        <div className="rm-tools">
          <SearchField wrapClass="rm-search" smart clear value={search} onChange={setSearch} placeholder={c.searchPlaceholder} label={c.title} />
          <ListTabs
            look="pills"
            label={tr('Room state')}
            active={filter}
            onChange={(id) => setFilter(id as RoomFilter)}
            tabs={[
              { id: 'all', label: tr('All'), count: allRooms.length },
              { id: 'dirty', label: tr('Needs cleaning'), count: counts.dirty || undefined },
              { id: 'clean', label: tr('Clean'), count: counts.clean || undefined },
              ...(counts.ooo ? [{ id: 'ooo', label: tr('Out of order'), count: counts.ooo }] : []),
            ]}
          />
          {floors.length > 1 ? (
            <ListTabs look="pills" label={tr('Floor')} active={floor} onChange={(id) => setFloor(floor === id ? '' : id)} tabs={floors.map((f) => ({ id: f, label: floorLabel(f) }))} />
          ) : null}
        </div>
        {rooms.length === 0 ? (
          <div className="card"><EmptyState icon={filter === 'dirty' && !needle ? 'stars' : 'search'} title={filter === 'dirty' && !needle && !floor ? tr('Every room is clean') : c.noMatchTitle} text={filter === 'dirty' && !needle && !floor ? tr('Nothing waits for housekeeping right now.') : c.noMatchBody} /></div>
        ) : (
          <ul className="rm-grid" aria-label={c.title}>
            {rooms.map((room) => {
              const st = stateOf(room);
              return (
                <li key={room.id} className={`rm-card is-${st}`}>
                  <div className="rm-top">
                    <span className="rm-no">
                      <b>{room.number}</b>
                      <small>{[room.roomTypeName ?? tr('No category'), room.floor ? floorLabel(room.floor) : ''].filter(Boolean).join(' · ')}</small>
                    </span>
                    <StatusChip tone={st === 'dirty' ? 'warn' : st === 'ooo' ? 'danger' : 'neutral'}>{st === 'dirty' ? tr('Needs cleaning') : st === 'ooo' ? tr('Out of order') : tr('Clean')}</StatusChip>
                  </div>
                  <p className="rm-line">
                    {room.currentStay ? (
                      <GoLink to="hotel.fo.stay" params={{ id: room.currentStay.id }} navigate={navigate} className="fo-tap">{trf('In house · {0}', [room.currentStay.guestName])}</GoLink>
                    ) : room.outOfOrder ? (
                      room.outOfOrderReason || tr('Not offered to guests')
                    ) : (
                      tr('Vacant')
                    )}
                  </p>
                  {mayEdit ? (
                    <div className="rm-acts">
                      {room.outOfOrder ? (
                        <Button variant="outline" size="sm" disabled={rowBusy === room.id} onClick={() => void backInService(room)}>{tr('Back in service')}</Button>
                      ) : (
                        <Button variant={room.hkStatus === 'dirty' ? 'primary' : 'outline'} size="sm" icon={room.hkStatus === 'dirty' ? 'stars' : undefined} busy={rowBusy === room.id} onClick={() => void toggleClean(room)}>
                          {room.hkStatus === 'clean' ? tr('Mark dirty') : tr('Mark clean')}
                        </Button>
                      )}
                      <Dropdown align="end" button={(p) => <IconButton icon="three-dots" label={trf('More for room {0}', [room.number])} {...p} />}>
                        <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setForm({ room }); }}>{tr('Edit room')}</a>
                        {!room.outOfOrder && !room.currentStay ? <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setOoo(room); }}>{tr('Take out of order')}</a> : null}
                        {!room.hasHistory ? <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setDel(room); }}>{tr('Delete room')}</a> : null}
                      </Dropdown>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        </>
      )}

      {form && (
        <RoomForm room={form.room} options={options} onClose={() => setForm(null)} onSaved={(text) => { toast.show({ tone: 'success', text }); setForm(null); list.reload(); }} />
      )}
      {bulk && <BulkForm options={options} onClose={() => setBulk(false)} onSaved={(text) => { toast.show({ tone: 'success', text }); setBulk(false); list.reload(); }} />}
      {ooo && <OooForm room={ooo} onClose={() => setOoo(null)} onSaved={(text) => { toast.show({ tone: 'success', text }); setOoo(null); list.reload(); }} />}
      <Dialog
        open={del !== null}
        title={del ? `Delete room ${del.number}?` : ''}
        message="It has no guests on record, so it can be removed."
        confirmLabel="Delete"
        tone="danger"
        busy={delBusy}
        onConfirm={() => void remove()}
        onCancel={() => setDel(null)}
      />
    </>
  );
}

const typeChoices = (options: FrontOfficeOptions | null) => (options?.roomTypes ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>);

function RoomForm({ room, options, onClose, onSaved }: { room: Room | null; options: FrontOfficeOptions | null; onClose: () => void; onSaved: (text: string) => void }) {
  const [number, setNumber] = useState(room?.number ?? '');
  const [floor, setFloor] = useState(room?.floor ?? '');
  const [roomTypeId, setRoomTypeId] = useState(room?.roomTypeId ?? '');
  const [notes, setNotes] = useState(room?.notes ?? '');
  const { busy, errors, submit } = useSubmit(['number', 'floor', 'notes']);

  const save = () => {
    const input = { number, floor, roomTypeId, notes };
    return room
      ? submit(() => foApi.updateRoom(room.id, input), (x) => onSaved(c.toast.updated(x.number)))
      : submit(() => foApi.createRoom(input), (x) => onSaved(c.toast.added(x.number)));
  };

  return (
    <Modal open scrollable={false} className="pay-form-modal" staticBackdrop eyebrow="Rooms" title={room ? `Edit room ${room.number}` : 'Add a room'} onClose={onClose} onSubmit={() => void save()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr("Cancel")}</Button>
          <Button type="submit" icon="check2" disabled={busy}>{busy ? tr("Saving…") : tr("Save")}</Button>
        </>
      }>
      <div className="row g-3">
        <Field label={tr("Room number")} required col="col-6" error={errors.number}>
          <input className="form-control" maxLength={20} placeholder="e.g. 101" value={number} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label={tr("Floor")} col="col-6" error={errors.floor}>
          <input className="form-control" maxLength={20} placeholder="e.g. 1" value={floor} onChange={(e) => setFloor(e.target.value)} />
        </Field>
        <Field label={tr("Category")}>
          <PmsSelect value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
            <option value="">{tr("Not set")}</option>
            {typeChoices(options)}
          </PmsSelect>
        </Field>
        <Field label={tr("Note")} error={errors.notes}>
          <input className="form-control" maxLength={255} placeholder={tr("e.g. Sea-facing, near the lift")} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function BulkForm({ options, onClose, onSaved }: { options: FrontOfficeOptions | null; onClose: () => void; onSaved: (text: string) => void }) {
  const [numbers, setNumbers] = useState('');
  const [floor, setFloor] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const { busy, errors, submit } = useSubmit(['numbers']);
  const save = () => submit(() => foApi.bulkAddRooms({ numbers, floor, roomTypeId }), (x) => onSaved(c.toast.bulk(x.added, x.skipped)));
  return (
    <Modal open scrollable={false} className="pay-form-modal" staticBackdrop eyebrow="Rooms" title={tr("Add several rooms")} onClose={onClose} onSubmit={() => void save()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr("Cancel")}</Button>
          <Button type="submit" disabled={busy}>{busy ? tr("Adding…") : tr("Add rooms")}</Button>
        </>
      }>
      <div className="row g-3">
        <Field label={tr("Room numbers")} required error={errors.numbers}>
          <input className="form-control" placeholder="101-110, 112, 115" value={numbers} onChange={(e) => setNumbers(e.target.value)} />
          <div className="form-text">{c.bulk.hint}</div>
        </Field>
        <Field label={tr("Floor")} col="col-6">
          <input className="form-control" maxLength={20} value={floor} onChange={(e) => setFloor(e.target.value)} />
        </Field>
        <Field label={tr("Category")} col="col-6">
          <PmsSelect value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
            <option value="">{tr("Not set")}</option>
            {typeChoices(options)}
          </PmsSelect>
        </Field>
      </div>
    </Modal>
  );
}

function OooForm({ room, onClose, onSaved }: { room: Room; onClose: () => void; onSaved: (text: string) => void }) {
  const [reason, setReason] = useState('');
  const { busy, submit } = useSubmit([]);
  const save = () => submit(() => foApi.setService(room.id, true, reason), () => onSaved(c.toast.ooo(room.number)));
  return (
    <Modal open scrollable={false} className="pay-form-modal" staticBackdrop eyebrow="Rooms" title={trf("Take room {0} out of order", [room.number])} onClose={onClose} onSubmit={() => void save()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr("Cancel")}</Button>
          <Button type="submit" variant="danger" disabled={busy}>{tr("Take out of order")}</Button>
        </>
      }>
      <label className="form-label">{tr("Reason")}</label>
      <input className="form-control" maxLength={255} placeholder={tr("e.g. AC repair")} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="form-text">{tr("The room is not offered to guests or reservations until it is back in service.")}</div>
    </Modal>
  );
}
