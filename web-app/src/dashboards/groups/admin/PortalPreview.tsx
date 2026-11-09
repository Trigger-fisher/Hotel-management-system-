'use client';

// Guest portal and Company portal (hotel.admin.guestPortal, hotel.admin.companyPortal): the set-up as a short checklist, then (demo build) the portal's own
// pages on sample data with the Preview pill.
import { useEffect, useState, type ComponentType } from 'react';
import { guestCopy } from '@shared/dashboards/guest';
import type { GuestStage } from '@shared/dashboards/guestStage';
import { apiMode } from '@/lib/api/mode';
import { Bi, Button, SegTabs } from '@/dashboards/pallav/ui';
import { useAsync } from '@/components/ui';
import { adminApi } from './api';
import type { ScreenMap, ScreenProps } from '../../types';
import { asDemoGuest, guestScenario, setGuestScenario } from '../guest/api';

import { tr, trf } from '@/lib/i18n/language';
interface Section { title: string; items: [id: string, icon: string, label: string][] }

// The guest portal's own menu order and names (decision 71, ui-shared nav.ts): Home, Room service, Bills, Payments, Account. The preview keeps the hotel shell's
// look (the guest look, its fixed bars and sheets are scoped to body.hms-guest, which the hotel shell never sets).
const GUEST: Section[] = [
  { title: 'Your stay', items: [['guest.home', 'house', guestCopy.nav.home], ['guest.order', 'cup-hot', guestCopy.nav.order]] },
  { title: 'Money', items: [['guest.bills', 'receipt', guestCopy.nav.bills], ['guest.history', 'wallet2', guestCopy.nav.payments]] },
  { title: 'Account', items: [['guest.profile', 'person-circle', guestCopy.nav.account]] },
];

/** Decision 71: the guest's stages, to see each version of the portal on the demo guest's sample data (mock only). */
const STAGES: { id: GuestStage; label: string }[] = [
  { id: 'arriving', label: 'Arriving' },
  { id: 'staying', label: 'In stay' },
  { id: 'checkoutDay', label: 'Check-out day' },
  { id: 'checkedOut', label: 'Checked out' },
  { id: 'none', label: 'No stay' },
];
const COMPANY: Section[] = [
  { title: 'Overview', items: [['corporate.dashboard', 'grid-1x2', 'Dashboard']] },
  { title: 'Accounts', items: [['corporate.bills', 'receipt', 'Due bills'], ['corporate.payments', 'wallet2', 'Payment history'], ['corporate.ledger', 'journal-text', 'Ledger']] },
  { title: 'Company', items: [['corporate.profile', 'building', 'Company profile']] },
];

type StepState = 'done' | 'todo' | 'warn';
interface SetupStep { id: string; title: string; state: StepState; status: string; action?: { label: string; run: () => void } }

