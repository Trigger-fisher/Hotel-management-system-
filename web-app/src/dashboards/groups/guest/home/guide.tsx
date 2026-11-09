'use client';
// First sign-in guide on Home (rule 6, MJ 5 Nov 2026): one card with four steps (your details, your own password, ordering food, what is due), each Done or
// To do with one button. It goes once every step is done or the guest hides it. The server's `firstSignIn` on the overview decides when it sends one; until
// then the card shows for an arriving or staying guest. Hidden and tapped steps are kept in this browser only (no personal details).
import { useState } from 'react';

import { useToast } from '@/components/ui';
import { Bi, PortalButton } from '@/dashboards/pallav/ui';
import { useCopy } from '@/lib/i18n/language';

import { gpWordsByLanguage } from '../kit/words';

export interface GuideStep {
  id: 'details' | 'password' | 'order' | 'pay';
  done: boolean;
  onOpen: () => void;
}

const KEY = 'gp-guide:';

function readMarks(user: string): string[] {
  try {
    const raw = window.localStorage.getItem(KEY + user);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeMarks(user: string, marks: string[]): void {
  try {
    window.localStorage.setItem(KEY + user, JSON.stringify(marks));
  } catch {
    // private window or blocked storage: the card simply shows again next time
  }
}

/** `user`: the profile id (the key of what this browser remembers). `steps` in order; a step the guest opened counts as done when it has no other proof. */
export function FirstSignInGuide({ user, steps, show }: { user: string; steps: GuideStep[]; show: boolean }) {
  const w = useCopy(gpWordsByLanguage).guide;
  const toast = useToast();
  const [marks, setMarks] = useState<string[]>(() => readMarks(user));
  if (!show || marks.includes('hidden')) return null;
  const isDone = (s: GuideStep): boolean => s.done || ((s.id === 'password' || s.id === 'order') && marks.includes(s.id));
  const left = steps.filter((s) => !isDone(s)).length;
  if (left === 0) return null;
  const save = (next: string[]) => {
    setMarks(next);
    writeMarks(user, next);
  };
  const mark = (id: string) => save(marks.includes(id) ? marks : [...marks, id]);
  const hide = () => {
    const before = marks;
    mark('hidden');
    toast.show({ tone: 'info', text: w.hidden, action: { label: w.undo, onClick: () => save(before) }, ms: 8000 });
  };
  return (
    <section className="gg-card gp-guide" aria-labelledby="gp-guide-h">
      <div className="gp-card-head">
        <span className="gp-guide-head">
          <h2 id="gp-guide-h">{w.title}</h2>
          <small>{w.left(left, steps.length)}</small>
        </span>
        <PortalButton variant="ghost" onClick={hide}>
          {w.hide}
        </PortalButton>
      </div>
      <ol className="gp-guide-list">
        {steps.map((s) => {
          const done = isDone(s);
          const t = w.steps[s.id];
          return (
            <li key={s.id} className={`gp-guide-step${done ? ' done' : ''}`}>
              <span className="gp-guide-mark" aria-hidden="true">
                {done ? <Bi name="check-lg" /> : null}
              </span>
              <span className="gp-guide-txt">
                <b>{t.label}</b>
                <small>{done ? w.done : t.note}</small>
              </span>
              {done ? null : (
                <PortalButton
                  variant="line"
                  onClick={() => {
                    if (s.id === 'password' || s.id === 'order') mark(s.id);
                    s.onOpen();
                  }}
                >
                  {t.go}
                </PortalButton>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
