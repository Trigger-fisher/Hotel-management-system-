'use client';

// The salary report table: one row per person, the name column stays put while the figures scroll in their own box, totals at the foot.
import { useState } from 'react';

import { formatINR } from '@shared/dashboards/format';
import { paymentStatusLabel, type SalaryRecord } from '@shared/dashboards/payrollPay';
import { Bi, ListSearch, Table } from '@/dashboards/pallav/ui';
import { fixed } from '../payrollCore/load';

import { tr } from '@/lib/i18n/language';
const STATUS: Record<string, { tone: string; icon: string }> = {
  Pending: { tone: 'pending', icon: 'hourglass-split' },
  Processing: { tone: 'processing', icon: 'arrow-repeat' },
  'On Hold': { tone: 'hold', icon: 'pause-circle' },
  'Partially Paid': { tone: 'partial', icon: 'pie-chart' },
  Paid: { tone: 'paid', icon: 'check-circle' },
  Failed: { tone: 'failed', icon: 'x-circle' },
};

const sum = (rows: SalaryRecord[], f: (r: SalaryRecord) => number) => rows.reduce((n, r) => n + f(r), 0);
const ded = (r: SalaryRecord) => r.deductions.reduce((n, d) => n + d.paise, 0);
const money = (p: number) => (p ? formatINR(p) : '-');

export function ReportTable({ rows: all, emptyMessage = 'No salary worked out for this choice.' }: { rows: SalaryRecord[]; emptyMessage?: string }) {
  const [typed, setTyped] = useState('');
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = words.length ? all.filter((r) => words.every((w) => `${r.employeeCode} ${r.employeeName} ${r.designation}`.toLowerCase().includes(w))) : all;
  const message = words.length && all.length > 0 ? tr('Nobody matches this search.') : tr(emptyMessage);
  return (
    <>
      {all.length > 6 ? (
        <div className="d-flex justify-content-end p-3 pb-2">
          <ListSearch value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={tr('Search staff')} />
        </div>
      ) : null}
      <div className="table-responsive rp-scroll" tabIndex={0} role="region" aria-label={tr('Salary report')}>
        <Table className={`table mb-0 pay-report rp-table ${rows.length === 0 ? 'is-empty' : ''}`.trim()}>
          <thead>
            <tr>
              <th>{tr('Staff')}</th>
              <th className="money">{tr('Salary')}</th>
              <th className="text-center">{tr('Paid days')}</th>
              <th className="money">{tr('For attendance')}</th>
              <th className="money">{tr('Overtime')}</th>
              <th className="money">{tr('Bonus and incentive')}</th>
              <th className="money">{tr('Deductions')}</th>
              <th className="money">{tr('Advance taken back')}</th>
              <th className="money">{tr('Net salary')}</th>
              <th>{tr('Payment')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="rp-empty">{message}</td>
              </tr>
            ) : null}
            {rows.map((r) => {
              const meta = STATUS[r.paymentStatus] ?? STATUS.Pending!;
              return (
                <tr key={r.id}>
                  <td>
                    <span className="cell-main">{r.employeeName}</span>
                    <span className="cell-sub">{[r.employeeCode, r.designation].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="money">{formatINR(r.monthlySalaryPaise)}</td>
                  <td className="text-center">{fixed(r.payableDays)}</td>
                  <td className="money">{formatINR(r.attendanceSalaryPaise)}</td>
                  <td className="money">
                    {money(r.otAmountPaise)}
                    {r.otHours ? <span className="cell-sub">{fixed(r.otHours)} h</span> : null}
                  </td>
                  <td className="money">{money(r.bonusPaise + r.incentivePaise)}</td>
                  <td className="money">{ded(r) ? `- ${formatINR(ded(r))}` : '-'}</td>
                  <td className="money">
                    {r.advanceRecoveryPaise ? `- ${formatINR(r.advanceRecoveryPaise)}` : '-'}
                    {r.pendingAdvancePaise ? <span className="cell-sub">{formatINR(r.pendingAdvancePaise)} {tr('still due')}</span> : null}
                  </td>
                  <td className="money rp-net">{formatINR(r.netPaise)}</td>
                  <td>
                    <span className={`pay-pill pay-${meta.tone}`}>
                      <Bi name={meta.icon} />
                      {paymentStatusLabel[r.paymentStatus]}
                    </span>
                    {r.paymentMode ? <span className="cell-sub">{r.paymentMode}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              <tr className="rp-total">
                <td>{tr('Total')}</td>
                <td className="money">{formatINR(sum(rows, (r) => r.monthlySalaryPaise))}</td>
                <td className="text-center">{fixed(sum(rows, (r) => r.payableDays))}</td>
                <td className="money">{formatINR(sum(rows, (r) => r.attendanceSalaryPaise))}</td>
                <td className="money">{money(sum(rows, (r) => r.otAmountPaise))}</td>
                <td className="money">{money(sum(rows, (r) => r.bonusPaise + r.incentivePaise))}</td>
                <td className="money">{sum(rows, ded) ? `- ${formatINR(sum(rows, ded))}` : '-'}</td>
                <td className="money">{sum(rows, (r) => r.advanceRecoveryPaise) ? `- ${formatINR(sum(rows, (r) => r.advanceRecoveryPaise))}` : '-'}</td>
                <td className="money rp-net">{formatINR(sum(rows, (r) => r.netPaise))}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </Table>
      </div>
    </>
  );
}
