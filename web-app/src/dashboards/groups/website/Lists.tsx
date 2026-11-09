'use client';
// hotel.web.services / policies / nearby: the cards the website lists, in the order guests see them.
import { useId, useState, type ReactNode } from 'react';

import { websiteCopy, type WebListKind, type WebNearbyInput, type WebNearbyPlace, type WebPolicyCard, type WebService } from '@shared/dashboards/website';
import type { DashResult } from '@shared/dashboards/common';
import { errorText, useAction, useAsync, useToast, type AsyncState } from '@/components/ui';
import { Bi, Dialog, Dropdown, EmptyState, FieldError, FieldHint, FormSection, ListSearch, Loaded, Modal, RequiredMark, Button, Textarea, MayEdit } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { webApi } from './api';
import { Linked, Handle, WaNav, readPicked, useReorder, type WaTab } from './parts';

import { tr, trf } from '@/lib/i18n/language';
interface Shell {
  kind: WebListKind;
  sub: string;
  addLabel: string;
  /** The word in "Delete service", "Search services". */
  noun: string;
  nouns: string;
  empty: { icon: string; title: string; text: string };
  deleteBody: string;
}

/** The words of a card the page search looks in: its texts, not its ids, links or numbers. */
const textOf = (item: object): string =>
  Object.entries(item)
    .filter(([k]) => k !== 'id' && !/url$/i.test(k))
    .flatMap(([, v]) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []))
    .join(' ')
    .toLowerCase();

interface CardParts { icon: ReactNode; sub?: ReactNode; body?: ReactNode }

/**
 * Head, add button, section tabs, empty state, draggable grid and delete that the three pages share. A card that can be put back exactly
 * (`restore`, no uploaded icon) is deleted at once with Undo; any other asks first.
 */
