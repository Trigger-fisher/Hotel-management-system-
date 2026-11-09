'use client';

// hotel.admin.users: Pallav's User Accounts (users/index.blade.php). One card per person, grouped by role; the manage pop-up holds
// Details / Password / Access / Permissions; "Add staff member" is one page with the username suggested from the name. The form fields are UserFields, the permissions tab UserPermissions.
import { useMemo, useState } from 'react';
import { formatDate, formatDateTime, formatTime } from '@shared/dashboards/format';
import { type AdminRole, type AdminUser, type PermissionOverride } from '@shared/dashboards/admin';
import { isPayrollAdmin } from '@shared/dashboards/payrollPay';
import { Bi, Button, DetailCard, DetailList, Dialog, Dropdown, EmptyState, Modal, SearchField, SegTabs, StatusChip, ListTabs } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { errorText, useAsync, useSubmit, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { adminApi, useAdminActor } from './api';
import { AdminOnly, Ready } from './pallavParts';
import { initials } from '../payrollCore/pms';
import { Page } from '../companies/pageParts';
import { plural, roleAccent, roleIcon, topRole } from './accessLook';
import { UserFields, type UserDraft } from './UserFields';
import { freeUsername, usernameFrom } from './username';
import { UserPermissions } from './UserPermissions';
import { PortalLinkModal } from './PortalLink';

import { tr, trf } from '@/lib/i18n/language';
/** Nobody is handed the top role from a form: it only changes hands by transfer. */
const assignableRole = (roles: AdminRole[]) => (r: AdminRole) => !topRole(roles, r.id);
// check-shared-ignore: the role's own saved colour, mixed into the avatar
const avatarStyle = (accent: string) => ({ background: `color-mix(in srgb, ${accent} 22%, var(--surface))`, color: 'var(--ink)', boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 55%, transparent)` });
const blank: UserDraft = { name: '', username: '', email: '', mobile: '', roleId: '' };
const draftOf = (u: AdminUser): UserDraft => ({ name: u.name, username: u.username, email: u.email, mobile: u.mobile, roleId: u.roleId });
/** The rung the signed-in person stands on: their own account's role; before that is known, the top rung for an owner, else the one under it. */
function actorRankOf(roles: AdminRole[], me: AdminUser | undefined, accountRole: string): number {
  const own = me ? roles.findIndex((r) => r.id === me.roleId) : -1;
  if (own >= 0) return own;
  return accountRole === 'super_admin' || accountRole === 'platform_admin' ? 0 : Math.min(1, roles.length - 1);
}

export function Users({ user, navigate, params }: ScreenProps) {
  const admin = isPayrollAdmin(user.role);
  useAdminActor(user);
  const [version, setVersion] = useState(0);
  const people = useAsync(() => adminApi.listUsers({ pageSize: 1000 }), [version], { keep: true });
  // Who is signed in: My Profile's username, so the card says "You" and cannot be managed from here.
  const me = useAsync(() => adminApi.getProfile(), [version], { keep: true });
  const myName = me.state.status === 'ready' ? me.state.data.username : null;
  const roleList = useAsync(() => adminApi.listRoles(), [version], { keep: true });
  // The top-bar search opens this screen with the username it found (`params.search`).
  const [term, setTerm] = useState(params.search ?? '');
  const [asked, setAsked] = useState(params.search);
  if (params.search !== asked) {
    // A new top-bar search while this screen is already open.
    setAsked(params.search);
    setTerm(params.search ?? '');
  }
  const [role, setRole] = useState('');
  const [managing, setManaging] = useState<string | null>(null);
  const [creating, setCreating] = useState(params.add === '1');
  if (!admin) return <AdminOnly />;

  return (
    <Ready state={people.state} onRetry={people.reload}>
      {(d) => (
        <Ready state={roleList.state} onRetry={roleList.reload}>
          {(roles) => (
            <Body
              users={d.page.items}
              roles={roles}
              selfId={d.page.items.find((u) => u.username === myName)?.id ?? null}
              actorRank={actorRankOf(roles, d.page.items.find((u) => u.username === myName), user.role)}
              term={term}
              setTerm={setTerm}
              role={role}
              setRole={setRole}
              managing={managing}
              setManaging={setManaging}
              creating={creating}
              setCreating={setCreating}
              refresh={() => setVersion((v) => v + 1)}
              navigate={navigate}
            />
          )}
        </Ready>
      )}
    </Ready>
  );
}

interface BodyProps {
  users: AdminUser[];
  roles: AdminRole[];
  selfId: string | null;
  actorRank: number;
  term: string;
  setTerm: (v: string) => void;
  role: string;
  setRole: (v: string) => void;
  managing: string | null;
  setManaging: (id: string | null) => void;
  creating: boolean;
  setCreating: (v: boolean) => void;
  refresh: () => void;
  navigate: ScreenProps['navigate'];
}

type Kind = 'staff' | 'guest' | 'company';
const kindOf = (u: AdminUser): Kind => (u.portal ? u.portal.kind : 'staff');

function Body({ users, roles, selfId, actorRank, term, setTerm, role, setRole, managing, setManaging, creating, setCreating, refresh, navigate }: BodyProps) {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('staff');
  const [onlyLocked, setOnlyLocked] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const flip = (u: AdminUser, undo: boolean) =>
    void adminApi.toggleUser(u.id).then((r) => {
      refresh();
      if (!r.ok) return toast.show({ tone: 'error', text: errorText(r.error) });
      if (undo) return toast.show({ tone: 'success', text: trf('{0} can sign in as before.', [u.name]) });
      const off = u.status !== 'inactive';
      toast.show({ tone: 'success', text: off ? trf('{0} can no longer sign in.', [u.name]) : trf('{0} can sign in again.', [u.name]), action: { label: tr('Undo'), onClick: () => flip(u, true) }, ms: 8000 });
    });
  const quick: QuickActions = { reset: setResetting, toggle: (u) => flip(u, false) };
  const assignable = roles.filter(assignableRole(roles));
  const byId = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const rankOf = (u: AdminUser) => roles.findIndex((r) => r.id === u.roleId);
  const ofKind = users.filter((u) => kindOf(u) === kind);
  const count = (k: Kind) => users.filter((u) => kindOf(u) === k).length;
  const active = users.filter((u) => u.status === 'active').length;
  const locked = users.filter((u) => u.status === 'locked');
  const unlinked = users.filter((u) => u.portal && !u.portal.linked).length;
  const signedIn = users.filter((u) => u.lastLoginAt).length;

  const q = term.trim().toLowerCase();
  const shown = ofKind.filter((u) => (!role || u.roleId === role) && (!onlyLocked || u.status === 'locked') && (!q || `${u.name} ${u.username} ${u.email}`.toLowerCase().includes(q)));
  const kindRoles = roles.filter((r) => ofKind.some((u) => u.roleId === r.id));
  const groups = kindRoles.map((r) => ({ role: r, rows: shown.filter((u) => u.roleId === r.id) })).filter((g) => g.rows.length);
  const target = users.find((u) => u.id === managing) ?? null;
  const pickKind = (k: Kind) => {
    setKind(k);
    setRole('');
    setOnlyLocked(false);
  };
  const showLocked = () => {
    const first = locked[0];
    if (!first) return;
    if (locked.length === 1) return setManaging(first.id);
    setKind(kindOf(first));
    setRole('');
    setOnlyLocked(true);
  };
  const kinds: { id: Kind; label: string; note: string }[] = [
    { id: 'staff', label: tr('Staff accounts'), note: tr('People who work at the hotel and sign in to HMS') },
    { id: 'guest', label: tr('Guest portal logins'), note: tr('Guests who sign in to the guest portal') },
    { id: 'company', label: tr('Company portal logins'), note: tr('Corporate clients who sign in to the company portal') },
  ];

  return (
    <Page
      sub={tr('Who can sign in, what role they hold and when they were last here.')}
      headActions={
        <div className="sh-head-actions">
          <SearchField wrapClass="pay-toolbar" wrapTag="div" value={term} onChange={setTerm} placeholder={tr('Search name, username or email…')} label={tr('Search users')} />
          <a className="btn btn-outline-p sh-new" href="#" onClick={(e) => { e.preventDefault(); navigate('hotel.admin.roles'); }}>
            <Bi name="diagram-3" /> {tr('Roles')}
          </a>
          {assignable.length ? <Button icon="person-plus" className="sh-new" onClick={() => setCreating(true)}>{tr('Add staff member')}</Button> : null}
        </div>
      }
      grid={false}
    >
      <div className="ha-stack">
        <HomeStats
          stats={[
            { id: 'accounts', label: tr('Accounts'), value: users.length, format: (n) => String(Math.round(n)), note: trf('{0} staff, {1} portal', [count('staff'), count('guest') + count('company')]) },
            { id: 'active', label: tr('Active'), value: active, format: (n) => String(Math.round(n)), note: users.length - active ? trf('{0} not active', [users.length - active]) : tr('Everyone can sign in') },
            { id: 'locked', label: tr('Locked'), value: locked.length, format: (n) => String(Math.round(n)), note: locked.length ? tr('Open the account to unlock it') : tr('Nobody is locked out') },
            { id: 'seen', label: tr('Have signed in'), value: signedIn, format: (n) => String(Math.round(n)), note: trf('{0} never', [users.length - signedIn]) },
          ]}
        />

        {locked.length ? (
          <div className="hm-queue us-locked">
            <div className="hm-q">
              <i className="hm-dot tone-warn" aria-hidden="true" />
              <div className="hm-q-text"><b>{locked.length === 1 ? trf('{0} is locked out after too many failed sign-ins', [locked[0]!.name]) : trf('{0} accounts are locked out after too many failed sign-ins', [locked.length])}</b></div>
              <Button variant="outline" size="sm" onClick={showLocked}>{locked.length === 1 ? tr('Open account') : tr('Show them')}</Button>
            </div>
          </div>
        ) : null}

        <div className="ha-kinds" role="tablist" aria-label={tr('Kind of account')}>
          {kinds.map((k) => (
            <button /* check-shared-ignore: a labelled kind switch with a count and a line under it; SegTabs carries a label only */ key={k.id} type="button" role="tab" aria-selected={kind === k.id} className={`ha-kind${kind === k.id ? ' active' : ''}`} onClick={() => pickKind(k.id)}>
              <span className="ha-kind-top"><b>{k.label}</b><span className="ha-kind-n">{count(k.id)}</span></span>
              <small>{k.note}</small>
            </button>
          ))}
        </div>

        {kindRoles.length > 1 || onlyLocked ? (
          <div className="bm-fbar" role="search">
            <div className="bm-fbar-top">
              <div className="bm-tabs-wrap">
                <ListTabs
                  label={tr('Roles')}
                  active={onlyLocked ? 'locked' : role}
                  onChange={(id) => {
                    if (id === 'locked') return;
                    setOnlyLocked(false);
                    setRole(id === role ? '' : id);
                  }}
                  tabs={[
                    { id: '', label: 'All roles', icon: 'collection', count: ofKind.length, className: 'role-filter' },
                    // check-shared-ignore: the role's own saved colour
                    ...kindRoles.map((r) => ({ id: r.id, label: r.name, title: r.description || r.name, className: 'role-filter', count: ofKind.filter((u) => u.roleId === r.id).length, leading: <span className="bm-dot" style={{ background: roleAccent(r) }} aria-hidden="true" /> })),
                    ...(onlyLocked ? [{ id: 'locked', label: 'Locked', icon: 'lock', count: shown.length, className: 'role-filter' }] : []),
                  ]}
                />
              </div>
              {onlyLocked ? <Button variant="ghost" size="sm" onClick={() => setOnlyLocked(false)}>{tr('Show everyone')}</Button> : null}
            </div>
          </div>
        ) : null}

        {kind !== 'staff' && unlinked && kindRoles.length ? (
          <p className="ha-hint-line"><Bi name="info-circle" /> {tr('A portal login that is not linked to a guest or company shows that person a "not set up" page. Open it and choose who it belongs to.')}</p>
        ) : null}

        {shown.length === 0 ? (
          <div className="card">
            <EmptyState icon="people" title={ofKind.length ? tr('No account matches') : kind === 'staff' ? tr('No staff accounts yet') : tr('No portal logins yet')} text={ofKind.length ? tr('Try a different name, username or email, or show every role.') : kind === 'staff' ? tr('Add the people who work here with Add staff member.') : tr('Portal logins are made with Add staff member and a guest or company portal role.')} />
          </div>
        ) : null}

        {groups.map(({ role: r, rows }) => (
          <section key={r.id} className="ha-day" aria-label={r.name}>
            <div className="ha-day-head">
              {/* check-shared-ignore: the role's own saved colour */}
              <h3><i className={`bi bi-${roleIcon(r)} me-2`} style={{ color: roleAccent(r) }} />{r.name}</h3>
              <span>{plural(rows.length, 'account')}</span>
            </div>
            {rows.map((u) => (
              <UserCard key={u.id} u={u} role={r} self={u.id === selfId} canManage={u.id !== selfId && rankOf(u) > actorRank} onManage={() => setManaging(u.id)} navigate={navigate} quick={quick} />
            ))}
          </section>
        ))}
      </div>

      {target ? (
        <ManageModal key={target.id} u={target} assignable={assignable} roles={roles} role={byId.get(target.roleId)} canManage={rankOf(target) > actorRank} onClose={() => setManaging(null)} onChanged={refresh} goToRoles={() => navigate('hotel.admin.roles')} />
      ) : null}
      <Dialog
        open={resetting !== null}
        title={tr('Email a new password?')}
        message={resetting ? trf('A new password goes to {0}. @{1} is signed out and chooses their own at the next sign-in.', [resetting.email, resetting.username]) : ''}
        confirmLabel={tr('Send it')}
        busy={quickBusy}
        onCancel={() => setResetting(null)}
        onConfirm={() => {
          const u = resetting;
          if (!u) return;
          setQuickBusy(true);
          void adminApi.emailNewPassword(u.id).then((r) => {
            setQuickBusy(false);
            setResetting(null);
            toast.show(r.ok ? { tone: 'success', text: trf('A new password was emailed to {0}.', [u.email]) } : { tone: 'error', text: errorText(r.error) });
          });
        }}
      />
      {creating ? (
        <CreateModal
          roles={assignable}
          taken={new Set(users.map((u) => u.username.toLowerCase()))}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
          goToRoles={() => navigate('hotel.admin.roles')}
        />
      ) : null}
    </Page>
  );
}

const STATUS: Record<AdminUser['status'], { tone: 'ok' | 'warn' | 'danger' | 'neutral'; label: string }> = {
  active: { tone: 'ok', label: 'Active' },
  locked: { tone: 'danger', label: 'Locked' },
  invited: { tone: 'warn', label: 'Invited' },
  inactive: { tone: 'neutral', label: 'Inactive' },
};

interface QuickActions {
  reset: (u: AdminUser) => void;
  toggle: (u: AdminUser) => void;
}

function UserCard({ u, role, self, canManage, onManage, navigate, quick }: { u: AdminUser; role: AdminRole; self: boolean; canManage: boolean; onManage: () => void; navigate: ScreenProps['navigate']; quick?: QuickActions }) {
  const accent = roleAccent(role);
  const st = STATUS[u.status] ?? STATUS.inactive;
  const attention = [
    u.status === 'locked' ? tr('Locked after too many failed attempts') : '',
    u.status === 'inactive' ? tr('Deactivated, so this account cannot sign in') : '',
    u.mustChangePassword ? tr('Must choose a new password at the next sign-in') : '',
    u.portal && !u.portal.linked ? tr('Not linked to a guest or company yet') : '',
  ].filter(Boolean);
  return (
    <DetailCard
      label={u.name}
      warn={attention.length > 0 && u.status !== 'inactive'}
      lead={
        <>
          <span className="avatar ua-avatar" style={avatarStyle(accent)}>{initials(u.name)}</span>
          {self ? <span className="you-tag">{tr('You')}</span> : null}
        </>
      }
      facts={[
        { label: tr('Name'), value: u.name, sub: `@${u.username}` },
        { label: tr('Role'), value: u.roleName, sub: u.portal ? (u.portal.linked ? u.portal.recordName : tr('Not linked')) : undefined, tone: u.portal && !u.portal.linked ? 'warn' : undefined },
        { label: tr('Status'), value: <StatusChip tone={st.tone}>{st.label}</StatusChip> },
        { label: tr('Email'), value: u.email, text: true },
      ]}
      amount={{ label: tr('Last sign-in'), value: u.lastLoginAt ? formatDate(u.lastLoginAt) : tr('Never'), sub: u.lastLoginAt ? formatTime(u.lastLoginAt) : undefined, tone: u.lastLoginAt ? undefined : 'muted' }}
      sections={[
        {
          icon: 'person-vcard',
          title: tr('Account'),
          content: (
            <DetailList
              items={[
                { label: tr('Username'), value: `@${u.username}` },
                { label: tr('Role'), value: u.roleName },
                { label: tr('Email'), value: u.email || '-' },
                { label: tr('Phone'), value: u.mobile || '-' },
                u.portal ? { label: u.portal.kind === 'guest' ? tr('Guest') : tr('Company'), value: u.portal.recordName || tr('Not linked') } : false,
                { label: tr('Created'), value: `${formatDate(u.createdAt)}${u.createdBy ? `, ${u.createdBy}` : ''}` },
              ]}
            />
          ),
        },
        {
          icon: 'shield-lock',
          title: tr('Sign-in'),
          content: (
            <DetailList
              items={[
                { label: tr('Last signed in'), value: u.lastLoginAt ? formatDateTime(u.lastLoginAt) : tr('Not yet') },
                { label: tr('Password changed'), value: u.passwordChangedAt ? formatDate(u.passwordChangedAt) : tr('Never') },
                { label: tr('Email code at sign-in'), value: u.emailedCode ? tr('On') : tr('Off') },
              ]}
            />
          ),
        },
        ...(attention.length ? [{ icon: 'exclamation-circle', title: tr('Needs attention'), tone: 'warn' as const, content: <ul className="ha-points">{attention.map((a) => <li key={a}>{a}</li>)}</ul> }] : []),
      ]}
      meta={trf('Added {0}', [formatDateTime(u.createdAt)])}
      actions={
        self ? (
          <Button variant="outline" size="sm" icon="person-circle" onClick={() => navigate('hotel.admin.profile')}>{tr('My profile')}</Button>
        ) : (
          <>
            <Button variant={canManage ? 'primary' : 'outline'} size="sm" icon={canManage ? 'sliders' : 'eye'} onClick={onManage}>{canManage ? tr('Manage') : tr('View')}</Button>
            {canManage && quick ? (
              <Dropdown align="end" button={(p) => <Button variant="ghost" size="sm" icon="three-dots" aria-label={trf('More for {0}', [u.name])} {...p} />}>
                {u.email ? <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); quick.reset(u); }}><Bi name="key" className="me-2" />{tr('Email a new password')}</a> : null}
                <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); quick.toggle(u); }}>
                  <Bi name={u.status === 'inactive' ? 'person-check' : 'person-slash'} className="me-2" />{u.status === 'inactive' ? tr('Switch login on') : tr('Switch login off')}
                </a>
              </Dropdown>
            ) : null}
          </>
        )
      }
    />
  );
}

type Tab = 'details' | 'password' | 'access' | 'permissions';
type Ask = null | 'password' | 'delete';
type Called<T> = Promise<{ ok: true; data: T } | { ok: false; error: Parameters<typeof errorText>[0] & { details?: { fields?: Record<string, string> } } }>;

function ManageModal({ u, roles, assignable, role, canManage, onClose, onChanged, goToRoles }: { u: AdminUser; roles: AdminRole[]; assignable: AdminRole[]; role: AdminRole | undefined; canManage: boolean; onClose: () => void; onChanged: () => void; goToRoles: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(canManage ? 'details' : 'access');
  const [live, setLive] = useState(u);
  const [linkOpen, setLinkOpen] = useState(false);
  const [draft, setDraft] = useState<UserDraft>(draftOf(u));
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const save = useSubmit(['name', 'username', 'email', 'mobile', 'roleId']);
  const liveRole = roles.find((r) => r.id === live.roleId) ?? role;

  /** Runs one change; the pop-up stays open on the updated person. */
  async function run<T>(call: () => Called<T>, ok: string, then?: (data: T) => void) {
    setBusy(true);
    const res = await call();
    setBusy(false);
    setAsk(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: ok });
      then?.(res.data);
      onChanged();
    } else toast.show({ tone: 'error', text: res.error.details?.fields?.form ?? errorText(res.error) });
  }
  const tabs = [
    ...(canManage
      ? [
          { id: 'details', label: 'Details', icon: 'person' },
          { id: 'password', label: 'Password', icon: 'key' },
        ]
      : []),
    { id: 'access', label: 'Access', icon: 'shield-lock' },
    { id: 'permissions', label: 'Permissions', icon: 'key' },
  ];

  return (
    <>
      <Modal
        open
        size="lg"
        centered={false}
        header={(id) => (
          <div className="d-flex align-items-center gap-3">
            {/* check-shared-ignore: avatar sized and coloured from the role */}
<div className="avatar" style={{ width: 44, height: 44, fontSize: 14, ...avatarStyle(roleAccent(liveRole)) }}>
              {initials(live.name)}
            </div>
            <div>
              <h5 className="modal-title mb-0" id={id}>
                {live.name}
              </h5>
              <div className="text-muted fs-sm">
                @{live.username} {tr("·")} {live.roleName}
              </div>
            </div>
          </div>
        )}
        onClose={onClose}
      >
        <SegTabs tabs={tabs} active={tab} onChange={(id) => setTab(id as Tab)} label={trf("{0} account", [live.name])} className="mb-3" />

        <div className="tab-content">
        {tab === 'details' ? (
          <div className="tab-pane fade show active">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save.submit(
                () => adminApi.updateUser(live.id, { ...draft, overrides: live.overrides }),
                (next) => {
                  toast.show({ tone: 'success', text: 'User updated.' });
                  setLive(next);
                  onChanged();
                },
              );
            }}
          >
            <UserFields value={draft} roles={assignable} errors={save.errors} onChange={setDraft} idPrefix={`u${live.id}_`} goToRoles={goToRoles} />
            <div className="d-flex justify-content-end mt-3">
              <Button type="submit" icon="check-lg" disabled={save.busy}>
                {save.busy ? tr("Saving…") : tr("Save changes")}
              </Button>
            </div>
          </form>
          </div>
        ) : null}

        {tab === 'password' ? (
          <div className="tab-pane fade show active">
            <p className="text-muted fs-md">
              {tr("Set a temporary password and share it with")} {live.name} {tr("privately. This also signs them out of other devices and clears any lock.")}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (live.email && !busy) setAsk('password');
              }}
            >
            <div className="row g-3">
              <div className="col-12">
                <div className="master-note">
                  <Bi name="envelope-check" />
                  <span>
                    {tr("A new password is generated and emailed to")} <strong>{live.email || tr("this person")}</strong>{tr(". Nobody else ever sees it, and @")}{live.username} {tr("has to replace it before they can reach anything.")}
                  </span>
                </div>
              </div>
            </div>
            <div className="d-flex justify-content-end align-items-center mt-3">
              <Button icon="key" disabled={!live.email || busy} onClick={() => setAsk('password')}>
                {tr("Reset and email password")}
              </Button>
            </div>
            {!live.email ? (
              <p className="text-muted mt-2 fs-sm">
                <Bi name="exclamation-circle" /> {tr("Add an email address on the Details tab first. That is where the password goes.")}
              </p>
            ) : null}
            </form>
          </div>
        ) : null}

        {tab === 'permissions' ? (
          <div className="tab-pane fade show active">
            <UserPermissions
              user={live}
              role={liveRole}
              canOverride={canManage}
              busy={busy}
              onOverrides={(overrides: PermissionOverride[]) => void run(() => adminApi.updateUser(live.id, { ...draftOf(live), overrides }), 'Permissions saved.', setLive)}
            />
          </div>
        ) : null}

        {tab === 'access' ? (
          <div className="tab-pane fade show active">
            <div className="kv-grid mb-3">
              <div>
                <span>{tr("Username")}</span>
                <strong>@{live.username}</strong>
              </div>
              <div>
                <span>{tr("Email")}</span>
                <strong>{live.email || '-'}</strong>
              </div>
              <div>
                <span>{tr("Phone")}</span>
                <strong>{live.mobile || '-'}</strong>
              </div>
              <div>
                <span>{tr("Role")}</span>
                <strong>{live.roleName}</strong>
              </div>
              <div>
                <span>{tr("Last sign-in")}</span>
                <strong>{live.lastLoginAt ? formatDateTime(live.lastLoginAt) : tr("Never")}</strong>
              </div>
              <div>
                <span>{tr("From")}</span>
                <strong>{live.lastLoginIp || '-'}</strong>
              </div>
              <div>
                <span>{tr("Password changed")}</span>
                <strong>{live.passwordChangedAt ? formatDate(live.passwordChangedAt) : '-'}</strong>
              </div>
              <div>
                <span>{tr("Created")}</span>
                <strong>
                  {formatDate(live.createdAt)}
                  {live.createdBy ? ` by ${live.createdBy}` : ''}
                </strong>
              </div>
            </div>

            {canManage ? (
              <>
                <div className="access-row">
                  <div>
                    <div className="fw-semibold">{live.status !== 'inactive' ? tr("Deactivate account") : tr("Activate account")}</div>
                    <div className="text-muted fs-sm">
                      {live.status !== 'inactive' ? tr("Blocks sign-in immediately and signs them out. Their records stay intact.") : tr("Allows this person to sign in again.")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`btn btn-sm ${live.status !== 'inactive' ? 'btn-outline-secondary' : 'btn-outline-p'}`}
                    disabled={busy}
                    onClick={() => void run(() => adminApi.toggleUser(live.id), live.status === 'inactive' ? 'User activated.' : 'User deactivated. They can no longer sign in.', setLive)}
                  >
                    {live.status !== 'inactive' ? tr("Deactivate") : tr("Activate")}
                  </button>
                </div>

                {live.status === 'locked' ? (
                  <div className="access-row">
                    <div>
                      <div className="fw-semibold">{tr("Unblock account")}</div>
                      <div className="text-muted fs-sm">
                        {tr("Locked after too many failed attempts.")}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => adminApi.unlockUser(live.id), 'Account unlocked. They can try signing in again.', setLive)}>
                      {tr("Unblock")}
                    </Button>
                  </div>
                ) : null}

                {live.portal ? (
                  <div className="access-row">
                    <div>
                      <div className="fw-semibold">{tr("Linked to")}</div>
                      <div className="text-muted fs-sm">
                        {live.portal.linked
                          ? `${live.portal.kind === 'company' ? 'Company' : 'Guest'}: ${live.portal.recordName ?? ''}. They see their own ${live.portal.kind === 'company' ? 'company bills and payments' : 'stay, bills and orders'} in the portal.`
                          : `Not linked. Until you link @${live.username} to a ${live.portal.kind === 'company' ? 'company' : 'guest'}, they only see 'Your account is not set up yet' in their portal.`}
                      </div>
                    </div>
                    <div className="d-flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => setLinkOpen(true)}>
                        {live.portal.linked ? tr("Change") : tr("Link")}
                      </Button>
                      {live.portal.linked ? (
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => adminApi.unlinkPortal(live.id), 'Unlinked. This person now sees the "not set up yet" page.', setLive)}>
                          {tr("Unlink")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="access-row">
                  <div>
                    <div className="fw-semibold">{tr("Email code at sign-in")}</div>
                    <div className="text-muted fs-sm">
                      {live.emailedCode ? `On. @${live.username} chose to also get an emailed 6-digit code after the password.` : `Off. The password is enough. Only @${live.username} can change this, in My Profile.`}
                    </div>
                  </div>
                </div>

                <div className="access-row danger-zone">
                  <div>
                    <div className="fw-semibold text-danger">{tr("Delete account")}</div>
                    <div className="text-muted fs-sm">
                      {tr("Permanently removes the account. It owns no records that would be lost.")}
                    </div>
                  </div>
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => setAsk('delete')}>
                    {tr("Delete")}
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-muted fs-sm">
                <Bi name="info-circle" /> {topRole(roles, live.roleId) ? tr("The SuperAdmin account can only change hands when the SuperAdmin transfers the role.") : tr("Only a higher role can manage this account.")}
              </div>
            )}
          </div>
        ) : null}
        </div>
      </Modal>

      {linkOpen ? (
        <PortalLinkModal
          user={live}
          onClose={() => setLinkOpen(false)}
          onDone={(next) => {
            setLive(next);
            setLinkOpen(false);
            toast.show({ tone: 'success', text: 'Linked. This person now sees their own portal.' });
          }}
        />
      ) : null}
      <Dialog open={ask === 'password'} title={tr("Email a new password?")} message={`@${live.username} is signed out and must set a new password the next time they sign in.`} confirmLabel="Send it" busy={busy} onCancel={() => setAsk(null)} onConfirm={() => void run(() => adminApi.emailNewPassword(live.id), `A new password was emailed to ${live.email}.`)} />
      <Dialog open={ask === 'delete'} tone="danger" title={trf("Delete {0}?", [live.username])} message="Their account is closed; entries they recorded are kept." confirmLabel="Delete" busy={busy} onCancel={() => setAsk(null)} onConfirm={() => void run(() => adminApi.deleteUser(live.id), 'Deleted.', onClose)} />
    </>
  );
}

const LAST_ROLE = 'hms.users.lastRole';
const readLastRole = (): string => {
  try {
    return localStorage.getItem(LAST_ROLE) ?? '';
  } catch {
    return '';
  }
};
const keepLastRole = (id: string): void => {
  try {
    localStorage.setItem(LAST_ROLE, id);
  } catch {
    // a blocked storage only forgets the choice
  }
};

function CreateModal({ roles, taken, onClose, onCreated, goToRoles }: { roles: AdminRole[]; taken: ReadonlySet<string>; onClose: () => void; onCreated: () => void; goToRoles: () => void }) {
  const toast = useToast();
  const remembered = readLastRole();
  const initial = roles.find((r) => r.id === remembered) ?? roles.find((r) => r.id === 'r-editor') ?? roles[0];
  const [draft, setDraft] = useState<UserDraft>({ ...blank, roleId: initial?.id ?? '' });
  const [typedUsername, setTypedUsername] = useState(false);
  const { busy, errors, submit } = useSubmit(['name', 'username', 'email', 'mobile', 'roleId']);
  const change = (next: UserDraft) => {
    if (next.username !== draft.username) {
      setTypedUsername(next.username.trim() !== '');
      setDraft(next);
      return;
    }
    setDraft(next.name !== draft.name && !typedUsername ? { ...next, username: freeUsername(usernameFrom(next.name), taken) } : next);
  };
  const wanted = draft.username.trim().toLowerCase();
  const isTaken = wanted !== '' && taken.has(wanted);
  const note = wanted === '' ? null : isTaken ? (
    <span className="text-danger">
      {trf('@{0} is taken.', [wanted])}{' '}
      <a href="#" onClick={(e) => { e.preventDefault(); setDraft({ ...draft, username: freeUsername(wanted, taken) }); }}>{trf('Use @{0}', [freeUsername(wanted, taken)])}</a>
    </span>
  ) : (
    <span className="text-success"><Bi name="check2" /> {trf('@{0} is free. They sign in with it.', [wanted])}</span>
  );
  const create = () =>
    void submit(
      () => adminApi.createUser({ ...draft, username: wanted, overrides: [] }),
      (made) => {
        keepLastRole(draft.roleId);
        toast.show({ tone: 'success', text: trf('{0} added. Their first password went to {1}.', [made.name, made.email]) });
        onCreated();
      },
    );
  return (
    <Modal
      open
      size="lg"
      className="pay-form-modal"
      staticBackdrop
      onClose={onClose}
      eyebrow={<>{tr('Staff accounts')}</>}
      title={tr('Add staff member')}
      onSubmit={create}
      footer={
        <>
          <span className="text-muted small me-auto">{tr('They choose their own password when they first sign in.')}</span>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tr('Cancel')}
          </Button>
          <Button type="submit" icon="person-plus" disabled={busy || isTaken}>
            {busy ? tr('Adding…') : tr('Add staff member')}
          </Button>
        </>
      }
    >
      <UserFields value={draft} roles={roles} errors={errors} onChange={change} idPrefix="new_" goToRoles={goToRoles} emailRequired usernameNote={note} />
    </Modal>
  );
}