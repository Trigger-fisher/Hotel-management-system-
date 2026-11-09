'use client';

// The Gmail pieces of the Mailbox page: the star, the snooze menu, the label menu, the bar of bulk actions, and the keyboard list.
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { mailboxPageCopy as mb, type ConvBulkAction } from '@shared/dashboards/conversations';
import { formatDateTime } from '@shared/dashboards/format';

import { useToast } from '@/components/ui';
import { Bi, Button, Dropdown, IconButton, Modal, Select } from '@/dashboards/pallav/ui';

import { snoozeChoices } from './mailQuery';

import { tr } from '@/lib/i18n/language';

const UNDO_MS = 6000;

/**
 * Gmail's Undo send: the mail waits UNDO_MS with an Undo button in the toast, then goes. Leaving the page while it waits sends it at once, so nothing
 * typed is lost. `pending` is true while it waits.
 */
export function useUndoSend(): { pending: boolean; schedule: (go: () => Promise<void>, onUndo?: () => void) => void } {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const job = useRef<{ timer: number; go: () => Promise<void> } | null>(null);
  useEffect(
    () => () => {
      const j = job.current;
      if (!j) return;
      window.clearTimeout(j.timer);
      job.current = null;
      void j.go();
    },
    [],
  );
  const schedule = useCallback(
    (go: () => Promise<void>, onUndo?: () => void) => {
      if (job.current) return;
      const fire = () => {
        const j = job.current;
        job.current = null;
        setPending(false);
        if (j) void j.go();
      };
      job.current = { timer: window.setTimeout(fire, UNDO_MS), go };
      setPending(true);
      toast.show({
        tone: 'info',
        text: mb.sending,
        ms: UNDO_MS,
        action: {
          label: mb.undo,
          onClick: () => {
            const j = job.current;
            if (!j) return;
            window.clearTimeout(j.timer);
            job.current = null;
            setPending(false);
            onUndo?.();
            toast.show({ tone: 'info', text: mb.sendCancelled });
          },
        },
      });
    },
    [toast],
  );
  return { pending, schedule };
}

/** A star toggle that never opens the row it sits in. */
export function StarButton({ on, name, onToggle, disabled }: { on: boolean; name: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <IconButton
      icon={on ? 'star-fill' : 'star'}
      label={on ? `${mb.unstar}: ${name}` : `${mb.star}: ${name}`}
      aria-pressed={on}
      className={`ml-star${on ? ' is-on' : ''}`}
      disabled={disabled}
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    />
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Snooze until later today, tomorrow, the weekend, next week, or a picked time; Unsnooze when it already sleeps. */
export function SnoozeMenu({ until, onSnooze, button }: { until: string | null | undefined; onSnooze: (iso: string | null) => void; button: (p: { 'aria-expanded': boolean; 'aria-haspopup': 'menu'; onClick: () => void }) => ReactNode }) {
  const now = new Date();
  const [pick, setPick] = useState(() => localInput(new Date(now.getTime() + 3_600_000)));
  const [err, setErr] = useState('');
  const choices = snoozeChoices(now);
  const setPicked = () => {
    const at = new Date(pick);
    if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) return setErr(mb.snooze.future);
    setErr('');
    onSnooze(at.toISOString());
  };
  return (
    <Dropdown align="end" menuClassName="ml-snooze" button={button}>
      <h6 className="dropdown-header">{mb.snooze.title}</h6>
      {choices.map((ch) => (
        <a key={ch.key} href="#" className="dropdown-item ml-snooze-item" onClick={(e) => { e.preventDefault(); onSnooze(ch.at.toISOString()); }}>
          <span>{mb.snooze[ch.key]}</span>
          <small>{formatDateTime(ch.at.toISOString())}</small>
        </a>
      ))}
      <div className="ml-snooze-pick" onClick={(e) => e.stopPropagation()}>
        <label htmlFor="ml-snooze-at">{mb.snooze.pick}</label>
        <div className="ml-snooze-row">
          <input id="ml-snooze-at" type="datetime-local" className="form-control form-control-sm" value={pick} min={localInput(now)} onChange={(e) => setPick(e.target.value)} />
          <Button size="sm" onClick={setPicked}>{mb.snooze.set}</Button>
        </div>
        {err ? <div className="field-error" role="alert">{err}</div> : null}
      </div>
      {until ? (
        <>
          <div className="dropdown-divider" />
          <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); onSnooze(null); }}>{mb.snooze.unsnooze}</a>
        </>
      ) : null}
    </Dropdown>
  );
}

