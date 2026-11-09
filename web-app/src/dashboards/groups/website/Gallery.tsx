'use client';
// hotel.web.gallery: the website's photo gallery. Picked photos go up at once; captions are added after, and a drag sets the order.
import { useRef, useState } from 'react';

import type { WebFileInput, WebPhoto } from '@shared/dashboards/website';
import { useAction, useAsync, useToast } from '@/components/ui';
import { Bi, Dialog, Dropdown, EmptyState, FieldHint, FilterBar, FormSection, ListSearch, LoadError, Modal, PageSkeleton, Button, MayEdit } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import type { ScreenProps } from '../../types';
import { webApi } from './api';
import { Linked, Handle, Picture, WaNav, readPicked, useReorder } from './parts';

import { tr, trf } from '@/lib/i18n/language';
/** Base64 characters of photos in one upload request: under a hosted platform's 4.5 MB request limit with room for the JSON around them. */
const MAX_REQUEST_CHARS = 4_000_000;

type Tab = 'all' | 'caption';
interface Upload { total: number; done: number; failed: { name: string; error: string }[] }

export function WebsiteGallery({ navigate }: ScreenProps) {
  const { state, reload } = useAsync(() => webApi.listPhotos(), [], { keep: true });
  const toast = useToast();
  const [edit, setEdit] = useState<WebPhoto | null>(null);
  const [del, setDel] = useState<WebPhoto | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [typed, setTyped] = useState('');
  const [upload, setUpload] = useState<Upload | null>(null);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const photos = state.status === 'ready' ? state.data : [];
  const order = useReorder(photos, (id, direction) => webApi.movePhoto(id, direction), reload);
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const bare = photos.filter((p) => !p.caption.trim()).length;
  const shown = order.ordered.filter((p) => (tab === 'caption' ? !p.caption.trim() : true) && words.every((w) => `${p.caption} ${p.altText}`.toLowerCase().includes(w)));
  const uploading = upload !== null && upload.done + upload.failed.length < upload.total;

  async function send(files: File[]) {
    if (picker.current) picker.current.value = '';
    if (files.length === 0) return;
    const ready: WebFileInput[] = [];
    const failed: Upload['failed'] = [];
    setUpload({ total: files.length, done: 0, failed });
    for (const f of files) {
      const r = await readPicked(f, 'photo');
      if (r.ok) ready.push(r.file);
      else failed.push({ name: f.name, error: r.error });
      setUpload({ total: files.length, done: ready.length, failed: [...failed] });
    }
    if (ready.length === 0) return;
    const batches: WebFileInput[][] = [];
    let size = 0;
    for (const f of ready) {
      if (batches.length === 0 || size + f.dataBase64.length > MAX_REQUEST_CHARS) {
        batches.push([]);
        size = 0;
      }
      batches[batches.length - 1]?.push(f);
      size += f.dataBase64.length;
    }
    let added = 0;
    for (const batch of batches) {
      const r = await webApi.addPhotos({ caption: '', files: batch });
      if (!r.ok) {
        toast.show({ tone: 'error', text: r.error.details?.fields?.photos ?? r.error.details?.fields?.files ?? tr('The photos could not be uploaded. Try again.') });
        break;
      }
      added += r.data.length;
    }
    if (added) toast.show({ tone: 'success', text: trf('{0} {1} on the website. Add a caption so guests and search engines know what they show.', [added, added === 1 ? tr('photo is') : tr('photos are')]) });
    if (failed.length === 0) setUpload(null);
    reload();
  }

  async function toFront(photo: WebPhoto) {
    const steps = photos.findIndex((p) => p.id === photo.id);
    for (let i = 0; i < steps; i++) if (!(await webApi.movePhoto(photo.id, 'up')).ok) break;
    reload();
    toast.show({
      tone: 'success',
      text: tr('Moved to the front of the gallery.'),
      action: {
        label: 'Undo',
        onClick: () =>
          void (async () => {
            for (let i = 0; i < steps; i++) if (!(await webApi.movePhoto(photo.id, 'down')).ok) break;
            reload();
          })(),
      },
    });
  }

  const pickButton = (label: string) => (
    <MayEdit module="website"><Button icon="cloud-arrow-up" disabled={uploading} onClick={() => picker.current?.click()}>{uploading ? tr('Uploading…') : label}</Button></MayEdit>
  );

  return (
    <>
      <div className="page-head reveal">
        <div><p className="pms-sub">{tr('The photos in the website gallery. Drag a photo by its handle to change the order guests see.')}</p></div>
        <div className="sh-head-actions">
          {photos.length > 8 ? <ListSearch value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={tr('Search captions')} /> : null}
          {pickButton(tr('Upload photos'))}
        </div>
      </div>
      <input ref={picker} type="file" className="visually-hidden" accept="image/*" multiple tabIndex={-1} aria-hidden="true" onChange={(e) => void send([...(e.target.files ?? [])])} />

      <WaNav active="gallery" navigate={navigate} />

      {state.status === 'loading' ? (
        <PageSkeleton tiles={false} />
      ) : state.status === 'error' ? (
        <LoadError error={state.error} onRetry={reload} />
      ) : (
        <div
          className={`ha-stack reveal wg-page${over ? ' is-over' : ''}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setOver(false);
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setOver(false);
            void send([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')));
          }}
        >
          {upload ? (
            <div className={`wg-upload${upload.failed.length ? ' is-bad' : ''}`} role="status">
              <Bi name={uploading ? 'cloud-arrow-up' : upload.failed.length ? 'exclamation-circle' : 'check2-circle'} />
              <div className="wg-upload-text">
                <b>{uploading ? trf('Getting {0} of {1} ready…', [upload.done + upload.failed.length + 1, upload.total]) : trf('{0} of {1} uploaded', [upload.done, upload.total])}</b>
                {upload.failed.map((f) => <small key={f.name}>{f.error}</small>)}
                {!uploading && upload.failed.length ? <small>{tr('Pick another copy of those photos, or a smaller one.')}</small> : null}
              </div>
              {!uploading ? <Button size="sm" variant="ghost" onClick={() => setUpload(null)}>{tr('Close')}</Button> : null}
            </div>
          ) : null}

          {photos.length === 0 ? (
            <div className="card">
              <EmptyState icon="images" title={tr('No photos yet')} text={tr('Upload the hotel\'s best photos: the lobby, the rooms, the food. Big photos are made smaller for you.')}>
                <div className="mt-3">{pickButton(tr('Upload photos'))}</div>
              </EmptyState>
            </div>
          ) : (
            <>
              <HomeStats
                stats={[
                  { id: 'all', label: tr('Photos'), value: photos.length, format: (n) => String(Math.round(n)), note: tr('In the website gallery') },
                  { id: 'cap', label: tr('With a caption'), value: photos.length - bare, format: (n) => String(Math.round(n)), note: tr('Shown under the photo') },
{ id: 'alt', label: tr('With a description'), value: photos.filter((p) => p.altText.trim() !== '').length, format: (n) => String(Math.round(n)), note: tr('Read aloud for blind visitors') },
{ id: 'bare', label: tr('Need a caption'), value: bare, format: (n) => String(Math.round(n)), note: bare ? tr('Search engines read captions') : tr('Every photo has one') },
                ]}
              />
              <FilterBar
                tabsLabel={tr('Photos')}
                tabs={[{ id: 'all', label: tr('All'), icon: 'images', count: photos.length }, { id: 'caption', label: tr('Need a caption'), icon: 'chat-square-text', count: bare }]}
                active={tab}
                onTab={(id) => setTab(id === 'caption' ? 'caption' : 'all')}
                summary={<>{tr('Drop photos anywhere here to upload them.')}</>}
              />
              {shown.length === 0 ? (
                <div className="card">
                  {tab === 'caption' && words.length === 0 ? (
                    <EmptyState icon="check2-circle" title={tr('Every photo has a caption')} text={tr('Nothing to do here.')} />
                  ) : (
                    <EmptyState icon="search" title={tr('No photo matches that search')} text={tr('Try another word.')}>
                      <Button variant="outline" className="mt-3" onClick={() => setTyped('')}>{tr('Clear search')}</Button>
                    </EmptyState>
                  )}
                </div>
              ) : (
                <ul className="wa-photos wg-grid">
                  {shown.map((photo, i) => (
                    <li className={`wa-photo wg-photo${order.dragClass(photo.id)}`} key={photo.id} {...order.cardProps(photo.id)}>
                      <Handle props={order.handleProps(photo.id)} />
                      {/* check-shared-ignore: the photo itself opens its caption form */}
                      <button type="button" className="wg-pic" onClick={() => setEdit(photo)} aria-label={trf('Caption for photo {0}', [i + 1])}>
                        <Picture url={photo.url} shade={photo.shade} label={photo.altText || photo.caption} className="wg-img" />
                      </button>
                      <div className="wa-photo-body">
                        {photo.caption ? <b className="wg-cap" title={photo.caption}>{photo.caption}</b> : <b className="wg-cap is-warn">{tr('No caption yet')}</b>}
                        <small className="wg-alt" title={photo.altText}>{photo.altText || tr('No description')}</small>
                      </div>
                      <div className="wa-photo-actions">
                        <Button size="sm" variant="outline" icon="pencil-square" onClick={() => setEdit(photo)}>{photo.caption ? tr('Edit') : tr('Add caption')}</Button>
                        <MayEdit module="website">
                          <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for photo {0}', [i + 1])} {...p} />}>
                            {photos[0]?.id !== photo.id ? <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); void toFront(photo); }}><Bi name="arrow-bar-left" className="me-2" />{tr('Move to the front')}</a> : null}
                            <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setDel(photo); }}><Bi name="trash" className="me-2" />{tr('Delete photo')}</a>
                          </Dropdown>
                        </MayEdit>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {edit ? <PhotoModal key={edit.id} photo={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} /> : null}
      <Dialog
        open={del !== null}
        tone="danger"
        title={tr('Delete this photo?')}
        message={tr('It leaves the website and the file is removed, so it cannot be brought back. You would need to upload it again.')}
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setDel(null)}
        onConfirm={() => {
          const p = del;
          if (p) void run(() => webApi.deletePhoto(p.id), { success: 'Photo deleted.', onOk: () => { setDel(null); reload(); } });
        }}
      />
    </>
  );
}

function PhotoModal({ photo, onClose, onSaved }: { photo: WebPhoto; onClose: () => void; onSaved: () => void }) {
  const [caption, setCaption] = useState(photo.caption);
  const [alt, setAlt] = useState(photo.altText);
  const { busy, run } = useAction();
  return (
    <Modal
      open
      className="pay-form-modal"
      staticBackdrop
      scrollable={false}
      eyebrow={tr('Gallery')}
      title={photo.caption ? tr('Edit caption') : tr('Add caption')}
      onClose={onClose}
      onSubmit={() => void run(() => webApi.updatePhoto(photo.id, { caption, altText: alt.trim() || caption }), { success: 'Saved. The website follows straight away.', onOk: onSaved })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button>
          <Button icon="check2" type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save')}</Button>
        </>
      }
    >
      <Picture url={photo.url} shade={photo.shade} label={photo.altText || photo.caption} className="wg-preview" />
      <FormSection icon="chat-square-text" title={tr('What guests read')}>
        <Linked className="mb-3"><label className="form-label">{tr('Caption')}</label><input className="form-control" maxLength={150} placeholder={tr('e.g. Deluxe room, Hotel lobby')} value={caption} onChange={(e) => setCaption(e.target.value)} autoFocus /></Linked>
        <Linked>
          <label className="form-label">{tr('Description')} <span className="wz-optional">{tr('optional')}</span></label>
          <input className="form-control" maxLength={255} placeholder={caption || tr('What the photo shows')} value={alt} onChange={(e) => setAlt(e.target.value)} />
          <FieldHint>{tr('Read by search engines and screen readers. Left empty, the caption is used.')}</FieldHint>
        </Linked>
      </FormSection>
    </Modal>
  );
}
