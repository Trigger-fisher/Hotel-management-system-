'use client';

// payroll/partials/_salary-revise.blade.php: the revision dialog on one employee's Salary Update page.
import { useState } from 'react';
import { formatINR } from '@shared/dashboards/format';
import { type PayEmployee, type SalaryRevisionInput } from '@shared/dashboards/payrollPay';
import { Bi, Modal, PmsDate, Select, Button } from '@/dashboards/pallav/ui';
import { useAsync, useSubmit, useToast } from '@/components/ui';
import { Fld } from '../payrollCore/pms';
import { fixed } from '../payrollCore/load';
import { payApi, payToday } from './api';

import { tr } from '@/lib/i18n/language';
/** Today: the mock's fixed date in mock mode, the hotel's IST date against the real server. */
const TODAY = payToday();

const rupees = (paise: number | null) => (paise ? String(paise / 100) : '');

export function SalaryReviseModal({ employee: e, companyId, onClose, onSaved }: { employee: PayEmployee; companyId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const modes = useAsync(() => payApi.masterChoices(companyId, 'salary_payment_mode'), [companyId]);
  const modeList = modes.state.status === 'ready' ? modes.state.data : ['Cash', 'Bank'];
  const [v, setV] = useState<SalaryRevisionInput>({
    effectiveDate: TODAY,
    salaryPaise: e.salaryPaise,
    designation: e.designation,
    department: e.department,
    dailyWorkingHours: String(e.dailyWorkingHours),
    paymentMode: e.paymentMode,
    bankName: e.bankName,
    accountHolderName: e.accountHolderName,
    ifscCode: e.ifscCode,
    branchName: e.branchName,
  });
  const [salary, setSalary] = useState(rupees(e.salaryPaise));
  const [account, setAccount] = useState(e.accountNumber ?? '');
  const { busy, errors, submit } = useSubmit(['effectiveDate', 'salaryPaise', 'dailyWorkingHours', 'paymentMode', 'bankName', 'accountNumber', 'ifscCode']);
  const set = <K extends keyof SalaryRevisionInput>(k: K, val: SalaryRevisionInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const cls = (k: string, base = 'form-control') => `${base} ${errors[k] ? 'is-invalid' : ''}`;
  const uid = e.id;

  const next = Number.parseFloat(salary);
  const current = e.salaryPaise / 100;
  const diff = next - current;
  const pct = current > 0 ? `${fixed(Math.abs((diff / current) * 100), 1)}%` : '';

  const save = () =>
    void submit(
      () => payApi.reviseSalary(companyId, e.id, { ...v, salaryPaise: Math.round((Number(salary) || 0) * 100), accountNumber: account.trim() }),
      (r) => {
        toast.show({ tone: 'success', text: r.message });
        onSaved();
      },
    );

  return (
    <Modal
      open
      size="xl"
      className="pay-form-modal"
      centered={false}
      onSubmit={save}
      onClose={onClose}
      eyebrow={<>{tr("Salary revision ·")} {e.code}</>}
      title={e.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" disabled={busy}>{tr("Save salary change")}</Button>
        </>
      }
    >
      <div className="ba-compare mb-4">
        <div>
          <div className="ba-label">{tr("Current salary")}</div>
          <div className="ba-value">{formatINR(e.salaryPaise)}</div>
        </div>
        <Bi name="arrow-right" className="ba-to" />
        <div className="ba-new">
          <div className="ba-label">{tr("New salary")}</div>
          <div className="ba-value">{Number.isNaN(next) ? '—' : formatINR(Math.round(next * 100))}</div>
          {Number.isNaN(next) ? (
            <div className="ba-delta same">{tr("Enter a salary")}</div>
          ) : Math.abs(diff) < 0.005 ? (
            <div className="ba-delta same">{tr("No change")}</div>
          ) : (
            <div className={`ba-delta ${diff > 0 ? 'up' : 'down'}`}>
              {diff > 0 ? '▲ ' : '▼ '}
              {formatINR(Math.round(Math.abs(diff) * 100))}
              {pct ? ` (${pct})` : ''}
            </div>
          )}
        </div>
      </div>

      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="cash-coin" /> {tr("Pay")}
          </div>
          <div className="fs-hint">{tr("The effective date is what the revision is filed under in the history.")}</div>
        </div>
        <div className="row g-3">
          <Fld md={6} id={`su_date_${uid}`} label={tr("Effective date")} required error={errors.effectiveDate}>
            <PmsDate type="date" id={`su_date_${uid}`} className={cls('effectiveDate')} value={v.effectiveDate} onChange={(x) => set('effectiveDate', x.target.value)} />
          </Fld>
          <Fld md={6} id={`su_sal_${uid}`} label={tr("New salary")} required error={errors.salaryPaise}>
            <input type="number" step="0.01" min="0" id={`su_sal_${uid}`} className={cls('salaryPaise')} value={salary} onChange={(x) => setSalary(x.target.value)} />
          </Fld>
          <Fld md={6} id={`su_hrs_${uid}`} label={tr("Working hours")} required hint="Per day. Overtime is paid against this." error={errors.dailyWorkingHours}>
            <input type="number" step="0.5" min="0.5" max="24" id={`su_hrs_${uid}`} className={cls('dailyWorkingHours')} value={v.dailyWorkingHours} onChange={(x) => set('dailyWorkingHours', x.target.value)} />
          </Fld>
          <Fld md={6} id={`su_mode_${uid}`} label={tr("Payment mode")} required error={errors.paymentMode}>
            <Select id={`su_mode_${uid}`} className="form-select payment-mode" value={v.paymentMode} onChange={(x) => set('paymentMode', x.target.value)}>
              {[...modeList, ...(modeList.includes(v.paymentMode) ? [] : [v.paymentMode])].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Fld>
        </div>
      </div>

      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="briefcase" /> {tr("Role")}
          </div>
        </div>
        <div className="row g-3">
          <Fld md={6} id={`su_desig_${uid}`} label={tr("Designation")}>
            <input id={`su_desig_${uid}`} className="form-control" value={v.designation} onChange={(x) => set('designation', x.target.value)} />
          </Fld>
          <Fld md={6} id={`su_dept_${uid}`} label={tr("Department")}>
            <input id={`su_dept_${uid}`} className="form-control" value={v.department} onChange={(x) => set('department', x.target.value)} />
          </Fld>
        </div>
      </div>

      {v.paymentMode === 'Bank' ? (
        <div className="form-section">
          <div className="fs-head">
            <div className="fs-title">
              <Bi name="bank" /> {tr("Bank details")}
            </div>
            <div className="fs-hint">{tr("Needed only while salary is paid to a bank.")}</div>
          </div>
          <div className="row g-3">
            <Fld md={6} id={`su_bank_${uid}`} label={tr("Bank name")} error={errors.bankName}>
              <input id={`su_bank_${uid}`} className={cls('bankName')} value={v.bankName} onChange={(x) => set('bankName', x.target.value)} />
            </Fld>
            <Fld md={6} id={`su_holder_${uid}`} label={tr("Account holder")}>
              <input id={`su_holder_${uid}`} className="form-control" value={v.accountHolderName} onChange={(x) => set('accountHolderName', x.target.value)} />
            </Fld>
            <Fld md={4} id={`su_acc_${uid}`} label={tr("Account number")} error={errors.accountNumber}>
              <input id={`su_acc_${uid}`} className={cls('accountNumber')} value={account} onChange={(x) => setAccount(x.target.value)} />
            </Fld>
            <Fld md={4} id={`su_ifsc_${uid}`} label={tr("IFSC code")} error={errors.ifscCode}>
              <input id={`su_ifsc_${uid}`} className={`${cls('ifscCode')} text-uppercase`} value={v.ifscCode} onChange={(x) => set('ifscCode', x.target.value.toUpperCase())} />
            </Fld>
            <Fld md={4} id={`su_branch_${uid}`} label={tr("Branch")}>
              <input id={`su_branch_${uid}`} className="form-control" value={v.branchName} onChange={(x) => set('branchName', x.target.value)} />
            </Fld>
          </div>
        </div>
      ) : null}

      <div className="form-text mt-3">
        <Bi name="info-circle" /> {tr("Only the fields you actually change are written to the update history. Earlier records are never overwritten.")}
      </div>
    </Modal>
  );
}
