'use client';

// Pieces shared by the Platform Dashboard, Hotels list and Hotel details (A2): the lifecycle pill, the Individual / Group pill, the
// per-hotel facts the hotel list does not carry (last activity, Hotel Admin email, user count) and the audited "Enter hotel" window.
// Pallav's own classes only (pay-pill tones, modal, form-control); every word comes from platformCopy.
import { useState } from 'react';
import type { DashError, DashResult } from '@shared/dashboards/common';
import { PLATFORM_MOCK_TODAY, platformCopy, type PlatformHotelKind, type PlatformHotelStatus } from '@shared/dashboards/platform';
import { errorText, useToast } from '@/components/ui';
import { Alert, Bi, Button, Field, FieldHint, Modal } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { platformApi } from './api';
import { asActor, enterHotelAudited } from './enter';

const L = platformCopy.hotelConsole;

/** A hotel's status, or an invitation still on its way (invited = link sent, onboarding = link opened). */
export type Lifecycle = PlatformHotelStatus | 'invited' | 'onboarding';

const PILL: Record<Lifecycle, [string, string]> = {
  invited: ['pay-processing', 'envelope'],
  onboarding: ['pay-partial', 'pencil-square'],
  pending_approval: ['pay-pending', 'hourglass-split'],
  active: ['pay-paid', 'check-circle'],
  suspended: ['pay-failed', 'pause-circle'],
  rejected: ['pay-hold', 'x-circle'],
  archived: ['pay-hold', 'archive'],
};

export function LifecyclePill({ status }: { status: Lifecycle }) {
  const [cls, icon] = PILL[status];
  return (
    <span className={`pay-pill ${cls}`}>
      <Bi name={icon} />
      {L.lifecycle[status]}
    </span>
  );
}

export function KindPill({ kind }: { kind: PlatformHotelKind }) {
  return (
    <span className={`pay-pill pay-kind ${kind === 'group' ? 'is-group' : 'pay-hold'}`}>
      <Bi name={kind === 'group' ? 'diagram-3' : 'building'} />
      {L.kind[kind]}
    </span>
  );
}

// ---------------------------------------------------------------- facts per hotel

export interface HotelFacts {
  /** Newest of: a platform action on the hotel, a sign-in of one of its users. null = nothing yet. */
  lastActivityAt: string | null;
  /** The first Hotel Admin's email (an enabled one first), or null. */
  adminEmail: string | null;
  /** Accounts of the hotel (Hotel Admins and Hotel Users, any status). */
  userCount: number;
  /** Has any Hotel Admin of it ever signed in? */
  adminSignedIn: boolean;
}

/** Every row of a paged list, 100 a page (the server's largest page), at most 50 pages. */
async function allPages<T>(load: (page: number) => Promise<DashResult<{ items: T[]; total: number }>>): Promise<DashResult<{ items: T[] }>> {
  const items: T[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const r = await load(page);
    if (!r.ok) return r;
    items.push(...r.data.items);
    if (items.length >= r.data.total || r.data.items.length === 0) break;
  }
  return { ok: true, data: { items } };
}

/** The accounts the facts are counted from: every Hotel Admin / Hotel User row, reduced to what the facts need. */
interface FactAccount {
  hotelId: string | null;
  level: 'hotel_admin' | 'hotel_user' | string;
  status: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
}

/**
 * GET /platform/users is Super Admin only. A Platform Admin gets 403 there, so the accounts come from the Hotel Admins list instead
 * (email, status, last sign-in); the user count is then the number of Hotel Admin accounts (Hotel Users are not visible to a Platform Admin).
 */
async function loadFactAccounts(): Promise<DashResult<{ items: FactAccount[] }>> {
  const users = await allPages<FactAccount>((page) => platformApi.listUsers({ page, pageSize: 100 }));
  if (users.ok || users.error.code !== 'FORBIDDEN') return users;
  return allPages<FactAccount>(async (page) => {
    const r = await platformApi.listHotelAdmins({ page, pageSize: 100, status: 'all', includeArchived: true });
    return r.ok ? { ok: true, data: { items: r.data.items.map((a) => ({ hotelId: a.hotelId, level: 'hotel_admin', status: a.status, email: a.email, createdAt: a.createdAt, lastSignInAt: a.lastSignInAt })), total: r.data.total } } : r;
  });
}

/** The hotel list carries none of these yet, so they are put together from the activity log and the accounts list. */
export async function loadHotelFacts(): Promise<DashResult<Record<string, HotelFacts>>> {
  const [act, users] = await Promise.all([allPages((page) => platformApi.listActivity({ page, pageSize: 100 })), loadFactAccounts()]);
  if (!act.ok) return act;
  if (!users.ok) return users;
  const out: Record<string, HotelFacts> = {};
  const of = (id: string) => (out[id] ??= { lastActivityAt: null, adminEmail: null, userCount: 0, adminSignedIn: false });
  const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
  for (const x of act.data.items) if (x.hotelId) of(x.hotelId).lastActivityAt = later(of(x.hotelId).lastActivityAt, x.at);
  const admins = users.data.items.filter((u) => u.hotelId && u.level === 'hotel_admin').sort((a, b) => (a.status === 'disabled' ? 1 : 0) - (b.status === 'disabled' ? 1 : 0) || a.createdAt.localeCompare(b.createdAt));
  for (const u of users.data.items) {
    if (!u.hotelId || (u.level !== 'hotel_admin' && u.level !== 'hotel_user')) continue;
    const f = of(u.hotelId);
    f.userCount += 1;
    f.lastActivityAt = later(f.lastActivityAt, u.lastSignInAt);
    if (u.level === 'hotel_admin' && u.lastSignInAt) f.adminSignedIn = true;
  }
  for (const a of admins) if (a.hotelId && !of(a.hotelId).adminEmail) of(a.hotelId).adminEmail = a.email;
  return { ok: true, data: out };
}

/** No sign-in and no platform action for this many days = inactive (dashboard tile). */
const INACTIVE_DAYS = 30;

/** The mock's today (fixed, so the seed's dates line up); the server will answer with its own clock. */
export function isInactive(facts: HotelFacts | undefined, createdAt: string): boolean {
  const last = facts?.lastActivityAt ?? createdAt;
  const today = Date.parse(`${PLATFORM_MOCK_TODAY}T23:59:59.000Z`);
  return today - Date.parse(last) > INACTIVE_DAYS * 86_400_000;
}

// ---------------------------------------------------------------- Enter hotel (audited, with a reason)

const MIN_REASON = 5;

/**
 * Research MUST 4: a written reason, read-only, 60 minutes, every action logged. The reason goes into the audit entry
 * (platformApi.enterHotel), then the shell opens the hotel (enterHotelAudited). The banner and the 60-minute end are the shell's (A4).
 */
export function EnterHotelModal({ props, hotel, onClose }: { props: ScreenProps; hotel: { id: string; name: string }; onClose: () => void }) {
  const C = L.enter;
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
    asActor(props.user);
    let failed: DashError | null = null;
    const done = await enterHotelAudited(props, hotel.id, why, (e) => {
      failed = e;
    });
    setBusy(false);
    if (done) {
      onClose();
      return;
    }
    const e = failed as DashError | null;
    if (e?.code === 'VALIDATION_FAILED' && e.details?.fields?.reason) setError(e.details.fields.reason);
    else toast.show({ tone: 'error', text: e ? errorText(e) : C.notActive });
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
            {C.cancel}
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
            placeholder={C.reasonPlaceholder}
            value={reason}
            disabled={busy}
            aria-label={C.reason}
            aria-required="true"
            aria-invalid={error ? true : undefined}
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
