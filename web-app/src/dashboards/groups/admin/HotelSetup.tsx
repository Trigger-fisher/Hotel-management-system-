'use client';

// "Set up your hotel": the Hotel Admin's one checklist, at the top of Settings and offered on the hotel home. Each row says Done or To do and opens the page
// where it is done; what the platform team sets up (online payments, WhatsApp, mail) shows as a read-only status. States come from the server's set-up map,
// the account list, the automatic-message settings and the WhatsApp status; nothing is stored in the browser.
import { useState } from 'react';

import type { SettingsMap } from '@shared/dashboards/admin';
import { useAsync } from '@/components/ui';
import { Bi, Button, StatusChip } from '@/dashboards/pallav/ui';
import { tr, trf } from '@/lib/i18n/language';

import { conversationsApi } from '../conversations/api';
import { adminApi } from './api';
import { messagesApi } from './messagesApi';

type Navigate = (viewId: string, params?: Record<string, string>) => void;

interface Step {
  id: string;
  icon: string;
  label: string;
  done: boolean;
  /** What is there now when done, or what is missing. */
  note: string;
  action: string;
  open: () => void;
}

interface Service {
  id: string;
  icon: string;
  label: string;
  working: boolean | null;
  note: string;
}

const stateOf = (map: SettingsMap | null, id: string) => map?.items.find((i) => i.id === id) ?? null;

function useSetupFacts() {
  const map = useAsync(() => adminApi.getSettingsMap(), []);
  const people = useAsync(() => adminApi.listUsers({ pageSize: 1000 }), []);
  const messages = useAsync(() => messagesApi.getMessagesSettings(), []);
  const wa = useAsync(() => conversationsApi.getWhatsAppSettings(), []);
  const ready = map.state.status !== 'loading' && people.state.status !== 'loading';
  return {
    ready,
    failed: map.state.status === 'error',
    retry: map.reload,
    map: map.state.status === 'ready' ? map.state.data : null,
    users: people.state.status === 'ready' ? people.state.data.page.items : [],
    messagesSaved: messages.state.status === 'ready' ? Boolean(messages.state.data.savedAt) : false,
    whatsapp: wa.state.status === 'ready' ? wa.state.data.connected : wa.state.status === 'error' ? false : null,
  };
}

function buildSteps(f: ReturnType<typeof useSetupFacts>, navigate: Navigate): { steps: Step[]; services: Service[] } {
  const profile = stateOf(f.map, 'profile');
  const billing = stateOf(f.map, 'billing');
  const rooms = stateOf(f.map, 'rooms');
  const rates = stateOf(f.map, 'rates');
  const website = stateOf(f.map, 'website');
  const payments = stateOf(f.map, 'payments');
  const staff = f.users.filter((u) => !u.portal && u.status !== 'inactive').length;
  const guests = f.users.filter((u) => u.portal?.kind === 'guest' && u.portal.linked).length;
  const companies = f.users.filter((u) => u.portal?.kind === 'company' && u.portal.linked).length;
  const steps: Step[] = [
    {
      id: 'details',
      icon: 'building',
      label: tr('Hotel details and bill header'),
      done: profile?.state === 'done' && billing?.state === 'done',
      note: profile?.state === 'done' && billing?.state === 'done' ? (profile.detail ?? '') : tr('Name, address, phone and the GSTIN printed on bills'),
      action: tr('Fill in details'),
      open: () => navigate('hotel.admin.settings', { tab: profile?.state === 'done' ? 'billing' : 'general' }),
    },
    {
      id: 'rooms',
      icon: 'door-open',
      label: tr('Rooms and rates'),
      done: rooms?.state === 'done' && rates?.state === 'done',
      note: rooms?.state === 'done' && rates?.state === 'done' ? `${rooms.detail ?? ''}, ${rates.detail ?? ''}` : rooms?.state === 'done' ? tr('Rooms are in. Add the plan rates.') : tr('Every room with its type, then a rate per plan'),
      action: rooms?.state === 'done' ? tr('Add rates') : tr('Add rooms'),
      open: () => (rooms?.state === 'done' ? navigate('hotel.admin.masters', { list: 'plan-rates' }) : navigate('hotel.fo.rooms')),
    },
    {
      id: 'staff',
      icon: 'people',
      label: tr('Staff users'),
      done: staff > 1,
      note: staff > 1 ? trf('{0} people can sign in', [staff]) : tr('Add the people who work here and what each may open'),
      action: tr('Add staff member'),
      open: () => navigate('hotel.admin.users', { add: '1' }),
    },
    {
      id: 'messages',
      icon: 'chat-left-text',
      label: tr('Message wording'),
      done: f.messagesSaved,
      note: f.messagesSaved ? tr('Automatic messages are checked and saved') : tr('Check the words guests get at check-in, check-out and when a bill is ready'),
      action: tr('Check messages'),
      open: () => navigate('hotel.admin.settings', { tab: 'messages' }),
    },
    {
      id: 'guestPortal',
      icon: 'phone',
      label: tr('Guest portal'),
      done: guests > 0,
      note: guests > 0 ? trf('{0} guests sign in', [guests]) : tr('Guests order room service and pay bills from their phone'),
      action: tr('See the guest portal'),
      open: () => navigate('hotel.admin.guestPortal'),
    },
    {
      id: 'companyPortal',
      icon: 'building-check',
      label: tr('Company portal'),
      done: companies > 0,
      note: companies > 0 ? trf(companies === 1 ? '{0} company signs in' : '{0} companies sign in', [companies]) : tr('Companies see what is due and pay it themselves'),
      action: tr('See the company portal'),
      open: () => navigate('hotel.admin.companyPortal'),
    },
    {
      id: 'website',
      icon: 'globe2',
      label: tr('Website'),
      done: website?.state === 'done',
      note: website?.detail ?? tr('Your rooms, rates and booking enquiries on the web'),
      action: tr('Open website'),
      open: () => navigate('hotel.web.overview'),
    },
  ];
  const services: Service[] = [
    { id: 'payments', icon: 'credit-card', label: tr('Online payments'), working: payments ? payments.state === 'done' : null, note: payments?.state === 'done' ? tr('Guests and companies can pay online') : tr('Not switched on yet') },
    { id: 'whatsapp', icon: 'whatsapp', label: tr('WhatsApp'), working: f.whatsapp, note: f.whatsapp ? tr('Your number is connected') : tr('Not connected yet') },
    { id: 'mail', icon: 'envelope', label: tr('Email'), working: true, note: tr("Sent through the platform's mail with your hotel's name") },
  ];
  return { steps, services };
}

