'use client';

// hotel.admin.masters - Master Data (Pallav: masters/index.blade.php; the catalogue is MastersCatalog.tsx, the plan rates MastersPlanRates.tsx).
// The lists are picked from Pallav's side panel (usePanel2: the first side panel under Administration, which has none of its own).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePanel2 } from '@/dashboards/pallav';
import { adminCopy, masterScopeLabel, masterScopes, type MasterList, type MasterRailEntry, type MasterRow, type MasterScope } from '@shared/dashboards/admin';
import { isPayrollAdmin } from '@shared/dashboards/payrollPay';
import { roomMenuCopy } from '@shared/dashboards/roomMenu';
import { errorText, useAsync, useSubmit, useToast } from '@/components/ui';
import { Bi, Button, Dialog, Dropdown, EmptyState, LoadError, Modal, PageSkeleton, Select, TextAction, MayEdit } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { adminApi } from './api';
import { MastersCatalog } from './MastersCatalog';
import { Sections, iconOf, matchesWords, wordsOf } from './masterParts';
import { MastersMenu } from './MastersMenu';
import { MastersPlanRates } from './MastersPlanRates';

import { tr, trf } from '@/lib/i18n/language';
const t = adminCopy.masters;
const PLAN_RATES = 'plan-rates';
const ROOM_MENU = 'room-menu';
const FIRST_KEY = 'hms-masters-first';
const rememberedFirst = (): string => {
  try {
    return window.localStorage.getItem(FIRST_KEY) ?? 'payment_mode';
  } catch {
    return 'payment_mode';
  }
};

