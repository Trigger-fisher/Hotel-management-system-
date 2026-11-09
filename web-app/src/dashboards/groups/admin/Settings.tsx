'use client';

// hotel.admin.settings: the hotel's business settings. The hotel's top role sees Hotel details, Bill header, Restaurant hours, WhatsApp, Automatic messages and
// Deleted items (keep days); a Hotel Admin below it sees the restaurant and guest-message sections. Payment keys, backups and mail are set up by the platform
// team in the Set-up centre (MJ, 5 Nov 2026): old links to those tabs open Hotel details. Restoring or removing deleted records for good is the Super Admin's
// alone (a full visit), so the list shows only to that account.
import { useState } from 'react';
import { adminCopy, type RecycleItem, type SettingField, type SettingGroup, type SettingsOverview } from '@shared/dashboards/admin';
import { formatDateTime } from '@shared/dashboards/format';
import { errorText, useAsync, useSubmit, useToast } from '@/components/ui';
import { Bi, Button, Dialog, LoadError, ListSearch, Select, Skeleton, Textarea } from '@/dashboards/pallav/ui';
import { messagesSettingsCopy, whatsappCopy } from '@shared/dashboards/whatsapp';
import { MessagesSettings } from './MessagesSettings';
import { WhatsAppSettings } from './WhatsAppSettings';
import type { ScreenProps } from '../../types';
import { adminApi, useAdminActor } from './api';
import { RestaurantHoursCard } from './RestaurantHours';
import { PayrollBins } from './PayrollBins';
import { HotelSetupCard } from './HotelSetup';

import { tr, trf } from '@/lib/i18n/language';
const t = adminCopy.settings;

/** The server's setting groups a hotel still keeps (business content only). */
const HOTEL_GROUPS = ['general', 'billing', 'recycle'] as const;
type ServerTab = (typeof HOTEL_GROUPS)[number];
type OwnTab = 'hours' | 'whatsapp' | 'messages';
type Tab = ServerTab | OwnTab;

const NAMES: Record<Tab, { icon: string; name: string; note: string }> = {
  general: { icon: 'building', name: 'Hotel details', note: 'Name, address, phone, check-in times' },
  billing: { icon: 'receipt', name: 'Bill header', note: 'GSTIN and what is printed on bills' },
  recycle: { icon: 'trash3', name: 'Deleted items', note: 'How long deleted records are kept' },
  hours: { icon: 'cup-hot', name: 'Restaurant hours', note: 'When room service takes orders' },
  whatsapp: { icon: 'whatsapp', name: whatsappCopy.name, note: 'Your number and message templates' },
  messages: { icon: 'chat-left-text', name: messagesSettingsCopy.title, note: 'Sent by themselves at check-in, check-out ...' },
};

const isServerTab = (x: string | undefined): x is ServerTab => (HOTEL_GROUPS as readonly string[]).includes(x ?? '');
const isOwnTab = (x: string | undefined): x is OwnTab => x === 'hours' || x === 'whatsapp' || x === 'messages';

