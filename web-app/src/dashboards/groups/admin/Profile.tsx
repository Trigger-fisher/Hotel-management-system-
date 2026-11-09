'use client';

// My profile (every console): who you are, sign-in and security (password, emailed code, devices), your email addresses (read only), language and theme.
// Sign-in history is its own page (SignIns.tsx), opened from the links here.
import { useState } from 'react';
import { formatDateTime } from '@shared/dashboards/format';
import { roleLabel } from '@shared/auth/copy';
import { adminCopy, type AccountChange, type AdminProfile, type LiveDevice } from '@shared/dashboards/admin';
import { Bi, Button, FieldError, Modal, PwInput, PwRules, PwSuggest, SegTabs, passwordPasses } from '@/dashboards/pallav/ui';
import { errorText, useAsync, useSubmit, useToast } from '@/components/ui';
import { userMayOpen } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { adminApi, useAdminActor } from './api';
import { Ready } from './pallavParts';
import { Fld, initials } from '../payrollCore/pms';
import { deviceIcon } from './accessLook';
import { SignIns } from './SignIns';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { chooseTheme } from '@/dashboards/pallav/theme';
import { personalMailboxApi } from '../conversations/api';
import { Timeline } from '../platform/superParts';
import { ProfilePhotoEditor } from './ProfilePhotoEditor';

import { tr, trf } from '@/lib/i18n/language';

type UiTheme = 'light' | 'dark';

/** A company login is not a hotel role: it reads as "Company" (a read-only look, like a viewer) with its own one-line description. */
const COMPANY_ROLE = { label: 'Company', description: "Your company's login for the Company portal. It shows only your company's bills, payments and ledger." } as const;
/** The console kinds are not hotel roles: their chip says what the person is, in plain words. */
const CONSOLE_ROLES: Partial<Record<ScreenProps['user']['role'], string>> = { super_admin: roleLabel.super_admin, platform_admin: roleLabel.platform_admin, group_hotel_admin: roleLabel.group_hotel_admin };

export function Profile({ user }: ScreenProps) {
  useAdminActor(user);
  const company = user.role === 'corporate_user';
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState<{ ip: string } | null>(null);
  const profile = useAsync(() => adminApi.getProfile(), [version], { keep: true });
  // The role list is a hotel-admin page; a Group Hotel Admin is not allowed to read it (403), so only the description is skipped.
  // The role list only labels the person's role: a person without the Roles page (a Hotel User) must not ask for it (it answers 403).
  const hotelRoles = user.role !== 'group_hotel_admin' && userMayOpen('hotel.admin.roles');
  const roles = useAsync(async () => (hotelRoles ? adminApi.listRoles() : { ok: true as const, data: [] }), [hotelRoles]);
  const signIns = useAsync(() => adminApi.listSignIns({ pageSize: 1 }), [version], { keep: true });
  const devices = useAsync(() => adminApi.listDevices(), [version], { keep: true });
  const changes = useAsync(() => adminApi.listAccountChanges(), [version], { keep: true });
  const changed = () => setVersion((v) => v + 1);

  if (history) return <SignIns initialIp={history.ip} onBack={() => setHistory(null)} />;
  return (
    <Ready state={profile.state} onRetry={profile.reload}>
      {(p) => {
        const last = signIns.state.status === 'ready' ? signIns.state.data.page.items.find((x) => x.result === 'success') : undefined;
        const description = company ? COMPANY_ROLE.description : roles.state.status === 'ready' ? roles.state.data.find((r) => r.name === p.roleName)?.description : '';
        const consoleRole = CONSOLE_ROLES[user.role];
        return (
          <Body
            p={company ? { ...p, roleName: COMPANY_ROLE.label } : consoleRole ? { ...p, roleName: consoleRole } : p}
            userId={user.id}
            description={description ?? ''}
            lastSignIn={last ? { at: last.at, ip: last.ip } : null}
            devices={devices.state.status === 'ready' ? devices.state.data : []}
            changes={changes.state.status === 'ready' ? changes.state.data : []}
            onChanged={changed}
            openHistory={(ip) => setHistory({ ip })}
          />
        );
      }}
    </Ready>
  );
}

