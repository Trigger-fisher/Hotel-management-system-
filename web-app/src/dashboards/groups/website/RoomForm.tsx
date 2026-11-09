'use client';
// hotel.web.roomForm (params.id = edit, none = add): a room category in three short steps, the room, how it shows, its photos.
import { useRef, useState, type DragEvent } from 'react';

import { validateRoom, type WebRoom, type WebRoomInput, type WebRoomPhoto } from '@shared/dashboards/website';
import { useAction, useAsync, useToast } from '@/components/ui';
import { Bi, FieldError, FieldHint, FormSection, LoadError, PageSkeleton, PickGroup, RequiredMark, StatusChip, Button } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { webApi } from './api';
import { Shade, WaNav, readPicked } from './parts';

import { tr, trf } from '@/lib/i18n/language';
const BLANK: WebRoom = {
  id: '', name: '', bedType: '', size: '', maxGuests: 2, totalCount: 1, badgeLabel: '', note: '',
  showPrice: true, available: true, photos: [], freeToday: 0, plansCount: 0,
};

type PhotoState = 'saved' | 'preparing' | 'ready' | 'failed';
interface Photo extends WebRoomPhoto { state: PhotoState; error?: string }

let photoSeq = 0;
const nameOf = (file: string) => file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();

function PhotoChip({ photo, first }: { photo: Photo; first: boolean }) {
  if (photo.state === 'preparing') return <StatusChip tone="neutral">{tr('Getting it ready…')}</StatusChip>;
  if (photo.state === 'failed') return <StatusChip tone="danger">{tr('Cannot use this photo')}</StatusChip>;
  if (photo.state === 'ready') return <StatusChip tone="warn">{tr('New: goes up when you save')}</StatusChip>;
  return first ? <StatusChip tone="ok">{tr('Cover photo')}</StatusChip> : <StatusChip tone="ok">{tr('On the website')}</StatusChip>;
}