function ListPage<T extends { id: string; title: string }, D>({ shell, state, pick, reload, onAdd, onEdit, card, restore, notice, navigate }: {
  shell: Shell; state: AsyncState<D>; pick: (data: D) => T[]; reload: () => void; onAdd: () => void; onEdit: (item: T) => void;
  card: (item: T) => CardParts; restore?: (item: T) => (() => Promise<DashResult<{ id: string }>>) | null; notice?: (data: D) => ReactNode; navigate: ScreenProps['navigate'];
}) {
  const toast = useToast();
  const items = state.status === 'ready' ? pick(state.data) : [];
  const order = useReorder(items, (id, dir) => webApi.moveListItem(shell.kind, id, dir), reload);
  const [del, setDel] = useState<T | null>(null);
  const [typed, setTyped] = useState('');
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (item: T) => words.every((w) => textOf(item).includes(w));
  const { busy, run } = useAction();

  async function removeNow(item: T, again: () => Promise<DashResult<{ id: string }>>) {
    const at = items.findIndex((x) => x.id === item.id);
    const res = await webApi.deleteListItem(shell.kind, item.id);
    if (!res.ok) return toast.show({ tone: 'error', text: errorText(res.error) });
    reload();
    toast.show({
      tone: 'success',
      text: trf('{0} taken off the website.', [item.title]),
      action: {
        label: 'Undo',
        onClick: () =>
          void (async () => {
            const back = await again();
            if (!back.ok) return toast.show({ tone: 'error', text: errorText(back.error) });
            for (let n = items.length - 1; n > at; n--) if (!(await webApi.moveListItem(shell.kind, back.data.id, 'up')).ok) break;
            reload();
          })(),
      },
    });
  }
  const askDelete = (item: T) => {
    const again = restore?.(item);
    if (again) void removeNow(item, again);
    else setDel(item);
  };

  return (
    <>
      <div className="page-head reveal">
        <div><p className="pms-sub">{shell.sub}</p></div>
        <div className="sh-head-actions">
          {items.length > 6 ? <ListSearch value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={trf('Search {0}', [shell.nouns])} /> : null}
          <MayEdit module="website"><Button icon="plus-lg" onClick={onAdd} className="sh-new">{shell.addLabel}</Button></MayEdit>
        </div>
      </div>

      <WaNav active={shell.kind as WaTab} navigate={navigate} />

      <Loaded state={state} onRetry={reload} tiles={false}>
        {(data) => (
          <div className="ha-stack reveal">
            {notice?.(data)}
            {items.length === 0 ? (
              <div className="card">
                <EmptyState icon={shell.empty.icon} title={shell.empty.title} text={shell.empty.text}>
                  <MayEdit module="website"><Button icon="plus-lg" className="mt-3" onClick={onAdd}>{shell.addLabel}</Button></MayEdit>
                </EmptyState>
              </div>
            ) : !items.some(matches) ? (
              <div className="card">
                <EmptyState icon="search" title={trf('No {0} matches that search', [shell.noun])} text={tr('Try another word.')}><Button variant="outline" className="mt-3" onClick={() => setTyped('')}>{tr('Clear search')}</Button></EmptyState>
              </div>
            ) : (
              <>
                <ul className="ha-co-grid">
                  {order.ordered.filter(matches).map((item) => {
                    const c = card(item);
                    return (
                      <li className={`card ha-co wl-item${order.dragClass(item.id)}`} key={item.id} {...order.cardProps(item.id)}>
                        <div className="ha-co-top">
                          {items.length > 1 ? <Handle props={order.handleProps(item.id)} /> : null}
                          <span className="wa-icon-tile">{c.icon}</span>
                          <div className="ha-co-name">
                            <h3 title={item.title}>{item.title}</h3>
                            {c.sub ? <small>{c.sub}</small> : null}
                          </div>
                        </div>
                        {c.body ? <div className="wl-body">{c.body}</div> : null}
                        <MayEdit module="website">
                          <div className="ha-co-acts">
                            <Dropdown align="end" button={(p) => <Button variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [item.title])} {...p}>{tr('More')}</Button>}>
                              <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); askDelete(item); }}><Bi name="trash" className="me-2" />{trf('Delete {0}', [shell.noun])}</a>
                            </Dropdown>
                            <Button variant="outline" icon="pencil-square" onClick={() => onEdit(item)}>{tr('Edit')}</Button>
                          </div>
                        </MayEdit>
                      </li>
                    );
                  })}
                </ul>
                {items.length > 1 ? <p className="wr-rates-hint"><Bi name="grip-vertical" /> {tr('Drag a card by its handle to change the order guests see.')}</p> : null}
              </>
            )}
          </div>
        )}
      </Loaded>

      <Dialog
        open={del !== null}
        tone="danger"
        title={trf('Delete {0}?', [del?.title ?? ''])}
        message={shell.deleteBody}
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setDel(null)}
        onConfirm={() => {
          const d = del;
          if (d) void run(() => webApi.deleteListItem(shell.kind, d.id), { success: 'Deleted.', onOk: () => { setDel(null); reload(); } });
        }}
      />
    </>
  );
}

/** The icon box of the service and rule-card forms: the current icon with "Remove this icon", then the file picker. */
function IconPicker({ has, iconUrl, glyph, removed, onRemoved, onPicked, error, children }: { has: boolean; iconUrl?: string | null; glyph: string; removed: boolean; onRemoved: (v: boolean) => void; onPicked: (file: File | null) => void; error?: string; children?: ReactNode }) {
  const fileId = useId();
  return (
    <div>
      <label className="form-label" htmlFor={fileId}>{tr('Icon')} <span className="wz-optional">{tr('optional')}</span></label>
      <div className="d-flex align-items-center gap-3 mb-2" hidden={!has}>
        <span className="wa-icon-tile"><IconTile url={iconUrl} glyph={glyph} /></span>
        <label className="form-check small mb-0"><input type="checkbox" className="form-check-input" checked={removed} onChange={(e) => onRemoved(e.target.checked)} /> <span className="form-check-label">{tr('Remove this icon')}</span></label>
      </div>
      <input id={fileId} type="file" className="form-control" accept=".jpg,.jpeg,.png,.webp,.gif,.svg" onChange={(e) => onPicked(e.target.files?.[0] ?? null)} />
      <FieldError>{error}</FieldError>
      {children}
    </div>
  );
}

