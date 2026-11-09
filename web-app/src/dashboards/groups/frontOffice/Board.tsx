'use client';
// The room board: the house in one quiet row of figures, every room as a tile by floor (the key filters them by state), and who arrives and leaves today.
import { useState } from 'react';

import { formatDate, formatCount } from '@shared/dashboards/format';
import { frontOfficeCopy as copy, plural, roomStateLabel, todayIst, type Board as BoardData, type Room, type RoomState } from '@shared/dashboards/frontOffice';

import type { ScreenProps } from '../../types';
import { errorText, useAsync } from '@/components/ui';
import { Bi, Button, EmptyState, PageHead, PageSkeleton } from '../../pallav/ui';
import { HomeStats, type HomeStat } from '../overview/HomeJobs';
import { foApi } from './api';
import { FoNav, GoLink } from './foKit';

import { tr, trf } from '@/lib/i18n/language';
const c = copy.board;
const states: RoomState[] = ['vacant', 'occupied', 'dirty', 'outOfOrder'];
const css = (s: RoomState) => (s === 'outOfOrder' ? 'out_of_order' : s);
const short = (d: string) => formatDate(d).slice(0, 6);
const floorName = (f: string) => (/^\d+$/.test(f) ? trf("Floor {0}", [f]) : f);

export function BoardScreen({ navigate }: ScreenProps) {
  const { state, reload } = useAsync(() => foApi.getBoard(), []);
  return (
    <>
      <PageHead sub={tr("Every room at a glance. Tap a room to check a guest in, open their stay, or look after the room.")}>
        <FoNav active="board" navigate={navigate} />
      </PageHead>
      {state.status === 'error' ? (
        <div className="card">
          <EmptyState icon="exclamation-triangle" title={tr("Could not load the front desk")} text={errorText(state.error)}>
            <Button variant="outline" className="mt-3" onClick={reload}>{tr("Try again")}</Button>
          </EmptyState>
        </div>
      ) : state.status === 'ready' ? (
        <BoardBody data={state.data} navigate={navigate} />
      ) : (
        <PageSkeleton />
      )}
    </>
  );
}

