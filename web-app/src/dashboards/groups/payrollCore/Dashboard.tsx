'use client';

// Payroll home of one company (hotel.payroll.dashboard): the Home pattern - job tiles, what waits, the month's figures and the latest payroll activity.
import { formatDateTime, formatINR, formatMonthLong, formatWeekdayDate } from '@shared/dashboards/format';
import type { Kpi } from '@shared/dashboards/common';
import { type PayrollCompanyRow, type PayrollDashboard } from '@shared/dashboards/payrollCore';
import { Bi, Button, EmptyState, Loaded } from '@/dashboards/pallav/ui';
import { useAsync } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { HomeJobs, HomeStats, type HomeJob, type HomeStat } from '../overview/HomeJobs';
import { payrollApi, payrollToday } from './api';
import { PayLayout } from './pms';
import { PayrollPage } from './shared';
import { count } from './load';

import { tr, trf } from '@/lib/i18n/language';

const TODAY = payrollToday();
const JOB_VIEWS = ['hotel.payroll.staff', 'hotel.payroll.attendance', 'hotel.payroll.salaryPayments', 'hotel.payroll.advances'];
const RECENT: Record<string, [string, string]> = {
  arrowUp: ['wallet2', 'hotel.payroll.advances'],
  gift: ['gift', 'hotel.payroll.bonus'],
  file: ['receipt', 'hotel.payroll.salarySlips'],
  logout: ['box-arrow-right', 'hotel.payroll.resignations'],
};
const RECENT_DEFAULT: [string, string] = ['activity', 'hotel.payroll.log'];

const figure = (k: Kpi) => (k.kind === 'money' ? formatINR(k.value) : k.kind === 'percent' ? `${k.value}%` : count(k.value));

/** hotel.payroll.dashboard */
export function PayrollDashboardScreen({ navigate }: ScreenProps) {
  return <PayrollPage navigate={navigate}>{(company) => <Body company={company} navigate={navigate} />}</PayrollPage>;
}

function Body({ company, navigate }: { company: PayrollCompanyRow; navigate: ScreenProps['navigate'] }) {
  const { state, reload } = useAsync(() => payrollApi.getDashboard(company.id), [company.id]);
  return (
    <Loaded state={state} onRetry={reload}>
      {(d: PayrollDashboard) => {
        const jobs: HomeJob[] = d.kpis.slice(0, 4).map((k, i) => ({
          id: k.id,
          label: k.label,
          note: k.hint ?? '',
          count: figure(k),
          money: k.kind === 'money',
          hot: k.tone === 'warning',
          onOpen: () => navigate(JOB_VIEWS[i] ?? 'hotel.payroll.staff'),
        }));
        const stats: HomeStat[] = [
          { id: 'net', label: tr('Net salary'), value: d.netPaise, format: (n) => formatINR(Math.round(n)), note: d.payrollMonth ? formatMonthLong(d.payrollMonth) : tr('No salary worked out yet') },
          { id: 'paid', label: tr('Paid'), value: d.paidPaise, format: (n) => formatINR(Math.round(n)), note: tr('Of the net salary') },
{ id: 'left', label: tr('Still to pay'), value: Math.max(0, d.netPaise - d.paidPaise), format: (n) => formatINR(Math.round(n)), note: tr('Net salary less paid') },
{ id: 'share', label: tr('Paid so far'), value: d.netPaise > 0 ? (d.paidPaise / d.netPaise) * 100 : 0, format: (n) => `%`, note: tr('Of the net salary') },
        ];
        return (
          <PayLayout
            trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name }]}
            actions={
              <>
                <Button variant="outline" icon="person-plus" onClick={() => navigate('hotel.payroll.staff', { add: '1' })}>{tr('Add staff')}</Button>
                <Button icon="calendar-check" onClick={() => navigate('hotel.payroll.attendance')}>{tr('Take attendance')}</Button>
              </>
            }
          >
            <div className="hd ha-home pr-home">
              <div className="hm-greet">
                <div>
                  <h2>{company.name}</h2>
                  <p>{trf('Payroll on {0}', [formatWeekdayDate(TODAY, { long: true })])}</p>
                </div>
              </div>

              <HomeJobs jobs={jobs} label={tr('Payroll jobs')} />

              <div className="hd-sec"><h3>{d.attention.length ? `${tr('Waiting for you')} · ${d.attention.length}` : tr('Waiting for you')}</h3></div>
              {d.attention.length ? (
                <div className="hm-queue">
                  {d.attention.map((a) => (
                    <div key={a.id} className="hm-q">
                      <i className={`hm-dot tone-${a.tone === 'danger' || a.tone === 'warning' ? 'warn' : 'info'}`} aria-hidden="true" />
                      <div className="hm-q-text"><b>{a.text}</b></div>
                      <Button variant="outline" size="sm" onClick={() => navigate(a.viewId)}>{a.action}</Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="hm-empty"><EmptyState icon="check2-circle" title={tr('All clear')} text={tr('Set-up is complete and every salary worked out is settled.')} /></div>
              )}

              <HomeStats stats={stats} />

              <div className="hd-sec">
                <h3>{tr('Recent payroll activity')}</h3>
                <a href="#" onClick={(e) => { e.preventDefault(); navigate('hotel.payroll.log'); }}>{tr('Payroll log')} <Bi name="arrow-right-short" /></a>
              </div>
              {d.recent.length ? (
                <div className="card ha-card">
                  <ol className="pf-timeline">
                    {d.recent.map((r) => {
                      const [, view] = RECENT[r.icon] ?? RECENT_DEFAULT;
                      return (
                        <li key={r.id}>
                          <span className="pf-tl-dot" aria-hidden="true" />
                          <div className="pf-tl-body">
                            <b><a href="#" className="ha-link" onClick={(e) => { e.preventDefault(); navigate(view); }}>{r.title}</a></b>
                            <small>{[r.detail, formatDateTime(r.at)].filter(Boolean).join(' · ')}</small>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : (
                <div className="hm-empty"><EmptyState icon="activity" title={tr('Nothing yet')} text={tr('Advances, bonuses and exits appear here as they happen.')} /></div>
              )}
            </div>
          </PayLayout>
        );
      }}
    </Loaded>
  );
}
