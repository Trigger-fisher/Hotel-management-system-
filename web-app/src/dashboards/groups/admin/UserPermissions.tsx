'use client';

// users/_permissions.blade.php and _permission-chip.blade.php: what one person may actually do, and why (their role, or given to /
// taken from them alone). A module's levels are read as the View / Add / Edit / Delete / PDF chips.
import { Fragment } from 'react';
import { permissionModules, type AdminRole, type AdminUser, type PermissionOverride } from '@shared/dashboards/admin';
import { Bi } from '@/dashboards/pallav/ui';
import { ACTIONS, TOTAL_CELLS, allowedCount, cellOn, moduleIcon, roleAccent, roleIcon, withCell } from './accessLook';

import { tr } from '@/lib/i18n/language';
type Origin = 'role' | 'granted' | 'revoked' | 'none';

export function UserPermissions({ user: u, role, canOverride, busy, onOverrides }: { user: AdminUser; role: AdminRole | undefined; canOverride: boolean; busy: boolean; onOverrides: (next: PermissionOverride[]) => void }) {
  const groups = [...new Set(permissionModules.map((m) => m.group))];
  const levelOf = (mod: string) => u.overrides.find((o) => o.module === mod)?.level ?? role?.levels[mod] ?? 'none';
  const effective = Object.fromEntries(permissionModules.map((m) => [m.key, levelOf(m.key)]));
  const count = allowedCount(effective);
  const first = u.name.split(' ')[0];

  function flip(mod: string, action: string, on: boolean) {
    const next = withCell(levelOf(mod), action, on);
    const rest = u.overrides.filter((o) => o.module !== mod);
    // Back to what the role says: the override is not needed any more.
    onOverrides(next === (role?.levels[mod] ?? 'none') ? rest : [...rest, { module: mod, level: next }]);
  }
  const clear = (mod: string) => onOverrides(u.overrides.filter((o) => o.module !== mod));

  function chip(mod: string, a: (typeof ACTIONS)[number]) {
    const allowed = cellOn(levelOf(mod), a.key);
    const base = cellOn(role?.levels[mod], a.key);
    const origin: Origin = allowed === base ? (allowed ? 'role' : 'none') : allowed ? 'granted' : 'revoked';
    const why = { role: `From their role, ${role?.name ?? u.roleName}`, granted: 'Given to them alone', revoked: 'Taken away from them alone', none: 'Not allowed' }[origin];
    const icon = { role: 'circle-fill', granted: 'plus-circle-fill', revoked: 'dash-circle-fill', none: 'circle' }[origin];
    const label = permissionModules.find((m) => m.key === mod)?.label ?? mod;
    return (
      <span key={a.key} className={`up-action ${allowed ? 'yes' : 'no'} origin-${origin}`} title={why}>
        <Bi name={icon} />
        {a.label}
        {canOverride ? (
          <>
            <button /* check-shared-ignore: a three-state grant/revoke flip, no kit equivalent */ type="button" className="up-flip" data-state={allowed ? 'revoke' : 'grant'} disabled={busy} title={allowed ? `Take this away from ${u.name}` : `Give this to ${u.name}`} aria-label={`${allowed ? 'Take away' : 'Give'} ${label} ${a.label}`} onClick={() => flip(mod, a.key, !allowed)}>
              <Bi name={allowed ? 'dash' : 'plus'} />
            </button>
            {origin === 'granted' || origin === 'revoked' ? (
              <button /* check-shared-ignore: a three-state grant/revoke flip, no kit equivalent */ type="button" className="up-flip clear" data-state="clear" disabled={busy} title={tr("Back to what the role says")} aria-label={tr("Reset to the role")} onClick={() => clear(mod)}>
                <Bi name="arrow-counterclockwise" />
              </button>
            ) : null}
          </>
        ) : null}
      </span>
    );
  }

  return (
    <>
      <div className="up-head" style={{ ['--role' as string]: roleAccent(role) }}>
        <span className="up-role-icon">
          <Bi name={roleIcon(role)} />
        </span>
        <div>
          <strong>{role?.name ?? u.roleName}</strong>
          <span>{role?.description || tr("No description yet.")}</span>
        </div>
        <div className="up-head-counts">
          <span>
            <strong>{count}</strong> {tr("of")} {TOTAL_CELLS} {tr("allowed")}
          </span>
          {u.overrides.length ? (
            <span className="warn">
              <strong>{u.overrides.length}</strong> {tr("just for them")}
            </span>
          ) : null}
        </div>
      </div>

      {u.overrides.length ? (
        <div className="up-overrides">
          <h6>{tr("Given to, or taken from,")} {first} {tr("alone")}</h6>
          {u.overrides.map((o) => {
            const mod = permissionModules.find((m) => m.key === o.module)?.label ?? o.module;
            const more = ACTIONS.filter((a) => cellOn(o.level, a.key)).length >= ACTIONS.filter((a) => cellOn(role?.levels[o.module], a.key)).length;
            return (
              <div key={o.module} className={`up-override ${more ? 'on' : 'off'}`}>
                <Bi name={more ? 'plus-circle-fill' : 'dash-circle-fill'} />
                <span>{mod}</span>
                <small>{more ? tr("added on top of their role") : tr("taken away from their role")}</small>
              </div>
            );
          })}
        </div>
      ) : null}

      <p className="up-legend">
        <span>
          <Bi name="circle-fill" className="up-from" /> {tr("From the role")}
        </span>
        <span>
          <Bi name="circle-half" className="up-inherit" /> {tr("Inherited, or held because all of the module is")}
        </span>
        <span>
          <Bi name="plus-circle-fill" className="up-grant" /> {tr("Given to them")}
        </span>
        <span>
          <Bi name="dash-circle-fill" className="up-deny" /> {tr("Taken away")}
        </span>
      </p>

      <div className="up-list">
        {groups.map((g) => (
          <Fragment key={g}>
            <h6 className="up-group">{g}</h6>
            {permissionModules
              .filter((m) => m.group === g)
              .map((m) => (
                <div key={m.key} className="up-module">
                  <div className="up-module-name">
                    <Bi name={moduleIcon[m.key] ?? 'grid'} /> {m.label}
                  </div>
                  <div className="up-actions">{ACTIONS.map((a) => chip(m.key, a))}</div>
                </div>
              ))}
          </Fragment>
        ))}
      </div>

      {canOverride ? (
        <p className="up-note">
          <Bi name="info-circle" /> {tr("Giving one person something on their own is meant to be rare. If several people need it, change their role instead.")}
        </p>
      ) : null}
    </>
  );
}
