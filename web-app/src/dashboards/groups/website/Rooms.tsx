'use client';
// Website rooms (hotel.web.rooms): one card per room category in the order guests see them; Edit, or Add a rate when it has none.
import { useState } from 'react';

import type { WebRoom } from '@shared/dashboards/website';
import { useAction, useAsync } from '@/components/ui';
import { Bi, Dialog, Dropdown, EmptyState, ListSearch, LoadError, PageSkeleton, Button, MayEdit, StatusChip } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { webApi } from './api';
import { Handle, Shade, WaNav, useReorder } from './parts';

import { tr, trf } from '@/lib/i18n/language';
export function WebsiteRooms({ navigate }: ScreenProps) {
  const { state, reload } = useAsync(() => webApi.listRooms(), []);
  const [del, setDel] = useState<WebRoom | null>(null);
  const { busy, run } = useAction();
  const rooms = state.status === 'ready' ? state.data : [];
  const order = useReorder(rooms, (id, direction) => webApi.moveRoom(id, { direction }), reload);
  const [typed, setTyped] = useState('');
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = order.ordered.filter((r) => words.every((w) => `${r.name} ${r.size} ${r.bedType}`.toLowerCase().includes(w)));

  return (
    <>
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">{tr('The room categories shown on the website, with their photos. Drag a card to change the order guests see.')}</p>
        </div>
        <div className="sh-head-actions">
          {rooms.length > 6 ? <ListSearch value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={tr('Search room categories')} /> : null}
          <Button icon="plus-lg" onClick={() => navigate('hotel.web.roomForm')}>{tr('Add room category')}</Button>
        </div>
      </div>

      <WaNav active="rooms" navigate={navigate} />

      {state.status === 'loading' ? (
        <PageSkeleton tiles={false} />
      ) : state.status === 'error' ? (
        <LoadError error={state.error} onRetry={reload} />
      ) : rooms.length === 0 ? (
        <div className="card reveal">
          <EmptyState icon="door-open" title={tr('No room categories yet')} text={tr('Add the first one; it shows on the website as soon as it is saved.')}>
            <Button icon="plus-lg" className="mt-3" onClick={() => navigate('hotel.web.roomForm')}>{tr('Add room category')}</Button>
          </EmptyState>
        </div>
      ) : shown.length === 0 ? (
        <div className="card reveal">
          <EmptyState icon="search" title={tr('No room category matches that search')} text={tr('Try another word.')}>
            <Button variant="outline" className="mt-3" onClick={() => setTyped('')}>{tr('Clear search')}</Button>
          </EmptyState>
        </div>
      ) : (
        <ul className="ha-co-grid reveal">
          {shown.map((room, i) => (
            <li className={`card ha-co wr-room${room.available ? '' : ' is-off'}${order.dragClass(room.id)}`} key={room.id} {...order.cardProps(room.id)}>
              {room.photos[0] ? (
                <Shade shade={i} label={room.photos[0].alt || room.name} className="wr-shade" />
              ) : (
                <div className="wa-icon-tile wa-shade-wide">
                  <span className="wa-card-sub">{tr('No photo yet')}</span>
                </div>
              )}
              <div className="ha-co-top">
                <Handle props={order.handleProps(room.id)} />
                <div className="ha-co-name">
                  <h3>{room.name}</h3>
                  <small>{[room.size, room.bedType].filter(Boolean).join(' · ') || tr('No details yet')}</small>
                </div>
                {room.available ? <StatusChip tone="ok">{tr('Taking enquiries')}</StatusChip> : <StatusChip tone="neutral">{tr('Unavailable')}</StatusChip>}
              </div>
              <dl className="ha-co-facts">
                <div><dt>{tr('Rooms')}</dt><dd>{room.totalCount}</dd></div>
                <div><dt>{tr('Free today')}</dt><dd>{room.freeToday}</dd></div>
                <div><dt>{tr('Rate plans')}</dt><dd className={room.plansCount ? undefined : 'is-warn'}>{room.plansCount || tr('None yet')}</dd></div>
              </dl>
              <div className="ha-co-acts">
                <Dropdown align="end" button={(p) => <Button variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [room.name])} {...p}>{tr('More')}</Button>}>
                  <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); navigate('hotel.web.rates', { room: room.id }); }}><Bi name="tags" className="me-2" />{tr('Rates')}</a>
                  <MayEdit module="website">
                    <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setDel(room); }}><Bi name="trash" className="me-2" />{tr('Delete room category')}</a>
                  </MayEdit>
                </Dropdown>
                {room.plansCount ? (
                  <Button icon="pencil-square" onClick={() => navigate('hotel.web.roomForm', { id: room.id })}>{tr('Edit')}</Button>
                ) : (
                  <Button icon="tags" onClick={() => navigate('hotel.web.rates', { room: room.id })}>{tr('Add a rate')}</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={del !== null}
        tone="danger"
        title={trf('Delete {0}?', [del?.name ?? ''])}
        message={tr('This room category and its photos are removed for good.')}
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setDel(null)}
        onConfirm={() => {
          const r = del;
          if (r) void run(() => webApi.deleteRoom(r.id), { success: 'Deleted.', onOk: () => { setDel(null); reload(); } });
        }}
      />
    </>
  );
}
