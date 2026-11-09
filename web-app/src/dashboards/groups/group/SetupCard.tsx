'use client';

// "Set up your group" on the group home: one row per step with its state and, where the group admin can act, one button. Mail and online payments
// are set up by the Super Admin (Set-up centre) and show here as a status only. Hidden once every step is done.
import { groupCopy } from '@shared/dashboards/groupCopy';
import { groupSetupDone, groupSetupSteps, type GroupOverview, type GroupSetupStep, type GroupSetupStepState } from '@shared/dashboards/groupConsole';

import type { ScreenProps } from '../../types';
import { Bi, Button, StatusChip, type ChipTone } from '@/dashboards/pallav/ui';

const S = groupCopy.overview.home.setup;
const TONE: Record<GroupSetupStepState, ChipTone> = { done: 'ok', todo: 'warn', platform: 'neutral', attention: 'danger', unknown: 'neutral' };
const MARK: Record<GroupSetupStepState, string> = { done: 'check-lg', todo: 'circle', platform: 'hourglass-split', attention: 'exclamation-lg', unknown: 'shield-lock' };

interface Row {
  step: GroupSetupStep;
  title: string;
  note: string;
  action?: { label: string; run: () => void };
}

export function GroupSetupCard({ data, hotelsWithoutAdmin, navigate }: { data: GroupOverview; hotelsWithoutAdmin: number | null; navigate: ScreenProps['navigate'] }) {
  const steps = groupSetupSteps(data, hotelsWithoutAdmin);
  if (groupSetupDone(steps)) return null;
  const done = steps.filter((s) => s.state === 'done').length;
  const rows = steps.map((s) => describe(s, data, navigate));
  return (
    <section className="card gc-setup" aria-labelledby="gc-setup-title">
      <div className="gc-setup-head">
        <div>
          <h3 id="gc-setup-title">{S.title}</h3>
          <p>{S.intro}</p>
        </div>
        <div className="gc-setup-progress">
          <span>{S.progress(done, steps.length)}</span>
          <span className="gc-setup-bar" role="progressbar" aria-label={S.progressLabel} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
            <i style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
          </span>
        </div>
      </div>
      <ol className="gc-setup-list">
        {rows.map((r) => (
          <li key={r.step.id} className={`gc-step is-${r.step.state}`}>
            <span className="gc-step-mark" aria-hidden="true">
              <Bi name={MARK[r.step.state]} />
            </span>
            <div className="gc-step-text">
              <b>{r.title}</b>
              <small>{r.note}</small>
            </div>
            <StatusChip tone={TONE[r.step.state]}>{S.state[r.step.state]}</StatusChip>
            {r.action ? (
              <Button variant={r.step.state === 'todo' ? 'primary' : 'outline'} size="sm" onClick={r.action.run}>
                {r.action.label}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function describe(s: GroupSetupStep, data: GroupOverview, navigate: ScreenProps['navigate']): Row {
  const todo = s.state === 'todo';
  switch (s.id) {
    case 'details':
      return {
        step: s,
        title: S.details.title,
        note: todo ? S.details.todo((s.missing ?? []).map((k) => S.details.names[k] ?? k).join(', ')) : S.details.done,
        action: todo ? { label: S.details.action, run: () => navigate('group.profile') } : undefined,
      };
    case 'firstHotel': {
      const canInvite = data.group.isPrimaryAdmin !== false;
      return {
        step: s,
        title: S.firstHotel.title,
        note: !todo ? S.firstHotel.done : canInvite ? S.firstHotel.todo : S.firstHotel.notPrimary,
        action: todo && canInvite ? { label: S.firstHotel.action, run: () => navigate('group.hotels.invite') } : undefined,
      };
    }
    case 'admins': {
      const noHotel = data.tiles.hotelsActive === 0;
      const note = s.state === 'done' ? S.admins.done : noHotel ? S.admins.noHotel : s.state === 'unknown' ? S.admins.unknown : S.admins.todo(s.ready ?? 0);
      return { step: s, title: S.admins.title, note, action: s.state !== 'done' && !noHotel ? { label: S.admins.action, run: () => navigate('group.hotels', { status: 'active' }) } : undefined };
    }
    case 'mail':
      return { step: s, title: S.mail.title, note: s.state === 'done' ? S.mail.done : s.state === 'attention' ? S.mail.attention(s.reason ?? null) : S.bySuper };
    case 'payments': {
      const note = s.state === 'done' ? S.payments.done(s.of ?? 0) : s.of ? S.payments.some(s.ready ?? 0, s.of) : S.bySuper;
      return { step: s, title: S.payments.title, note, action: data.tiles.hotelsActive > 0 ? { label: S.payments.action, run: () => navigate('group.payments') } : undefined };
    }
  }
}
