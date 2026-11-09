'use client';

// The ONE Email page of every console (MJ, 5 Nov 2026): a switch at the top between the console's shared inbox (Hotel / Platform / Group inbox) and the person's own mailbox,
// showing only the boxes this person has (no switch when there is one). The last box chosen is remembered per person in this browser. The old addresses (My mailbox, the
// combined inbox) open this page on the right box.
import { useEffect, useState } from 'react';

import type { DashError } from '@shared/dashboards/common';
import { emailBoxCopy as bx, type PersonalAddressView } from '@shared/dashboards/conversations';
import { userMayOpen } from '@shared/dashboards/features';
import { emailBoxesOf } from '@shared/dashboards/mailboxAccess';

import { LoadError, SegTabs, Skeleton } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';

import { personalMailboxApi } from './api';
import { onceValue, readOnce } from './convCache';
import { GmailPage } from './GmailPage';
import { AddressLine } from './MyMailbox';

type Home = 'hotel' | 'platform' | 'group';
type Box = 'shared' | 'mine';

const memoKey = (home: Home, userId: string) => `hms.emailBox.${home}.${userId}`;
function remembered(home: Home, userId: string): Box | null {
  try {
    const v = window.localStorage.getItem(memoKey(home, userId));
    return v === 'shared' || v === 'mine' ? v : null;
  } catch {
    return null;
  }
}
function remember(home: Home, userId: string, box: Box): void {
  try {
    window.localStorage.setItem(memoKey(home, userId), box);
  } catch {
    // a private window: the choice is simply not kept
  }
}

/** Which boxes this person has in this console: the Super Admin only their own mailbox. */
const boxesOf = (home: Home, role: string): Box[] => emailBoxesOf(home, role, home === 'hotel' && userMayOpen('hotel.conversations'));

export function EmailPage({ home, forceBox, ...props }: ScreenProps & { home: Home; forceBox?: Box }) {
  const { user, params, navigate } = props;
  const boxes = boxesOf(home, user.role);
  const asked = forceBox ?? (params.box === 'shared' || params.box === 'mine' ? params.box : null);
  const [stored] = useState<Box | null>(() => (typeof window === 'undefined' ? null : remembered(home, user.id)));
  const box: Box | null = [asked, stored, boxes[0] ?? null].find((b): b is Box => b !== null && boxes.includes(b)) ?? null;

  // an old link to the platform inbox's settings opens the Set-up centre for the Super Admin (the inbox has no settings any more)
  const toSetup = home === 'platform' && params.tab === 'settings' && user.role === 'super_admin';
  useEffect(() => {
    if (toSetup) navigate('platform.setup', { step: 'mail' });
  }, [toSetup, navigate]);

  if (!box) return null;
  const pick = (id: string) => {
    const next: Box = id === 'mine' ? 'mine' : 'shared';
    remember(home, user.id, next);
    navigate(`${home}.email`, { box: next });
  };
  return (
    <>
      {boxes.length > 1 ? (
        <SegTabs
          className="mb-2"
          label={bx.label}
          active={box}
          onChange={pick}
          tabs={[
            { id: 'shared', label: bx.shared[home], icon: 'inbox' },
            { id: 'mine', label: bx.mine, icon: 'person' },
          ]}
        />
      ) : null}
      {box === 'mine' ? <MineBox {...props} home={home} /> : <GmailPage {...props} scope={home} />}
    </>
  );
}

/** The person's own mailbox: the address line (with Copy), then the mailbox. */
function MineBox({ home, ...props }: ScreenProps & { home: Home }) {
  const [attempt, setAttempt] = useState(0);
  // the address is read once per tab (convCache.ts): coming back to this box shows it at once
  const [loaded, setLoaded] = useState<{ attempt: number; view: PersonalAddressView | null; error: DashError | null } | null>(() => {
    const view = onceValue<PersonalAddressView>(personalMailboxApi, 'address');
    return view ? { attempt: 0, view, error: null } : null;
  });
  useEffect(() => {
    let live = true;
    void readOnce(personalMailboxApi, 'address', () => personalMailboxApi.getAddress()).then((r) => live && setLoaded({ attempt, view: r.ok ? r.data : null, error: r.ok ? null : r.error }));
    return () => {
      live = false;
    };
  }, [attempt]);
  if (!loaded || loaded.attempt !== attempt) return <Skeleton rows={3} />;
  if (loaded.error || !loaded.view) return <LoadError error={loaded.error ?? { code: 'SERVER_ERROR', message: 'SERVER_ERROR', traceId: 'client' }} onRetry={() => setAttempt((n) => n + 1)} />;
  const v = loaded.view;
  const own = v.usable && v.address ? [v.address, ...(v.extras ?? []).filter((a) => a !== v.address)] : [];
  return (
    <>
      <AddressLine view={v} />
      <GmailPage {...props} scope="personal" home={home} own={own} />
    </>
  );
}

export const HotelEmail = (p: ScreenProps) => <EmailPage {...p} home="hotel" />;
export const PlatformEmail = (p: ScreenProps) => <EmailPage {...p} home="platform" />;
export const GroupEmail = (p: ScreenProps) => <EmailPage {...p} home="group" />;
/** Old addresses: My mailbox opens Email on the person's own box; the combined inbox opens it on the shared one. */
export const HotelMyMailbox = (p: ScreenProps) => <EmailPage {...p} home="hotel" forceBox="mine" />;
export const PlatformMyMailbox = (p: ScreenProps) => <EmailPage {...p} home="platform" forceBox="mine" />;
export const GroupMyMailbox = (p: ScreenProps) => <EmailPage {...p} home="group" forceBox="mine" />;
export const HotelInboxAlias = (p: ScreenProps) => <EmailPage {...p} home="hotel" forceBox="shared" />;
export const PlatformInboxAlias = (p: ScreenProps) => <EmailPage {...p} home="platform" forceBox="shared" />;