function Body({ room: r, editing, navigate }: { room: WebRoom; editing: boolean; navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: r.name, bedType: r.bedType, size: r.size, maxGuests: String(r.maxGuests), totalCount: String(r.totalCount),
    badgeLabel: r.badgeLabel, note: r.note, showPrice: r.showPrice, available: r.available,
  });
  const [photos, setPhotos] = useState<Photo[]>(r.photos.map((p) => ({ ...p, state: 'saved' })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [over, setOver] = useState(false);
  const { busy, run } = useAction();
  const picker = useRef<HTMLInputElement>(null);
  const set = (k: 'name' | 'bedType' | 'size' | 'maxGuests' | 'totalCount' | 'badgeLabel' | 'note') => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const setPhoto = (id: string, patch: Partial<Photo>) => setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const list = () => navigate('hotel.web.rooms');
  const preparing = photos.some((p) => p.state === 'preparing');

  const addFiles = (files: FileList | File[] | null) => {
    const picked = [...(files ?? [])];
    if (picker.current) picker.current.value = '';
    if (!picked.length) return;
    const added = picked.map((file): Photo => ({ id: `new-${++photoSeq}`, name: nameOf(file.name), alt: '', state: 'preparing' }));
    setPhotos((ps) => [...ps, ...added]);
    added.forEach((p, i) => {
      const file = picked[i];
      if (!file) return;
      void readPicked(file, 'photo').then((res) => setPhoto(p.id, res.ok ? { state: 'ready' } : { state: 'failed', error: res.error }));
    });
  };

  const remove = (photo: Photo) => {
    const at = photos.findIndex((p) => p.id === photo.id);
    setPhotos((ps) => ps.filter((p) => p.id !== photo.id));
    if (photo.state === 'failed') return;
    toast.show({
      tone: 'success',
      text: photo.state === 'saved' ? tr('Photo taken off. It leaves the website when you save.') : tr('Photo taken off.'),
      action: { label: 'Undo', onClick: () => setPhotos((ps) => (ps.some((p) => p.id === photo.id) ? ps : [...ps.slice(0, at), photo, ...ps.slice(at)])) },
    });
  };
  const makeCover = (photo: Photo) => setPhotos((ps) => [photo, ...ps.filter((p) => p.id !== photo.id)]);

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setOver(false);
    addFiles([...e.dataTransfer.files].filter((x) => x.type.startsWith('image/')));
  };

  const save = () => {
    const roomName = f.name.trim();
    const kept = photos.filter((p) => p.state === 'saved' || p.state === 'ready');
    const input: WebRoomInput = {
      name: f.name, bedType: f.bedType.trim(), size: f.size.trim(), maxGuests: Number.parseInt(f.maxGuests, 10), totalCount: Number.parseInt(f.totalCount, 10),
      badgeLabel: f.badgeLabel.trim(), note: f.note.trim(), showPrice: f.showPrice, available: f.available,
      photos: kept.map(({ id, name, alt }, i) => ({ id, name: name.trim() || trf('{0} photo {1}', [roomName, i + 1]), alt: alt.trim() || trf('{0}, photo {1}', [roomName, i + 1]) })),
    };
    const v = validateRoom(input);
    setErrors(v);
    if (Object.keys(v).length) return;
    void run(() => (editing ? webApi.updateRoom(r.id, input) : webApi.createRoom(input)), {
      success: editing ? 'Saved. The website follows straight away.' : 'Room category added. Now give it a rate so guests can book it.',
      onFields: setErrors,
      onOk: (saved) => (editing ? list() : navigate('hotel.web.rates', { room: saved.id })),
    });
  };
  const err = (k: string) => <FieldError>{errors[k]}</FieldError>;
  const messages = Object.values(errors).filter(Boolean);
  const failed = photos.filter((p) => p.state === 'failed').length;

  return (
    <form
      className="card reveal p-3 p-md-4 wf-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {messages.length > 0 ? (
        <div className="alert alert-danger" role="alert">
          {messages.map((m) => <div key={m}>{m}</div>)}
        </div>
      ) : null}

      <FormSection icon="door-open" title={tr('1. The room')} hint={tr('What guests read on the room card.')}>
        <div className="row g-3">
          <div className="col-md-6"><label className="form-label" htmlFor="r_name">{tr('Room name')}<RequiredMark /></label>
            <input id="r_name" className="form-control" maxLength={100} value={f.name} onChange={set('name')} placeholder={tr('e.g. Executive Suite')} autoFocus={!editing} />{err('name')}</div>
          <div className="col-6 col-md-3"><label className="form-label" htmlFor="r_bed">{tr('Bed type')}</label>
            <input id="r_bed" className="form-control" maxLength={50} value={f.bedType} onChange={set('bedType')} placeholder={tr('e.g. Queen Bed')} /></div>
          <div className="col-6 col-md-3"><label className="form-label" htmlFor="r_size">{tr('Size')}</label>
            <input id="r_size" className="form-control" maxLength={50} value={f.size} onChange={set('size')} placeholder={tr('e.g. 160 sq.ft')} /></div>
          <div className="col-6 col-md-3"><label className="form-label" htmlFor="r_guests">{tr('Max guests')}<RequiredMark /></label>
            <input id="r_guests" type="number" inputMode="numeric" className="form-control" min={1} max={20} value={f.maxGuests} onChange={set('maxGuests')} />{err('maxGuests')}</div>
          <div className="col-6 col-md-3"><label className="form-label" htmlFor="r_count">{tr('Rooms of this kind')}<RequiredMark /></label>
            <input id="r_count" type="number" inputMode="numeric" className="form-control" min={1} max={255} value={f.totalCount} onChange={set('totalCount')} />{err('totalCount')}</div>
          <div className="col-md-6 align-self-end"><FieldHint>{tr('Rooms of this kind is how many real rooms there are. The website counts free rooms from it.')}</FieldHint></div>
        </div>
      </FormSection>

      <FormSection icon="globe2" title={tr('2. On the website')} hint={tr('Both can be changed at any time.')}>
        <div className="row g-3">
          <div className="col-md-6">
            <PickGroup
              label={tr('Enquiries')}
              value={f.available ? 'on' : 'off'}
              onChange={(v) => setF((p) => ({ ...p, available: v === 'on' }))}
              choices={[
                { value: 'on', icon: 'check2-circle', title: tr('Taking enquiries'), text: tr('Guests can ask for it') },
                { value: 'off', icon: 'pause-circle', title: tr('Unavailable'), text: tr('Shown, but not offered') },
              ]}
            />
          </div>
          <div className="col-md-6">
            <PickGroup
              label={tr('Prices')}
              value={f.showPrice ? 'show' : 'hide'}
              onChange={(v) => setF((p) => ({ ...p, showPrice: v === 'show' }))}
              choices={[
                { value: 'show', icon: 'eye', title: tr('Show prices'), text: tr("Today's rate on the card") },
                { value: 'hide', icon: 'eye-slash', title: tr('Hide prices'), text: tr('Guests ask for the price') },
              ]}
            />
          </div>
          <div className="col-md-6"><label className="form-label" htmlFor="r_badge">{tr('Badge')} <span className="wz-optional">{tr('optional')}</span></label>
            <input id="r_badge" className="form-control" maxLength={40} value={f.badgeLabel} onChange={set('badgeLabel')} placeholder={tr('e.g. Most Booked')} />
            <FieldHint>{tr('The small tag at the top of the room card.')}</FieldHint></div>
          <div className="col-md-6"><label className="form-label" htmlFor="r_note">{tr('Note')} <span className="wz-optional">{tr('optional')}</span></label>
            <input id="r_note" className="form-control" maxLength={255} value={f.note} onChange={set('note')} placeholder={tr('e.g. Under renovation until March')} /></div>
        </div>
      </FormSection>

      <FormSection icon="images" title={tr('3. Photos')} hint={tr('The first photo is the cover. Big photos are made smaller for you.')}>
        {photos.length > 0 ? (
          <ul className="wf-photos" aria-label={tr('Photos of this room')}>
            {photos.map((photo, i) => (
              <li className={`wf-photo is-${photo.state}`} key={photo.id}>
                <Shade shade={i} label={photo.alt || photo.name} className="wf-thumb" />
                <div className="wf-photo-body">
                  <PhotoChip photo={photo} first={i === 0} />
                  {photo.state === 'failed' ? (
                    <p className="wf-photo-err">{photo.error} {tr('Pick another photo.')}</p>
                  ) : (
                    <div className="wf-photo-fields">
                      <input className="form-control" value={photo.name} onChange={(e) => setPhoto(photo.id, { name: e.target.value })} placeholder={tr('Photo name')} aria-label={trf('Name of photo {0}', [i + 1])} />
                      <input className="form-control" value={photo.alt} onChange={(e) => setPhoto(photo.id, { alt: e.target.value })} placeholder={tr('What it shows (read by search engines)')} aria-label={trf('What photo {0} shows', [i + 1])} />
                    </div>
                  )}
                </div>
                <div className="wf-photo-acts">
                  {i > 0 && photo.state !== 'failed' && photo.state !== 'preparing' ? <Button size="sm" variant="ghost" icon="star" onClick={() => makeCover(photo)}>{tr('Make cover')}</Button> : null}
                  <Button size="sm" variant="ghost" icon="x-lg" onClick={() => remove(photo)} aria-label={trf('Take off photo {0}', [i + 1])}>{tr('Take off')}</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <input id="r_photos" ref={picker} type="file" className="visually-hidden" accept="image/*" multiple onChange={(e) => addFiles(e.target.files)} />
        <label
          className={`wf-drop${over ? ' is-over' : ''}`}
          htmlFor="r_photos"
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <Bi name="cloud-arrow-up" />
          <span><b>{photos.length ? tr('Add more photos') : tr('Add photos')}</b><small>{tr('Tap to pick, or drop them here. JPG, PNG, WebP or GIF.')}</small></span>
        </label>
        {failed > 0 ? <FieldHint>{tr('A photo that cannot be used is left out when you save.')}</FieldHint> : null}
      </FormSection>

      <div className="wf-foot">
        <Button variant="ghost" onClick={list}>{tr('Cancel')}</Button>
        <Button icon="check2" type="submit" disabled={busy || preparing}>{busy ? tr('Saving…') : preparing ? tr('Getting photos ready…') : editing ? tr('Save changes') : tr('Add room category')}</Button>
      </div>
    </form>
  );
}

export function WebsiteRoomForm({ params, navigate }: ScreenProps) {
  const id = params.id;
  const { state, reload } = useAsync(() => (id ? webApi.getRoom(id) : Promise.resolve({ ok: true as const, data: BLANK })), [id]);
  const editing = Boolean(id);
  const room = state.status === 'ready' ? state.data : null;

  return (
    <>
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">
            {editing
              ? tr('Change this room category. The website follows as soon as it is saved.')
              : tr('Three short steps. Once saved it shows on the website, and you give it a rate next.')}
          </p>
        </div>
        <div className="sh-head-actions">
          <Button variant="outline" icon="arrow-left" onClick={() => navigate('hotel.web.rooms')}>{tr('Back to rooms')}</Button>
        </div>
      </div>
      <WaNav active="rooms" navigate={navigate} />
      {room ? <Body key={room.id || 'new'} room={room} editing={editing} navigate={navigate} /> : state.status === 'error' ? <LoadError error={state.error} onRetry={reload} /> : <PageSkeleton tiles={false} />}
    </>
  );
}
