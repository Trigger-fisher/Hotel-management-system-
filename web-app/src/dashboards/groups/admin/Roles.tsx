'use client';

// hotel.admin.roles: Pallav's Roles and Permissions (users/access.blade.php, _access-cells.blade.php, public/assets/access.js).
// The ladder on the left (drag or use the arrows), the chosen role's tick grid on the right; every tick saves at once.
import { Fragment, useState } from 'react';
import { adminCopy, permissionModules, roleTemplates, type AdminRole, type AdminRoleInput, type PermissionMap } from '@shared/dashboards/admin';
import type { DashError, DashResult } from '@shared/dashboards/common';
import { isPayrollAdmin } from '@shared/dashboards/payrollPay';
import { Bi, Button, Dialog, Dropdown, ListSearch, Modal, SegTabs, Textarea, MayEdit } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { errorText, useAsync, useSubmit, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { adminApi } from './api';
import { AdminOnly, Ready } from './pallavParts';
import { ACCENT_CHOICES, ACTIONS, moduleAbout, moduleIcon, ICON_CHOICES, TOTAL_CELLS, allowedCount, cellOn, effectiveLevels, plural, roleAccent, roleIcon, sensitiveCount, topRole, withCell } from './accessLook';

import { tr, trf } from '@/lib/i18n/language';
const roleVars = (accent: string) => ({ ['--role' as string]: accent });
const copy = adminCopy.roles;

/**
 * A save that touched a built-in role and was refused: the server answers PUT roles/{id} with 409 CONFLICT and PUT roles/order with
 * VALIDATION_FAILED (roleService SHIPPED_ROLE_MESSAGE / SHIPPED_ORDER_MESSAGE); the mock gives the same codes. The screen shows one friendly sentence.
 */
const builtInRefused = (error: DashError, touchesBuiltIn: boolean, codes: readonly string[]) => touchesBuiltIn && codes.includes(error.code);
/** The refusal as the screen shows it: the sentence as a form-level error (a toast where the save path toasts). */
function friendly<T>(res: DashResult<T>, touchesBuiltIn: boolean, codes: readonly string[]): DashResult<T> {
  if (res.ok || !builtInRefused(res.error, touchesBuiltIn, codes)) return res;
  return { ok: false, error: { ...res.error, message: copy.builtInLocked, details: { fields: { form: copy.builtInLocked } } } };
}
/** True when the new ladder changes the order of the built-in roles among themselves. */
const shippedOrderChanged = (roles: AdminRole[], ids: string[]) => {
  const now = roles.filter((r) => r.builtIn).map((r) => r.id);
  return ids.filter((id) => now.includes(id)).join() !== now.join();
};

export function Roles({ user, navigate }: ScreenProps) {
  const canEdit = isPayrollAdmin(user.role);
  const [version, setVersion] = useState(0);
  const { state, reload } = useAsync(() => adminApi.listRoles(), [version], { keep: true });
  const [pick, setPick] = useState<string | null>(null);
  if (!canEdit) return <AdminOnly />;
  return (
    <Ready state={state} onRetry={reload}>
      {(roles) => <Body roles={roles} selectedId={pick} onPick={setPick} refresh={() => setVersion((v) => v + 1)} navigate={navigate} />}
    </Ready>
  );
}

function Body({ roles, selectedId, onPick, refresh, navigate }: { roles: AdminRole[]; selectedId: string | null; onPick: (id: string) => void; refresh: () => void; navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const [form, setForm] = useState<{ role: AdminRole | null } | null>(null);
  const [del, setDel] = useState<AdminRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // The page search (decision 51): the ladder keeps its order and positions (the rank matters), so the box hides the roles that do not match.
  const [typed, setTyped] = useState('');
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (r: AdminRole) => words.every((w) => `${r.name} ${r.description}`.toLowerCase().includes(w));
  const none = words.length > 0 && !roles.some(matches);

  const index = Math.max(0, roles.findIndex((r) => r.id === selectedId));
  const selected = roles[index];
  const eff = effectiveLevels(roles, index);
  const below = roles[index + 1];
  const groupNames = [...new Set(permissionModules.map((m) => m.group))];
  const [group, setGroup] = useState('');

  async function call<T>(fn: () => Promise<DashResult<T>>, ok?: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      if (ok) toast.show({ tone: 'success', text: ok });
      refresh();
    } else toast.show({ tone: 'error', text: res.error.details?.fields?.form ?? errorText(res.error) });
    return res.ok;
  }

  const tick = (role: AdminRole, mod: string, action: string, on: boolean) =>
    void call(async () => friendly(await adminApi.updateRole(role.id, { name: role.name, description: role.description, levels: { ...role.levels, [mod]: withCell(role.levels[mod], action, on) } }), role.builtIn, ['CONFLICT']));

  /** Moves the role to sit where `before` is (or one step, for the arrows). The top rung stays put; built-in roles keep their order. */
  function place(id: string, to: number) {
    const ids = roles.map((r) => r.id).filter((x) => x !== id);
    ids.splice(Math.max(1, to), 0, id);
    void call(async () => friendly(await adminApi.reorderRoles(ids), shippedOrderChanged(roles, ids), ['VALIDATION_FAILED', 'CONFLICT']));
  }

  async function remove() {
    if (!del) return;
    const ok = await call(() => adminApi.deleteRole(del.id), 'Deleted.');
    setDel(null);
    if (ok) onPick(roles[0]?.id ?? '');
  }

  return (
    <>
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">{tr("Each role is given what it needs, and passes everything it has up to the role above it.")}</p>
        </div>
        <div className="ac-head-actions">
          <ListSearch value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={tr("Search roles")} />
          <a
            className="btn btn-outline-p"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate('hotel.admin.users');
            }}
          >
            <Bi name="person-badge" /> {tr("Users")}
          </a>
          <MayEdit module="access"><Button icon="plus-lg" onClick={() => setForm({ role: null })}>
            {tr("New role")}
          </Button></MayEdit>
        </div>
      </div>

      <div className="ac-layout">
        {/* The ladder: highest rung at the top, dragged to reorder */}
        <aside className="ac-ladder-wrap reveal">
          <div className="ac-side-head">
            <h3>{tr("The ladder")}</h3>
            <p>{tr("Highest at the top. A role gains everything below it.")}</p>
          </div>

          {none ? (<div className="ac-side-head"><p>{tr("No role matches that search.")}</p><Button variant="outline" onClick={() => setTyped('')}>{tr("Clear search")}</Button></div>) : null}
          <ol className="ac-ladder" id="roleLadder">
            {roles.map((r, i) => {
              const pinned = topRole(roles, r.id);
              const count = allowedCount(effectiveLevels(roles, i));
              return (
                <li
                  key={r.id}
                  hidden={!matches(r)}
                  className={`ac-rung ${r.id === selected?.id ? 'current' : ''} ${pinned ? 'pinned' : ''} ${drag === r.id ? 'dragging' : ''} ${over === r.id && drag !== r.id ? 'drop-target' : ''}`}
                  style={roleVars(roleAccent(r))}
                  draggable={!pinned && !r.builtIn}
                  onDragStart={() => setDrag(r.id)}
                  onDragOver={(e) => {
                    if (drag && i > 0) {
                      e.preventDefault();
                      setOver(r.id);
                    }
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag && drag !== r.id && i > 0) place(drag, i);
                    setDrag(null);
                    setOver(null);
                  }}
                >
                  <span className="ac-grip" aria-hidden="true">
                    <Bi name="grip-vertical" />
                  </span>
                  <a
                    className="ac-rung-body"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onPick(r.id);
                    }}
                  >
                    <span className="ac-rung-icon">
                      <Bi name={roleIcon(r)} />
                    </span>
                    <span className="ac-rung-text">
                      <span className="ac-rung-name">{r.name}</span>
                      <span className="ac-rung-meta">
                        {plural(r.usersCount, 'account')} {tr("·")} {count} {tr("allowed")}
                      </span>
                    </span>
                  </a>
                  <span className="ac-rung-side">
                    {pinned ? (
                      <span className="ac-pin" title={tr("This role stays at the top")}>
                        <Bi name="pin-angle-fill" />
                      </span>
                    ) : (
                      <span className="ac-move">
                        <button type="button" data-move="up" title={r.builtIn ? copy.viewOnly : 'Move up'} aria-label={trf("Move {0} up", [r.name])} disabled={busy || r.builtIn || i <= 1} onClick={() => place(r.id, i - 1)}>
                          <Bi name="chevron-up" />
                        </button>
                        <button type="button" data-move="down" title={r.builtIn ? copy.viewOnly : 'Move down'} aria-label={trf("Move {0} down", [r.name])} disabled={busy || r.builtIn || i === roles.length - 1} onClick={() => place(r.id, i + 1)}>
                          <Bi name="chevron-down" />
                        </button>
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>

          <p className="ac-hint">
            <Bi name="info-circle" /> {tr("Drag a role, or use the arrows. The top rung is pinned: somebody has to keep the keys. Built-in roles keep their place.")}
          </p>
        </aside>

        {/* What the chosen role may do */}
        <section className="ac-main reveal" id="rolePanel" style={roleVars(roleAccent(selected))}>
          {selected ? (
            <>
              <header className="ac-role-head">
                <span className="ac-role-icon">
                  <Bi name={roleIcon(selected)} />
                </span>
                <div className="ac-role-title">
                  <h3>
                    {selected.name} {selected.builtIn ? <span className="ac-chip">{tr("Built in")}</span> : null}
                  </h3>
                  <p>{selected.description || tr("No description yet.")}</p>
                </div>
                <div className="ac-role-tools">
                  <MayEdit module="access">
                    <Button variant="outline" size="sm" icon={selected.builtIn ? 'eye' : 'pencil'} onClick={() => setForm({ role: selected })}>{selected.builtIn ? tr('View') : tr('Edit name and description')}</Button>
                    {!selected.builtIn ? (
                      <Dropdown align="end" button={(p) => <Button variant="ghost" size="sm" icon="three-dots" aria-label={trf('More for {0}', [selected.name])} {...p} />}>
                        <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setDel(selected); }}><Bi name="trash" className="me-2" />{tr('Delete role')}</a>
                      </Dropdown>
                    ) : null}
                  </MayEdit>
                </div>
              </header>

              {selected.builtIn ? (
                <div className="ac-inherit off" role="note">
                  <Bi name="lock-fill" />
                  <span>
                    <strong>{copy.viewOnly}</strong>. {copy.builtInLocked}
                  </span>
                </div>
              ) : null}

              <HomeStats
                stats={[
                  { id: 'accounts', label: tr('Accounts'), value: selected.usersCount, format: (n) => String(Math.round(n)), note: tr('Hold this role') },
                  { id: 'allowed', label: tr('Allowed in total'), value: allowedCount(eff), format: (n) => trf('{0} of {1}', [Math.round(n), TOTAL_CELLS]), note: tr('Ticked here and inherited') },
                  { id: 'own', label: tr('Ticked here'), value: allowedCount(selected.levels), format: (n) => String(Math.round(n)), note: tr('Given to this role itself') },
                  { id: 'sensitive', label: tr('Sensitive'), value: sensitiveCount(eff), format: (n) => String(Math.round(n)), note: tr('Delete, export and the like') },
                ]}
              />
              <div className={`ac-inherit ${selected.inherits ? '' : 'off'}`}>
                <Bi name={selected.inherits ? 'arrow-down-up' : 'slash-circle'} />
                {selected.inherits && below ? (
                  <>
                    {tr("Everything")} <strong>{below.name}</strong> {tr("may do,")} {selected.name} {tr("may do as well.")}
                  </>
                ) : selected.inherits ? (
                  tr("This is the bottom rung, so there is nothing below it to inherit.")
                ) : (
                  tr("Inheritance is off: this role has only what is ticked here.")
                )}
              </div>

              <SegTabs className="ha-perm-tabs" label={tr('Permission groups')} active={group} onChange={setGroup} tabs={[{ id: '', label: tr('Every screen') }, ...groupNames.map((g) => ({ id: g, label: g }))]} />
              {groupNames.filter((g) => !group || g === group).map((g) => (
                <Fragment key={g}>
                  <h4 className="ac-group">{g}</h4>
                  <div className="ac-grid" role="table">
                    <div className="ac-grid-head" role="row">
                      <span role="columnheader">{tr("Screen")}</span>
                      {ACTIONS.map((a) => (
                        <span key={a.key} role="columnheader" className={a.sensitive ? 'warn' : ''} title={a.hint}>
                          {a.label}
                        </span>
                      ))}
                    </div>

                    {permissionModules
                      .filter((m) => m.group === g)
                      .map((m) => (
                        <div key={m.key} className="ac-block" data-block={m.key}>
                          <div className="ac-row ac-parent" role="row">
                            <span className="ac-module" role="cell">
                              <Bi name={moduleIcon[m.key] ?? 'grid'} />
                              <span>
                                <strong>{m.label}</strong>
                                <small>{moduleAbout[m.key] ?? ''}</small>
                              </span>
                            </span>
                            {ACTIONS.map((a) => {
                              const own = cellOn(selected.levels[m.key], a.key);
                              const inherited = !own && cellOn(eff[m.key], a.key);
                              const locked = selected.builtIn || topRole(roles, selected.id) || busy;
                              return (
                                <span key={a.key} className="ac-cell" role="cell">
                                  <label className={`ac-toggle ${inherited ? 'inherited' : ''} ${a.sensitive ? 'warn' : ''}`} title={inherited ? `Comes from ${below?.name}. Tick it to give it to this role in its own right.` : a.hint}>
                                    <input type="checkbox" checked={own} disabled={locked} aria-label={`${m.label}: ${a.label}`} onChange={(e) => tick(selected, m.key, a.key, e.target.checked)} />
                                    <span className="ac-box">
                                      <Bi name="check-lg" />
                                    </span>
                                    {inherited ? <span className="ac-from">{below?.name}</span> : null}
                                  </label>
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                  </div>
                </Fragment>
              ))}
            </>
          ) : (
            <div className="empty-state">
              <div className="es-icon">
                <Bi name="diagram-3" />
              </div>
              <div className="es-title">{tr("No roles yet")}</div>
            </div>
          )}
        </section>
      </div>

      {form ? (
        <RoleForm
          key={form.role?.id ?? 'new'}
          role={form.role}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            setForm(null);
            onPick(saved.id);
            refresh();
          }}
        />
      ) : null}
      <Dialog open={del !== null} tone="danger" title={del ? `Delete the ${del.name} role?` : ''} message="Accounts using it must be moved to another role first." confirmLabel="Delete" busy={busy} onConfirm={() => void remove()} onCancel={() => setDel(null)} />
    </>
  );
}

function RoleForm({ role, onClose, onSaved }: { role: AdminRole | null; onClose: () => void; onSaved: (r: AdminRole) => void }) {
  const toast = useToast();
  const [v, setV] = useState({ name: role?.name ?? '', description: role?.description ?? '', icon: role ? roleIcon(role) : (ICON_CHOICES[0] ?? 'person'), accent: role ? roleAccent(role) : (ACCENT_CHOICES[0] ?? '#2B2B31'), inherits: role?.inherits ?? true });
  // A new role may start from a template (the usual hotel jobs): its name, description, icon and ticks are filled in and stay editable; "Blank" ticks nothing.
  const [template, setTemplate] = useState<string>('');
  const [levels, setLevels] = useState<PermissionMap>(() => role?.levels ?? Object.fromEntries(permissionModules.map((m) => [m.key, 'none'])));
  const pickTemplate = (key: string) => {
    setTemplate(key);
    const t = roleTemplates.find((x) => x.key === key);
    const none = Object.fromEntries(permissionModules.map((m) => [m.key, 'none' as const]));
    if (!t) return setLevels(none);
    setLevels({ ...none, ...t.levels });
    setV((p) => ({ ...p, name: p.name.trim() === '' || roleTemplates.some((x) => x.name === p.name) ? t.name : p.name, description: p.description.trim() === '' || roleTemplates.some((x) => x.description === p.description) ? t.description : p.description, icon: ICON_CHOICES.includes(t.icon) ? t.icon : p.icon }));
  };
  const { busy, errors, submit } = useSubmit(['name']);
  /** A built-in role opens view only: nothing can be changed and Save is off (the server and the mock refuse any change anyway). */
  const locked = role?.builtIn === true;
  const input = (): AdminRoleInput => ({
    name: v.name,
    description: v.description,
    levels,
    icon: v.icon,
    accent: v.accent,
    inherits: v.inherits,
  });
  return (
    <Modal
      open
      className="pay-form-modal"
      scrollable={false}
      staticBackdrop
      onClose={onClose}
      eyebrow={<>{tr("Access control ·")} {locked ? tr("View") : role ? tr("Edit") : tr("New")}</>}
      title={locked && role ? role.name : role ? `Edit ${role.name}` : 'New role'}
      onSubmit={() =>
        void submit(
          async () => (role ? friendly(await adminApi.updateRole(role.id, input()), role.builtIn, ['CONFLICT']) : adminApi.createRole(input())),
          (saved) => {
            toast.show({ tone: 'success', text: role ? 'Role saved.' : 'Role added.' });
            onSaved(saved);
          },
        )
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {locked ? tr("Close") : tr("Cancel")}
          </Button>
          <Button type="submit" disabled={busy || locked} title={locked ? copy.viewOnly : undefined}>
            {role ? tr("Save changes") : tr("Create role")}
          </Button>
        </>
      }
    >
      {locked ? (
        <div className="ac-inherit off mb-3" role="note">
          <Bi name="lock-fill" />
          <span>
            <strong>{copy.viewOnly}</strong>. {copy.builtInLocked}
          </span>
        </div>
      ) : null}
      {!role ? (
        <div className="form-section">
          <div className="fs-head">
            <div className="fs-title">
              <Bi name="magic" /> {copy.startFrom}
            </div>
            <div className="fs-hint">{copy.startFromHint}</div>
          </div>
          <div className="ac-icon-pick ac-template-pick" role="radiogroup" aria-label={copy.startFrom}>
            {[{ key: '', name: copy.blank, icon: 'file-earmark', description: '' }, ...roleTemplates].map((t) => (
              <label key={t.key} title={t.description || undefined}>
                <input type="radio" name="template" value={t.key} checked={template === t.key} onChange={() => pickTemplate(t.key)} />
                <span>
                  <Bi name={t.icon} /> {t.name}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="person-badge" /> {tr("What to call it")}
          </div>
        </div>
        <div className="row g-3">
          <div className="col-12">
            <label className="form-label" htmlFor="role_name">
              {tr("Name")}<span className="req">*</span>
            </label>
            <input id="role_name" className="form-control" maxLength={40} placeholder={tr("Front Desk Supervisor")} value={v.name} readOnly={locked} onChange={(e) => setV({ ...v, name: e.target.value })} />
            {errors.name ? <div className="field-error">{errors.name}</div> : null}
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="role_desc">
              {tr("What this role is for")}<span className="opt">{tr("optional")}</span>
            </label>
            <Textarea id="role_desc" rows={2} maxLength={500} placeholder={tr("Runs the front desk: records the day's cash and hands over shifts.")} value={v.description} readOnly={locked} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="palette" /> {tr("How it looks")}
          </div>
        </div>
        <div className="ac-icon-pick" role="radiogroup" aria-label={tr("Icon")}>
          {ICON_CHOICES.map((icon) => (
            <label key={icon}>
              <input type="radio" name="icon" value={icon} checked={v.icon === icon} disabled={locked} onChange={() => setV({ ...v, icon })} />
              <span>
                <Bi name={icon} />
              </span>
            </label>
          ))}
        </div>
        <div className="ac-colour-pick" role="radiogroup" aria-label={tr("Colour")}>
          {ACCENT_CHOICES.map((accent) => (
            <label key={accent}>
              <input type="radio" name="accent" value={accent} checked={v.accent === accent} disabled={locked} onChange={() => setV({ ...v, accent })} />
              {/* check-shared-ignore: the role's own saved colour */}
              <span style={{ background: accent }} />
            </label>
          ))}
        </div>
      </div>

      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="arrow-down-up" /> {tr("Inheritance")}
          </div>
        </div>
        <label className="ac-inherit-toggle">
          <input type="checkbox" checked={v.inherits} disabled={locked} onChange={(e) => setV({ ...v, inherits: e.target.checked })} />
          <span className="ac-switch">
            <span />
          </span>
          <span className="ac-ability-body">
            <strong>{tr("Gains everything below it")}</strong>
            <small>{tr("Off means this role has only what you tick for it, whatever sits underneath.")}</small>
          </span>
        </label>
      </div>
    </Modal>
  );
}
