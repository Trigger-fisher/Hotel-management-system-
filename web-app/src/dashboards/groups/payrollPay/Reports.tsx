'use client';

// Salary report (hotel.payroll.reports opens on a whole month, hotel.payroll.periodReport on some days of a month): one page, Print / PDF first.
import { useEffect, useState, type ReactNode } from 'react';
import { formatDate, formatINR } from '@shared/dashboards/format';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { type AttendanceSheet } from '@shared/dashboards/payrollCore';
import { type MealsOverview, type PayrollCompanyRef, type ReportResult } from '@shared/dashboards/payrollPay';
import { markTone, weekdayOf, weekdayShort } from '@shared/dashboards/payrollCore';
import { Bi, PickGroup, PmsDate, wordsOf, Select, Button, Table } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import type { ScreenProps } from '../../types';
import { payrollApi } from '../payrollCore/api';
import { EmptyState, MonthNav, PayLayout } from '../payrollCore/pms';
import { payApi, payToday } from './api';
import { ReportTable } from './ReportTable';
import { PayPage, useFoodCompanyName } from './shared';
import { PdfLink, Wait, fixed, useLoaded } from '../payrollCore/load';

import { tr, trf } from '@/lib/i18n/language';
const TODAY = payToday();
const thisMonth = TODAY.slice(0, 7);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
function monthEnd(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return `${iso.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
const count = (n: number) => String(Math.round(n));
type Mode = 'month' | 'days';

/** hotel.payroll.reports (a whole month) */
export function MonthlyReport({ user, navigate }: ScreenProps) {
  return <PayPage role={user.role} navigate={navigate}>{(company) => <Report company={company} navigate={navigate} start="month" />}</PayPage>;
}

/** hotel.payroll.periodReport (some days of one month) */
export function PeriodReport({ user, navigate }: ScreenProps) {
  return <PayPage role={user.role} navigate={navigate}>{(company) => <Report company={company} navigate={navigate} start="days" />}</PayPage>;
}

function Report({ company, navigate, start }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate']; start: Mode }) {
  const [mode, setMode] = useState<Mode>(start);
  const trail = [
    { label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') },
    { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') },
    { label: 'Salary report' },
  ];
  const picker = (
    <PickGroup
      label={tr('Report for')}
      value={mode}
      onChange={setMode}
      choices={[
        { value: 'month', icon: 'calendar3', title: tr('A whole month'), text: tr('Salary worked out, with attendance and meals') },
        { value: 'days', icon: 'calendar-range', title: tr('Some days'), text: tr('Salary for days inside one month') },
      ]}
    />
  );
  return mode === 'month' ? <Monthly company={company} navigate={navigate} trail={trail} picker={picker} /> : <Period company={company} trail={trail} picker={picker} />;
}

type Trail = { label: string; icon?: string; onPress?: () => void }[];

function Monthly({ company, navigate, trail, picker }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate']; trail: Trail; picker: ReactNode }) {
  const PAYEE = useFoodCompanyName();
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const report = useLoaded(() => payApi.monthlyReport(company.id, picked), [company.id, picked], picked);
  const data: (ReportResult & { period: string }) | null = report.data;
  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [meals, setMeals] = useState<MealsOverview | null>(null);
  const period = data?.period;

  useEffect(() => {
    if (!period) return;
    let live = true;
    void Promise.all([payrollApi.getAttendance(company.id, period, { page: 1, pageSize: 100 }), payApi.getMeals(company.id, period)]).then(([a, m]) => {
      if (!live) return;
      setSheet(a.ok ? a.data : null);
      setMeals(m.ok ? m.data : null);
    });
    return () => {
      live = false;
    };
  }, [company.id, period]);

  if (!data) return <Wait error={report.error} onRetry={report.reload} />;
  const month = data.period;
  const rows = data.rows;
  const net = rows.reduce((n, r) => n + r.netPaise, 0);
  const food = meals && meals.period === month && meals.billFinal && meals.bill.length > 0 ? meals : null;
  const mealsPaise = food ? food.billTotalPaise : 0;
  const owed = !company.providesFood;
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const statusMap = new Map((sheet?.statuses ?? []).map((s) => [s.id, s]));
  const byEmp = new Map((sheet?.rows ?? []).map((r) => [r.employeeId, r]));

  return (
    <PayLayout
      trail={trail}
      sub={trf('The salary of {0} for one month or some of its days, ready to print.', [company.name])}
      actions={
        rows.length > 0 ? (
          <PdfLink className="btn btn-p" href={PDF_ROUTES.monthlyReport(company.id, month)} doc={`Salary report for ${monthName(month)}`}>
            <Bi name="printer" /> {tr('Print / PDF')}
          </PdfLink>
        ) : null
      }
    >
      <div className="ha-stack">
        <div className="card rp-pick">
          {picker}
          <div className="rp-pick-row">
            <span className="rp-pick-lab">{tr('Month')}</span>
            <MonthNav month={month} last={thisMonth} onChange={setPicked} />
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="card">
            <EmptyState icon="bar-chart" title={trf('No salary worked out for {0}', [monthName(month)])} text={month === thisMonth ? tr('This month is still running. Work out its salary from Attendance once it ends.') : tr('Work out this month\'s salary from Attendance; the report then shows here.')}>
              <Button variant="outline" icon="calendar3" onClick={() => navigate('hotel.payroll.attendance')} className="mt-3">{tr('Open attendance')}</Button>
            </EmptyState>
          </div>
        ) : (
          <>
            <HomeStats
              stats={[
                { id: 'staff', label: tr('Staff'), value: rows.length, format: count, note: monthName(month) },
                { id: 'net', label: tr('Net salary'), value: net, format: (n) => formatINR(Math.round(n)), note: tr('For the month') },
                { id: 'meals', label: tr('Staff meals'), value: mealsPaise, format: (n) => formatINR(Math.round(n)), note: food ? (owed ? trf('To pay {0}', [PAYEE]) : tr('Cost of staff meals')) : tr('None this month') },
                { id: 'total', label: tr('Total'), value: net + mealsPaise, format: (n) => formatINR(Math.round(n)), note: tr('Salary and meals') },
              ]}
            />

            <div className="card">
              <div className="card-header d-flex justify-content-between align-items-center">
                <span>{trf('Salary, {0}', [monthName(month)])}</span>
                <span className="text-muted fw-normal fs-sm">{rows.length === 1 ? tr('1 person') : trf('{0} people', [rows.length])}</span>
              </div>
              <ReportTable rows={rows} />
            </div>

            {food ? (
              <div className="card">
                <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
                  <span>
                    <Bi name="cup-hot" className="me-1" /> {owed ? trf('To pay {0}', [PAYEE]) : tr('Staff meals')}
                  </span>
                  <Button variant="ghost" size="sm" icon="box-arrow-up-right" onClick={() => navigate('hotel.payroll.meals')}>{tr('Staff meals')}</Button>
                </div>
                <p className="ml-note">{trf('{0} a person for a full month, counted by day; never taken from salary.', [formatINR(food.currentPricePaise ?? 0)])}</p>
                <div className="table-responsive rp-scroll">
                  <Table className="table align-middle mb-0 pay-report rp-table">
                    <thead>
                      <tr>
                        <th>{tr('Staff')}</th>
                        <th className="text-center">{tr('Days')}</th>
                        <th className="money">{tr('Amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {food.bill.map((b) => (
                        <tr key={b.employeeId}>
                          <td>
                            <span className="cell-main">{b.employeeName}</span>
                            <span className="cell-sub">{b.designation}</span>
                          </td>
                          <td className="text-center">{b.days} / {days}</td>
                          <td className="money">{formatINR(b.amountPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
                <div className="grand-total">
                  <div className="gt-row">
                    <span>{tr('Net salary')}</span>
                    <strong>{formatINR(net)}</strong>
                  </div>
                  <div className="gt-row">
                    <span>{owed ? trf('To pay {0}', [PAYEE]) : tr('Staff meals')}</span>
                    <strong>{formatINR(food.billTotalPaise)}</strong>
                  </div>
                  <div className="gt-row gt-final">
                    <span>
                      {trf('Total for {0}', [monthName(month)])}
                      <small>{wordsOf(net + food.billTotalPaise)}</small>
                    </span>
                    <strong>{formatINR(net + food.billTotalPaise)}</strong>
                  </div>
                </div>
              </div>
            ) : null}

            {sheet && sheet.month === month ? (
              <details className="card rp-att">
                <summary>
                  <span>
                    <b>{tr('Attendance this month')}</b>
                    <small>{tr('The marks the salary was worked out from.')}</small>
                  </span>
                  <Bi name="chevron-down" />
                </summary>
                <div className="legend-row">
                  <div className="d-flex flex-wrap gap-2">
                    {sheet.statuses.filter((s) => s.isActive).map((s) => (
                      <span key={s.id} className="legend-chip">
                        {/* check-shared-ignore: the colour of an attendance mark is user data */}
                        <span className="lc-key" data-tone={markTone(s.attendancePercentage)} style={{ background: s.color }}>{s.shortcutKey.toUpperCase()}</span> {s.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="attendance-scroll">
                  <Table className="attendance-grid w-100">
                    <thead>
                      <tr>
                        <th className="sticky-col col-name">{tr('Name')}</th>
                        {Array.from({ length: days }, (_, i) => {
                          const dow = weekdayOf(month, i + 1);
                          return (
                            <th key={i} className={`day-head ${dow === 0 ? 'is-sunday' : ''} ${dow === 1 && i > 0 ? 'week-start' : ''}`}>
                              <span className="dh-num">{i + 1}</span>
                              <span className="dh-dow">{weekdayShort[dow]}</span>
                            </th>
                          );
                        })}
                        <th className="text-center">{tr('Paid days')}</th>
                        <th className="text-center">{tr('OT')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const a = byEmp.get(r.employeeId);
                        return (
                          <tr key={r.id}>
                            <td className="sticky-col col-name">
                              <div className="fw-semibold fs-sm">{r.employeeName}</div>
                              <div className="text-muted fs-2xs">{r.employeeCode}</div>
                            </td>
                            {Array.from({ length: days }, (_, i) => {
                              const st = a?.days[i] ? statusMap.get(a.days[i] as string) : undefined;
                              const dow = weekdayOf(month, i + 1);
                              return (
                                <td key={i} className={`day-cell ${dow === 0 ? 'is-sunday' : ''} ${dow === 1 && i > 0 ? 'week-start' : ''} text-center cell-tight`}>
                                  {st ? (
                                    // check-shared-ignore: the colour of an attendance mark is user data
                                    <span className="fw-black fs-2xs att-chip" data-tone={markTone(st.attendancePercentage)} style={{ background: st.color }}>{st.shortcutKey.toUpperCase()}</span>
                                  ) : (
                                    <span className="text-muted fs-2xs">·</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="summary-cell total">{fixed(r.payableDays)}</td>
                            <td className="summary-cell">{fixed(r.otHours)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </details>
            ) : null}
          </>
        )}
      </div>
    </PayLayout>
  );
}

function Period({ company, trail, picker }: { company: PayrollCompanyRef; trail: Trail; picker: ReactNode }) {
  const [from, setFrom] = useState(`${thisMonth}-01`);
  const [to, setTo] = useState(TODAY);
  const [employeeId, setEmployeeId] = useState('');
  const [result, setResult] = useState<{ key: string; data: ReportResult | null; error: string } | null>(null);
  const [people, setPeople] = useState<{ id: string; name: string; code: string; active: boolean }[]>([]);

  useEffect(() => {
    let live = true;
    void payrollApi.listEmployees(company.id, { pageSize: 1000 }).then((res) => live && res.ok && setPeople(res.data.items.map((e) => ({ id: e.id, name: e.name, code: e.employeeCode, active: e.isActive }))));
    return () => {
      live = false;
    };
  }, [company.id]);

  const toMin = from || undefined;
  const toMax = from ? [monthEnd(from), TODAY].sort()[0] : TODAY;
  const local = !from || !to ? tr('Choose the first and the last day.') : from > to ? tr('The first day must be on or before the last day.') : from.slice(0, 7) !== to.slice(0, 7) ? tr('Both days must be in the same month.') : to > TODAY ? tr('The last day cannot be after today.') : '';
  const key = `${from}|${to}|${employeeId}`;

  useEffect(() => {
    if (local) return;
    let live = true;
    void payApi.periodReport(company.id, from, to, employeeId).then((res) => {
      if (!live) return;
      if (res.ok) setResult({ key, data: res.data, error: '' });
      else {
        const f = res.error.details?.fields ?? {};
        setResult({ key, data: null, error: f.form ?? f.from ?? f.to ?? res.error.message ?? tr('The report could not be made. Try again.') });
      }
    });
    return () => {
      live = false;
    };
  }, [company.id, from, to, employeeId, local, key]);

  const current = result && result.key === key && !local ? result : null;
  const rows = current?.data?.rows ?? [];
  const error = local || current?.error || '';
  const periodDays = Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1;
  const net = rows.reduce((n, r) => n + r.netPaise, 0);

  return (
    <PayLayout
      trail={trail}
      sub={trf('The salary of {0} for one month or some of its days, ready to print.', [company.name])}
      actions={
        rows.length > 0 ? (
          <PdfLink className="btn btn-p" href={PDF_ROUTES.periodReport(company.id, { from, to, employeeId: employeeId || undefined })} doc={`Salary report, ${formatDate(from)} to ${formatDate(to)}`}>
            <Bi name="printer" /> {tr('Print / PDF')}
          </PdfLink>
        ) : null
      }
    >
      <div className="ha-stack">
        <div className="card rp-pick">
          {picker}
          <div className="row g-3 mt-1">
            <div className="col-6 col-md-3">
              <label className="form-label" htmlFor="pr_from">{tr('First day')}</label>
              <PmsDate
                type="date"
                id="pr_from"
                className="form-control"
                max={TODAY}
                value={from}
                onChange={(e) => {
                  const next = e.target.value;
                  setFrom(next);
                  if (next && to && (to.slice(0, 7) !== next.slice(0, 7) || to < next)) setTo([monthEnd(next), TODAY].sort()[0] ?? TODAY);
                }}
              />
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label" htmlFor="pr_to">{tr('Last day')}</label>
              <PmsDate type="date" id="pr_to" className="form-control" min={toMin} max={toMax} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="col-md-6">
              <label className="form-label" htmlFor="pr_emp">{tr('Staff')}</label>
              <Select id="pr_emp" className="form-select" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">{tr('Everyone')}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code}){p.active ? '' : ` · ${tr('inactive')}`}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {error ? <div className="field-error mt-2" role="alert">{error}</div> : <p className="mp-note">{tr('Both days in one month, up to today. The report follows as you change them.')}</p>}
        </div>

        {rows.length > 0 ? (
          <HomeStats
            stats={[
              { id: 'staff', label: tr('Staff'), value: rows.length, format: count, note: employeeId ? tr('One person') : tr('Everyone in these days') },
              { id: 'days', label: tr('Days'), value: periodDays, format: count, note: `${formatDate(from)} to ${formatDate(to)}` },
              { id: 'net', label: tr('Net salary'), value: net, format: (n) => formatINR(Math.round(n)), note: tr('For these days') },
            ]}
          />
        ) : null}

        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center">
            <span>{trf('Salary, {0} to {1}', [formatDate(from), formatDate(to)])}</span>
            {rows.length > 0 ? <span className="text-muted fw-normal fs-sm">{rows.length === 1 ? tr('1 person') : trf('{0} people', [rows.length])}</span> : null}
          </div>
          <ReportTable rows={rows} emptyMessage={error ? tr('Fix the days above to see the report.') : current ? tr('No salary for these days. Work out the month\'s salary from Attendance first.') : tr('Making the report…')} />
        </div>
      </div>
    </PayLayout>
  );
}
