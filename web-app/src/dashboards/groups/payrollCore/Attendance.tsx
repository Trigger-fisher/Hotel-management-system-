'use client';

// Attendance (hotel.payroll.attendance): Today on a phone (AttendanceToday.tsx); on a desk the month sheet, marked by picking a mark and painting cells or by typing keys.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { formatDateTime, formatMonthLong } from '@shared/dashboards/format';
import { weekdayOf, weekdayShort, type AttendanceSheet, type AttendanceStatus, type PayrollCompanyRow } from '@shared/dashboards/payrollCore';
import { isPayrollAdmin } from '@shared/dashboards/payrollPay';
import { Bi, Dialog, Dropdown, Loaded, Button, MayEdit, SegTabs, StatusChip } from '@/dashboards/pallav/ui';
import { errorText, useAsync, useMedia, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { HomeStats } from '../overview/HomeJobs';
import { payrollApi, payrollToday } from './api';
import { AttendanceToday } from './AttendanceToday';
import { EmptyState, MonthNav, PayLayout, SearchField } from './pms';
import { PayrollPage } from './shared';
import { count, fixed } from './load';

import { tr, trf } from '@/lib/i18n/language';

const TODAY = payrollToday();
const thisMonth = TODAY.slice(0, 7);
type Confirm = 'generate' | 'regenerate' | 'unlock' | null;
type View = 'today' | 'month';
type Layer = 'marks' | 'ot';

const tile = (s: AttendanceStatus) => ({ '--mk': s.color }) as CSSProperties;
const remembered: { view: View | null } = { view: null };

/** hotel.payroll.attendance */
export function PayrollAttendance({ user, navigate }: ScreenProps) {
  return <PayrollPage navigate={navigate}>{(company) => <Body company={company} admin={isPayrollAdmin(user.role)} navigate={navigate} />}</PayrollPage>;
}

function Body({ company, admin, navigate }: { company: PayrollCompanyRow; admin: boolean; navigate: ScreenProps['navigate'] }) {
  const phone = useMedia('(max-width: 768px)');
  const [month, setMonth] = useState(thisMonth);
  const [version, setVersion] = useState(0);
  const [chosen, setChosen] = useState<View | null>(remembered.view);
  const view: View = month !== thisMonth ? 'month' : (chosen ?? (phone ? 'today' : 'month'));
  const setView = (v: View) => {
    remembered.view = v;
    setChosen(v);
  };
  const { state, reload } = useAsync(() => payrollApi.getAttendance(company.id, month, { page: 1, pageSize: 100 }), [company.id, month, version]);
  const nav = (
    <>
      {month === thisMonth ? (
        <SegTabs className="at-switch" label={tr('Attendance view')} active={view} onChange={(id) => setView(id as View)} tabs={[{ id: 'today', label: tr('Today') }, { id: 'month', label: tr('Month') }]} />
      ) : (
        <Button variant="outline" icon="calendar-check" onClick={() => setMonth(thisMonth)}>{tr('This month')}</Button>
      )}
      {view === 'month' ? <MonthNav month={month} last={thisMonth} onChange={setMonth} /> : null}
    </>
  );
  return (
    <Loaded state={state} onRetry={reload}>
      {(sheet: AttendanceSheet) => <Sheet key={`${company.id}-${month}-${version}`} company={company} sheet={sheet} admin={admin} navigate={navigate} nav={nav} view={view} onChanged={() => setVersion((v) => v + 1)} />}
    </Loaded>
  );
}

function Sheet({ company, sheet, admin, navigate, nav, view, onChanged }: { company: PayrollCompanyRow; sheet: AttendanceSheet; admin: boolean; navigate: ScreenProps['navigate']; nav: React.ReactNode; view: View; onChanged: () => void }) {
  const toast = useToast();
  const statuses = useMemo(() => sheet.statuses.filter((x) => x.isActive), [sheet.statuses]);
  const byKey = useMemo(() => new Map(statuses.map((x) => [x.shortcutKey.toUpperCase(), x])), [statuses]);
  const byId = useMemo(() => new Map(sheet.statuses.map((x) => [x.id, x])), [sheet.statuses]);
  const days = sheet.daysInMonth;
  const locked = sheet.lock === 'locked';
  const unlocked = sheet.lock === 'unlocked';
  const isCurrent = sheet.month === thisMonth;
  const todayDay = isCurrent ? Number(TODAY.slice(8)) : 0;
  const [keys, setKeys] = useState<string[][]>(() => sheet.rows.map((r) => Array.from({ length: days }, (_, d) => (r.days[d] ? (byId.get(r.days[d] as string)?.shortcutKey.toUpperCase() ?? '') : ''))));
  const [ot, setOt] = useState<string[][]>(() => sheet.rows.map((r) => Array.from({ length: days }, (_, d) => (r.overtime[d] ? String(r.overtime[d]) : ''))));
  const [changed, setChanged] = useState<Set<number>>(() => new Set());
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [layer, setLayer] = useState<Layer>('marks');
  const [brush, setBrush] = useState<string | null>(null);
  const [day, setDay] = useState(() => (isCurrent ? todayDay : 1));
  const [typed, setTyped] = useState('');
  const grid = useRef<HTMLTableElement>(null);
  const painting = useRef(false);
  const dirty = changed.size > 0;
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const shows = (r: AttendanceSheet['rows'][number]) => words.every((w) => `${r.employeeName} ${r.employeeCode} ${r.designation}`.toLowerCase().includes(w));
  const matching = words.length ? sheet.rows.filter(shows).length : sheet.rows.length;
  const sheetPct = sheet.progress.required > 0 ? Math.round((sheet.progress.filled / sheet.progress.required) * 100) : 0;
  const gaps = keys.reduce((n, r) => n + r.slice(0, sheet.daysElapsed).filter((k) => k === '').length, 0);
  const otAll = ot.reduce((n, r) => n + r.reduce((m, h) => m + (Number(h) || 0), 0), 0);

  useEffect(() => {
    const stop = () => {
      painting.current = false;
    };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const touch = (ri: number) => setChanged((p) => (p.has(ri) ? p : new Set(p).add(ri)));
  const setCell = (ri: number, d: number, v: string) => {
    const up = v.toUpperCase().slice(0, 5);
    setKeys((p) => p.map((r, i) => (i === ri ? r.map((x, n) => (n === d ? up : x)) : r)));
    touch(ri);
  };
  const setOtCell = (ri: number, d: number, v: string) => {
    setOt((p) => p.map((r, i) => (i === ri ? r.map((x, n) => (n === d ? v.replace(/[^0-9.]/g, '') : x)) : r)));
    touch(ri);
  };
  const paint = (ri: number, d: number) => {
    if (brush === null || locked) return;
    if ((keys[ri]?.[d] ?? '') !== brush) setCell(ri, d, brush);
  };
  const fillDay = () => {
    if (!brush) return;
    const d = day - 1;
    const hit = keys.flatMap((r, ri) => (shows(sheet.rows[ri]!) && !r[d] ? [ri] : []));
    if (hit.length === 0) return;
    setKeys(keys.map((r, ri) => (hit.includes(ri) ? r.map((x, n) => (n === d ? brush : x)) : r)));
    setChanged((p) => new Set([...p, ...hit]));
  };

  const cell = (ri: number, d: number) => grid.current?.querySelector<HTMLInputElement>(`input[data-r="${ri}"][data-d="${d}"]:not(:disabled)`) ?? null;
  const onKey = (ri: number, d: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    const move = (r: number, dd: number) => {
      e.preventDefault();
      const step = r > ri ? 1 : -1;
      let to = r;
      while (to !== ri && to >= 0 && to < sheet.rows.length && !shows(sheet.rows[to]!)) to += step;
      const el = cell(to, dd);
      el?.focus();
      el?.select();
    };
    if (e.key === 'ArrowRight') move(ri, d + 1);
    else if (e.key === 'ArrowLeft') move(ri, d - 1);
    else if (e.key === 'ArrowDown') move(ri + 1, d);
    else if (e.key === 'ArrowUp') move(ri - 1, d);
    else if (e.key === 'Enter') {
      if (layer === 'marks') move(ri + 1, d);
      else move(ri, d + 1);
    } else if (layer === 'marks' && e.ctrlKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const v = keys[ri]?.[d] ?? '';
      setKeys((p) => p.map((r, i) => (i === ri ? r.map((x, n) => (n > d && n < sheet.daysElapsed ? v : x)) : r)));
      touch(ri);
    }
  };

  async function run(kind: 'save' | Exclude<Confirm, null>) {
    if (kind === 'save' && keys.some((r) => r.some((k) => k !== '' && !byKey.has(k)))) {
      toast.show({ tone: 'error', text: tr('One or more marks are not set up. Fix the cells outlined in red.') });
      return;
    }
    setBusy(true);
    const res =
      kind === 'save'
        ? await payrollApi.saveAttendance(
            company.id,
            sheet.month,
            sheet.rows.flatMap((r, ri) => (changed.has(ri) ? [{ employeeId: r.employeeId, days: (keys[ri] ?? []).map((k) => (k === '' ? null : (byKey.get(k)?.shortcutKey ?? null))), overtime: (ot[ri] ?? []).map((h) => Number(h) || 0) }] : [])),
            { page: sheet.page.page, pageSize: sheet.page.pageSize },
          )
        : kind === 'generate'
          ? await payrollApi.generateSalary(company.id, sheet.month)
          : kind === 'regenerate'
            ? await payrollApi.regenerateSalary(company.id, sheet.month)
            : await payrollApi.unlockAttendance(company.id, sheet.month);
    setBusy(false);
    setConfirm(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: kind === 'save' ? tr('Attendance saved.') : kind === 'generate' ? tr('Salary worked out.') : kind === 'regenerate' ? tr('Salary worked out again.') : tr('Attendance unlocked.') });
      onChanged();
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  const trail = [{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Attendance' }];
  const head = { trail, sub: tr('Salary is worked out from this sheet, so a month is locked once its salary is worked out.'), actions: nav };
  const monthTitle = formatMonthLong(sheet.month);

  if (statuses.length === 0) {
    return (
      <PayLayout {...head}>
        <div className="card">
          <EmptyState icon="palette2" title={tr('No attendance marks set up')} text={tr('Attendance is entered with marks like P, HD or WO, and each mark carries the part of a day it pays. Set them up before recording a month.')}>
            <Button icon="arrow-right" onClick={() => navigate('hotel.payroll.attendanceStatuses')} className="mt-3">{tr('Go to attendance marks')}</Button>
          </EmptyState>
        </div>
      </PayLayout>
    );
  }

  if (view === 'today' && isCurrent) {
    return (
      <PayLayout {...head} sub={tr('Mark everyone present in one tap, then only the exceptions. The month sheet and the paid days update from here.')}>
        <AttendanceToday company={company} sheet={sheet} dayIndex={todayDay - 1} onSaved={onChanged} />
      </PayLayout>
    );
  }

  const incomplete = sheet.incomplete;
  const rowsN = sheet.rows.length;
  const canWorkOut = !locked && !unlocked && sheet.monthOver && incomplete.length === 0 && !dirty;
  const canRedo = unlocked && !dirty;
  const statusLine = locked
    ? trf('Salary worked out {0}. The sheet is read-only.', [sheet.salaryGeneratedAt ? formatDateTime(sheet.salaryGeneratedAt) : ''])
    : dirty
      ? trf('{0} people changed, not saved yet', [changed.size])
      : incomplete.length === 0
        ? sheet.monthOver
          ? tr('Everyone is complete. Salary can be worked out.')
          : trf('{0} of {1} entries saved', [count(sheet.progress.filled), count(sheet.progress.required)])
        : sheet.monthOver
          ? trf('{0} of {1} people still have days without a mark', [incomplete.length, sheet.page.total])
          : trf('{0} of {1} entries saved', [count(sheet.progress.filled), count(sheet.progress.required)]);
  const more = admin && (locked || unlocked);

  return (
    <PayLayout {...head} search={<SearchField bare clear value={typed} onChange={setTyped} placeholder={tr('Search staff…')} label={tr('Search staff on the sheet')} />}>
      <HomeStats
        stats={[
          { id: 'people', label: tr('On the sheet'), value: sheet.page.total, format: (n) => count(Math.round(n)), note: monthTitle },
          { id: 'saved', label: tr('Entries saved'), value: sheetPct, format: (n) => `${Math.round(n)}%`, note: trf('{0} of {1}', [count(sheet.progress.filled), count(sheet.progress.required)]) },
          { id: 'gaps', label: tr('Still to mark'), value: gaps, format: (n) => count(Math.round(n)), note: isCurrent ? tr('Days up to today without a mark') : tr('Days without a mark') },
          { id: 'ot', label: tr('Overtime'), value: otAll, format: (n) => `${fixed(n, 1)} h`, note: tr('Hours this month') },
        ]}
      />

      <div className={`card ha-att${locked ? ' is-locked' : ''}`}>
        <div className="ha-att-head">
          <div className="ha-att-title">
            <h2>{monthTitle}</h2>
            {locked ? <StatusChip tone="neutral"><Bi name="lock-fill" /> {tr('Locked')}</StatusChip> : unlocked ? <StatusChip tone="warn">{tr('Open for correction')}</StatusChip> : <StatusChip tone="ok">{tr('Open')}</StatusChip>}
          </div>
          <SegTabs className="ha-att-layer" label={tr('What the cells hold')} active={layer} onChange={(id) => { setLayer(id as Layer); setBrush(null); }} tabs={[{ id: 'marks', label: tr('Marks') }, { id: 'ot', label: tr('Overtime hours') }]} />
        </div>

        {layer === 'marks' && !locked ? (
          <div className="ha-att-tools">
            <div className="ha-brushes" role="group" aria-label={tr('Mark with')}>
              <span className="ha-att-lab">{tr('Mark with')}</span>
              {statuses.map((s) => {
                const k = s.shortcutKey.toUpperCase();
                return (
                  <button /* check-shared-ignore: a mark tile carries the hotel's own mark colour and key */ key={s.id} type="button" className={`ha-brush${brush === k ? ' is-on' : ''}`} aria-pressed={brush === k} title={`${s.name}, ${s.attendancePercentage}%`} onClick={() => setBrush(brush === k ? null : k)}>
                    <kbd style={tile(s)}>{k}</kbd>
                    <span>{s.name}</span>
                  </button>
                );
              })}
              <button /* check-shared-ignore: the clear tile beside the mark tiles, same shape as them */ type="button" className={`ha-brush is-clear${brush === '' ? ' is-on' : ''}`} aria-pressed={brush === ''} onClick={() => setBrush(brush === '' ? null : '')}>
                <Bi name="eraser" />
                <span>{tr('Clear')}</span>
              </button>
            </div>
            <Button variant="outline" size="sm" icon="arrow-down" disabled={!brush} onClick={fillDay} title={tr('Puts the chosen mark in every empty cell of the day')}>
              {trf('Fill day {0}', [day])}
            </Button>
          </div>
        ) : null}

        <p className="ha-att-hint">
          {locked
            ? tr('Read-only: salary for this month is worked out.')
            : layer === 'ot'
              ? tr('Type the overtime hours of a day. Enter moves to the next day.')
              : brush !== null
                ? tr('Click or drag across cells to mark them. Choose the mark again to go back to typing.')
                : tr('Choose a mark above and click the cells, or type a key in a cell. Arrows move, Enter goes down, Ctrl+D fills the rest of the row.')}
        </p>

        <div className="ha-att-scroll">
          <table /* check-shared-ignore: the attendance sheet is a grid of inputs, not a list table */ className="ha-grid" ref={grid} data-layer={layer} data-brush={brush !== null || undefined}>
            <thead>
              <tr>
                <th className="ha-col-name" scope="col">{tr('Staff')}</th>
                {Array.from({ length: days }, (_, i) => {
                  const n = i + 1;
                  const dow = weekdayOf(sheet.month, n);
                  const cls = ['ha-dh', dow === 0 ? 'is-sun' : '', dow === 1 && n > 1 ? 'is-wk' : '', n === todayDay ? 'is-today' : '', n > sheet.daysElapsed ? 'is-future' : '', n === day ? 'is-picked' : ''].filter(Boolean).join(' ');
                  return (
                    <th key={n} scope="col" className={cls} data-day={n}>
                      <button /* check-shared-ignore: a day header of the attendance grid picks the day to fill */ type="button" className="ha-dh-btn" aria-pressed={n === day} aria-label={trf('Day {0}, {1}', [n, weekdayShort[dow]])} onClick={() => setDay(n)}>
                        <b>{n}</b>
                        <small>{weekdayShort[dow]?.slice(0, 2)}</small>
                      </button>
                    </th>
                  );
                })}
                <th className="ha-col-sum ha-sum-paid" scope="col">{tr('Paid days')}</th>
                <th className="ha-col-sum ha-sum-ot" scope="col">{tr('OT hrs')}</th>
              </tr>
            </thead>
            <tbody>
              {rowsN === 0 ? (
                <tr>
                  <td colSpan={days + 3}>
                    <EmptyState icon="people" title={tr('No active staff')} text={tr('Add staff in Staff and they appear here, ready for attendance.')}>
                      <Button icon="people" onClick={() => navigate('hotel.payroll.staff')} className="mt-3">{tr('Go to staff')}</Button>
                    </EmptyState>
                  </td>
                </tr>
              ) : null}
              {rowsN > 0 && matching === 0 ? (
                <tr>
                  <td colSpan={days + 3}>
                    <EmptyState icon="search" title={tr('No one on the sheet matches that search')} text={tr('Try another name or code.')}>
                      <Button variant="outline" className="mt-3" onClick={() => setTyped('')}>{tr('Clear search')}</Button>
                    </EmptyState>
                  </td>
                </tr>
              ) : null}
              {sheet.rows.map((r, ri) => {
                const rowKeys = keys[ri] ?? [];
                const per: Record<string, number> = { full: 0, part: 0, none: 0 };
                let paid = 0;
                rowKeys.forEach((k) => {
                  const st = byKey.get(k);
                  if (!st) return;
                  per[st.attendancePercentage <= 0 ? 'none' : st.attendancePercentage >= 100 ? 'full' : 'part']! += 1;
                  if (st.statusType === 'Paid') paid += st.attendancePercentage / 100;
                });
                const missing = rowKeys.slice(0, sheet.daysElapsed).filter((k) => k === '').length;
                const otTotal = (ot[ri] ?? []).reduce((n, h) => n + (Number(h) || 0), 0);
                return (
                  <tr key={r.employeeId} hidden={!shows(r)} className={changed.has(ri) ? 'is-changed' : undefined}>
                    <th scope="row" className="ha-col-name">
                      <span className="ha-who">
                        <b title={r.employeeName}>{r.employeeName}</b>
                        {missing > 0 && !locked ? <small className="ha-miss">{trf('{0} to mark', [missing])}</small> : <small>{[r.employeeCode, r.designation].filter(Boolean).join(' · ')}</small>}
                      </span>
                    </th>
                    {Array.from({ length: days }, (_, d) => {
                      const n = d + 1;
                      const dow = weekdayOf(sheet.month, n);
                      const v = rowKeys[d] ?? '';
                      const st = byKey.get(v);
                      const bad = layer === 'marks' && v !== '' && !st;
                      const future = n > sheet.daysElapsed;
                      const cls = ['ha-day', dow === 0 ? 'is-sun' : '', dow === 1 && n > 1 ? 'is-wk' : '', n === todayDay ? 'is-today' : '', future ? 'is-future' : '', n === day ? 'is-picked' : ''].filter(Boolean).join(' ');
                      const markCls = ['ha-cell', st ? 'has-mk' : '', bad ? 'is-bad' : '', !v && !future ? 'is-gap' : ''].filter(Boolean).join(' ');
                      return (
                        <td key={n} className={cls}>
                          {layer === 'marks' ? (
                            <input
                              type="text"
                              className={markCls}
                              data-r={ri}
                              data-d={d}
                              maxLength={5}
                              autoComplete="off"
                              aria-label={trf('{0}, day {1}', [r.employeeName, n])}
                              aria-invalid={bad || undefined}
                              title={bad ? tr('This mark is not set up') : st?.name}
                              style={st ? tile(st) : undefined}
                              value={v}
                              disabled={locked}
                              onPointerDown={(e) => {
                                if (brush === null || locked) return;
                                e.preventDefault();
                                painting.current = true;
                                setDay(n);
                                paint(ri, d);
                              }}
                              onPointerEnter={() => {
                                if (painting.current) paint(ri, d);
                              }}
                              onFocus={(e) => {
                                setDay(n);
                                e.currentTarget.select();
                              }}
                              onChange={(e) => setCell(ri, d, e.target.value)}
                              onKeyDown={onKey(ri, d)}
                            />
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              className={`ha-cell ha-ot${ot[ri]?.[d] ? ' has-ot' : ''}`}
                              data-r={ri}
                              data-d={d}
                              aria-label={trf('{0}, overtime day {1}', [r.employeeName, n])}
                              placeholder={st ? v : ''}
                              value={ot[ri]?.[d] ?? ''}
                              disabled={locked}
                              onFocus={(e) => {
                                setDay(n);
                                e.currentTarget.select();
                              }}
                              onChange={(e) => setOtCell(ri, d, e.target.value)}
                              onKeyDown={onKey(ri, d)}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="ha-col-sum ha-sum-paid" title={trf('Full days {0}, part days {1}, unpaid or off {2}', [per.full ?? 0, per.part ?? 0, per.none ?? 0])}>{fixed(paid)}</td>
                    <td className="ha-col-sum ha-sum-ot">{otTotal ? fixed(otTotal, 1) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="ha-att-bar">
          <span className={`ha-att-status${!locked && !dirty && sheet.monthOver && incomplete.length > 0 ? ' is-warn' : ''}`} aria-live="polite" title={incomplete.length && sheet.monthOver ? incomplete.join(', ') : undefined}>
            <Bi name={locked ? 'lock-fill' : dirty ? 'pencil' : incomplete.length === 0 && sheet.monthOver ? 'check-circle-fill' : 'calendar3'} />
            {statusLine}
          </span>
          <span className="ha-att-acts">
            {more ? (
              <MayEdit module="payroll">
                <Dropdown align="end" button={(p) => <Button variant="outline" icon="three-dots" {...p}>{tr('More')}</Button>}>
                  {locked ? (
                    <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setConfirm('unlock'); }}>
                      <Bi name="unlock" className="me-2" />
                      {tr('Unlock attendance')}
                    </a>
                  ) : (
                    <a href="#" className={`dropdown-item${dirty ? ' disabled' : ''}`} aria-disabled={dirty || undefined} onClick={(e) => { e.preventDefault(); if (!dirty) setConfirm('regenerate'); }}>
                      <Bi name="arrow-repeat" className="me-2" />
                      {tr('Work out salary again')}
                    </a>
                  )}
                </Dropdown>
              </MayEdit>
            ) : null}
            {locked ? null : canWorkOut ? (
              <MayEdit module="payroll"><Button icon="cash-stack" disabled={busy} onClick={() => setConfirm('generate')}>{tr('Work out salary')}</Button></MayEdit>
            ) : canRedo ? (
              <MayEdit module="payroll"><Button icon="arrow-repeat" disabled={busy} onClick={() => setConfirm('regenerate')}>{tr('Work out salary again')}</Button></MayEdit>
            ) : (
              <Button icon="check2" busy={busy} disabled={!dirty} onClick={() => void run('save')}>{tr('Save')}</Button>
            )}
          </span>
        </div>
      </div>

      <Dialog
        open={confirm === 'generate'}
        icon="cash-stack"
        title={trf('Work out salary for {0}?', [monthTitle])}
        message={tr('Attendance for the month is locked afterwards. Changing it later needs an Admin to unlock the month and work the salary out again.')}
        confirmLabel={tr('Work out salary')}
        busy={busy}
        onConfirm={() => void run('generate')}
        onCancel={() => setConfirm(null)}
      />
      <Dialog
        open={confirm === 'regenerate'}
        tone="warning"
        icon="arrow-repeat"
        title={trf('Work out salary for {0} again?', [monthTitle])}
        message={tr('This replaces the salary records, salary slips, reports and advance recoveries already made for this month.')}
        confirmLabel={tr('Work out again')}
        busy={busy}
        onConfirm={() => void run('regenerate')}
        onCancel={() => setConfirm(null)}
      />
      <Dialog
        open={confirm === 'unlock'}
        icon="unlock"
        title={tr('Unlock attendance?')}
        message={tr('The month opens for correction. Salary must be worked out again afterwards.')}
        confirmLabel={tr('Unlock attendance')}
        busy={busy}
        onConfirm={() => void run('unlock')}
        onCancel={() => setConfirm(null)}
      />
    </PayLayout>
  );
}