/** The card's icon: the stored picture when the server sent its URL, else the glyph stand-in. */
function IconTile({ url, glyph }: { url?: string | null; glyph: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- a stored user upload behind the session, not a static asset
  return url ? <img src={url} alt="" width={28} height={28} loading="lazy" decoding="async" style={{ objectFit: 'contain' }} /> : <Bi name={glyph} />;
}

/** Common names offered above the title box; the ones already on the list are left out, so a tap fills a new one. */
function Presets({ names, taken, value, onPick }: { names: string[]; taken: string[]; value: string; onPick: (name: string) => void }) {
  const free = names.filter((n) => !taken.some((t) => t.trim().toLowerCase() === n.toLowerCase()));
  if (free.length === 0) return null;
  return (
    <div className="wr-presets" role="group" aria-label={tr('Common choices')}>
      {free.map((n) => <Button key={n} size="sm" variant={value === tr(n) ? 'primary' : 'outline'} onClick={() => onPick(tr(n))}>{tr(n)}</Button>)}
    </div>
  );
}

function FormModal({ eyebrow, title, saveLabel, wide, busy, onClose, onSubmit, children }: { eyebrow: string; title: string; saveLabel: string; wide?: boolean; busy: boolean; onClose: () => void; onSubmit: () => void; children: ReactNode }) {
  return (
    <Modal
      open
      size={wide ? 'lg' : 'md'}
      className="pay-form-modal"
      staticBackdrop
      eyebrow={eyebrow}
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button>
          <Button icon="check2" type="submit" disabled={busy}>{busy ? tr('Saving…') : saveLabel}</Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/** Runs a save call, shows field errors under the boxes and anything else as a toast. */
function useSave() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const save = (call: () => Promise<DashResult<unknown>>, onOk: () => void) => void run(call, { success: 'Saved. The website follows straight away.', onFields: setErrors, onOk });
  return { busy, errors, setErrors, save };
}
const fe = (errors: Record<string, string>, k: string) => <FieldError>{errors[k]}</FieldError>;

/* ------------------------------------------------------------------ services */

const SERVICE_NAMES = ['Free Wi-Fi', 'Free parking', 'Restaurant', 'Room service', '24-hour front desk', 'Airport pickup', 'Laundry'];

export function WebsiteServices({ navigate }: ScreenProps) {
  const { state, reload } = useAsync(() => webApi.listServices(), []);
  const [form, setForm] = useState<{ item: WebService | null } | null>(null);
  const list = state.status === 'ready' ? state.data : [];
  return (
    <>
      <ListPage<WebService, WebService[]>
        shell={{
          kind: 'services', sub: tr('The services and facilities listed on the website, in the order guests see them.'), addLabel: tr('Add service'), noun: tr('service'), nouns: tr('services'),
          empty: { icon: 'stars', title: tr('No services yet'), text: tr('Add what guests ask about: Wi-Fi, parking, a restaurant. Common ones are a tap away.') }, deleteBody: tr('This service and its icon are removed from the website.'),
        }}
        state={state} pick={(d) => d} reload={reload} onAdd={() => setForm({ item: null })} onEdit={(s) => setForm({ item: s })} navigate={navigate}
        restore={(s) => (s.hasIcon ? null : () => webApi.saveService(null, { title: s.title, description: s.description }))}
        card={(s) => ({
          icon: s.hasIcon ? <IconTile url={s.iconUrl} glyph="stars" /> : <Bi name="stars" />,
          body: s.description ? <p className="ha-note">{s.description}</p> : <p className="wl-none">{tr('No description yet')}</p>,
        })}
      />
      {form ? <ServiceModal key={form.item?.id ?? 'new'} item={form.item} taken={list.map((s) => s.title)} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} /> : null}
    </>
  );
}

function ServiceModal({ item, taken, onClose, onSaved }: { item: WebService | null; taken: string[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [removeIcon, setRemoveIcon] = useState(false);
  const { busy, errors, setErrors, save } = useSave();
  async function submit() {
    if (!title.trim()) return setErrors({ title: websiteCopy.lists.titleMissing });
    const icon = iconFile ? await readPicked(iconFile, 'icon') : null;
    if (icon && !icon.ok) return setErrors({ icon: icon.error });
    save(() => webApi.saveService(item?.id ?? null, { title, description, ...(icon ? { icon: icon.file } : {}), removeIcon }), onSaved);
  }
  return (
    <FormModal eyebrow={tr('Services')} title={item ? trf('Edit {0}', [item.title]) : tr('Add service')} saveLabel={item ? tr('Save changes') : tr('Add service')} busy={busy} onClose={onClose} onSubmit={() => void submit()}>
      <FormSection icon="stars" title={tr('The service')} hint={tr('One short name and one line about it.')}>
        {!item ? <Presets names={SERVICE_NAMES} taken={taken} value={title} onPick={setTitle} /> : null}
        <Linked className="mb-3"><label className="form-label">{tr('Name')}<RequiredMark /></label><input className="form-control" maxLength={80} required placeholder={tr('e.g. Free parking')} value={title} onChange={(e) => setTitle(e.target.value)} />{fe(errors, 'title')}</Linked>
        <Linked className="mb-3"><label className="form-label">{tr('One line about it')} <span className="wz-optional">{tr('optional')}</span></label><input className="form-control" maxLength={255} placeholder={tr('e.g. Covered parking for 20 cars')} value={description} onChange={(e) => setDescription(e.target.value)} /></Linked>
        <IconPicker has={Boolean(item?.hasIcon)} iconUrl={item?.iconUrl} glyph="stars" removed={removeIcon} onRemoved={setRemoveIcon} onPicked={setIconFile} error={errors.icon}>
          <FieldHint>{tr("An SVG works best: it takes the page's colour.")}</FieldHint>
        </IconPicker>
      </FormSection>
    </FormModal>
  );
}

/* ------------------------------------------------------------------ house rules */

const POLICY_NAMES = ['Check-in and check-out', 'Cancellation', 'Guest rules', 'Children and extra beds', 'Payment'];
/** Str::limit($line, 70): the first 70 characters and "...". */
const limit = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n).trimEnd()}...` : s);

export function WebsitePolicies({ navigate }: ScreenProps) {
  const { state, reload } = useAsync(() => webApi.listPolicies(), []);
  const [form, setForm] = useState<{ item: WebPolicyCard | null } | null>(null);
  const list = state.status === 'ready' ? state.data : [];
  return (
    <>
      <ListPage<WebPolicyCard, WebPolicyCard[]>
        shell={{
          kind: 'policies', sub: tr('The house rules and booking terms shown as cards on the website, in the order guests see them.'), addLabel: tr('Add rule card'), noun: tr('card'), nouns: tr('cards'),
          empty: { icon: 'journal-check', title: tr('No rule cards yet'), text: tr('Add cards such as Check-in and check-out, Cancellation and Guest rules.') }, deleteBody: tr('This card and its icon are removed from the website.'),
        }}
        state={state} pick={(d) => d} reload={reload} onAdd={() => setForm({ item: null })} onEdit={(p) => setForm({ item: p })} navigate={navigate}
        restore={(p) => (p.hasIcon ? null : () => webApi.savePolicy(null, { title: p.title, lines: p.lines }))}
        card={(p) => ({
          icon: p.hasIcon ? <IconTile url={p.iconUrl} glyph="journal-check" /> : <Bi name="journal-check" />,
          sub: p.lines.length === 1 ? tr('1 rule') : trf('{0} rules', [p.lines.length]),
          body: p.lines.length ? (
            <>
              <ul className="wa-lines">{p.lines.slice(0, 4).map((l, i) => <li key={i}>{limit(l)}</li>)}</ul>
              {p.lines.length > 4 ? <p className="wl-none">{trf('and {0} more', [p.lines.length - 4])}</p> : null}
            </>
          ) : <p className="wl-none is-warn">{tr('No rules yet: guests see an empty card.')}</p>,
        })}
      />
      {form ? <PolicyModal key={form.item?.id ?? 'new'} item={form.item} taken={list.map((p) => p.title)} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} /> : null}
    </>
  );
}

function PolicyModal({ item, taken, onClose, onSaved }: { item: WebPolicyCard | null; taken: string[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [lines, setLines] = useState((item?.lines ?? []).join('\n'));
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [removeIcon, setRemoveIcon] = useState(false);
  const { busy, errors, setErrors, save } = useSave();
  async function submit() {
    if (!title.trim()) return setErrors({ title: websiteCopy.lists.titleMissing });
    const icon = iconFile ? await readPicked(iconFile, 'icon') : null;
    if (icon && !icon.ok) return setErrors({ icon: icon.error });
    save(() => webApi.savePolicy(item?.id ?? null, { title, lines: lines.split('\n'), ...(icon ? { icon: icon.file } : {}), removeIcon }), onSaved);
  }
  return (
    <FormModal wide eyebrow={tr('House rules')} title={item ? trf('Edit {0}', [item.title]) : tr('Add rule card')} saveLabel={item ? tr('Save changes') : tr('Add rule card')} busy={busy} onClose={onClose} onSubmit={() => void submit()}>
      <FormSection icon="journal-check" title={tr('The card')} hint={tr('A title and the rules under it, one per line.')}>
        {!item ? <Presets names={POLICY_NAMES} taken={taken} value={title} onPick={setTitle} /> : null}
        <Linked className="mb-3"><label className="form-label">{tr('Card title')}<RequiredMark /></label><input className="form-control" maxLength={60} required placeholder={tr('e.g. Check-in and check-out')} value={title} onChange={(e) => setTitle(e.target.value)} />{fe(errors, 'title')}</Linked>
        <Linked className="mb-3"><label className="form-label">{tr('Rules')} <span className="wz-optional">{tr('one per line')}</span></label><Textarea className="form-control" rows={7} placeholder={'Check-in is from 12:00 PM\nGovernment ID is required for every guest'} value={lines} onChange={(e) => setLines(e.target.value)} /></Linked>
        <IconPicker has={Boolean(item?.hasIcon)} iconUrl={item?.iconUrl} glyph="journal-check" removed={removeIcon} onRemoved={setRemoveIcon} onPicked={setIconFile} error={errors.icon} />
      </FormSection>
    </FormModal>
  );
}

/* ------------------------------------------------------------------ nearby places */

const PLACE_NAMES = ['Airport', 'Railway station', 'Bus stand', 'City centre', 'Hospital'];
const LOCATION: Record<WebNearbyPlace['location'], [string, string]> = {
  exact: ['check-circle', 'Exact place found on the map'],
  link: ['link-45deg', 'Uses the map link'],
  name: ['search', 'Found by its name on the map'],
};

export function WebsiteNearby({ navigate }: ScreenProps) {
  const { state, reload } = useAsync(() => webApi.listNearby(), []);
  const [form, setForm] = useState<{ item: WebNearbyPlace | null } | null>(null);
  const list = state.status === 'ready' ? state.data.places : [];
  return (
    <>
      <ListPage
        shell={{
          kind: 'nearby', sub: tr("The places shown above the website's map, such as the airport and the railway station. Each links to directions from there to the hotel."), addLabel: tr('Add place'), noun: tr('place'), nouns: tr('places'),
          empty: { icon: 'geo-alt', title: tr('No places yet'), text: tr('Add the airport, the railway station, the bus stand: whatever guests ask about.') }, deleteBody: tr('This place is removed from the website.'),
        }}
        state={state} pick={(d) => d.places} reload={reload} onAdd={() => setForm({ item: null })} onEdit={(p) => setForm({ item: p })} navigate={navigate}
        restore={(p) => () => webApi.saveNearby(null, { title: p.title, distanceLabel: p.distanceLabel, mapUrl: p.mapUrl, mapQuery: p.mapQuery })}
        notice={(d) => (!d.hotelPinned ? (
          <div className="wl-notice" role="note">
            <Bi name="geo" />
            <span><b>{tr("The hotel's own place on the map is not set")}</b><small>{tr('Until it is, distances cannot be worked out for you; type them by hand.')}</small></span>
            <Button size="sm" variant="outline" onClick={() => navigate('hotel.web.settings')}>{tr('Set it in Settings')}</Button>
          </div>
        ) : null)}
        card={(p) => {
          const [icon, text] = LOCATION[p.location];
          return {
            icon: <Bi name="geo-alt" />,
            sub: p.distanceLabel || tr('No distance yet'),
            body: <p className={`wl-loc is-${p.location}`}><Bi name={icon} /> {tr(text)}</p>,
          };
        }}
      />
      {form ? <PlaceModal key={form.item?.id ?? 'new'} item={form.item} taken={list.map((p) => p.title)} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} /> : null}
    </>
  );
}

function PlaceModal({ item, taken, onClose, onSaved }: { item: WebNearbyPlace | null; taken: string[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<WebNearbyInput>({ title: item?.title ?? '', distanceLabel: item?.distanceLabel ?? '', mapUrl: item?.mapUrl ?? '', mapQuery: item?.mapQuery ?? '' });
  const { busy, errors, setErrors, save } = useSave();
  const set = (k: keyof WebNearbyInput) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  function submit() {
    if (!v.title.trim()) return setErrors({ title: websiteCopy.lists.titleMissing });
    save(() => webApi.saveNearby(item?.id ?? null, v), onSaved);
  }
  return (
    <FormModal eyebrow={tr('Nearby places')} title={item ? trf('Edit {0}', [item.title]) : tr('Add place')} saveLabel={item ? tr('Save changes') : tr('Add place')} busy={busy} onClose={onClose} onSubmit={submit}>
      <FormSection icon="geo-alt" title={tr('The place')} hint={tr('A name is enough; a map link makes the directions exact.')}>
        {!item ? <Presets names={PLACE_NAMES} taken={taken} value={v.title} onPick={(title) => setV((p) => ({ ...p, title }))} /> : null}
        <Linked className="mb-3"><label className="form-label">{tr('Place name')}<RequiredMark /></label><input className="form-control" maxLength={80} required placeholder={tr('e.g. Rajkot Railway Station')} value={v.title} onChange={set('title')} />{fe(errors, 'title')}</Linked>
        <Linked className="mb-3"><label className="form-label">{tr('Google Maps link')} <span className="wz-optional">{tr('recommended')}</span></label><input type="url" inputMode="url" className="form-control" maxLength={500} placeholder={tr('https://maps.app.goo.gl/...')} value={v.mapUrl} onChange={set('mapUrl')} />
          {fe(errors, 'mapUrl')}
          <FieldHint>{tr('Open the place on Google Maps, press Share and paste the link here.')}</FieldHint></Linked>
        <Linked className="mb-3"><label className="form-label">{tr('Distance')} <span className="wz-optional">{tr('optional')}</span></label><input className="form-control" maxLength={40} placeholder={tr('e.g. 4.5 km')} value={v.distanceLabel} onChange={set('distanceLabel')} />
          <FieldHint>{tr('Leave it empty and the driving distance is worked out from the link.')}</FieldHint></Linked>
        {!v.mapUrl.trim() ? (
          <Linked><label className="form-label">{tr('Words to find it on the map')} <span className="wz-optional">{tr('optional')}</span></label><input className="form-control" maxLength={255} placeholder={tr('e.g. Rajkot Junction railway station')} value={v.mapQuery} onChange={set('mapQuery')} /></Linked>
        ) : null}
      </FormSection>
    </FormModal>
  );
}