export function Masters({ user, params }: ScreenProps) {
  const toast = useToast();
  // `params.list` opens straight on a list: a rail key, or PLAN_RATES ("Set up your hotel" > Rates and GST).
  const [key, setKey] = useState<string | null>(params?.list || null);
  const [scope, setScope] = useState<MasterScope>('both');
  const [q, setQ] = useState('');
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const panel = usePanel2(useMemo(() => ({ title: 'Lists and rates', icon: 'sliders' }), []));
  const allowed = isPayrollAdmin(user.role);
  const rail = useAsync(() => adminApi.listMasterRail(), [version], { keep: true });
  const entries: MasterRailEntry[] = rail.state.status === 'ready' ? rail.state.data : [];
  const planRates = key === PLAN_RATES;
  const roomMenu = key === ROOM_MENU;
  // The first list is asked for together with the rail (not after it): the rail's first entry is remembered for the next visit, and the usual first list
  // (payment modes) stands in on the first ever visit; if the rail says otherwise the right list follows.
  const firstKey = entries[0]?.key ?? (rail.state.status === 'loading' ? rememberedFirst() : null);
  const current = planRates || roomMenu ? null : (key ?? firstKey);
  const firstLoaded = entries[0]?.key;
  useEffect(() => {
    const first = firstLoaded;
    if (!first) return;
    try {
      window.localStorage.setItem(FIRST_KEY, first);
    } catch {
      // blocked storage: the guess stays the usual first list
    }
  }, [firstLoaded]);
  const list = useAsync(() => (current ? adminApi.getMasterList(current, scope) : Promise.resolve({ ok: true as const, data: null })), [current, scope, version]);
  const data: MasterList | null = list.state.status === 'ready' ? list.state.data : null;

  const refresh = () => setVersion((v) => v + 1);
  const pick = (k: string) => { setKey(k); setQ(''); };

  if (!allowed) return <EmptyState icon="lock" title={adminCopy.common.adminOnly.title} text={adminCopy.common.adminOnly.body} />;

  const catalog = data?.set.isCatalog ?? false;
  const nameOnly = data?.set.isNameOnly ?? false;
  const plainList = !planRates && !roomMenu && data !== null && !catalog;
  const hint = planRates ? t.search.planRates : roomMenu ? roomMenuCopy.search : catalog ? t.search.catalog : nameOnly ? t.search.names : t.search.options;
  const words = wordsOf(q);

  const search = (
    <div className="pay-toolbar" role="search">
      <div className="search-field">
        <Bi name="search" />
        <input type="search" className="form-control" autoComplete="off" value={q} placeholder={hint} aria-label={hint.replace(/…$/, '')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && q) setQ(''); }} />
        {q ? <TextAction kind="clear" title={t.clearSearch} aria-label={t.clearSearch} onClick={() => setQ('')} /> : null}
      </div>
    </div>
  );

  const plain = entries.filter((e) => !e.grouped);
  const perBusiness = entries.filter((e) => e.grouped);
  const isActive = (e: MasterRailEntry): boolean => !planRates && data !== null && (data.placement ? data.placement.groupName === e.name : data.set.key === e.key);
  const railItem = (e: MasterRailEntry): ReactNode => (
    <a key={e.key} href="#" className={`rail-item ${isActive(e) ? 'active' : ''}`} title={e.hint} aria-current={isActive(e) ? 'page' : undefined} onClick={(ev) => { ev.preventDefault(); pick(e.key); }}>
      <Bi name={iconOf(e.icon)} />
      <span>{e.name}</span>
    </a>
  );

  return (
    <>
      <div className="page-head page-tools reveal">
        <div><p className="pms-sub">{tr("The lists the rest of EasyHotelSolutions picks from, such as room types, payment modes and expense heads.")}</p></div>
        <div className="sh-head-actions">
          {search}
          {plainList && data ? (
            <MayEdit module="masters"><Button icon="plus-lg" className="sh-new" onClick={() => setAdding(true)}>
              {trf('Add to {0}', [data.placement?.sectionLabel ?? data.set.name])}
            </Button></MayEdit>
          ) : null}
        </div>
      </div>

      {/* phones: the side rail is not shown, so the lists are chosen here */}
      <div className="app-only-phone master-phone-pick reveal">
        <label className="form-label" htmlFor="master-pick">
          {tr("List")}
        </label>
        <Select id="master-pick" value={planRates ? PLAN_RATES : roomMenu ? ROOM_MENU : (current ?? '')} onChange={(e) => pick(e.target.value)}>
          {plain.length ? (
            <optgroup label={tr("Lists")}>
              {plain.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {perBusiness.length ? (
            <optgroup label={tr("For each business")}>
              {perBusiness.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label={tr("Rates")}>
            <option value={PLAN_RATES}>{t.rail.planRates}</option>
          </optgroup>
          <optgroup label={tr("Guest services")}>
            <option value={ROOM_MENU}>{roomMenuCopy.rail}</option>
          </optgroup>
        </Select>
      </div>
      {data?.scope && !roomMenu ? (
        <div className="ha-ml-scope reveal">
          <label className="form-label m-0" htmlFor="master-scope">{tr('Applies to')}</label>
          <Select id="master-scope" value={data.scope} onChange={(e) => setScope(e.target.value as MasterScope)}>
            {masterScopes.map((s) => <option key={s} value={s}>{masterScopeLabel[s]}</option>)}
          </Select>
          <span className="ha-ml-scope-why">{data.scope === 'both' ? t.scope.both : t.scope.one(masterScopeLabel[data.scope])}</span>
        </div>
      ) : null}
      {panel
        ? createPortal(
            <nav className="subnav-body" aria-label={tr("Master Data lists")}>
              {plain.length ? (
                <div className="rail-group">
                  <div className="rail-label">{tr("Lists")}</div>
                  {plain.map(railItem)}
                </div>
              ) : null}
              {perBusiness.length ? (
                <div className="rail-group">
                  <div className="rail-label">{tr("For each business")}</div>
                  {perBusiness.map(railItem)}
                </div>
              ) : null}
              <div className="rail-group">
                <div className="rail-label">{tr("Rates")}</div>
                <a href="#" className={`rail-item ${planRates ? 'active' : ''}`} title={t.rail.planRatesHint} aria-current={planRates ? 'page' : undefined} onClick={(e) => { e.preventDefault(); pick(PLAN_RATES); }}>
                  <Bi name="cup-hot" />
                  <span>{t.rail.planRates}</span>
                </a>
              </div>
              <div className="rail-group">
                <div className="rail-label">{tr("Guest services")}</div>
                <a href="#" className={`rail-item ${roomMenu ? 'active' : ''}`} title={roomMenuCopy.railHint} aria-current={roomMenu ? 'page' : undefined} onClick={(e) => { e.preventDefault(); pick(ROOM_MENU); }}>
                  <Bi name="bell" />
                  <span>{roomMenuCopy.rail}</span>
                </a>
              </div>
            </nav>,
            panel,
          )
        : null}

      <div className="master-layout master-tabs">
        <section className="master-panel">
          {roomMenu ? (
            <MastersMenu words={words} />
          ) : planRates ? (
            <MastersPlanRates words={words} onGoMasters={() => pick(entries[0]?.key ?? '')} />
          ) : data === null ? (
            <div className="card">
              {list.state.status === 'error' ? (
                <LoadError error={list.state.error} onRetry={list.reload} />
              ) : rail.state.status === 'error' ? (
                <LoadError error={rail.state.error} onRetry={rail.reload} />
              ) : rail.state.status === 'ready' && entries.length === 0 ? (
                <EmptyState icon="sliders" title={tr("No master lists yet")} text="Nothing to set up here for this hotel." />
              ) : (
                <PageSkeleton />
              )}
            </div>
          ) : catalog ? (
            <MastersCatalog list={data} scope={scope} words={words} onPick={pick} />
          ) : (
            <OptionsList
              list={data}
              scope={scope}
              words={words}
              q={q}
              adding={adding}
              onAdd={() => setAdding(true)}
              onCloseAdd={() => setAdding(false)}
              onPick={pick}
              onChanged={refresh}
              onRemoved={() => { toast.show({ tone: 'success', text: adminCopy.common.deleted }); setKey(null); refresh(); }}
            />
          )}
        </section>
      </div>
    </>
  );
}

function OptionsList({ list, scope, words, q, adding, onAdd, onCloseAdd, onPick, onChanged, onRemoved }: {
  list: MasterList; scope: MasterScope; words: string[]; q: string; adding: boolean; onAdd: () => void; onCloseAdd: () => void; onPick: (setKey: string) => void; onChanged: () => void; onRemoved: () => void;
}) {
  const toast = useToast();
  const { set, placement, rows } = list;
  const nameOnly = set.isNameOnly;
  const both = list.scope === 'both';
  const shown = useMemo(() => rows.filter((r) => matchesWords(`${r.label} ${r.value}`, words)), [rows, words]);
  const [editing, setEditing] = useState<MasterRow | null>(null);
  const [removing, setRemoving] = useState<MasterRow | null>(null);
  const [removingList, setRemovingList] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = placement ? placement.sectionLabel : set.name;
  const searching = words.length > 0;

  async function act<T extends { message?: string }>(call: () => Promise<{ ok: true; data: T } | { ok: false; error: Parameters<typeof errorText>[0] }>, after?: () => void) {
    setBusy(true);
    const res = await call();
    setBusy(false);
    if (res.ok) {
      if (res.data.message) toast.show({ tone: 'success', text: res.data.message });
      after?.();
      onChanged();
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  const noMatch = searching && shown.length === 0;
  return (
    <>
      {/* Shown above the list when the search box matches nothing (master-search.js hides the rows, the card stays) */}
      {noMatch ? (
        <div className="card">
          <EmptyState icon="search" title={t.noMatch.title(q.trim())} text={t.noMatch.text} />
        </div>
      ) : null}

      <div className="card reveal ha-ml">
        <div className="ha-ml-head">
          <span className="ha-ml-icon"><Bi name={iconOf(set.icon)} /></span>
          <span className="ha-ml-title">
            <b>{title}</b>
            <small>{(set.description || t.note.fallback).replace(/\.+$/, '')}.</small>
          </span>
          <Sections list={list} onPick={onPick} />
        </div>

        {rows.length === 0 ? (
          <EmptyState icon="list-ul" title={both ? t.empty.bothTitle : t.empty.oneTitle} text={both ? t.empty.both : nameOnly ? t.empty.names : t.empty.options(placement?.groupName ?? set.name)}>
            <MayEdit module="masters"><Button icon="plus-lg" onClick={onAdd}>{trf('Add to {0}', [title])}</Button></MayEdit>
          </EmptyState>
        ) : (
          <section className="ha-ms-sec">
            {!nameOnly ? <p className="ha-ms-why">{tr('Switched off items stay on old records but are not offered on forms. The first item is offered first.')}</p> : null}
            <ul className="ha-items">
              {shown.map((row, at) => (
                <li key={row.id} className={row.isActive || nameOnly ? undefined : 'is-off'}>
                  <span className="ha-item-main">
                    <b>{row.label}</b>
                    {row.isDefault || (list.scope && list.scope !== 'both' && row.shared) ? (
                      <small>
                        {[row.isDefault ? t.pills.isDefault : '', list.scope && list.scope !== 'both' && row.shared ? tr('Shared by both businesses') : ''].filter(Boolean).join(' · ')}
                      </small>
                    ) : null}
                  </span>
                  <MayEdit module="masters">
                    {!nameOnly ? (
                      <label className="form-check form-switch ha-switch">
                        <input className="form-check-input" type="checkbox" role="switch" checked={row.isActive} disabled={busy} onChange={() => void act(() => adminApi.toggleMasterItem(row.id, scope))} aria-label={trf('{0} offered on forms', [row.label])} />
                        <span>{row.isActive ? tr('In use') : tr('Off')}</span>
                      </label>
                    ) : null}
                    <Button size="sm" variant="outline" icon="pencil-square" onClick={() => setEditing(row)}>{tr('Edit')}</Button>
                    <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [row.label])} {...p} />}>
                      {!nameOnly && !searching && at > 0 ? <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); void act(() => adminApi.moveMasterItem(row.id, 'up').then((r) => (r.ok ? { ok: true as const, data: {} } : r))); }}><Bi name="arrow-up" className="me-2" />{tr('Move up')}</a> : null}
                      {!nameOnly && !searching && at < shown.length - 1 ? <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); void act(() => adminApi.moveMasterItem(row.id, 'down').then((r) => (r.ok ? { ok: true as const, data: {} } : r))); }}><Bi name="arrow-down" className="me-2" />{tr('Move down')}</a> : null}
                      <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setRemoving(row); }}><Bi name="trash" className="me-2" />{tr('Remove from the list')}</a>
                    </Dropdown>
                  </MayEdit>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {!set.isSystem ? (
        <div className="master-foot">
          <MayEdit module="masters">
            <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" {...p}>{tr('More for this list')}</Button>}>
              <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setRemovingList(true); }}><Bi name="trash" className="me-2" />{t.foot.deleteList}</a>
            </Dropdown>
          </MayEdit>
        </div>
      ) : null}
      {adding || editing ? (
        <ItemForm key={editing?.id ?? 'new'} list={list} scope={scope} row={editing} onClose={() => { onCloseAdd(); setEditing(null); }} onSaved={(message) => { toast.show({ tone: 'success', text: message }); onCloseAdd(); setEditing(null); onChanged(); }} />
      ) : null}

      <Dialog
        open={removing !== null}
        tone="danger"
        title={t.remove.title(removing?.label ?? '')}
        message={both ? t.remove.both : t.remove.one}
        confirmLabel={t.remove.label}
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => { const r = removing; setRemoving(null); if (r) void act(() => adminApi.deleteMasterItem(r.id, scope)); }}
      />
      <Dialog
        open={removingList}
        tone="danger"
        title={t.foot.removeListTitle(placement ? `${placement.groupName} ${placement.sectionLabel}` : set.name)}
        message={t.foot.removeListBody}
        confirmLabel={t.foot.removeListLabel}
        busy={busy}
        onCancel={() => setRemovingList(false)}
        onConfirm={() => { setRemovingList(false); void act(() => adminApi.deleteMasterSet(set.key), onRemoved); }}
      />
    </>
  );
}

