'use client';

// A vault's list (platform 0168, 0190): the hotel's Vault tab and the Super Admin's My vault share it. The list never carries a secret; Show opens one item's secret and notes on the
// server (recorded), they hide again after 30 seconds, Copy puts the secret on the clipboard and clears it after 30 seconds.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashResult } from '@shared/dashboards/common';
import { formatDate } from '@shared/dashboards/format';
import { VAULT_KINDS, vaultCopy, vaultExpiry, type VaultSecret } from '@shared/dashboards/vault';
import { errorText, useAction, useToast } from '@/components/ui';
import { Alert, Bi, Button, CellStack, Dialog, EmptyState, Field, FieldHint, IconButton, ListSearch, Modal, PageSkeleton, Select, Table, Textarea } from '@/dashboards/pallav/ui';
import { useLoaded } from '../payrollCore/load';
import { When } from './superParts';
import { vaultApi } from './vaultApi';
import { needsRecheck } from './recheckApi';
import { RecheckModal } from './RecheckModal';

import { tr } from '@/lib/i18n/language';
const CLEAR_AFTER_MS = 30_000;
const today = () => new Date().toISOString().slice(0, 10);
const without = <T,>(o: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

interface Item<K extends string> {
  id: string;
  kind: K;
  title: string;
  username: string | null;
  url: string | null;
  hasSecret: boolean;
  hasNotes: boolean;
  expiresOn: string | null;
  updatedAt: string;
  updatedBy: string | null;
}
interface Input<K extends string> {
  kind: K;
  title: string;
  username?: string | null;
  url?: string | null;
  secret?: string;
  notes?: string;
  expiresOn?: string | null;
}

export interface VaultPanelApi<K extends string> {
  list(): Promise<DashResult<Item<K>[]>>;
  add(input: Input<K>): Promise<DashResult<Item<K>>>;
  change(id: string, input: Input<K>): Promise<DashResult<Item<K>>>;
  remove(id: string): Promise<DashResult<{ id: string }>>;
  reveal(id: string): Promise<DashResult<VaultSecret>>;
}

export interface VaultPanelCopy<K extends string> {
  title: string;
  intro: string;
  add: string;
  empty: { title: string; body: string };
  search: string;
  kinds: Record<K, string>;
  kindIcons: Record<K, string>;
  secretLabel: Record<K, string>;
  fields: { kind: string; title: string; username: string; url: string; secret: string; notes: string; expiresOn: string };
  hints: { title: string; secretKeep: string; notes: string };
  urlPlaceholder: string;
  show: string;
  hide: string;
  copy: string;
  copied: string;
  edit: string;
  remove: string;
  removeAsk: (title: string) => string;
  removeBody: string;
  saved: (title: string) => string;
  removed: (title: string) => string;
  expired: string;
  expiresSoon: string;
  nothingLocked: string;
}

/** The hotel's Vault tab. */
export function HotelVault({ hotelId, onChanged }: { hotelId: string; onChanged: () => void }) {
  const api = useMemo(
    () => ({
      list: () => vaultApi.list(hotelId),
      add: (i: Parameters<typeof vaultApi.add>[1]) => vaultApi.add(hotelId, i),
      change: (id: string, i: Parameters<typeof vaultApi.add>[1]) => vaultApi.change(hotelId, id, i),
      remove: (id: string) => vaultApi.remove(hotelId, id),
      reveal: (id: string) => vaultApi.reveal(hotelId, id),
    }),
    [hotelId],
  );
  return <VaultPanel api={api} copy={vaultCopy} kinds={VAULT_KINDS} expiryKinds={['licence', 'card']} scope={hotelId} onChanged={onChanged} />;
}

export function VaultPanel<K extends string>({ api, copy: V, kinds, expiryKinds, scope, onChanged }: { api: VaultPanelApi<K>; copy: VaultPanelCopy<K>; kinds: readonly K[]; expiryKinds: readonly K[]; scope: string; onChanged?: () => void }) {
  const toast = useToast();
  const loaded = useLoaded(() => api.list(), [api], scope);
  const items = loaded.data;
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Item<K> | 'new' | null>(null);
  const [removing, setRemoving] = useState<Item<K> | null>(null);
  const [shown, setShown] = useState<Record<string, VaultSecret>>({});
  const [opening, setOpening] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState<Item<K> | null>(null);
  const { busy, run } = useAction();
  const hideTimers = useRef<Record<string, number>>({});

  const visible = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (items ?? []).filter((i) => words.every((w) => [i.title, i.username ?? '', i.url ?? '', V.kinds[i.kind]].join(' ').toLowerCase().includes(w)));
  }, [items, search, V]);

  const hide = (id: string) => {
    window.clearTimeout(hideTimers.current[id]);
    delete hideTimers.current[id];
    setShown((s) => without(s, id));
  };

  async function show(item: Item<K>) {
    if (shown[item.id]) return hide(item.id);
    setOpening(item.id);
    const res = await api.reveal(item.id);
    setOpening(null);
    if (needsRecheck(res)) {
      setRechecking(item);
      return;
    }
    if (!res.ok) {
      toast.show({ tone: 'error', text: errorText(res.error) });
      return;
    }
    setShown((s) => ({ ...s, [item.id]: res.data }));
    hideTimers.current[item.id] = window.setTimeout(() => hide(item.id), CLEAR_AFTER_MS);
    onChanged?.();
  }

  // a copied secret is cleared from the clipboard after 30 seconds, when the clipboard still holds it
  const clearTimer = useRef<number | null>(null);
  useEffect(() => {
    const timers = hideTimers.current;
    return () => {
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      Object.values(timers).forEach((t) => window.clearTimeout(t));
    };
  }, []);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ tone: 'success', text: V.copied });
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => {
        void navigator.clipboard.readText().then((now) => (now === text ? navigator.clipboard.writeText('') : undefined)).catch(() => undefined);
      }, CLEAR_AFTER_MS);
    } catch {
      toast.show({ tone: 'error', text: 'The browser did not allow copying. Select the text and copy it.' });
    }
  }

  if (items === null) {
    if (loaded.error) {
      return (
        <Alert tone="danger" className="reveal">
          {errorText(loaded.error)}{' '}
          <Button variant="outline" size="sm" icon="arrow-clockwise" onClick={loaded.reload}>
            {tr("Try again")}
          </Button>
        </Alert>
      );
    }
    return <PageSkeleton />;
  }

  return (
    <div className="card reveal">
      <div className="d-flex flex-wrap align-items-center gap-2 p-3 border-bottom">
        <div className="me-auto" style={{ minWidth: 0, maxWidth: '60ch' }}>
          <div className="fw-semibold d-flex align-items-center gap-2">
            <Bi name="shield-lock" /> {V.title}
          </div>
          <div className="small text-muted">{V.intro}</div>
        </div>
        {items.length ? <ListSearch value={search} onChange={setSearch} onClear={() => setSearch('')} placeholder={V.search} label={V.search} wrapClass="" /> : null}
        <Button icon="plus-lg" onClick={() => setEditing('new')}>
          {V.add}
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="shield-lock" title={V.empty.title} text={V.empty.body} />
      ) : (
        <div className="table-responsive">
          <Table className="table table-hover mb-0 align-middle">
            <thead>
              <tr>
                <th>{V.fields.title}</th>
                <th>{V.fields.username}</th>
                <th>{V.fields.secret}</th>
                <th>{tr("Last change")}</th>
                <th className="text-end">{tr("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => {
                const open = shown[i.id];
                const exp = vaultExpiry(i.expiresOn, today());
                return (
                  <tr key={i.id}>
                    <td style={{ minWidth: 200 }}>
                      <CellStack main={<span className="d-inline-flex align-items-center gap-2"><Bi name={V.kindIcons[i.kind]} /> {i.title}</span>}>
                        <span className="cell-sub">
                          {V.kinds[i.kind]}
                          {i.url ? <> · <a href={/^https?:\/\//i.test(i.url) ? i.url : `https://${i.url}`} target="_blank" rel="noreferrer noopener">{i.url.replace(/^https?:\/\//i, '')}</a></> : null}
                        </span>
                        {i.expiresOn ? (
                          <span className={`cell-sub ${exp === 'expired' ? 'text-danger' : exp === 'soon' ? 'text-warning' : ''}`}>
                            {V.fields.expiresOn} {formatDate(i.expiresOn)}{exp === 'expired' ? ` · ${V.expired}` : exp === 'soon' ? ` · ${V.expiresSoon}` : ''}
                          </span>
                        ) : null}
                      </CellStack>
                    </td>
                    <td>
                      {i.username ? (
                        <span className="d-inline-flex align-items-center gap-1">
                          <span className="text-break">{i.username}</span>
                          <IconButton icon="copy" label={`${V.copy} ${V.fields.username}`} onClick={() => void copy(i.username ?? '')} />
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td style={{ minWidth: 220 }}>
                      {!i.hasSecret && !i.hasNotes ? (
                        <span className="text-muted small">{V.nothingLocked}</span>
                      ) : open ? (
                        <div className="d-grid gap-1">
                          {open.secret ? (
                            <span className="d-inline-flex align-items-center gap-1">
                              <code className="text-break">{open.secret}</code>
                              <IconButton icon="copy" label={`${V.copy} ${V.secretLabel[i.kind]}`} onClick={() => void copy(open.secret ?? '')} />
                            </span>
                          ) : null}
                          {open.notes ? <span className="small text-muted" style={{ whiteSpace: 'pre-wrap' }}>{open.notes}</span> : null}
                        </div>
                      ) : (
                        <span className="text-muted" aria-label={tr("Locked")}>
                          <Bi name="lock" /> ••••••••{i.hasNotes ? <span className="small"> {tr("· notes")}</span> : null}
                        </span>
                      )}
                    </td>
                    <td className="small">
                      <When iso={i.updatedAt} />
                      {i.updatedBy ? <span className="cell-sub">{i.updatedBy}</span> : null}
                    </td>
                    <td className="text-end text-nowrap">
                      {i.hasSecret || i.hasNotes ? (
                        <Button variant="outline" size="sm" icon={open ? 'eye-slash' : 'eye'} busy={opening === i.id} onClick={() => void show(i)}>
                          {open ? V.hide : V.show}
                        </Button>
                      ) : null}{' '}
                      <IconButton icon="pencil" label={`${V.edit} ${i.title}`} onClick={() => setEditing(i)} />{' '}
                      <IconButton icon="trash" tone="danger" label={`${V.remove} ${i.title}`} onClick={() => setRemoving(i)} />
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-muted py-4">
                    {tr("Nothing matches “")}{search}”.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </Table>
        </div>
      )}

      {editing ? (
        <VaultForm
          api={api}
          copy={V}
          kinds={kinds}
          expiryKinds={expiryKinds}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            hide(saved.id);
            loaded.reload();
            onChanged?.();
          }}
        />
      ) : null}

      {rechecking ? (
        <RecheckModal
          onClose={() => setRechecking(null)}
          onDone={() => {
            const item = rechecking;
            setRechecking(null);
            void show(item);
          }}
        />
      ) : null}

      <Dialog
        open={removing !== null}
        title={removing ? V.removeAsk(removing.title) : ''}
        message={V.removeBody}
        confirmLabel={V.remove}
        tone="danger"
        icon="trash"
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const r = removing;
          if (!r) return;
          void run(() => api.remove(r.id), {
            success: V.removed(r.title),
            onOk: () => {
              setRemoving(null);
              loaded.reload();
              onChanged?.();
            },
          });
        }}
      />
    </div>
  );
}

