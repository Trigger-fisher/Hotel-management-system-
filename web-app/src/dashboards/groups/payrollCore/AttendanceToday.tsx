'use client';

// Attendance for today (MJ's attendance preview, 5 Nov 2026): the supervisor marks everyone present in one tap, then only the exceptions; More holds the other
// marks (week off, leave ...). Saved through the month save with only today's key changed, so the month sheet, the lock and the salary rules stay the same.
import { useMemo, useState, type CSSProperties } from 'react';

import type { AttendanceSheet, AttendanceStatus, PayrollCompanyRow } from '@shared/dashboards/payrollCore';
import { formatWeekdayDate } from '@shared/dashboards/format';

import { errorText, useToast } from '@/components/ui';
import { Bi, Button, Dropdown, GoldTick } from '@/dashboards/pallav/ui';

import { payrollApi } from './api';
import { markAllPresent, quickMarks, saveRows, todayCounts, todayPeople, type TodayCounts } from './attendanceMarks';

import { tr, trf } from '@/lib/i18n/language';

const countsLine = (c: TodayCounts) =>
  [c.present ? trf('{0} present', [c.present]) : '', c.half ? trf('{0} half day', [c.half]) : '', c.absent ? trf('{0} absent', [c.absent]) : '', c.other ? trf('{0} on leave or off', [c.other]) : '']
    .filter(Boolean)
    .join(' · ');

/** The mark's own colour is the hotel's data (Attendance marks): it tints the tile and draws its edge, the letters stay in ink, so any colour reads in day and night. */
const tile = (s: AttendanceStatus) => ({ '--mk': s.color }) as CSSProperties;

export function AttendanceToday({ company, sheet, dayIndex, onSaved }: { company: PayrollCompanyRow; sheet: AttendanceSheet; dayIndex: number; onSaved: () => void }) {
  const toast = useToast();
  const people = useMemo(() => todayPeople(sheet, dayIndex), [sheet, dayIndex]);
  const { quick, more, present } = useMemo(() => quickMarks(sheet.statuses), [sheet.statuses]);
  const byKey = useMemo(() => new Map(sheet.statuses.map((s) => [s.shortcutKey.toUpperCase(), s])), [sheet.statuses]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<TodayCounts | null>(null);
  const locked = sheet.lock === 'locked';
  const date = `${sheet.month}-${String(dayIndex + 1).padStart(2, '0')}`;
  const counts = todayCounts(people, marks, sheet.statuses);
  const done = people.length - counts.unmarked;
  const rows = saveRows(sheet, dayIndex, marks);

  const mark = (id: string, key: string) => setMarks((m) => ({ ...m, [id]: key.toUpperCase() }));
  const save = async () => {
    if (busy || rows.length === 0) return;
    setBusy(true);
    const r = await payrollApi.saveAttendance(company.id, sheet.month, rows, { page: sheet.page.page, pageSize: sheet.page.pageSize });
    setBusy(false);
    if (!r.ok) return toast.show({ tone: 'error', text: errorText(r.error) });
    setSaved(counts);
  };

  if (saved) {
    return (
      <div className="card at-done" role="status">
        <GoldTick />
        <h2>{trf('Saved for {0}', [formatWeekdayDate(date)])}</h2>
        <p>{countsLine(saved) || tr('Nothing marked')}</p>
        <div className="at-auto">
          <b>{tr('Updated by itself')}</b>
          <span>{tr('The month sheet and the paid days of each person. Anyone still unmarked shows as a dashed cell on the month sheet.')}</span>
        </div>
        <Button variant="outline" onClick={() => { setSaved(null); setMarks({}); onSaved(); }}>{tr('Back to today')}</Button>
      </div>
    );
  }

  return (
    <div className="card at-today">
      <div className="at-head">
        <div>
          <span className="at-date">{formatWeekdayDate(date)}</span>
          <h2>{tr("Today's attendance")}</h2>
        </div>
        <span className="at-n" aria-live="polite">{done}/{people.length}</span>
      </div>
      <div className="at-prog" aria-hidden="true"><i style={{ width: `${people.length ? (done / people.length) * 100 : 0}%` }} /></div>
      {locked ? (
        <p className="at-lock"><Bi name="lock-fill" /> {tr('Salary for this month is generated, so today is read-only. Only an Admin can unlock the month.')}</p>
      ) : present ? (
        <Button variant="outline" className="at-all" icon="people" disabled={counts.unmarked === 0} onClick={() => setMarks((m) => markAllPresent(m, people, present.shortcutKey))}>
          {counts.unmarked ? trf('Mark the other {0} present', [counts.unmarked]) : tr('Everyone is marked')}
        </Button>
      ) : null}

      <ul className="at-list">
        {people.map((p) => {
          const k = marks[p.employeeId] ?? p.key;
          const cur = k ? byKey.get(k) : undefined;
          const inMore = cur && !quick.includes(cur);
          return (
            <li key={p.employeeId} className={`at-row${k ? '' : ' is-empty'}`}>
              <span className="at-who">
                <b>{p.name}</b>
                <small>{p.designation || p.code}</small>
              </span>
              <span className="at-marks" role="group" aria-label={trf('Mark for {0}', [p.name])}>
                {quick.map((s) => (
                  <button /* check-shared-ignore: an attendance mark tile carries the hotel's own mark colour and key; no kit button draws a coloured key tile */ key={s.id} type="button" className={`at-mark${k === s.shortcutKey.toUpperCase() ? ' is-on' : ''}`} aria-pressed={k === s.shortcutKey.toUpperCase()} aria-label={`${s.name}: ${p.name}`} title={s.name} disabled={locked || busy} onClick={() => mark(p.employeeId, s.shortcutKey)}>
                    <kbd style={tile(s)}>{s.shortcutKey.toUpperCase()}</kbd>
                  </button>
                ))}
                {more.length ? (
                  <Dropdown
                    align="end"
                    menuClassName="at-more-menu"
                    button={(bp) => (
                      <button /* check-shared-ignore: the More tile beside the mark tiles, same shape as them */ type="button" className={`at-mark is-more${inMore ? ' is-on' : ''}`} aria-label={trf('More marks for {0}', [p.name])} disabled={locked || busy} {...bp}>
                        {inMore && cur ? <kbd style={tile(cur)}>{cur.shortcutKey.toUpperCase()}</kbd> : <span>{tr('More')}</span>}
                      </button>
                    )}
                  >
                    <h6 className="dropdown-header">{p.name}</h6>
                    {more.map((s) => (
                      <a key={s.id} href="#" className="dropdown-item at-more-item" onClick={(e) => { e.preventDefault(); mark(p.employeeId, s.shortcutKey); }}>
                        <kbd style={tile(s)}>{s.shortcutKey.toUpperCase()}</kbd>
                        <span>
                          <b>{s.name}</b>
                          <small>{[s.statusType === 'Paid' ? tr('paid') : tr('unpaid'), s.skipsFood ? tr('no food') : ''].filter(Boolean).join(' · ')}</small>
                        </span>
                      </a>
                    ))}
                  </Dropdown>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      {locked ? null : (
        <div className="at-bar">
          <span className="at-mini" aria-live="polite">{rows.length ? countsLine(counts) : tr('Tap a mark for each person')}</span>
          <Button icon="check2" busy={busy} disabled={rows.length === 0} onClick={() => void save()}>{tr('Save today')}</Button>
        </div>
      )}
    </div>
  );
}