/** masters/_item-fields.blade.php inside its pop-up (add, or open one to change). */
function ItemForm({ list, scope, row, onClose, onSaved }: { list: MasterList; scope: MasterScope; row: MasterRow | null; onClose: () => void; onSaved: (message: string) => void }) {
  const { set, placement } = list;
  const nameOnly = set.isNameOnly;
  const [label, setLabel] = useState(row?.label ?? '');
  const [value, setValue] = useState(row ? (row.value === row.label ? '' : row.value) : '');
  const [isActive, setActive] = useState(row?.isActive ?? true);
  const [isDefault, setDefault] = useState(row?.isDefault ?? false);
  const { busy, errors, submit } = useSubmit(['label', 'value', 'color']);
  const f = t.form;
  const list0 = placement ? placement.sectionLabel : set.name;
  const title = row ? row.label : nameOnly ? f.addNameTo(list0) : f.addTo(list0);
  const input = { label, value, color: row?.color ?? null, isActive, isDefault };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      eyebrow={!row && list.scope ? t.scope.eyebrow(masterScopeLabel[list.scope]) : undefined}
      onSubmit={() => void submit(() => (row ? adminApi.updateMasterItem(row.id, scope, input) : adminApi.createMasterItem(set.key, scope, input)), (d) => onSaved(d.message))}
      footer={<Button type="submit" disabled={busy}>{row ? t.saveChanges : nameOnly ? t.addName : t.addOption}</Button>}
    >
      {nameOnly ? (
        <>
          <label className="form-label" htmlFor={`item_name_${row?.id ?? 'new'}`}>{f.name}<span className="req">*</span></label>
          <input id={`item_name_${row?.id ?? 'new'}`} className="form-control" value={label} maxLength={60} autoComplete="off" onChange={(e) => setLabel(e.target.value)} />
          {errors.label ? <div className="field-error">{errors.label}</div> : null}
        </>
      ) : (
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label">{f.option}<span className="req">*</span></label>
            <input className="form-control" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
            <div className="form-text">{f.optionHint}</div>
            {errors.label ? <div className="field-error">{errors.label}</div> : null}
          </div>
          <div className="col-md-6">
            <label className="form-label">{f.value} <span className="wz-optional">{f.optional}</span></label>
            <input className="form-control" value={value} maxLength={60} placeholder={f.valuePlaceholder} onChange={(e) => setValue(e.target.value)} />
            <div className="form-text">{f.valueHint}</div>
            {errors.value ? <div className="field-error">{errors.value}</div> : null}
          </div>
          <div className="col-12">
            <label className="check-line"><input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} /><span>{f.offer}</span></label>
            <label className="check-line"><input type="checkbox" checked={isDefault} onChange={(e) => setDefault(e.target.checked)} /><span>{f.preselect}</span></label>
          </div>
        </div>
      )}
    </Modal>
  );
}