export function Settings({ user, params, navigate }: ScreenProps) {
  const top = useAdminActor(user);
  const asked = params?.tab;
  const [tab, setTab] = useState<Tab>(isOwnTab(asked) || (top && isServerTab(asked)) ? asked : top ? 'general' : 'hours');
  const groups: { label: string; items: Tab[] }[] = [
    ...(top ? [{ label: tr('Your hotel'), items: ['general', 'billing'] as Tab[] }] : []),
    { label: tr('Restaurant'), items: ['hours'] },
    { label: tr('Guest messages'), items: ['whatsapp', 'messages'] },
    ...(top ? [{ label: tr('Records'), items: ['recycle'] as Tab[] }] : []),
  ];
  const go = (view: string, p?: Record<string, string>) => {
    const asTab = p?.tab;
    if (view === 'hotel.admin.settings' && (isOwnTab(asTab) || isServerTab(asTab))) setTab(asTab);
    else navigate(view, p);
  };
  return (
    <>
      {top ? <HotelSetupCard navigate={go} /> : null}
      <div className="ha-set reveal">
        <nav className="ha-set-nav" aria-label={tr('Settings sections')}>
          {groups.map((g) => (
            <div key={g.label} className="ha-set-group">
              <span className="ha-set-label">{g.label}</span>
              {g.items.map((id) => (
                <a key={id} href="#" className={`ha-set-item${tab === id ? ' active' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setTab(id); }}>
                  <Bi name={NAMES[id].icon} />
                  <span><b>{tr(NAMES[id].name)}</b><small>{tr(NAMES[id].note)}</small></span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="ha-set-body">
          {tab === 'whatsapp' ? (
            <WhatsAppSettings onOpenMessages={() => setTab('messages')} />
          ) : tab === 'messages' ? (
            <MessagesSettings user={user} />
          ) : tab === 'hours' ? (
            <RestaurantHoursCard />
          ) : (
            <ServerGroup tab={tab} fullPower={user.role === 'super_admin'} navigate={navigate} />
          )}
        </div>
      </div>
    </>
  );
}

function ServerGroup({ tab, fullPower, navigate }: { tab: ServerTab; fullPower: boolean; navigate: ScreenProps['navigate'] }) {
  const [version, setVersion] = useState(0);
  const { state, reload } = useAsync(() => adminApi.getSettings(tab), [tab, version]);
  if (state.status === 'loading') return <div className="st-card"><Skeleton rows={4} /></div>;
  if (state.status === 'error') return <LoadError error={state.error} onRetry={reload} />;
  const data: SettingsOverview = state.data;
  const group = data.current;
  return (
    <>
      <GroupForm key={`${group.key}-${version}`} group={group} name={tr(NAMES[tab].name)} onSaved={() => setVersion((v) => v + 1)} />
      {tab === 'recycle' && fullPower ? (
        <div className="st-extra">
          <RecycleExtra days={Number(group.fields.find((f) => f.key === 'recycle.days')?.value ?? 30)} />
          <PayrollBins navigate={navigate} />
        </div>
      ) : null}
    </>
  );
}

const initialOf = (f: SettingField): string | boolean => (f.type === 'toggle' ? f.value === '1' : (f.value ?? ''));
const idOf = (key: string): string => key.replace(/\./g, '_');

function GroupForm({ group, name, onSaved }: { group: SettingGroup; name: string; onSaved: () => void }) {
  const toast = useToast();
  const fields = group.fields.filter((f) => f.type !== 'password');
  const [loaded] = useState<Record<string, string | boolean>>(() => Object.fromEntries(fields.map((f) => [f.key, initialOf(f)])));
  const [values, setValues] = useState<Record<string, string | boolean>>(loaded);
  const { busy, errors, submit } = useSubmit(fields.map((f) => f.key));
  const set = (key: string, v: string | boolean) => setValues((p) => ({ ...p, [key]: v }));
  const dirty = Object.keys(values).some((k) => values[k] !== loaded[k]);
  if (fields.length === 0) {
    return (
      <div className="st-card">
        <div className="st-head">
          <div className="st-icon"><Bi name={group.icon.replace(/^bi-/, '')} /></div>
          <div><h2 className="st-title">{name}</h2></div>
        </div>
        <p className="text-muted mb-3">{tr('These settings could not be read.')}</p>
        <Button variant="outline" icon="arrow-clockwise" onClick={onSaved}>{tr('Try again')}</Button>
      </div>
    );
  }
  return (
    <form className="st-card" autoComplete="off" noValidate onSubmit={(e) => { e.preventDefault(); void submit(() => adminApi.saveSettings(group.key, values), (d) => { toast.show({ tone: 'success', text: d.message }); onSaved(); }); }}>
      <div className="st-head">
        <div className="st-icon"><Bi name={group.icon.replace(/^bi-/, '')} /></div>
        <div>
          <h2 className="st-title">{name}</h2>
          <p className="st-about">{group.about}</p>
        </div>
      </div>
      <div className="st-grid">
        {fields.map((f) => {
          const id = idOf(f.key);
          const wide = f.type === 'textarea' || f.type === 'toggle';
          const v = values[f.key];
          return (
            <div key={f.key} className={`st-field ${wide ? 'wide' : ''}`}>
              {f.type === 'toggle' ? (
                <label className="st-toggle" htmlFor={id}>
                  <input type="checkbox" id={id} name={id} checked={v === true} onChange={(e) => set(f.key, e.target.checked)} />
                  <span className="st-switch" aria-hidden="true" />
                  <span className="st-toggle-text"><strong>{f.label}</strong>{f.help ? <small>{f.help}</small> : null}</span>
                </label>
              ) : (
                <>
                  <label className="form-label" htmlFor={id}>{f.label}</label>
                  {f.type === 'select' ? (
                    <Select id={id} name={id} value={String(v)} onChange={(e) => set(f.key, e.target.value)}>
                      {Object.entries(f.options ?? {}).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                  ) : f.type === 'textarea' ? (
                    <Textarea id={id} name={id} className="st-fit" rows={Math.max(f.rows ?? 2, String(v).split('\n').length)} maxLength={f.maxLength ?? undefined} value={String(v)} onChange={(e) => set(f.key, e.target.value)} />
                  ) : f.type === 'number' && f.suffix ? (
                    <div className="input-group">
                      <input type="number" id={id} name={id} className="form-control" inputMode="decimal" min={f.min ?? undefined} max={f.max ?? undefined} step={f.step ?? undefined} placeholder={f.placeholder ?? ''} value={String(v)} onChange={(e) => set(f.key, e.target.value)} />
                      <span className="input-group-text">{f.suffix}</span>
                    </div>
                  ) : (
                    <input type={f.type} id={id} name={id} className="form-control" min={f.min ?? undefined} max={f.max ?? undefined} step={f.step ?? undefined} maxLength={f.maxLength ?? undefined} placeholder={f.placeholder ?? ''} value={String(v)} onChange={(e) => set(f.key, e.target.value)} />
                  )}
                  {f.help ? <div className="form-text">{f.help}</div> : null}
                </>
              )}
              {errors[f.key] ? <div className="field-error">{errors[f.key]}</div> : null}
            </div>
          );
        })}
      </div>
      <div className="st-foot ha-sticky-foot">
        <span className="text-muted small me-auto">{dirty ? tr('Not saved yet.') : t.foot}</span>
        <Button type="submit" icon="check2" disabled={busy || !dirty}>{trf('Save {0}', [name.toLowerCase()])}</Button>
      </div>
    </form>
  );
}

/** Everything deleted within the keep period: restore or remove for good. Shown to the Super Admin only (full visit). */
function RecycleExtra({ days }: { days: number }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const { state } = useAsync(() => adminApi.listRecycle({ page: 1, pageSize: 100 }), [version], { keep: true });
  const [purge, setPurge] = useState<RecycleItem | null>(null);
  const [typed, setTyped] = useState('');
  const r = t.recycle;
  if (state.status !== 'ready') return null;
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const all = state.data.items;
  const rows = words.length ? all.filter((x) => words.every((w) => `${x.kind} ${x.label} ${x.detail ?? ''} ${x.deletedBy ?? ''}`.toLowerCase().includes(w))) : all;

  async function restore(i: RecycleItem) {
    const res = await adminApi.restoreRecycle(i.key, i.id);
    if (res.ok) { toast.show({ tone: 'success', text: res.data.message }); setVersion((v) => v + 1); } else toast.show({ tone: 'error', text: errorText(res.error) });
  }
  async function forever(i: RecycleItem) {
    setPurge(null);
    const res = await adminApi.purgeRecycle(i.key, i.id);
    if (res.ok) { toast.show({ tone: 'success', text: res.data.message }); setVersion((v) => v + 1); } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  return (
    <>
      <div className="ha-bin-head">
        <p className="text-muted small m-0">{r.keep(days)}</p>
        {all.length > 0 ? <ListSearch value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={tr('Search deleted items')} /> : null}
      </div>
      <div className="ha-bin">
        {rows.length === 0 ? (
          <div className="ha-bin-empty"><Bi name="recycle" /><p>{all.length > 0 ? tr('Nothing deleted matches that search.') : r.empty}</p></div>
        ) : rows.map((row) => (
          <div key={`${row.key}-${row.id}`} className="ha-bin-row">
            <span className="ha-bin-kind">{row.kind}</span>
            <b className="ha-bin-title">{row.label}</b>
            <span className="ha-bin-meta">{r.deleted} {formatDateTime(row.deletedAt)}{row.deletedBy ? ` ${r.by} ${row.deletedBy}` : ''}</span>
            <span className={`ha-bin-meta${row.daysLeft <= 3 ? ' is-low' : ''}`}>{r.left(row.daysLeft)}</span>
            <span className="ha-bin-actions">
              <Button size="sm" icon="arrow-counterclockwise" onClick={() => void restore(row)}>{r.restore}</Button>
              <Button size="sm" variant="ghost" title={r.deleteForever} aria-label={r.deleteForever} onClick={() => setPurge(row)}><Bi name="x-lg" /></Button>
            </span>
          </div>
        ))}
      </div>
      <Dialog open={purge !== null} tone="danger" title={r.confirmTitle} message={r.confirmBody} confirmLabel={r.confirmLabel} onCancel={() => setPurge(null)} onConfirm={() => { if (purge) void forever(purge); }} />
    </>
  );
}
