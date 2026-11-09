'use client';

// The company's first sign-in guide on the home: one card with the four things a new company login does, each Done or with its button.
// Company details and people to contact are done when the profile has them; the password and due bills steps are done once opened. The card goes
// when every step is done or the person hides it. Opened steps and hiding are kept in this browser until the server keeps a "first sign-in" flag.
import { useState } from 'react';

import type { PortalProfile } from '@shared/dashboards/corporate';

import { Bi, Button, GoldTick, StatusChip } from '@/dashboards/pallav/ui';
import { tr } from '@/lib/i18n/language';
import type { ScreenProps } from '../../types';
import { cpWords } from './words';

const W = cpWords.guide;
type StepId = 'details' | 'people' | 'password' | 'due';

interface Kept {
  hidden: boolean;
  opened: StepId[];
}

const keyOf = (userId: string) => `hms-cp-guide:${userId}`;

function readKept(userId: string): Kept {
  try {
    const raw = localStorage.getItem(keyOf(userId));
    const v = raw ? (JSON.parse(raw) as Partial<Kept>) : {};
    return { hidden: v.hidden === true, opened: Array.isArray(v.opened) ? v.opened.filter((s): s is StepId => typeof s === 'string') : [] };
  } catch {
    return { hidden: false, opened: [] };
  }
}

function writeKept(userId: string, kept: Kept) {
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(kept));
  } catch {
    // storage blocked: the guide simply shows again next time
  }
}

export function FirstSteps({ userId, profile, navigate }: { userId: string; profile: PortalProfile | null; navigate: ScreenProps['navigate'] }) {
  const [kept, setKept] = useState<Kept>(() => readKept(userId));
  if (!profile || kept.hidden) return null;

  const detailsDone = Boolean(profile.address && profile.gstin && profile.email && profile.mobile);
  const steps: { id: StepId; label: string; note: string; button: string; view: string; done: boolean }[] = [
    { id: 'details', ...W.steps.details, view: 'corporate.profile', done: detailsDone },
    { id: 'people', ...W.steps.people, view: 'corporate.profile', done: profile.contacts.length > 0 },
    { id: 'password', ...W.steps.password, view: 'corporate.myProfile', done: kept.opened.includes('password') },
    { id: 'due', ...W.steps.due, view: 'corporate.bills', done: kept.opened.includes('due') },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (left === 0) return null;

  const save = (next: Kept) => {
    writeKept(userId, next);
    setKept(next);
  };
  const open = (s: (typeof steps)[number]) => {
    if (!kept.opened.includes(s.id)) save({ ...kept, opened: [...kept.opened, s.id] });
    navigate(s.view);
  };
  const next = steps.find((s) => !s.done);

  return (
    <section className="card cp-guide" aria-labelledby="cp-guide-h">
      <div className="cp-guide-head">
        <div>
          <h2 id="cp-guide-h">{tr(W.title)}</h2>
          <p>{W.line(steps.length - left, steps.length)}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => save({ ...kept, hidden: true })}>
          {tr(W.hide)}
        </Button>
      </div>
      <ol className="cp-guide-steps">
        {steps.map((s, i) => (
          <li key={s.id} className={s.done ? 'is-done' : undefined}>
            {s.done ? <GoldTick size={28} /> : <span className="cp-guide-n">{i + 1}</span>}
            <div className="cp-guide-text">
              <b>{tr(s.label)}</b>
              <small>{tr(s.note)}</small>
            </div>
            {s.done ? (
              <StatusChip tone="ok">{tr(W.done)}</StatusChip>
            ) : (
              <Button size="sm" variant={s === next ? 'primary' : 'outline'} onClick={() => open(s)}>
                {tr(s.button)}
              </Button>
            )}
          </li>
        ))}
      </ol>
      <p className="cp-note">
        <Bi name="info-circle" /> {tr(W.howBills)}
      </p>
    </section>
  );
}