/**
 * The checklist. `place="home"`: compact (how far, the next step's button and a link to the full list in Settings), and nothing once every step is done.
 * `place="settings"`: always reachable; when all is done it folds into one line that opens it again.
 */
export function HotelSetupCard({ navigate, place = 'settings' }: { navigate: Navigate; place?: 'home' | 'settings' }) {
  const facts = useSetupFacts();
  const [open, setOpen] = useState(false);
  if (!facts.ready || facts.failed || !facts.map) return null;
  const { steps, services } = buildSteps(facts, navigate);
  const done = steps.filter((s) => s.done).length;
  const allDone = done === steps.length;
  if (allDone && place === 'home') return null;
  if (place === 'home') {
    const first = steps.find((s) => !s.done) as Step;
    return (
      <section className="ha-setup is-compact reveal" aria-label={tr('Set up your hotel')}>
        <div className="ha-setup-head">
          <div>
            <h2>{tr('Set up your hotel')}</h2>
            <p>{trf('{0} of {1} done. Next: {2}.', [done, steps.length, first.label])}</p>
          </div>
          <span className="ha-setup-meter" role="progressbar" aria-label={tr('Set-up progress')} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
            <span style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
          </span>
        </div>
        <div className="ha-setup-go">
          <Button icon={first.icon} onClick={first.open}>
            {first.action}
          </Button>
          <Button variant="ghost" icon="list-check" onClick={() => navigate('hotel.admin.settings')}>
            {tr('See the full list')}
          </Button>
        </div>
      </section>
    );
  }
  if (allDone && !open) {
    return (
      <div className="ha-setup-done reveal">
        <Bi name="check2-circle" />
        <span>{tr('Your hotel is set up.')}</span>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {tr('Show the checklist')}
        </Button>
      </div>
    );
  }
  const next = steps.find((s) => !s.done);
  return (
    <section className="ha-setup reveal" aria-label={tr('Set up your hotel')}>
      <div className="ha-setup-head">
        <div>
          <h2>{tr('Set up your hotel')}</h2>
          <p>{allDone ? tr('Everything is done. Each row still opens its page.') : trf('{0} of {1} done. Next: {2}.', [done, steps.length, next?.label ?? ''])}</p>
        </div>
        <span className="ha-setup-meter" aria-hidden="true">
          <span style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
        </span>
        {allDone ? (
          <Button variant="ghost" size="sm" icon="chevron-up" onClick={() => setOpen(false)}>
            {tr('Hide')}
          </Button>
        ) : null}
      </div>
      <ol className="ha-setup-list">
        {steps.map((s) => (
          <li key={s.id} className={`ha-setup-row${s.done ? ' is-done' : ''}${next?.id === s.id ? ' is-next' : ''}`}>
            <span className="ha-setup-tick" aria-hidden="true">
              <Bi name={s.done ? 'check-lg' : s.icon} />
            </span>
            <span className="ha-setup-text">
              <b>{s.label}</b>
              <small>{s.note}</small>
            </span>
            <StatusChip tone={s.done ? 'ok' : 'neutral'}>{s.done ? tr('Done') : tr('To do')}</StatusChip>
            <Button variant={next?.id === s.id ? 'primary' : 'outline'} size="sm" onClick={s.open} aria-label={`${s.action}: ${s.label}`}>
              {s.done ? tr('Open') : s.action}
            </Button>
          </li>
        ))}
      </ol>
      <div className="ha-setup-services">
        <span className="ha-setup-label">{tr('Set up by the platform team')}</span>
        <ul>
          {services.map((x) => (
            <li key={x.id}>
              <Bi name={x.icon} />
              <span>
                <b>{x.label}</b>
                <small>{x.note}</small>
              </span>
              <StatusChip tone={x.working ? 'ok' : 'neutral'}>{x.working ? tr('Working') : tr('Not set up')}</StatusChip>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
