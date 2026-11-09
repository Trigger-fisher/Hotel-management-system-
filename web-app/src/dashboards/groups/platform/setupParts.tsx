'use client';

// Guided set-up, built once for every console (MJ, 5 Nov 2026): a checklist of services or tasks with a plain state and one next-step button, and a
// step-by-step wizard (one thing per step, numbered hints, Back / Next) with a Test that answers in plain words.
import { useState, type ReactNode } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import { setupCopy as T } from '@shared/dashboards/platform';

import { useToast } from '@/components/ui';
import { Bi, Button, FieldError, FieldHint, StatusChip, type ChipTone } from '@/dashboards/pallav/ui';
import { apiMode } from '@/lib/api/mode';

export type SetupState = 'not_set_up' | 'working' | 'attention' | 'done' | 'todo' | 'checking';

const TONE: Record<SetupState, ChipTone> = { not_set_up: 'neutral', working: 'ok', attention: 'warn', done: 'ok', todo: 'neutral', checking: 'neutral' };
const DOT: Record<SetupState, string> = { not_set_up: 'tone-muted', working: 'tone-ok', attention: 'tone-warn', done: 'tone-ok', todo: 'tone-muted', checking: 'tone-muted' };

export function SetupStatePill({ state }: { state: SetupState }) {
  return <StatusChip tone={TONE[state]}>{T.state[state]}</StatusChip>;
}

export interface SetupRow {
  id: string;
  icon: string;
  title: string;
  text: string;
  state: SetupState;
  /** One plain sentence: why it needs attention, or what is true now. */
  reason?: string | null;
  /** The next step. Absent: a read-only row (a service someone else sets up). */
  action?: { label: string; onClick: () => void };
}