/** Rule 6: the portal's set-up as a short checklist with a plain status and one next-step button per step. */
function PortalSetup({ kind, navigate, onPreview }: { kind: 'guest' | 'company'; navigate: ScreenProps['navigate']; onPreview?: () => void }) {
  const users = useAsync(() => adminApi.listUsers({ pageSize: 200 }), []);
  const noun = kind === 'guest' ? tr('guest') : tr('company');
  if (users.state.status !== 'ready') return null;
  const accounts = users.state.data.page.items.filter((u) => u.portal?.kind === kind);
  const unlinked = accounts.filter((u) => !u.portal?.linked);
  const openUsers = { label: tr('Open user accounts'), run: () => navigate('hotel.admin.users') };
  const steps: SetupStep[] = [
    {
      id: 'accounts',
      title: kind === 'guest' ? tr('Give guests a sign-in') : tr('Give companies a sign-in'),
      state: accounts.length ? 'done' : 'todo',
      status: accounts.length ? trf(accounts.length === 1 ? '{0} {1} sign-in' : '{0} {1} sign-ins', [accounts.length, noun]) : trf('No {0} has a sign-in yet. Create one from the {0} record or User accounts.', [noun]),
      action: accounts.length ? undefined : openUsers,
    },
    {
      id: 'linked',
      title: kind === 'guest' ? tr('Link each sign-in to its guest') : tr('Link each sign-in to its company'),
      state: !accounts.length ? 'todo' : unlinked.length ? 'warn' : 'done',
      status: !accounts.length ? tr('After the first sign-in.') : unlinked.length ? trf('{0} not linked: they see "Your account is not set up yet".', [unlinked.length]) : tr('Every sign-in is linked.'),
      action: unlinked.length ? { label: tr('Link them'), run: () => navigate('hotel.admin.users') } : undefined,
    },
    {
      id: 'preview',
      title: tr('See what they see'),
      state: 'done',
      status: onPreview ? tr('The pages below run on sample data.') : tr('Sign in with a portal account of this hotel to see it.'),
      action: onPreview ? { label: tr('Show the preview'), run: onPreview } : undefined,
    },
  ];
  const left = steps.filter((s) => s.state !== 'done').length;
  return (
    <section className="card ha-card pl-setup" aria-label={kind === 'guest' ? tr('Guest portal set-up') : tr('Company portal set-up')}>
      <h3 className="ha-card-h">
        {kind === 'guest' ? tr('Guest portal set-up') : tr('Company portal set-up')}
        <small>{left ? trf('{0} of {1} steps left', [left, steps.length]) : tr('Ready')}</small>
      </h3>
      <ol className="pl-steps">
        {steps.map((s, i) => (
          <li key={s.id} className={`is-${s.state}`}>
            <span className="pl-step-mark" aria-hidden="true">{s.state === 'done' ? <Bi name="check-lg" /> : s.state === 'warn' ? <Bi name="exclamation" /> : i + 1}</span>
            <span className="pl-step-text">
              <b>{s.title}</b>
              <small>{s.status}</small>
            </span>
            {s.action ? <Button size="sm" variant={s.state === 'done' ? 'outline' : undefined} onClick={s.action.run}>{s.action.label}</Button> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Preview({ kind, props }: { kind: 'guest' | 'company'; props: ScreenProps }) {
  if (apiMode() === 'real') {
    return <PortalSetup kind={kind} navigate={props.navigate} />;
  }
  return (
    <div className="ha-stack">
      <PortalSetup kind={kind} navigate={props.navigate} onPreview={() => document.getElementById('pl-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
      <div id="pl-preview">
        <PreviewScreens kind={kind} props={props} />
      </div>
    </div>
  );
}
function PreviewScreens({ kind, props }: { kind: 'guest' | 'company'; props: ScreenProps }) {
  const sections = kind === 'guest' ? GUEST : COMPANY;
  const tabs = sections.flatMap((s) => s.items.map(([id, icon, label]) => ({ id, icon, label })));
  const [view, setView] = useState(tabs[0]?.id ?? '');
  const [params, setParams] = useState<ScreenProps['params']>({});
  const [map, setMap] = useState<ScreenMap | null>(null);
  const [stage, setStage] = useState<GuestStage>(() => guestScenario());

  useEffect(() => {
    let live = true;
    const load = kind === 'guest' ? import('../guest') : import('../corporate');
    void load.then((m) => live && setMap(m.screens));
    return () => {
      live = false;
    };
  }, [kind]);

  const Screen: ComponentType<ScreenProps> | undefined = map?.[view];
  const open = (id: string, p: ScreenProps['params'] = {}) => {
    if (map?.[id]) {
      setView(id);
      setParams(p);
    }
  };

  return (
    <>
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">{kind === 'guest' ? tr("What a guest sees in the Guest portal.") : tr("What a company sees in the Company portal.")} {tr("Sample data: nothing here is saved or charged.")}</p>
        </div>
        <div className="sh-head-actions">
          <span className="pt-tb-pill preview" title={tr("Design preview on sample data. Nothing here is saved or charged.")}>
            <Bi name="eye" />
            <span>{tr("Preview")}</span>
          </span>
        </div>
      </div>
      <SegTabs tabs={tabs} active={tabs.some((t) => t.id === view) ? view : ''} onChange={(id) => open(id)} label={kind === 'guest' ? 'Guest portal pages' : 'Company portal pages'} />
      {kind === 'guest' ? (
        <SegTabs
          className="mt-2"
          tabs={STAGES}
          active={stage}
          onChange={(id) => {
            setGuestScenario(id as GuestStage);
            setStage(id as GuestStage);
          }}
          label={tr("Where the guest is in the stay")}
        />
      ) : null}
      {/* the guest screens run as the demo guest (the sample data); a stage change draws the page again for that stage */}
      <div className="pl-frame">
        {Screen ? (
          <Screen key={kind === 'guest' ? `${view}:${stage}` : view} {...props} user={kind === 'guest' ? asDemoGuest(props.user) : props.user} signOut={() => undefined} params={params} navigate={open} back={() => open(tabs[0]?.id ?? view)} />
        ) : (
          <p className="text-muted">{tr("Loading the portal…")}</p>
        )}
      </div>
    </>
  );
}

/** hotel.admin.guestPortal */
export const GuestPortal = (p: ScreenProps) => <Preview kind="guest" props={p} />;

/** hotel.admin.companyPortal */
export const CompanyPortal = (p: ScreenProps) => <Preview kind="company" props={p} />;
