'use client';
// What Pallav's Revenue and Expense lists share (resources/views/cashbook/*): the search box, the Business filter card, the day headings,
// the entry stamp field and the helpers for the closed card's time and date.
import { useState, type ReactNode } from 'react';

import { formatCount, formatDateTime } from '@shared/dashboards/format';
import { cashBusinessName, type CashBookFilter, type StampInput } from '@shared/dashboards/cash';

import { Bi, Button, Dropdown, PmsDate, ListTabs, TextAction } from '../../pallav/ui';

import { tr, trf } from '@/lib/i18n/language';
const IST_MS = 330 * 60_000;

/** "14:05:09" in IST, to the second (Pallav shows entry times to the second). */
export function istClock(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(11, 19);
}

/** "06 Oct 2026, 2:05 pm" */
export function istStamp(iso: string): string {
  return formatDateTime(iso);
}

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** The search box in the page header (cashbook/_search.blade.php) is the app's one list search now (decision 51): `ListSearch` in the kit. */
export { ListSearch as CashSearch } from '../../pallav/ui';

const books: { id: CashBookFilter; label: string; icon: string; dot?: string }[] = [
  { id: 'all', label: 'All', icon: 'grid' },
  { id: 'hotel', label: cashBusinessName.hotel, icon: 'building', dot: 'paid' },
  { id: 'food', label: cashBusinessName.food, icon: 'cup-hot', dot: 'due' },
];

/** `<x-filter-bar>`: the business as tabs, for Expense the kind of entry as one-tap pills, a summary with the count and a Reset. */
export function CashFilterBar({
  book, onBook, total, noun, narrowed, onReset, kinds, kind, onKind,
}: {
  book: CashBookFilter;
  onBook: (b: CashBookFilter) => void;
  total: number | null;
  noun: string;
  narrowed: boolean;
  onReset: () => void;
  kinds?: { value: string; label: string; icon: string }[];
  kind?: string;
  onKind?: (k: string) => void;
}) {
  return (
    <div className="bm-fbar" role="search">
      <div className="bm-fbar-top">
        <div className="bm-tabs-wrap">
          <span className="bm-tabs-title">{tr("Business")}</span>
          <ListTabs label={tr("Business")} active={book} onChange={(id) => onBook(id as CashBookFilter)} tabs={books.map((b) => ({ id: b.id, label: b.label, dot: b.dot, icon: b.dot ? undefined : b.icon }))} />
        </div>
        <div className="bm-fbar-summary">
          {total !== null && (
            <span aria-live="polite">
              {narrowed ? tr("Showing ") : tr("All ")}
              <b>{formatCount(total)}</b> {total === 1 ? (noun === 'entries' ? tr("entry") : noun.replace(/s$/, '')) : noun}
            </span>
          )}
          {narrowed && (
            <TextAction kind="reset" onClick={onReset}>{tr("Reset")}</TextAction>
          )}
        </div>
      </div>
      {kinds && (
        <div className="bm-fbar-row">
          <span className="bm-fbar-label"><i className="bi bi-sliders2" /> {tr("Narrow down")}</span>
          <ListTabs look="pills" label={tr("Kind of entry")} active={kind ?? 'all'} onChange={(v) => onKind?.(v)} tabs={[{ value: 'all', label: 'Every kind', icon: 'grid' }, ...kinds].map((k) => ({ id: k.value, label: k.label, icon: k.icon }))} />
        </div>
      )}
    </div>
  );
}

/** A cash card's footer: View the receipt is the one button; Edit and the red Delete sit in More. */
export function CashActions({ what, canEdit, canDelete, onView, onEdit, onDelete }: { what: string; canEdit: boolean; canDelete: boolean; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  return (
    <span className="hu-order-acts">
      <Button variant="outline" size="sm" icon="file-earmark-pdf" onClick={onView}>{tr("View receipt")}</Button>
      {(canEdit || canDelete) && (
        <Dropdown align="end" button={(p) => <Button variant="outline" size="sm" icon="three-dots" aria-label={trf("More for {0}", [what])} {...p}>{tr("More")}</Button>}>
          {canEdit && <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); onEdit(); }}><Bi name="pencil-square" /> {tr("Edit")}</a>}
          {canDelete && <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); onDelete(); }}><Bi name="trash" /> {tr("Delete")}</a>}
        </Dropdown>
      )}
    </span>
  );
}

/** One day: a heading with its count and total, then the cards. */
export function CashDay({ label, count, noun, total, children }: { label: string; count: number; noun: string; total: string; children: ReactNode }) {
  return (
    <div className="cb-day">
      <div className="cb-day-head">
        <span>{label}</span>
        <span className="cb-day-meta">{count} {count === 1 ? noun : noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`} · {total}</span>
      </div>
      {children}
    </div>
  );
}

/** "When an entry was made" as one Date and time field (partials/_entry-stamp.blade.php): editable for those who may backdate, else shown locked. */
export function EntryStamp({ canSet, stamp, onChange, saved, error, col = 'col-md-6' }: { canSet: boolean; stamp: StampInput; onChange: (s: StampInput) => void; saved: boolean; error?: string; col?: string }) {
  const value = `${stamp.date}T${stamp.time}`;
  const [now] = useState(() => new Date(Date.now() + IST_MS).toISOString().slice(0, 16));
  return (
    <div className={col}>
      {canSet ? (
        <>
          <label className="form-label">{tr("Date and time")}<span className="req">*</span></label>
          <PmsDate type="datetime-local"
            max={now}
            value={value}
            onChange={(e) => {
              const [date, time] = e.target.value.split('T');
              if (date) onChange({ date, time: time || '00:00' });
            }}
          />
          <div className="form-text">{tr("Cannot be in the future.")}</div>
          {error && <div className="field-error">{error}</div>}
        </>
      ) : (
        <>
          <span className="form-label d-block">{tr("Date and time")}</span>
          <div className="field-readonly">
            <Bi name="lock" />
            <span>{formatDateTime(`${stamp.date}T${stamp.time.slice(0, 5)}:00+05:30`)}</span>
          </div>
          <div className="form-text">{saved ? tr("Only an Admin can change when this was entered.") : tr("Stamped automatically when you save.")}</div>
          {error && <div className="field-error">{error}</div>}
        </>
      )}
    </div>
  );
}
