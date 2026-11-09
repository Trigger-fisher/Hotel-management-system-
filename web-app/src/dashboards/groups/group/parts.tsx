'use client';

// Pieces shared by the Group console screens: the Hotel Admin card and its confirmed actions, the invite gate (primary admin, group limit)
// and the "Look inside" window (a written reason, then a read-only visit of 60 minutes).
import { useState } from 'react';

import type { DashError } from '@shared/dashboards/common';
import { formatDateTime } from '@shared/dashboards/format';
import { groupConsoleCopy, type GroupConsoleApi } from '@shared/dashboards/groupConsole';
import { groupCopy } from '@shared/dashboards/groupCopy';
import { platformCopy, type PlatformAdminStatus, type PlatformHotelAdmin } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { errorText, useAction, useToast } from '@/components/ui';
import { Alert, Bi, Button, DetailCard, DetailList, Dialog, Dropdown, Field, FieldHint, Modal } from '@/dashboards/pallav/ui';
import { useLoaded } from '../payrollCore/load';
import { WrapEmail, When } from '../platform/superParts';
import { groupApiFor } from './api';

export type AdminAsk = { kind: 'reset' | 'unlock' | 'disable' | 'enable'; admin: PlatformHotelAdmin };

const PC = platformCopy.hotel;
const PA = platformCopy.hotelConsole.details.admin;
const PS = platformCopy.status.admin;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export function AdminPill({ status }: { status: PlatformAdminStatus }) {
  const [cls, icon] = status === 'locked' ? ['pay-failed', 'lock-fill'] : status === 'active' ? ['pay-paid', 'check-circle'] : status === 'pending' ? ['pay-pending', 'hourglass-split'] : ['pay-hold', 'slash-circle'];
  return (
    <span className={`pay-pill ${cls}`}>
      <Bi name={icon} />
      {PS[status]}
    </span>
  );
}

/** One Hotel Admin: who, which hotel, status and last sign-in; opened, the account. Unlock or Enable is the main button; Disable sits in More. */
export function AdminCard({ admin: a, busy, onAsk, showHotel = false }: { admin: PlatformHotelAdmin; busy: boolean; onAsk?: (x: AdminAsk) => void; showHotel?: boolean }) {
  const ask = (kind: AdminAsk['kind']) => () => onAsk?.({ kind, admin: a });
  const lastSignIn = a.lastSignInAt ? formatDateTime(a.lastSignInAt) : groupCopy.admins.neverSignedIn;
  return (
    <DetailCard
      label={`${groupCopy.admins.columns.name} ${a.name}`}
      className="pf-admin gc-card"
      warn={a.status === 'locked'}
      lead={
        <>
          <span className="pf-kind pf-initials" aria-hidden="true">
            {initials(a.name)}
          </span>
          <AdminPill status={a.status} />
        </>
      }
      facts={[
        { label: groupCopy.admins.columns.name, value: a.name, sub: showHotel ? a.hotelName : a.groupAdminOf ? PC.groupAdminOf(a.groupAdminOf.groupName) : a.username },
        { label: PA.email, value: <WrapEmail email={a.email} />, title: a.email },
        {
          label: PA.status,
          value: PS[a.status],
          tone: a.status === 'locked' ? ('warn' as const) : a.status === 'disabled' ? ('muted' as const) : undefined,
          sub: a.status === 'locked' && a.lockedAt ? PC.lockedSince(formatDateTime(a.lockedAt)) : undefined,
        },
        { label: PA.lastSignIn, value: a.lastSignInAt ? <When iso={a.lastSignInAt} /> : groupCopy.admins.neverSignedIn, tone: a.lastSignInAt ? undefined : ('muted' as const) },
      ]}
      sections={[
        {
          icon: 'person-badge',
          title: PA.account,
          wide: true,
          content: (
            <DetailList
              items={[
                { label: PA.username, value: a.username },
                { label: groupCopy.admins.columns.hotel, value: a.hotelName },
                a.groupAdminOf ? { label: groupCopy.detail.group, value: PC.groupAdminOf(a.groupAdminOf.groupName) } : null,
                { label: PA.email, value: <WrapEmail email={a.email} /> },
                { label: PA.mobile, value: a.mobile },
                { label: PA.lastSignIn, value: lastSignIn },
              ]}
            />
          ),
        },
      ]}
      actions={
        a.status === 'pending' || !onAsk ? undefined : (
          <>
            {a.status === 'locked' ? (
              <Button size="sm" icon="unlock" title={PC.rowAction(PC.unlock, a.name)} disabled={busy} onClick={ask('unlock')}>
                {PC.unlock}
              </Button>
            ) : null}
            {a.status === 'disabled' ? (
              <Button size="sm" icon="check-circle" title={PC.rowAction(PC.enable, a.name)} disabled={busy} onClick={ask('enable')}>
                {PC.enable}
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" icon="key" title={PC.rowAction(PC.resetPassword, a.name)} disabled={busy} onClick={ask('reset')}>
                  {PC.resetPassword}
                </Button>
                <Dropdown
                  align="end"
                  button={(p) => (
                    <Button variant="outline" size="sm" icon="three-dots" title={groupCopy.detail.moreLabel(a.name)} disabled={busy} {...p}>
                      {groupCopy.detail.more}
                    </Button>
                  )}
                >
                  <a
                    href="#"
                    className="dropdown-item text-danger"
                    onClick={(e) => {
                      e.preventDefault();
                      onAsk({ kind: 'disable', admin: a });
                    }}
                  >
                    <Bi name="slash-circle" /> {PC.disable}
                  </a>
                </Dropdown>
              </>
            )}
          </>
        )
      }
    />
  );
}