function VaultForm<K extends string>({ api, copy: V, kinds, expiryKinds, item, onClose, onSaved }: { api: VaultPanelApi<K>; copy: VaultPanelCopy<K>; kinds: readonly K[]; expiryKinds: readonly K[]; item: Item<K> | null; onClose: () => void; onSaved: (item: Item<K>) => void }) {
  const [v, setV] = useState<{ kind: K; title: string; username: string; url: string; secret: string; notes: string; expiresOn: string }>({
    kind: item?.kind ?? kinds[0], title: item?.title ?? '', username: item?.username ?? '', url: item?.url ?? '', secret: '', notes: '', expiresOn: item?.expiresOn ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState(false);
  const { busy, run } = useAction();
  const set = (k: keyof typeof v, x: string) => {
    setV((p) => ({ ...p, [k]: x }));
    if (errors[k]) setErrors((p) => ({ ...p, [k]: '' }));
  };
  const box = (k: 'title' | 'username' | 'url', max: number, extra: { inputMode?: 'url' | 'text'; placeholder?: string } = {}) => (
    <input className={`form-control${errors[k] ? ' is-invalid' : ''}`} maxLength={max} autoComplete="off" inputMode={extra.inputMode} placeholder={extra.placeholder} value={v[k]} onChange={(e) => set(k, e.target.value)} />
  );

  function submit() {
    // on a change, an empty secret or notes box keeps what is stored
    const input: Input<K> = {
      kind: v.kind, title: v.title, username: v.username || null, url: v.url || null, expiresOn: v.expiresOn || null,
      ...(item && v.secret === '' ? {} : { secret: v.secret }),
      ...(item && v.notes === '' ? {} : { notes: v.notes }),
    };
    void run(() => (item ? api.change(item.id, input) : api.add(input)), { success: (r) => V.saved(r.title), onFields: setErrors, onOk: onSaved });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={item ? `${V.edit}: ${item.title}` : V.add}
      staticBackdrop
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button type="submit" icon="lock" busy={busy}>
            {item ? tr("Save changes") : tr("Save in vault")}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy}>
        <div className="row g-3">
          <Field label={V.fields.kind} col="col-sm-5" error={errors.kind}>
            <Select value={v.kind} onChange={(e) => set('kind', e.target.value)}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {V.kinds[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={V.fields.title} col="col-sm-7" required error={errors.title}>
            {box('title', 120)}
            <FieldHint>{V.hints.title}</FieldHint>
          </Field>
          <Field label={V.fields.username} col="col-sm-6" optional error={errors.username}>
            {box('username', 200)}
          </Field>
          <Field label={V.fields.url} col="col-sm-6" optional error={errors.url}>
            {box('url', 500, { inputMode: 'url', placeholder: V.urlPlaceholder })}
          </Field>
          <Field label={V.secretLabel[v.kind]} optional error={errors.secret}>
            <div className="d-flex gap-2">
              <input
                className={`form-control${errors.secret ? ' is-invalid' : ''}`}
                type={showSecret ? 'text' : 'password'}
                autoComplete="new-password"
                maxLength={2000}
                placeholder={item?.hasSecret ? '••••••••' : ''}
                value={v.secret}
                onChange={(e) => set('secret', e.target.value)}
              />
              <IconButton icon={showSecret ? 'eye-slash' : 'eye'} label={showSecret ? V.hide : V.show} onClick={() => setShowSecret((s) => !s)} />
            </div>
            {item?.hasSecret ? <FieldHint>{V.hints.secretKeep}</FieldHint> : null}
          </Field>
          <Field label={V.fields.notes} optional error={errors.notes}>
            <Textarea rows={3} maxLength={5000} placeholder={item?.hasNotes ? '•••••••• (leave empty to keep)' : ''} value={v.notes} onChange={(e) => set('notes', e.target.value)} />
            <FieldHint>{V.hints.notes}</FieldHint>
          </Field>
          {expiryKinds.includes(v.kind) || v.expiresOn ? (
            <Field label={V.fields.expiresOn} col="col-sm-6" optional error={errors.expiresOn}>
              <input type="date" className={`form-control${errors.expiresOn ? ' is-invalid' : ''}`} value={v.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} />
            </Field>
          ) : null}
        </div>
      </fieldset>
    </Modal>
  );
}