function BoardBody({ data, navigate }: { data: BoardData; navigate: ScreenProps['navigate'] }) {
  const t = todayIst();
  const st = data.stats;
  const [only, setOnly] = useState<RoomState | null>(null);
  const all = data.floors.reduce((n, f) => n + f.rooms.length, 0);
  const stateCount: Record<RoomState, number> = { vacant: 0, occupied: 0, dirty: 0, outOfOrder: 0 };
  for (const f of data.floors) for (const r of f.rooms) stateCount[r.state] += 1;
  const floors = data.floors.map((f) => ({ ...f, rooms: only ? f.rooms.filter((r) => r.state === only) : f.rooms })).filter((f) => f.rooms.length > 0);
  const lateIn = data.arrivals.filter((r) => r.checkIn < t).length;
  const lateOut = data.departures.filter((s) => s.expectedCheckOut < t).length;
  const stats: HomeStat[] = [
    { id: 'occ', label: 'Occupancy', value: st.occupancy, format: (n) => `${Math.round(n)}%`, note: c.occupancyFoot(st.occupied, st.rooms - st.outOfOrder) },
    { id: 'house', label: 'Guests in the house', value: data.inHouse, format: (n) => formatCount(Math.round(n)), note: trf("{0} rooms in all", [st.rooms]) },
    { id: 'in', label: 'Arriving today', value: data.arrivals.length, format: (n) => formatCount(Math.round(n)), note: lateIn > 0 ? trf("{0} past the arrival date", [lateIn]) : tr("Booked to arrive") },
    { id: 'out', label: 'Leaving today', value: data.departures.length, format: (n) => formatCount(Math.round(n)), note: lateOut > 0 ? trf("{0} past the leaving date", [lateOut]) : tr("Due to check out") },
  ];
  const noRooms = st.rooms === 0 || all === 0;

  return (
    <>
      {st.rooms > 0 && st.occupied === 0 && data.arrivals.length === 0 && data.departures.length === 0 ? (
        <p className="text-muted mb-3">{tr("No guests are in the house and nobody is due today. Arrivals and departures will show here as they are booked.")}</p>
      ) : null}
      <HomeStats stats={stats} />

      <div className="hu-board-grid">
        <section className="card hu-board" aria-labelledby="hu-board-h">
          <div className="hu-sec-head">
            <h2 id="hu-board-h" className="hu-h">{tr("Rooms")}</h2>
            {!noRooms && <span className="hu-sec-note">{data.floors.length > 1 ? trf("{0} rooms on {1} floors", [all, data.floors.length]) : trf("{0} rooms", [all])}</span>}
          </div>

          {noRooms ? (
            <EmptyState icon="door-open" title={tr("No rooms set up yet")} text={tr("Add the hotel's room numbers first, each with its category.")}>
              <GoLink to="hotel.fo.rooms" navigate={navigate} className="btn btn-p mt-3">{tr("Set up rooms")}</GoLink>
            </EmptyState>
          ) : (
            <>
              <div className="fo-legend hu-legend" role="group" aria-label={tr("Show rooms")}>
                <button /* check-shared-ignore: the board key doubles as its filter (a coloured key with a count; no kit piece draws this) */ type="button" className={`fo-key hu-key-all${only === null ? ' is-on' : ''}`} aria-pressed={only === null} onClick={() => setOnly(null)}>
                  {tr("All")} <span className="fo-key-n">{all}</span>
                </button>
                {states.map((k) => (
                  <button /* check-shared-ignore: as above */ key={k} type="button" className={`fo-key s-${css(k)}${only === k ? ' is-on' : ''}`} aria-pressed={only === k} disabled={stateCount[k] === 0 && only !== k} onClick={() => setOnly(only === k ? null : k)}>
                    <i aria-hidden="true" /> {roomStateLabel[k]} <span className="fo-key-n">{stateCount[k]}</span>
                  </button>
                ))}
              </div>

              {floors.length === 0 ? (
                <EmptyState icon="funnel" title={tr("No rooms in that state now")} text={tr("Tap All to show every room.")} />
              ) : (
                floors.map((f) => (
                  <div key={f.floor} className="hu-floor">
                    {data.floors.length > 1 && (
                      <div className="hu-floor-h">
                        <b>{floorName(f.floor)}</b>
                        <span>{plural(f.rooms.length, 'room')}</span>
                      </div>
                    )}
                    <div className="hu-tiles">
                      {f.rooms.map((r) => <RoomTile key={r.id} room={r} today={t} navigate={navigate} />)}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </section>

        <div className="hu-side">
          <section className="hu-side-sec" aria-labelledby="hu-in-h">
            <div className="hu-sec-head">
              <h2 id="hu-in-h" className="hu-h">{tr("Arriving")}</h2>
              <span className="fo-count">{data.arrivals.length}</span>
            </div>
            {data.arrivals.length === 0 ? (
              <p className="hu-none">{c.noArrivals}</p>
            ) : (
              <div className="hm-queue">
                {data.arrivals.map((r) => {
                  const late = r.checkIn < t;
                  return (
                    <div key={r.id} className="hm-q">
                      <i className={`hm-dot ${late ? 'tone-warn' : 'tone-info'}`} aria-hidden="true" />
                      <div className="hm-q-text">
                        <GoLink to="hotel.fo.reservation" params={{ id: r.id }} navigate={navigate} className="hu-q-name">{r.guestName}</GoLink>
                        <small>
                          {r.rooms} × {r.roomTypeName || tr("room")} · {plural(r.nights, 'night')}
                          {late && <> · <span className="hu-late">{trf("was due {0}", [short(r.checkIn)])}</span></>}
                        </small>
                      </div>
                      <GoLink to="hotel.fo.checkIn" params={{ reservationId: r.id }} navigate={navigate} className="btn btn-sm btn-outline-p">{tr("Check in")}</GoLink>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="hu-side-sec" aria-labelledby="hu-out-h">
            <div className="hu-sec-head">
              <h2 id="hu-out-h" className="hu-h">{tr("Leaving")}</h2>
              <span className="fo-count">{data.departures.length}</span>
            </div>
            {data.departures.length === 0 ? (
              <p className="hu-none">{c.noDepartures}</p>
            ) : (
              <div className="hm-queue">
                {data.departures.map((s) => {
                  const late = s.expectedCheckOut < t;
                  return (
                    <div key={s.id} className="hm-q">
                      <i className={`hm-dot ${late ? 'tone-warn' : 'tone-muted'}`} aria-hidden="true" />
                      <div className="hm-q-text">
                        <GoLink to="hotel.fo.stay" params={{ id: s.id }} navigate={navigate} className="hu-q-name">{s.guestName}</GoLink>
                        <small>
                          {tr("Room")} {s.roomNumber}
                          {late && <> · <span className="hu-late">{trf("was due {0}", [short(s.expectedCheckOut)])}</span></>}
                        </small>
                      </div>
                      <GoLink to="hotel.fo.stay" params={{ id: s.id }} navigate={navigate} className="btn btn-sm btn-outline-p">{tr("Check out")}</GoLink>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function RoomTile({ room: r, today, navigate }: { room: Room; today: string; navigate: ScreenProps['navigate'] }) {
  const stay = r.currentStay;
  const due = !!stay && stay.expectedCheckOut <= today;
  const to = stay ? { v: 'hotel.fo.stay', p: { id: stay.id } } : r.state === 'vacant' ? { v: 'hotel.fo.checkIn', p: { roomId: r.id } } : { v: 'hotel.fo.rooms', p: {} as Record<string, string> };
  const label = `${tr("Room")} ${r.number}, ${roomStateLabel[r.state]}${stay ? `, ${stay.guestName}` : ''}${r.outOfOrderReason ? `: ${r.outOfOrderReason}` : ''}`;
  return (
    <GoLink to={to.v} params={to.p} navigate={navigate} className={`hu-tile s-${css(r.state)}${due ? ' is-due' : ''}`} title={label}>
      <span className="hu-tile-top">
        <b>{r.number}</b>
        <span className="hu-tile-state">{due ? c.dueOut : roomStateLabel[r.state]}</span>
      </span>
      <small className="hu-tile-type">{r.roomTypeName ?? tr("No category")}</small>
      <span className="hu-tile-foot">
        {stay ? (
          <>
            <span className="hu-tile-guest">{stay.guestName}</span>
            <small>{trf("until {0}", [short(stay.expectedCheckOut)])}</small>
          </>
        ) : r.state === 'vacant' ? (
          <span className="hu-tile-go">{tr("Check in")} <Bi name="arrow-right-short" /></span>
        ) : r.state === 'dirty' ? (
          <span className="hu-tile-go">{tr("Mark clean")} <Bi name="arrow-right-short" /></span>
        ) : (
          <small className="hu-tile-why">{r.outOfOrderReason || tr("Not in service")}</small>
        )}
      </span>
    </GoLink>
  );
}
