'use client';

// Payslips (hotel.payroll.salarySlips): one card per slip, net salary at the right; a slip opens as the PDF.
import { formatDate, formatINR } from '@shared/dashboards/format';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { paymentStatusLabel, paymentStatuses, payrollPayCopy, type PaymentStatus, type PayrollCompanyRef, type SalaryRecord, type SlipList, type SlipSort } from '@shared/dashboards/payrollPay';
import { Bi, DetailCard, DetailList, FilterBar, Pager, SearchField, Button, type DetailTone } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import type { ScreenProps } from '../../types';
import { EmptyState, PayLayout } from '../payrollCore/pms';
import { payApi } from './api';
import { PayPage } from './shared';
import { PdfLink, StaleNote, Wait, istClock, useLoaded } from '../payrollCore/load';
import { useServerList } from './serverList';

import { tr, trf } from '@/lib/i18n/language';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const periodLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const L = payrollPayCopy.lists;
const NUMERIC: SlipSort[] = ['period', 'net', 'processed'];
/** The same icons as Salary Payments' status tabs. */
const STATUS_ICON: Record<PaymentStatus, string> = { Pending: 'hourglass-split', Processing: 'arrow-repeat', 'On Hold': 'pause-circle', 'Partially Paid': 'pie-chart', Paid: 'check-circle', Failed: 'x-circle' };

/** hotel.payroll.salarySlips */
export function Slips({ user, navigate }: ScreenProps) {
  return <PayPage role={user.role} navigate={navigate}>{(company) => <Body company={company} navigate={navigate} />}</PayPage>;
}

