'use client';

// Master Data > "Room service menu": the list a staying guest orders from. Since MJ's 26 Oct 2026 order it is food only (the Restaurant list; no laundry
// or other services), and the server sends only that list. HMS design, no Pallav screen:
// plain Pallav cards and tables. Module `masters`: the server refuses a person without edit.
import { useState } from 'react';
import { dashErrorText } from '@shared/dashboards';
import { formatINR } from '@shared/dashboards/format';
import { ROOM_MENU_PHOTO_MAX_BYTES, roomMenuCopy, roomMenuPhotoPath, type RoomMenuGroup, type RoomMenuItem } from '@shared/dashboards/roomMenu';
import * as client from '@/lib/api/client';
import { apiMode } from '@/lib/api/mode';
import { errorText, useAsync, useSubmit, useToast } from '@/components/ui';
import { Bi, Button, Dialog, EmptyState, IconButton, LoadError, Modal, PageSkeleton, RupeeInput, Table, MayEdit } from '@/dashboards/pallav/ui';
import { Linked } from '../website/parts';
import { roomMenuApi } from './menuApi';
import { matchesWords } from './masterParts';

import { tr, trf } from '@/lib/i18n/language';
const t = roomMenuCopy;

export function MastersMenu({ words }: { words: string[] }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const state = useAsync(() => roomMenuApi.list(), [version], { keep: true });
  const [form, setForm] = useState<{ group: RoomMenuGroup; item: RoomMenuItem | null } | null>(null);
  const [removing, setRemoving] = useState<RoomMenuItem | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => setVersion((v) => v + 1);

  if (state.state.status === 'error') return <LoadError error={state.state.error} onRetry={state.reload} />;
  if (state.state.status !== 'ready') return <div className="card"><PageSkeleton /></div>;
  const groups = state.state.data;

  const move = async (item: RoomMenuItem, direction: 'up' | 'down') => {
    setBusy(true);
    const res = await roomMenuApi.move(item.id, direction);
    setBusy(false);
    if (res.ok) refresh();
    else toast.show({ tone: 'error', text: dashErrorText[res.error.code] });
  };
  const doRemove = async () => {
    if (!removing) return;
    setBusy(true);
    const res = await roomMenuApi.remove(removing.id);
    setBusy(false);
    setRemoving(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: res.data.message });
      refresh();
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  };

  return (
    <>
      <p className="master-hint reveal"><Bi name="info-circle" /> {t.hint}</p>
      {groups.map((g) => {
        const shown = g.items.filter((i) => matchesWords(`${i.name} ${i.note ?? ''}`, words));
        return (
          <div className="card reveal mb-3" key={g.id}>
            <div className="d-flex align-items-center gap-2 p-3 pb-2">
              <Bi name={g.icon} />
              <div className="flex-grow-1">
                <div className="fw-semibold">{g.label}</div>
                <div className="small text-muted">{g.hint}</div>
              </div>
              <MayEdit module="masters"><Button size="sm" icon="plus-lg" onClick={() => setForm({ group: g, item: null })}>
                {t.add}
              </Button></MayEdit>
            </div>
            {shown.length === 0 ? (
              <EmptyState icon="cup-hot" title={t.empty} text={words.length ? '' : t.emptyHint} />
            ) : (
              <div className="table-responsive">
                <Table className="table table-hover align-middle mb-0 hms-card-table">
                  <thead>
                    <tr>
                      <th className="text-start">{t.fields.name}</th>
                      <th className="text-end">{t.fields.price}</th>
                      <th>{t.on}</th>
                      <th className="text-end" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((i, at) => (
                      <tr key={i.id}>
                        <td className="hms-card-head text-start">
                          <span className="cell-main">
                            {i.veg === 'yes' || i.veg === 'no' ? <span className={`go-veg ${i.veg === 'yes' ? 'veg' : 'nonveg'}`} role="img" aria-label={i.veg === 'yes' ? 'Vegetarian' : 'Non-vegetarian'} /> : null}
                            {i.name}
                            {i.hasPhoto ? <Bi name="image" className="ms-1 text-muted" aria-label={tr("Has a photo")} /> : null}
                          </span>
                          {i.category ? <span className="cell-sub">{i.category}</span> : null}
                          {i.note ? <span className="cell-sub">{i.note}</span> : null}
                        </td>
                        <td className="text-end" data-label={t.fields.price}>{formatINR(i.pricePaise)}</td>
                        <td data-label={t.on}>{i.available ? <span className="pill pill-live">{t.on}</span> : <span className="pill pill-locked" title={t.offHint}>{t.off}</span>}</td>
                        <td className="text-end hms-card-actions">
                          <span className="hms-row-icons">
                            <IconButton icon="arrow-up" label={`${t.moveUp}: ${i.name}`} title={t.moveUp} disabled={busy || at === 0} onClick={() => void move(i, 'up')} />
                            <IconButton icon="arrow-down" label={`${t.moveDown}: ${i.name}`} title={t.moveDown} disabled={busy || at === shown.length - 1} onClick={() => void move(i, 'down')} />
                            <MayEdit module="masters"><IconButton icon="pencil" label={`${t.edit}: ${i.name}`} title={t.edit} onClick={() => setForm({ group: g, item: i })} /></MayEdit>
                            <MayEdit module="masters"><IconButton icon="trash" tone="danger" label={`${t.remove}: ${i.name}`} title={t.remove} onClick={() => setRemoving(i)} /></MayEdit>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </div>
        );
      })}

      {form ? (
        <ItemForm
          key={form.item?.id ?? `new-${form.group.id}`}
          group={form.group}
          item={form.item}
          onClose={() => setForm(null)}
          onSaved={(message) => {
            setForm(null);
            toast.show({ tone: 'success', text: message });
            refresh();
          }}
        />
      ) : null}

      <Dialog
        open={removing !== null}
        tone="danger"
        title={t.removeTitle(removing?.name ?? '')}
        message={t.removeBody}
        confirmLabel={t.removeConfirm}
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void doRemove()}
      />
    </>
  );
}

function ItemForm({ group, item, onClose, onSaved }: { group: RoomMenuGroup; item: RoomMenuItem | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [note, setNote] = useState(item?.note ?? '');
  const [pricePaise, setPrice] = useState(item?.pricePaise ?? 0);
  const [available, setAvailable] = useState(item?.available ?? true);
  const [category, setCategory] = useState(item?.category ?? '');
  const [veg, setVeg] = useState<'yes' | 'no' | 'unknown'>(item?.veg ?? 'unknown');
  const { busy, errors, submit } = useSubmit(['name', 'note', 'pricePaise', 'category', 'veg']);
  const input = { name, note, pricePaise, available, category: category.trim() || null, veg };

  return (
    <Modal
      open
      onClose={onClose}
      title={item ? t.editTitle(item.name) : t.addTitle(group.label)}
      onSubmit={() => void submit(() => (item ? roomMenuApi.update(item.id, input) : roomMenuApi.create(group.id, input)), (d) => onSaved(item ? t.saved : t.added(d.name)))}
      footer={<Button type="submit" disabled={busy}>{busy ? t.saving : t.save}</Button>}
    >
      <div className="row g-3">
        <Linked className="col-12">
          <label className="form-label">{t.fields.name}<span className="req">*</span></label>
          <input className="form-control" maxLength={120} autoComplete="off" placeholder={t.placeholders.name} value={name} onChange={(e) => setName(e.target.value)} />
          {errors.name ? <div className="field-error">{errors.name}</div> : null}
        </Linked>
        <Linked className="col-12">
          <label className="form-label">{t.fields.note}</label>
          <input className="form-control" maxLength={200} autoComplete="off" placeholder={t.placeholders.note} value={note} onChange={(e) => setNote(e.target.value)} />
          {errors.note ? <div className="field-error">{errors.note}</div> : null}
        </Linked>
        <Linked className="col-md-6">
          <label className="form-label">{t.fields.price}</label>
          <RupeeInput paise={pricePaise} onChange={setPrice} />
          {errors.pricePaise ? <div className="field-error">{errors.pricePaise}</div> : null}
        </Linked>
        <Linked className="col-md-6">
          <label className="form-label">{tr("Category (optional)")}</label>
          <input className="form-control" maxLength={60} autoComplete="off" placeholder={trf("Empty = {0}", [group.label])} value={category} onChange={(e) => setCategory(e.target.value)} />
          <div className="form-text">{tr("A heading on the guest's menu, like Starters or Mains.")}</div>
          {errors.category ? <div className="field-error">{errors.category}</div> : null}
        </Linked>
        <fieldset className="col-12">
          <legend className="form-label">{tr("Veg or non-veg")}</legend>
          <div className="d-flex gap-3 flex-wrap">
            {(['yes', 'no', 'unknown'] as const).map((k) => (
              <label key={k} className="check-line">
                <input type="radio" name="menu-veg" checked={veg === k} onChange={() => setVeg(k)} />
                <span>
                  {k !== 'unknown' ? <span className={`go-veg ${k === 'yes' ? 'veg' : 'nonveg'}`} aria-hidden="true" /> : null}
                  {k === 'yes' ? tr("Veg") : k === 'no' ? tr("Non-veg") : tr("Not shown")}
                </span>
              </label>
            ))}
          </div>
          {errors.veg ? <div className="field-error">{errors.veg}</div> : null}
        </fieldset>
        {item ? <MenuPhoto item={item} /> : <div className="col-12 form-text">{tr("Save the item first, then add its photo.")}</div>}
        <div className="col-12">
          <label className="check-line"><input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} /><span>{t.fields.available}</span></label>
          <div className="form-text">{t.offHint}</div>
        </div>
      </div>
    </Modal>
  );
}

/** The item's photo (Round 3): a preview, "Add photo" / "Change photo" (JPG, PNG or WebP up to 10 MB; the server keeps a WebP) and Remove. Saved at once, apart from
 * the form. The mock has no photo store, so in a preview build it only says so. */
function MenuPhoto({ item }: { item: RoomMenuItem }) {
  const toast = useToast();
  const [has, setHas] = useState(Boolean(item.hasPhoto));
  const [stamp, setStamp] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const real = apiMode() === 'real';
  const path = roomMenuPhotoPath(item.id).replace(/^\/api\/v1/, '');

  const upload = async (file: File) => {
    setError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setError('Choose a JPG, PNG or WebP picture.');
    if (file.size > ROOM_MENU_PHOTO_MAX_BYTES) return setError('The picture is larger than 10 MB.');
    setBusy(true);
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    const res = await client.put<{ id: string; hasPhoto: boolean }>(path, { fileName: file.name, dataBase64 });
    setBusy(false);
    if (res.ok) {
      setHas(true);
      setStamp((n) => n + 1);
      toast.show({ tone: 'success', text: 'Photo saved.' });
    } else setError(res.error.details?.fields?.photo ?? errorText(res.error));
  };
  const remove = async () => {
    setBusy(true);
    const res = await client.del<{ id: string; hasPhoto: boolean }>(path);
    setBusy(false);
    if (res.ok) {
      setHas(false);
      toast.show({ tone: 'success', text: 'Photo removed.' });
    } else setError(errorText(res.error));
  };

  return (
    <div className="col-12">
      <span className="form-label d-block">{tr("Photo (optional)")}</span>
      <div className="d-flex align-items-center gap-3 flex-wrap">
        {has && real ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed-in picture from the API; next/image would fetch it without the session
          <img src={`${roomMenuPhotoPath(item.id)}?v=${stamp}`} alt={trf("Photo of {0}", [item.name])} className="go-photo" style={{ width: 72, height: 72 }} />
        ) : (
          <span className="go-photo none" style={{ width: 72, height: 72 }} aria-hidden="true">
            <Bi name="image" />
          </span>
        )}
        {real ? (
          <>
            <label className={`btn btn-sm btn-outline-p mb-0${busy ? ' disabled' : ''}`}>
              <Bi name="upload" /> {has ? tr("Change photo") : tr("Add photo")}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
            </label>
            {has ? (
              <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => void remove()}>
                {tr("Remove")}
              </Button>
            ) : null}
          </>
        ) : (
          <span className="small text-muted">{tr("Photos are kept on the real server; this preview has none.")}</span>
        )}
      </div>
      <div className="form-text">{tr("Shown on the guest's menu. JPG, PNG or WebP, up to 10 MB.")}</div>
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}