function Body({ p, userId, description, lastSignIn, devices, changes, onChanged, openHistory }: { p: AdminProfile; userId: string; description: string; lastSignIn: { at: string; ip: string } | null; devices: LiveDevice[]; changes: AccountChange[]; onChanged: () => void; openHistory: (ip: string) => void }) {
  const role = p.roleName === COMPANY_ROLE.label ? 'viewer' : p.roleName.toLowerCase().replace(/\s/g, '');
  const AP = adminCopy.profile;
  const [offOpen, setOffOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(p.mustChangePassword);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const current = devices.find((d) => d.current);
  const started = current ? formatDateTime(current.lastActiveAt) : tr('recently');
  const mailbox = useAsync(() => personalMailboxApi.getAddress(), []);
  const box = mailbox.state.status === 'ready' ? mailbox.state.data : null;
  const [theme, setThemeNow] = useState<UiTheme>(() => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));

  async function turnOn() {
    setBusy(true);
    const res = await adminApi.setMySignInCode(true);
    setBusy(false);
    if (!res.ok) {
      toast.show({ tone: 'error', text: errorText(res.error) });
      return;
    }
    toast.show({ tone: 'success', text: AP.codeOnToast });
    onChanged();
  }

  function pickTheme(next: UiTheme) {
    chooseTheme(userId, next);
    setThemeNow(next);
  }

  const shownDevices = devices.slice(0, 5);
  const rest = devices.slice(5);

  return (
    <>
      <div className="pay-head reveal">
        <div className="ph-text">
          <p className="pms-subtitle">{tr('Who you are, how you sign in, your email addresses, and how the app looks for you. Only you can change this page.')}</p>
        </div>
      </div>

      <div className={`pf-id role-${role} reveal mb-3`}>
        <ProfilePhotoEditor className={`pp-compact role-av-${role}`} name={p.name} initials={initials(p.name)} />
        <div className="pf-id-text">
          <h3 className="pms-title">{p.name}</h3>
          <div className="pf-id-meta">
            <span className="pf-handle">@{p.username}</span>
            <span className="role-pill">
              <Bi name={role === 'superadmin' ? 'shield-fill-check' : role === 'admin' || role === 'platformadmin' || role === 'grouphoteladmin' ? 'person-gear' : role === 'editor' ? 'pencil-square' : 'eye'} />
              {p.roleName}
            </span>
          </div>
          <p className="pf-id-desc">{description}</p>
        </div>
        <div className="pf-id-aside">
          <span className="pill pill-live">
            <span className="dot" /> {tr('Signed in')}
          </span>
          <span className="pf-aside-note">{lastSignIn ? trf('Last sign-in {0}', [formatDateTime(lastSignIn.at)]) : started}</span>
        </div>
      </div>

      {p.mustChangePassword ? (
        <div className="lock-banner unlocked mb-3">
          <Bi name="key-fill" />
          <span>{tr('Your password was set for you. Choose your own password to carry on.')}</span>
        </div>
      ) : null}

      <div className="pf-grid reveal">
        <div className="pf-col">
          <section className="card pf-card" aria-labelledby="pf-who">
            <div className="pf-card-head">
              <h3 id="pf-who">{tr('Who you are')}</h3>
            </div>
            <div className="pf-card-body">
              <DetailsForm p={p} onSaved={onChanged} />
            </div>
          </section>

          <section className="card pf-card" aria-labelledby="pf-mail">
            <div className="pf-card-head">
              <h3 id="pf-mail">{tr('Your email addresses')}</h3>
            </div>
            <div className="pf-card-body">
              {box?.address ? (
                <ul className="pf-addr">
                  <li><Bi name="envelope-check" /><span><b className="text-break">{box.address}</b><small>{tr('Your own mailbox: mail to it arrives in Email > My mailbox.')}</small></span></li>
                  {(box.extras ?? []).map((a) => (
                    <li key={a}><Bi name="envelope-plus" /><span><b className="text-break">{a}</b><small>{tr('Arrives in the same mailbox.')}</small></span></li>
                  ))}
                </ul>
              ) : box && box.message ? (
                <p className="ha-ms-why">{box.message}</p>
              ) : (
                <p className="ha-ms-why">{tr('This account has no mailbox of its own.')}</p>
              )}
              {box?.address ? <p className="ha-ms-why mt-2">{tr('These cannot be changed here. Extra addresses are given by the Super Admin.')}</p> : null}
            </div>
          </section>

          <section className="card pf-card" aria-labelledby="pf-look">
            <div className="pf-card-head">
              <h3 id="pf-look">{tr('Language and theme')}</h3>
            </div>
            <div className="pf-card-body pf-look">
              <div>
                <span className="pf-look-lab">{tr('Language')}</span>
                <LanguageSwitch variant="menu" bare />
              </div>
              <div>
                <span className="pf-look-lab">{tr('Theme')}</span>
                <SegTabs
                  tabs={[
                    { id: 'light', label: 'Day', icon: 'sun' },
                    { id: 'dark', label: 'Night', icon: 'moon-stars' },
                  ]}
                  active={theme}
                  onChange={(id) => pickTheme(id as UiTheme)}
                  label={tr('Theme')}
                />
              </div>
            </div>
          </section>
        </div>

        <div className="pf-col">
          <section className="card pf-card" aria-labelledby="pf-sec">
            <div className="pf-card-head">
              <h3 id="pf-sec">{tr('Sign-in and security')}</h3>
              <HistoryLink onClick={() => openHistory('')}>{tr('Sign-in history')}</HistoryLink>
            </div>
            <div className="pf-row">
              <span className="pf-row-icon">
                <Bi name="key" />
              </span>
              <div className="pf-row-text">
                <div className="pf-row-title">{tr('Password')}</div>
                <div className="pf-row-detail">{p.passwordChangedAt ? trf('Changed {0}', [formatDateTime(p.passwordChangedAt)]) : tr('Never changed on this account')}</div>
              </div>
              {!pwOpen ? (
                <span className="pf-row-end">
                  <Button size="sm" variant="outline" onClick={() => setPwOpen(true)}>{tr('Change password')}</Button>
                </span>
              ) : null}
            </div>
            {pwOpen ? (
              <div className="pf-card-body">
                <PasswordForm onChanged={() => { setPwOpen(false); onChanged(); }} />
              </div>
            ) : null}

            <div className="pf-row">
              <span className="pf-row-icon">
                <Bi name="envelope-check" />
              </span>
              <div className="pf-row-text">
                <div className="pf-row-title">{AP.codeSwitch}</div>
                <div className="pf-row-detail">
                  {p.emailedCode ? trf('On: a code is emailed to {0} at each sign-in.', [p.email]) : AP.codeSwitchHint}
                  {!p.email ? ` ${AP.codeNeedsEmail}` : ''}
                </div>
              </div>
              <span className="pf-row-end">
                <label className="form-check form-switch ha-switch mb-0">
                  <input
                    id="pf-code-switch"
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    aria-label={AP.codeSwitch}
                    checked={p.emailedCode}
                    disabled={busy || (!p.emailedCode && !p.email)}
                    onChange={() => (p.emailedCode ? setOffOpen(true) : void turnOn())}
                  />
                  <span>{p.emailedCode ? tr('On') : tr('Off')}</span>
                </label>
              </span>
            </div>

            <div className="pf-card-head pf-sub-head">
              <h3>
                {tr('Devices')} {devices.length ? <span className="dp-count">{devices.length}</span> : null}
              </h3>
            </div>
            <div className="pf-list">
              {shownDevices.length ? shownDevices.map((d) => <SessionRow key={d.id} d={d} onView={() => openHistory(d.ip)} />) : <div className="pf-empty">{tr('Nothing is holding a session for this account.')}</div>}
            </div>
            {rest.length ? (
              <details className="pf-more">
                <summary>
                  <span>{trf('Show the other {0}', [rest.length])}</span>
                  <Bi name="chevron-down" />
                </summary>
                {rest.map((d) => (
                  <SessionRow key={d.id} d={d} onView={() => openHistory(d.ip)} />
                ))}
              </details>
            ) : null}
            <p className="ha-ms-why pf-foot-note">{trf('One device at a time: signing in elsewhere ends this session (signed in {0}).', [started])}</p>
          </section>

          <section className="card pf-card" aria-labelledby="pf-changes">
            <div className="pf-card-head">
              <h3 id="pf-changes">{tr('What has changed')}</h3>
            </div>
            <div className="pf-card-body">
              {changes.length ? (
                <Timeline rows={changes.map((c) => ({ id: c.id, at: c.at, actorName: tr('you'), text: c.summary }))} />
              ) : (
                <div className="pf-empty">{tr('Nothing has been changed on this account yet.')}</div>
              )}
            </div>
          </section>
        </div>
      </div>

      {offOpen ? (
        <CodeOffModal
          onClose={() => setOffOpen(false)}
          onDone={() => {
            setOffOpen(false);
            toast.show({ tone: 'success', text: AP.codeOffToast });
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}
function HistoryLink({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <a
      className="pf-head-link"
      href="#"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {children} <Bi name="arrow-right-short" />
    </a>
  );
}

function SessionRow({ d, onView }: { d: LiveDevice; onView: () => void }) {
  return (
    <div className={`pf-session ${d.current ? 'is-current' : ''}`}>
      <span className="pf-session-icon">
        <Bi name={deviceIcon(d.device)} />
      </span>
      <div className="pf-session-text">
        <div className="pf-session-name">
          {d.device}
          {d.current ? <span className="you-tag">{tr("This device")}</span> : null}
        </div>
        <div className="pf-session-meta">
          <span>
            <Bi name="hdd-network" /> {d.ip || tr("No address")}
          </span>
          <span>
            <Bi name="geo-alt" /> {d.place}
          </span>
          <span>
            <Bi name="clock" /> {tr("Last active")} {formatDateTime(d.lastActiveAt)}
          </span>
        </div>
      </div>
      <div className="pf-session-end">
        <a
          className="btn btn-sm btn-outline-secondary"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onView();
          }}
        >
          <Bi name="clock-history" /> {tr("View")}
        </a>
      </div>
    </div>
  );
}

function DetailsForm({ p, onSaved }: { p: AdminProfile; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ name: p.name, username: p.username, mobile: p.mobile, email: p.email });
  const { busy, errors, submit } = useSubmit(['name', 'email', 'mobile', 'username']);
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(
          () => adminApi.updateProfile({ name: v.name, email: v.email, mobile: v.mobile, ...(p.canEditUsername ? { username: v.username } : {}) }),
          () => {
            toast.show({ tone: 'success', text: 'Profile saved.' });
            onSaved();
          },
        );
      }}
    >
      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="person-badge" /> {tr("Name")}
          </div>
          <div className="fs-hint">{tr("Your name is what other people see beside anything you record.")}</div>
        </div>
        <div className="row g-3">
          <Fld md={6} id="pf_name" label={tr("Full name")} required error={errors.name}>
            <input id="pf_name" className="form-control" value={v.name} maxLength={100} onChange={(e) => set('name', e.target.value)} />
          </Fld>
          <Fld md={6} id="pf_username" label={tr("Username")} hint={p.canEditUsername ? 'Letters, numbers, dots and underscores. This is what you sign in with.' : 'Ask an administrator to change your username.'} error={errors.username}>
            <div className="input-icon">
              <Bi name="at" />
              <input id="pf_username" className="form-control" value={p.canEditUsername ? v.username : p.username} disabled={!p.canEditUsername} minLength={3} maxLength={50} autoCapitalize="none" onChange={(e) => set('username', e.target.value)} />
            </div>
          </Fld>
        </div>
      </div>

      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="envelope" /> {tr("How we reach you")}
          </div>
          <div className="fs-hint">{tr("Both are needed. The phone number is how anyone here reaches you, and the email address is what lets you reset a forgotten password and switch the sign-in code on.")}</div>
        </div>
        <div className="row g-3">
          <Fld md={6} id="pf_phone" label={tr("Phone")} required error={errors.mobile}>
            <div className="input-icon">
              <Bi name="telephone" />
              <input id="pf_phone" className="form-control" value={v.mobile} maxLength={20} onChange={(e) => set('mobile', e.target.value)} />
            </div>
          </Fld>
          <Fld md={6} id="pf_email" label={tr("Email")} required error={errors.email}>
            <div className="input-icon">
              <Bi name="envelope" />
              <input type="email" id="pf_email" className="form-control" value={v.email} maxLength={254} onChange={(e) => set('email', e.target.value)} />
            </div>
          </Fld>
        </div>
      </div>

      <div className="pf-actions">
        <Button type="submit" icon="check-lg" disabled={busy}>
          {busy ? tr("Saving...") : tr("Save profile")}
        </Button>
      </div>
    </form>
  );
}

