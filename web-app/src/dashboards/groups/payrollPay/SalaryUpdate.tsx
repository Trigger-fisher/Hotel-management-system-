'use client';

// Salary changes (hotel.payroll.salaryUpdate): one card per person with Revise salary on it; a person's page holds the current terms and every revision as a timeline.
import { useMemo, useState } from 'react';
import { formatDate, formatDateTime, formatINR } from '@shared/dashboards/format';
import { type PayEmployee, type PayrollCompanyRef, type SalaryProfile, type SalaryRevision } from '@shared/dashboards/payrollPay';
import { Button, DetailCard, DetailList, MayEdit, Pager, SearchField, useTableView } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { HomeStats } from '../overview/HomeJobs';
import { EmptyState, PayLayout } from '../payrollCore/pms';
import { payApi, payToday } from './api';
import { SalaryReviseModal } from './SalaryRevise';
import { PayPage } from './shared';
import { StaleNote, Wait, count, useLoaded } from '../payrollCore/load';

import { tr, trf } from '@/lib/i18n/language';

const TODAY = payToday();

const trailOf = (company: PayrollCompanyRef, navigate: ScreenProps['navigate'], tail: { label: string; onPress?: () => void }[]) => [
  { label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') },
  { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') },
  ...tail,
];

const changesWord = (n: number) => trf(n === 1 ? '{0} change on record' : '{0} changes on record', [n]);
const terms = (e: PayEmployee) => [
  { label: tr('Monthly salary'), value: formatINR(e.salaryPaise) },
  { label: tr('Hours a day'), value: String(e.dailyWorkingHours) },
  { label: tr('Paid by'), value: e.paymentMode === 'Bank' && e.bankName ? `${e.paymentMode}, ${e.bankName}` : e.paymentMode },
  { label: tr('Designation'), value: e.designation || '-' },
  { label: tr('Department'), value: e.department || tr('None') },
  { label: tr('Joined'), value: formatDate(e.joiningDate) },
];

/** hotel.payroll.salaryUpdate */
export function SalaryUpdate({ user, navigate }: ScreenProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <PayPage role={user.role} navigate={navigate}>
      {(company) => (openId ? <Show company={company} navigate={navigate} employeeId={openId} onBack={() => setOpenId(null)} /> : <List company={company} navigate={navigate} onOpen={setOpenId} />)}
    </PayPage>
  );
}

function List({ company, navigate, onOpen }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate']; onOpen: (id: string) => void }) {
  const [version, setVersion] = useState(0);
  const [revising, setRevising] = useState<PayEmployee | null>(null);
  const list = useLoaded(() => payApi.listSalaryProfiles(company.id, { page: 1, pageSize: 1000 }), [company.id, version]);
  const rows: SalaryProfile[] | null = list.data?.items ?? null;
  const all = useMemo(() => rows ?? [], [rows]);
  const view = useTableView(all, {
    perPage: 25,
    match: (r, q) => `${r.employee.name} ${r.employee.code} ${r.employee.designation} ${r.employee.department}`.toLowerCase().includes(q),
    sorters: { employee: { kind: 'text', value: (r) => r.employee.name.toLowerCase() } },
  });
  const year = TODAY.slice(0, 4);
  const never = all.filter((r) => !r.lastRevisedOn).length;

  if (!rows) return <Wait error={list.error} onRetry={list.reload} />;

  return (
    <PayLayout
      trail={trailOf(company, navigate, [{ label: 'Salary changes' }])}
      sub={tr('Everyone’s current pay and role. Revise a salary from its card; History shows every change made.')}
      search={<SearchField bare value={view.search} onChange={view.setSearch} placeholder={tr('Search name, ID or designation…')} label={tr('Search staff')} />}
    >
      <StaleNote error={list.error} onRetry={list.reload} />
      <div className="ha-stack">
        <HomeStats
          stats={[
            { id: 'people', label: tr('Staff'), value: all.length, format: (n) => count(Math.round(n)), note: company.name },
            { id: 'monthly', label: tr('Monthly salary'), value: all.reduce((n, r) => n + r.employee.salaryPaise, 0), format: (n) => formatINR(Math.round(n)), note: tr('Current pay, everyone listed') },
            { id: 'year', label: tr('Revised this year'), value: all.filter((r) => r.lastRevisedOn?.startsWith(year)).length, format: (n) => count(Math.round(n)), note: year },
            { id: 'never', label: tr('Never revised'), value: never, format: (n) => count(Math.round(n)), note: tr('Still on joining pay') },
          ]}
        />
        {all.length === 0 ? (
          <div className="card">
            <EmptyState icon="clock-history" title={tr('No staff to revise')} text={tr('Salary changes apply to active staff. Add someone in Staff first.')}>
              <Button icon="people" onClick={() => navigate('hotel.payroll.staff')} className="mt-3">{tr('Go to staff')}</Button>
            </EmptyState>
          </div>
        ) : view.total === 0 ? (
          <div className="card"><EmptyState icon="search" title={tr('No matching staff')} text={tr('Try a different name, staff ID or designation.')} /></div>
        ) : (
          <div>
            {view.rows.map((r) => {
              const e = r.employee;
              return (
                <DetailCard
                  key={e.id}
                  label={e.name}
                  lead={{ big: e.code || '-', tag: e.paymentMode, title: e.code }}
                  facts={[
                    { label: tr('Staff'), value: e.name, sub: e.department || undefined },
                    { label: tr('Designation'), value: e.designation },
                    { label: tr('Hours a day'), value: String(e.dailyWorkingHours) },
                    { label: tr('Last revised'), value: r.lastRevisedOn ? formatDate(r.lastRevisedOn) : '', empty: tr('Never'), sub: r.lastRevisedOn ? changesWord(r.revisionCount) : tr('Since joining') },
                  ]}
                  amount={{ label: tr('Monthly salary'), value: formatINR(e.salaryPaise) }}
                  sections={[{ icon: 'briefcase', title: tr('Current terms'), content: <DetailList items={terms(e)} /> }]}
                  actions={
                    <>
                      <Button size="sm" variant="outline" icon="clock-history" onClick={() => onOpen(e.id)}>{tr('History')}</Button>
                      <MayEdit module="payroll"><Button size="sm" icon="pencil-square" onClick={() => setRevising(e)}>{tr('Revise salary')}</Button></MayEdit>
                    </>
                  }
                />
              );
            })}
            {view.total > 25 ? <div className="card sh-pager-card"><Pager view={view} /></div> : null}
          </div>
        )}
      </div>
      {revising ? (
        <SalaryReviseModal
          employee={revising}
          companyId={company.id}
          onClose={() => setRevising(null)}
          onSaved={() => {
            setRevising(null);
            setVersion((n) => n + 1);
          }}
        />
      ) : null}
    </PayLayout>
  );
}

function Show({ company, navigate, employeeId, onBack }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate']; employeeId: string; onBack: () => void }) {
  const [version, setVersion] = useState(0);
  const [revising, setRevising] = useState(false);
  const profile = useLoaded(() => payApi.getSalaryProfile(company.id, employeeId), [company.id, employeeId, version]);
  const data: { employee: PayEmployee; history: SalaryRevision[] } | null = profile.data;
  if (!data) return <Wait error={profile.error} onRetry={profile.reload} />;
  const { employee: e, history } = data;

  return (
    <PayLayout
      trail={trailOf(company, navigate, [{ label: 'Salary changes', onPress: onBack }, { label: e.name }])}
      sub={tr('Current terms and every revision on record, newest first. Nothing is ever overwritten.')}
      actions={<MayEdit module="payroll"><Button icon="pencil-square" onClick={() => setRevising(true)}>{tr('Revise salary')}</Button></MayEdit>}
    >
      <StaleNote error={profile.error} onRetry={profile.reload} />
      <div className="hm-greet ha-person">
        <div>
          <h2>{e.name}</h2>
          <p>{[e.code, e.designation, e.department].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="ha-person-pay">
          <small>{tr('Monthly salary')}</small>
          <b>{formatINR(e.salaryPaise)}</b>
        </span>
      </div>
      <div className="pf-detail-grid">
        <section className="card ha-card">
          <h3 className="ha-card-h">{tr('Current terms')}</h3>
          <DetailList items={terms(e)} />
        </section>
        <section className="card ha-card">
          <h3 className="ha-card-h">{tr('Revision history')} <small>{changesWord(history.length)}</small></h3>
          <ol className="pf-timeline">
            {history.map((h) => (
              <li key={h.batchId}>
                <span className="pf-tl-dot" aria-hidden="true" />
                <div className="pf-tl-body">
                  <b>{trf('Effective {0}', [formatDate(h.effectiveDate)])}</b>
                  <small>{trf('Saved {0} by {1}', [formatDateTime(h.changedAt), h.changedBy || tr('System')])}</small>
                  <ul className="ha-diff">
                    {h.changes.map((c) => (
                      <li key={c.id}>
                        <span className="ha-diff-f">{c.field}</span>
                        <span className="ha-diff-was">{c.previous || '-'}</span>
                        <span className="ha-diff-arrow" aria-label={tr('became')}>→</span>
                        <span className="ha-diff-now">{c.next || '-'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
            <li>
              <span className="pf-tl-dot" aria-hidden="true" />
              <div className="pf-tl-body">
                <b>{trf('Joined {0}', [formatDate(e.joiningDate)])}</b>
                <small>{history.length === 0 ? tr('Still on the terms recorded at joining.') : tr('The first revision above changed the terms recorded at joining.')}</small>
              </div>
            </li>
          </ol>
        </section>
      </div>

      {revising ? (
        <SalaryReviseModal
          employee={e}
          companyId={company.id}
          onClose={() => setRevising(false)}
          onSaved={() => {
            setRevising(false);
            setVersion((n) => n + 1);
          }}
        />
      ) : null}
    </PayLayout>
  );
}
