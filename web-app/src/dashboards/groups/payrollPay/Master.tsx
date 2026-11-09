'use client';

// Payroll settings (hotel.payroll.master, admin only): the lists payroll forms choose from; the list is picked in the side panel (a select on a phone), the company in Applies to.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePanel2 } from '@/dashboards/pallav';
import { masterLists, type MasterItem, type MasterListDef, type MasterListKey, type MasterScope, type MasterView, type PayrollCompanyRef } from '@shared/dashboards/payrollPay';
import { Bi, Dialog, Dropdown, Modal, StatusChip, Select, Button, MayEdit } from '@/dashboards/pallav/ui';
import { useSubmit, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { EmptyState, Fld, PayLayout, SearchField } from '../payrollCore/pms';
import { payApi } from './api';
import { PayPage, failText } from './shared';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';

import { tr, trf } from '@/lib/i18n/language';
/** hotel.payroll.master */
export function Master({ user, navigate }: ScreenProps) {
  return (
    <PayPage role={user.role} navigate={navigate} adminOnly>
      {(company) => <Body company={company} navigate={navigate} />}
    </PayPage>
  );
}

function Body({ company, navigate }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate'] }) {
  const [companies, setCompanies] = useState<PayrollCompanyRef[]>([]);
  const [scope, setScope] = useState<MasterScope>(company.id);
  const [list, setList] = useState<MasterListKey>('designations');
  const [find, setFind] = useState('');
  const [adding, setAdding] = useState(false);
  const panel = usePanel2(useMemo(() => ({ title: 'Payroll Master', icon: 'sliders' }), []));
  const def = masterLists.find((l) => l.key === list) as MasterListDef;
  const scopeName = scope === 'all' ? 'All companies' : (companies.find((c) => c.id === scope)?.name ?? company.name);

  useEffect(() => {
    let live = true;
    void payApi.listCompanies().then((res) => live && res.ok && setCompanies(res.data));
    return () => {
      live = false;
    };
  }, []);

  const pickList = (k: MasterListKey) => {
    setList(k);
    setFind('');
  };

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Payroll settings' }]}
      sub={tr('The lists payroll forms choose from: designations, departments, exit reasons and the rest. Each one can be kept for every company or for one company alone.')}
      search={<SearchField bare clear value={find} onChange={setFind} placeholder={trf('Search {0}…', [def.name.toLowerCase()])} label={trf('Search {0}', [def.name.toLowerCase()])} />}
      actions={<MayEdit module="payroll"><Button icon="plus-lg" onClick={() => setAdding(true)}>{trf('Add to {0}', [def.name])}</Button></MayEdit>}
    >
      {panel
        ? createPortal(
            <nav className="subnav-body" aria-label={tr('Payroll settings lists')}>
              <div className="rail-group">
                <div className="rail-label">{tr('Lists')}</div>
                {masterLists.map((l) => (
                  <a
                    key={l.key}
                    className={`rail-item ${l.key === list ? 'active' : ''}`}
                    href="#"
                    title={l.name}
                    aria-current={l.key === list ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      pickList(l.key);
                    }}
                  >
                    <Bi name={iconOf(l.icon)} />
                    <span>{l.name}</span>
                  </a>
                ))}
              </div>
            </nav>,
            panel,
          )
        : null}
      <div className="card ha-ms">
        <div className="ha-ms-head">
          <div className="ha-ms-title">
            <span className="pf-initials ha-ms-icon" aria-hidden="true"><Bi name={iconOf(def.icon)} /></span>
            <div>
              <h2>{def.name}</h2>
              <p>{def.description}</p>
            </div>
          </div>
          <div className="ha-ms-pick">
            {panel ? null : (
              <label className="ha-ms-field">
                <span>{tr('List')}</span>
                <Select className="form-select" value={list} onChange={(e) => pickList(e.target.value as MasterListKey)}>
                  {masterLists.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
                </Select>
              </label>
            )}
            <label className="ha-ms-field">
              <span>{tr('Applies to')}</span>
              <Select className="form-select" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">{tr('All companies')}</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </label>
          </div>
        </div>
        <Items key={`${scope}-${list}`} scope={scope} scopeName={scopeName} def={def} find={find} adding={adding} onCloseAdd={() => setAdding(false)} onAll={() => setScope('all')} />
      </div>
    </PayLayout>
  );
}