/** The labels on one mail, each a tick; every tick saves at once. */
export function LabelMenu({ labels, all, onChange, button }: { labels: readonly string[]; all: readonly string[]; onChange: (next: string[]) => void; button: (p: { 'aria-expanded': boolean; 'aria-haspopup': 'menu'; onClick: () => void }) => ReactNode }) {
  return (
    <Dropdown align="end" autoClose={false} menuClassName="ml-labels" button={button}>
      <h6 className="dropdown-header">{mb.labelMenu.title}</h6>
      {all.map((l) => {
        const on = labels.includes(l);
        return (
          <a key={l} href="#" role="menuitemcheckbox" aria-checked={on} className={`dropdown-item ml-label-item${on ? ' is-on' : ''}`} onClick={(e) => { e.preventDefault(); onChange(on ? labels.filter((x) => x !== l) : [...labels, l]); }}>
            <span className="ml-tick" aria-hidden="true">{on ? <Bi name="check2" /> : null}</span>
            <i className={`ml-ldot is-${labelTone(l)}`} aria-hidden="true" />
            {tr(l)}
          </a>
        );
      })}
    </Dropdown>
  );
}

/** The label's dot colour: a fixed tone per label so a label looks the same on every row and both themes. */
export function labelTone(label: string): 'a' | 'b' | 'c' | 'd' | 'e' | 'f' {
  const tones = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return tones[h % tones.length];
}

export function LabelChips({ labels }: { labels: readonly string[] | undefined }) {
  if (!labels?.length) return null;
  return (
    <>
      {labels.map((l) => (
        <span key={l} className={`ml-lchip is-${labelTone(l)}`}>{tr(l)}</span>
      ))}
    </>
  );
}

const BULK: readonly ConvBulkAction[] = ['done', 'read', 'unread', 'star', 'snooze'];

/** Replaces the filter row when anything is ticked: the count, select-all, and the actions on all of them. */
export function BulkBar({ n, allOnPage, onAll, onClear, onAct, busy, folderDone }: { n: number; allOnPage: boolean; onAll: () => void; onClear: () => void; onAct: (a: ConvBulkAction) => void; busy: boolean; folderDone: boolean }) {
  const acts: ConvBulkAction[] = BULK.map((a) => (a === 'done' && folderDone ? 'reopen' : a));
  return (
    <div className="ml-bulk" role="toolbar" aria-label={mb.selected.replace('{n}', String(n))}>
      <input type="checkbox" className="form-check-input ml-check" aria-label={mb.selectPage} checked={allOnPage} onChange={() => (allOnPage ? onClear() : onAll())} />
      <span className="ml-bulk-n" aria-live="polite">{mb.selected.replace('{n}', String(n))}</span>
      <span className="ml-grow" />
      {acts.map((a) => (
        <Button key={a} variant="outline" size="sm" disabled={busy} onClick={() => onAct(a)}>{mb.bulk[a as keyof typeof mb.bulk]}</Button>
      ))}
      <IconButton icon="x-lg" label={mb.clearSelection} onClick={onClear} />
    </div>
  );
}

/** The From of a reply or a new mail in My mailbox: only the person's own addresses (the main one first). Nothing when there is one address. */
export function FromField({ id, own, value, onChange, invalid }: { id: string; own: readonly string[]; value: string; onChange: (address: string) => void; invalid?: boolean }) {
  if (own.length < 2) return null;
  return (
    <div className="mb-fl">
      <label htmlFor={id}>{mb.compose.fromLabel}</label>
      <Select id={id} className="mb-in mb-frompick" value={value} invalid={invalid} onChange={(e) => onChange(e.target.value)}>
        {own.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </Select>
      <span />
    </div>
  );
}

/** The own address a received mail came to (its To or Cc), else the main one. */
export function receivedOn(own: readonly string[], to: readonly string[], cc: readonly string[]): string {
  const got = new Set([...to, ...cc].map((a) => a.trim().toLowerCase()));
  return own.find((a) => got.has(a.toLowerCase())) ?? own[0] ?? '';
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={mb.shortcuts.title}>
      <dl className="ml-keys">
        {mb.shortcuts.rows.map(([k, what]) => (
          <div key={k}>
            <dt><kbd>{k}</kbd></dt>
            <dd>{tr(what)}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