/** A list of services or tasks, each with its state and one next-step button. The first row that needs work gets the gold button. */
export function SetupChecklist({ rows, label, className = '' }: { rows: SetupRow[]; label: string; className?: string }) {
  const first = rows.find((r) => r.action && (r.state === 'attention' || r.state === 'not_set_up' || r.state === 'todo'));
  return (
    <ul className={`pf-setup-list ${className}`} aria-label={label}>
      {rows.map((r) => (
        <li key={r.id} className={`pf-setup-row${r.state === 'attention' ? ' warn' : ''}`}>
          <span className="pf-setup-icon" aria-hidden="true">
            <Bi name={r.icon} />
            <i className={`hm-dot ${DOT[r.state]}`} />
          </span>
          <span className="pf-setup-text">
            <b>{r.title}</b>
            <small>{r.reason ?? r.text}</small>
          </span>
          <SetupStatePill state={r.state} />
          {r.action ? (
            <Button size="sm" variant={first?.id === r.id ? 'primary' : 'outline'} onClick={r.action.onClick}>
              {r.action.label}
            </Button>
          ) : (
            <span className="pf-setup-none" />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Short numbered hints: where to find each value in the provider's own console. */
export function SetupHints({ hints, title = T.whereTitle }: { hints: readonly string[]; title?: string }) {
  if (hints.length === 0) return null;
  return (
    <div className="pf-setup-hints">
      <b>{title}</b>
      <ol>
        {hints.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ol>
    </div>
  );
}

export interface WizardStep {
  id: string;
  title: string;
  hints?: readonly string[];
  done?: boolean;
  content: ReactNode;
}

/**
 * The step-by-step wizard. Each step saves its own part (so it can be left and continued later); Back / Next only move between steps.
 * `step` and `onStep` let the page keep the open step in its address.
 */
export function SetupWizard({ title, steps, step, onStep, onClose }: { title: string; steps: WizardStep[]; step: string; onStep: (id: string) => void; onClose: () => void }) {
  const at = Math.max(0, steps.findIndex((s) => s.id === step));
  const cur = steps[at];
  const last = at === steps.length - 1;
  return (
    <section className="pf-wizard reveal" aria-label={title}>
      <div className="pf-wizard-head">
        <Button variant="ghost" size="sm" icon="arrow-left" onClick={onClose}>
          {T.close}
        </Button>
        <h2>{title}</h2>
        <span className="pf-sec-note">{T.stepOf(at + 1, steps.length)}</span>
      </div>
      <div className="pf-wizard-body">
        <ol className="pf-wizard-rail" aria-label={T.stepsLabel}>
          {steps.map((s, i) => (
            <li key={s.id}>
              {/* check-shared-ignore: a numbered wizard step with its tick has no kit equivalent */}
              <button type="button" className={`pf-wizard-step${i === at ? ' on' : ''}${s.done ? ' done' : ''}`} aria-current={i === at ? 'step' : undefined} onClick={() => onStep(s.id)}>
                <span className="pf-step-n">{s.done ? <Bi name="check-lg" /> : i + 1}</span>
                <span>{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="pf-wizard-main">
          <h3 className="pf-wizard-title">{cur.title}</h3>
          {cur.hints?.length ? <SetupHints hints={cur.hints} /> : null}
          <div className="pf-wizard-content">{cur.content}</div>
          <div className="pf-wizard-foot">
            {at > 0 ? (
              <Button variant="ghost" icon="arrow-left" onClick={() => onStep(steps[at - 1].id)}>
                {T.back}
              </Button>
            ) : (
              <span />
            )}
            {last ? (
              <Button variant="outline" icon="check2" onClick={onClose}>
                {T.finish}
              </Button>
            ) : (
              <Button variant="outline" icon="arrow-right" onClick={() => onStep(steps[at + 1].id)}>
                {T.next}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * One question of a wizard step: its label, the box, a check as you type (shown in place of the hint and holding the button back), and the step's own button
 * (Save and continue, or Continue when it is saved with a later step). Enter presses the button.
 */
export function SetupAsk({ id, label, hint, check, children, go }: { id: string; label: string; hint?: ReactNode; check?: string | null; children: ReactNode; go?: { label: string; icon?: string; busy?: boolean; disabled?: boolean; onClick: () => void } }) {
  const blocked = Boolean(check) || go?.disabled === true || go?.busy === true;
  return (
    <form
      className="pf-setup-ask"
      autoComplete="off"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (go && !blocked) go.onClick();
      }}
    >
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {check ? <FieldError>{check}</FieldError> : hint ? <FieldHint>{hint}</FieldHint> : null}
      {go ? (
        <div className="pf-setup-ask-go">
          <Button type="submit" icon={go.icon ?? 'check2'} busy={go.busy} disabled={blocked}>
            {go.label}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export interface TestAnswer {
  ok: boolean;
  text: string;
  /** What to do when it did not work. */
  fix?: string | null;
}

/** A Test button and its answer in plain words. In the demo the answer says it was simulated; on the real server it runs only when pressed. */
export function SetupTest({ label, run, disabled, last, children }: { label: string; run: () => Promise<TestAnswer>; disabled?: boolean; last?: { at: string; ok: boolean } | null; children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<TestAnswer | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      setAnswer(await run());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pf-setup-test">
      <div className="pf-setup-test-row">
        {children}
        <Button variant="secondary" icon="send-check" busy={busy} disabled={disabled} onClick={() => void go()}>
          {label}
        </Button>
      </div>
      <div role="status" aria-live="polite">
        {answer ? (
          <p className={`pf-setup-answer ${answer.ok ? 'ok' : 'bad'}`}>
            <Bi name={answer.ok ? 'check-circle-fill' : 'x-circle-fill'} /> <span>{answer.text}</span>
            {!answer.ok && answer.fix ? <small>{answer.fix}</small> : null}
          </p>
        ) : last ? (
          <p className={`pf-setup-answer ${last.ok ? 'ok' : 'bad'}`}>
            <Bi name={last.ok ? 'check-circle-fill' : 'x-circle-fill'} /> <span>{T.lastTest(formatDateTime(last.at), last.ok)}</span>
          </p>
        ) : null}
        {answer && apiMode() === 'mock' ? <p className="pf-sec-note mb-0">{T.simulated}</p> : null}
      </div>
    </div>
  );
}

/** A value to paste somewhere else (a webhook address, a secret shown once), with Copy. */
export function CopyLine({ value, label, id }: { value: string; label: string; id: string }) {
  const toast = useToast();
  const copy = () => {
    const failed = () => toast.show({ tone: 'error', text: T.copyFailed });
    try {
      if (!navigator.clipboard) failed();
      else void navigator.clipboard.writeText(value).then(() => toast.show({ tone: 'info', text: T.copied }), failed);
    } catch {
      failed();
    }
  };
  return (
    <div className="pf-copy">
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="form-control pf-mono" readOnly value={value} onFocus={(e) => e.target.select()} />
      <Button variant="outline" icon="clipboard" onClick={copy}>
        {T.copy}
      </Button>
    </div>
  );
}