/** Our mock names icons its own way; Pallav's master lists use Bootstrap Icons. */
function iconOf(name: string): string {
  const map: Record<string, string> = { users: 'people', logout: 'box-arrow-right', file: 'card-text', wallet: 'wallet2', mail: 'envelope' };
  return map[name] ?? name;
}

function Items({ scope, scopeName, def, find, adding, onCloseAdd, onAll }: { scope: MasterScope; scopeName: string; def: MasterListDef; find: string; adding: boolean; onCloseAdd: () => void; onAll: () => void }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const master = useLoaded(() => payApi.getMaster(scope, def.key), [scope, def.key, version]);
  const view: MasterView | null = master.data;
  const [edit, setEdit] = useState<MasterItem | null>(null);
  const [del, setDel] = useState<MasterItem | null>(null);
  const [busy, setBusy] = useState(false);

  if (!view) return <Wait error={master.error} onRetry={master.reload} tiles={false} rows={3} />;
  const term = find.trim().toLowerCase();
  const match = (i: { label: string; value?: string | null }) => !term || `${i.label} ${i.value ?? ''}`.toLowerCase().includes(term);
  const own = view.own.filter(match);
  const inherited = scope === 'all' ? [] : view.inherited.filter(match);
  const builtIn = view.own.length === 0 && view.inherited.length === 0 ? def.defaults.filter((x) => !term || x.toLowerCase().includes(term)) : [];

  async function toggle(i: MasterItem) {
    const res = await payApi.toggleMasterItem(i.id, scope);
    if (res.ok) setVersion((v) => v + 1);
    else toast.show({ tone: 'error', text: failText(res.error) });
  }
  async function remove() {
    if (!del) return;
    setBusy(true);
    const res = await payApi.deleteMasterItem(del.id, scope);
    setBusy(false);
    setDel(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: 'Item removed.' });
      setVersion((v) => v + 1);
    } else toast.show({ tone: 'error', text: failText(res.error) });
  }

  const nothing = view.own.length === 0 && view.inherited.length === 0 && def.defaults.length === 0;
  const noMatch = Boolean(term) && own.length + inherited.length + builtIn.length === 0;

  return (
    <>
      <StaleNote error={master.error} onRetry={master.reload} />
      {noMatch ? <EmptyState icon="search" title={trf('Nothing matches "{0}"', [find])} text={tr('Try a different word, or clear the search to see everything.')} /> : null}
      {nothing ? <EmptyState icon={iconOf(def.icon)} title={tr('Nothing here yet')} text={trf('Add the first one for {0}.', [scopeName])} /> : null}

      {own.length ? (
        <section className="ha-ms-sec" aria-label={trf('Kept for {0}', [scopeName])}>
          <h3>{trf('Kept for {0}', [scopeName])} <b>{own.length}</b></h3>
          <ul className="ha-items">
            {own.map((i) => (
              <li key={i.id} className={i.isActive ? undefined : 'is-off'}>
                <span className="ha-item-main">
                  <b>{i.label}</b>
                  {def.isEmail && i.value ? <small>{i.value}</small> : null}
                </span>
                <MayEdit module="payroll">
                  <label className="form-check form-switch ha-switch">
                    <input className="form-check-input" type="checkbox" role="switch" checked={i.isActive} onChange={() => void toggle(i)} aria-label={trf('{0} in use', [i.label])} />
                    <span>{i.isActive ? tr('In use') : tr('Off')}</span>
                  </label>
                  <Button size="sm" variant="outline" icon="pencil-square" onClick={() => setEdit(i)}>{tr('Edit')}</Button>
                  <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [i.label])} {...p} />}>
                    <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setDel(i); }}><Bi name="trash" className="me-2" />{tr('Remove from the list')}</a>
                  </Dropdown>
                </MayEdit>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {inherited.length ? (
        <section className="ha-ms-sec is-muted" aria-label={tr('From All companies')}>
          <h3>{tr('From All companies')} <b>{inherited.length}</b></h3>
          <p className="ha-ms-why">{tr('Shared by every company. Change these with Applies to set to All companies.')}</p>
          <ul className="ha-items">
            {inherited.map((i) => (
              <li key={i.id} className={i.isActive ? undefined : 'is-off'}>
                <span className="ha-item-main">
                  <b>{i.label}</b>
                  {def.isEmail && i.value ? <small>{i.value}</small> : null}
                </span>
                {i.isActive ? <StatusChip tone="ok">{tr('In use')}</StatusChip> : <StatusChip tone="neutral">{tr('Off')}</StatusChip>}
              </li>
            ))}
          </ul>
          {scope !== 'all' ? <Button size="sm" variant="outline" icon="globe2" onClick={onAll}>{tr('Open All companies')}</Button> : null}
        </section>
      ) : null}

      {builtIn.length ? (
        <section className="ha-ms-sec is-muted" aria-label={tr('Built in')}>
          <h3>{tr('Built in')} <b>{builtIn.length}</b></h3>
          <p className="ha-ms-why">{tr('Used until you add your own; adding the first one replaces them.')}</p>
          <ul className="ha-items">
            {builtIn.map((label) => (
              <li key={label}>
                <span className="ha-item-main"><b>{label}</b></span>
                <Bi name="lock" className="text-muted" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {adding || edit ? (
        <ItemModal
          key={edit?.id ?? 'new'}
          scope={scope}
          scopeName={scopeName}
          def={def}
          item={edit}
          onClose={() => {
            setEdit(null);
            onCloseAdd();
          }}
          onSaved={() => {
            setEdit(null);
            onCloseAdd();
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
      <Dialog open={del !== null} tone="danger" title={del ? trf('Remove {0}?', [del.label]) : ''} message={trf('It is taken out of this list for {0}.', [scopeName])} confirmLabel={tr('Remove')} busy={busy} onConfirm={() => void remove()} onCancel={() => setDel(null)} />
    </>
  );
}

function ItemModal({ scope, scopeName, def, item, onClose, onSaved }: { scope: MasterScope; scopeName: string; def: MasterListDef; item: MasterItem | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState(item?.label ?? '');
  const [value, setValue] = useState(item?.value ?? '');
  const { busy, errors, submit } = useSubmit(['label', 'value']);
  const uid = item?.id ?? 'new';
  const save = () =>
    void submit(
      () => (item ? payApi.updateMasterItem(item.id, { label, value }, scope) : payApi.createMasterItem(scope, def.key, { label, value })),
      () => {
        toast.show({ tone: 'success', text: 'Saved.' });
        onSaved();
      },
    );
  return (
    <Modal
      open
      className="pay-form-modal"
      centered={false}
      scrollable={false}
      onClose={onClose}
      onSubmit={save}
      eyebrow={item ? undefined : <>{tr("For")} {scopeName}</>}
      title={item ? item.label : <>{tr("Add to")} {def.name}</>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" disabled={busy}>{item ? tr("Save changes") : tr("Add")}</Button>
        </>
      }
    >
      <div className="row g-3">
        <Fld md={12} id={`mi_label_${uid}`} label={tr("Name")} required error={errors.label}>
          <input id={`mi_label_${uid}`} className={`form-control ${errors.label ? 'is-invalid' : ''}`} maxLength={120} placeholder={def.isEmail ? 'e.g. Accounts team' : 'e.g. Front Office'} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Fld>
        {def.isEmail ? (
          <Fld md={12} id={`mi_value_${uid}`} label={tr("Email address")} required error={errors.value}>
            <input type="email" id={`mi_value_${uid}`} className={`form-control ${errors.value ? 'is-invalid' : ''}`} maxLength={190} placeholder={tr("name@example.com")} value={value} onChange={(e) => setValue(e.target.value)} />
          </Fld>
        ) : null}
      </div>
    </Modal>
  );
}