/** Reset password, Unlock, Disable, Enable: the ask, its confirm window and the call. A password is never shown; the new one is emailed. */
export function useAdminAsk(api: GroupConsoleApi, onDone: () => void) {
  const { busy, run } = useAction();
  const [ask, setAsk] = useState<AdminAsk | null>(null);
  const confirm = (x: AdminAsk) => {
    const done = { onOk: onDone };
    const name = x.admin.name;
    const call =
      x.kind === 'reset'
        ? run(() => api.resetAdminPassword(x.admin.id), { ...done, success: (r) => PC.resetDone(r.message, platformCopy.newHotel.devLogNote) })
        : x.kind === 'unlock'
          ? run(() => api.unlockAdmin(x.admin.id), { ...done, success: PC.unlocked(name) })
          : x.kind === 'disable'
            ? run(() => api.disableAdmin(x.admin.id), { ...done, success: PC.disabled(name) })
            : run(() => api.enableAdmin(x.admin.id), { ...done, success: PC.enabled(name) });
    void call.then(() => setAsk(null));
  };
  const dialog = (
    <Dialog
      open={ask !== null}
      tone={ask?.kind === 'disable' ? 'danger' : ask?.kind === 'reset' ? 'warning' : 'primary'}
      icon={ask ? { reset: 'key', unlock: 'unlock', disable: 'slash-circle', enable: 'check-circle' }[ask.kind] : undefined}
      title={ask ? { reset: PC.resetTitle, unlock: PC.unlockTitle, disable: PC.disableTitle, enable: PC.enableTitle }[ask.kind](ask.admin.name) : ''}
      message={ask ? { reset: PC.resetBody, unlock: PC.unlockBody, disable: PC.disableBody, enable: PC.enableBody }[ask.kind] : undefined}
      confirmLabel={ask ? { reset: PC.resetConfirm, unlock: PC.unlock, disable: PC.disable, enable: PC.enable }[ask.kind] : undefined}
      cancelLabel={PC.cancel}
      busy={busy}
      onCancel={() => setAsk(null)}
      onConfirm={() => ask && confirm(ask)}
    />
  );
  return { busy, setAsk, dialog };
}

/** Whether this admin may invite a hotel now: only the primary admin, and only under the group's limit (the server checks both). */
export function useInviteGate(api: GroupConsoleApi, version: unknown = 0) {
  const o = useLoaded(() => api.groupOverview(), [api, version]);
  const counted = o.data?.tiles.hotelsCounted ?? null;
  const max = o.data?.group.maxHotels ?? null;
  const atLimit = counted !== null && max !== null && counted >= max;
  return {
    canInvite: o.data?.group.isPrimaryAdmin !== false,
    atLimit,
    limitNote: atLimit && max !== null ? groupConsoleCopy.groupHotel.atLimit(max) : undefined,
    countLine: counted !== null ? groupConsoleCopy.groupHotel.count(counted, max, o.data?.tiles.invitationsOpen ?? 0) : null,
    groupName: o.data?.group.name ?? null,
  };
}

const C = groupCopy.enter;
const D = groupCopy.detail;
const MIN_REASON = 5;

/** Asks for the reason, tells the server (audited), then lets the shell open the hotel read only until the server's end time. */
export function GroupEnterModal({ props, hotel, onClose }: { props: ScreenProps; hotel: { id: string; name: string }; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const why = reason.trim();
    if (why.length < MIN_REASON) {
      setError(C.reasonShort);
      return;
    }
    setBusy(true);
    const r = await groupApiFor(props.user).enterMemberHotel(hotel.id, why);
    setBusy(false);
    if (r.ok) {
      props.enterHotel(hotel.id, why, r.data.expiresAt, r.data.access);
      onClose();
      return;
    }
    const e: DashError = r.error;
    if (e.code === 'VALIDATION_FAILED' && e.details?.fields?.reason) setError(e.details.fields.reason);
    else toast.show({ tone: 'error', text: errorText(e) });
  };
  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={C.title(hotel.name)}
      staticBackdrop
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {D.cancel}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" /> : <Bi name="box-arrow-in-right" />} {C.confirm}
          </Button>
        </>
      }
    >
      <Alert tone="info" icon="shield-lock" role="note">
        {C.body}
      </Alert>
      <div className="row g-3">
        <Field label={C.reason} required error={error}>
          <textarea
            className={`form-control${error ? ' is-invalid' : ''}`}
            rows={3}
            maxLength={500}
            value={reason}
            disabled={busy}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError('');
            }}
          />
          <FieldHint>{C.reasonHint}</FieldHint>
        </Field>
      </div>
    </Modal>
  );
}