function PasswordForm({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ current: '', next: '', confirm: '' });
  const [tried, setTried] = useState(false);
  const { busy, errors, submit } = useSubmit(['current', 'next', 'confirm']);
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!passwordPasses(v.next) || v.next !== v.confirm) return;
        void submit(
          () => adminApi.changePassword(v),
          () => {
            toast.show({ tone: 'success', text: 'Password changed.' });
            setV({ current: '', next: '', confirm: '' });
            setTried(false);
            onChanged();
          },
        );
      }}
    >
      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="lock" /> {tr("Prove it is you")}
          </div>
        </div>
        <div className="row g-3">
          <Fld md={6} id="curPw" label={tr("Current password")} required error={errors.current}>
            <PwInput id="curPw" value={v.current} onChange={(x) => set('current', x)} autoComplete="current-password" invalid={Boolean(errors.current)} />
          </Fld>
        </div>
      </div>

      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="key" /> {tr("Choose the new one")}
          </div>
          <div className="fs-hint">{tr("Changing it signs you out on every other device.")}</div>
        </div>
        <div className="row g-3">
          <Fld md={6} id="newPw" label={tr("New password")} required error={errors.next}>
            <PwInput id="newPw" value={v.next} onChange={(x) => set('next', x)} autoComplete="new-password" invalid={Boolean(errors.next)} />
          </Fld>
          <Fld md={6} id="newPw2" label={tr("Confirm new password")} required error={errors.confirm}>
            <PwInput id="newPw2" value={v.confirm} onChange={(x) => set('confirm', x)} icon="lock-fill" autoComplete="new-password" matchWith={v.next} invalid={Boolean(errors.confirm)} />
          </Fld>
          <div className="col-12 pf-pw-rules">
            <PwRules value={v.next} checked={tried} />
            <PwSuggest onFill={(pw) => setV((s) => ({ ...s, next: pw, confirm: pw }))} />
          </div>
        </div>
      </div>

      <div className="pf-actions">
        <Button type="submit" icon="key" disabled={busy || !v.current || !v.next}>
          {busy ? tr("Updating...") : tr("Change password")}
        </Button>
      </div>
    </form>
  );
}