function Body({ company, navigate }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate'] }) {
  const list = useServerList<PaymentStatus, SlipSort>(NUMERIC, 'processed');
  const res = useLoaded(() => payApi.listSlips(company.id, list.query), [company.id, ...list.deps]);
  const data: SlipList | null = res.data;
  const view = list.viewOf<SalaryRecord>(data?.items ?? [], data?.total ?? 0);

  if (!data) return <Wait error={res.error} onRetry={res.reload} />;
  const s = data.summary;
  const latest = s.latestPeriod;
  const fullyPaid = s.byStatus.Paid ?? 0;
  const tabs = [
    { id: '', label: L.all, icon: 'collection', count: s.slips },
    ...paymentStatuses.filter((p) => s.byStatus[p]).map((p) => ({ id: p, label: paymentStatusLabel[p], icon: STATUS_ICON[p], count: s.byStatus[p] })),
  ];

  const statusTone = (r: SalaryRecord): DetailTone => (r.paymentStatus === 'Paid' ? 'ok' : r.paymentStatus === 'Failed' ? 'danger' : r.paymentStatus === 'Pending' || r.paymentStatus === 'On Hold' ? 'warn' : 'info');

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Payslips' }]}
      sub={trf('Every slip for {0}, latest month first. A month appears once its salary is worked out.', [company.name])}
      search={<SearchField bare value={view.search} onChange={view.setSearch} placeholder={L.slips.search} label={tr('Search salary slips')} />}
    >
      <StaleNote error={res.error} onRetry={res.reload} />
      <div className="ha-stack">
        <HomeStats
          stats={[
            { id: 'slips', label: tr('Slips'), value: s.slips, format: (n) => String(Math.round(n)), note: trf('{0} people', [s.people]) },
            { id: 'net', label: L.slips.kpiNet, value: s.netPaise, format: (n) => formatINR(Math.round(n)), note: latest ? trf('Latest: {0}', [periodLabel(latest)]) : tr('No month worked out yet') },
            { id: 'paid', label: tr('Paid'), value: s.paidPaise, format: (n) => formatINR(Math.round(n)), note: trf('{0} paid in full', [fullyPaid]) },
            { id: 'due', label: L.slips.kpiOutstanding, value: s.outstandingPaise, format: (n) => formatINR(Math.round(n)), note: s.outstandingPaise > 0 ? tr('Still to pay') : tr('Nothing to pay') },
          ]}
        />
        {s.slips > 0 ? (
          <FilterBar
            tabs={tabs}
            active={list.status}
            onTab={(id) => list.setStatus(id as '' | PaymentStatus)}
            tabsLabel={L.slips.tabsLabel}
            summary={
              list.narrowed ? (
                <>
                  {L.showing} <b>{view.total}</b> {L.of} {s.slips} {s.slips === 1 ? L.slips.noun : L.slips.nouns}
                </>
              ) : (
                <>
                  {L.all} <b>{s.slips}</b> {s.slips === 1 ? L.slips.noun : L.slips.nouns}
                </>
              )
            }
          />
        ) : null}
        {s.slips === 0 ? (
          <div className="card">
            <EmptyState icon="receipt" title={tr('No salary slips yet')} text={tr('Slips are made when salary is worked out for a finished month. Mark that month\'s attendance, then work out salary there.')}>
              <Button icon="calendar3" onClick={() => navigate('hotel.payroll.attendance')} className="mt-3">{tr('Go to attendance')}</Button>
            </EmptyState>
          </div>
        ) : view.total === 0 ? (
          <div className="card"><EmptyState icon="search" title={tr('No matching slips')} text={tr('Try another status or a different name.')} /></div>
        ) : (
          <div>
            {view.rows.map((r) => {
              const doc = `Salary slip of ${r.employeeName}, ${periodLabel(r.period)}`;
              const due = Math.max(0, r.netPaise - r.paidPaise);
              return (
                <DetailCard
                  key={r.id}
                  label={doc}
                  warn={r.paymentStatus === 'Failed'}
                  lead={{ big: periodLabel(r.period).slice(0, 3), tag: r.period.slice(0, 4), title: periodLabel(r.period) }}
                  facts={[
                    { label: tr('Staff'), value: r.employeeName, sub: r.employeeCode },
                    { label: tr('Designation'), value: r.designation, sub: r.department },
                    { label: tr('Payment'), value: paymentStatusLabel[r.paymentStatus], tone: statusTone(r), sub: r.paidOn ? formatDate(r.paidOn) : r.paymentMode },
                    { label: tr('Worked out'), value: formatDate(r.processedAt), sub: istClock(r.processedAt) },
                  ]}
                  amount={{ label: tr('Net salary'), value: formatINR(r.netPaise), sub: due > 0 && r.paidPaise > 0 ? trf('{0} still to pay', [formatINR(due)]) : undefined }}
                  sections={[
                    {
                      icon: 'cash-stack',
                      title: tr('Salary'),
                      content: (
                        <DetailList
                          items={[
                            { label: tr('Paid days'), value: String(r.payableDays) },
                            { label: tr('For attendance'), value: formatINR(r.attendanceSalaryPaise) },
                            r.otAmountPaise > 0 && { label: trf('Overtime ({0} h)', [r.otHours]), value: formatINR(r.otAmountPaise) },
                            r.bonusPaise > 0 && { label: tr('Bonus'), value: formatINR(r.bonusPaise) },
                            r.incentivePaise > 0 && { label: tr('Incentive'), value: formatINR(r.incentivePaise) },
                            ...(r.deductions ?? []).map((d) => ({ label: d.label, value: `- ${formatINR(d.paise)}` })),
                            r.advanceRecoveryPaise > 0 && { label: tr('Advance taken back'), value: `- ${formatINR(r.advanceRecoveryPaise)}` },
                            { label: tr('Net salary'), value: formatINR(r.netPaise), total: true },
                          ]}
                        />
                      ),
                    },
                    {
                      icon: 'bank',
                      title: tr('Payment'),
                      content: (
                        <DetailList
                          items={[
                            { label: tr('Status'), value: paymentStatusLabel[r.paymentStatus] },
                            { label: tr('Paid'), value: formatINR(r.paidPaise) },
                            !!r.paidOn && { label: tr('Paid on'), value: formatDate(r.paidOn ?? '') },
                            { label: tr('Mode'), value: r.paymentMode || '-' },
                            !!r.reference && { label: tr('Reference'), value: r.reference },
                          ]}
                        />
                      ),
                    },
                  ]}
                  actions={
                    <PdfLink className="btn btn-sm btn-p" href={PDF_ROUTES.salarySlip(company.id, r.id)} doc={doc}>
                      <Bi name="file-earmark-pdf" /> {tr('Open slip')}
                    </PdfLink>
                  }
                />
              );
            })}
            <div className="card sh-pager-card"><Pager server view={view} /></div>
          </div>
        )}
      </div>
    </PayLayout>
  );
}