/** Turning the emailed code OFF: anyone with the password could then sign in, so the current password is asked first (a wrong one is refused on its field). */
function CodeOffModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const AP = adminCopy.profile;
  const [password, setPassword] = useState('');
  const { busy, errors, submit } = useSubmit(['password']);

  return (
    <Modal
      open
      size="md"
      className="pay-form-modal tf-modal"
      staticBackdrop
      scrollable={false}
      onClose={onClose}
      eyebrow="Security"
      title={AP.codeOffTitle}
      onSubmit={() => void submit(() => adminApi.setMySignInCode(false, password), onDone)}
      footer={
        <>
          <Button variant="ghost" icon="x-lg" onClick={onClose}>
            {tr("Not now")}
          </Button>
          <Button type="submit" variant="dangerSolid" icon="shield-x" disabled={busy}>
            {busy ? tr("Checking...") : AP.codeOffConfirm}
          </Button>
        </>
      }
    >
      <p className="tf-lead">{AP.codeOffText}</p>
      <label className="form-label" htmlFor="codeOffPw">
        {AP.codeOffPassword}
      </label>
      <PwInput id="codeOffPw" value={password} onChange={setPassword} autoComplete="current-password" invalid={Boolean(errors.password)} />
      {errors.password ? <FieldError>{errors.password}</FieldError> : null}
    </Modal>
  );
}
