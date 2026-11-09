'use client';

// Rejoin a former staff member: from the Resignation page (one person) or from Staff (a picker).
// As the Blade, the modal is one <form> around header, body and footer: Enter in a field saves, like the other payroll modals.
import { useEffect, useRef, useState } from 'react';
import { formatMonth } from '@shared/dashboards/format';
import { type PayrollOptions } from '@shared/dashboards/payrollCore';
import { type RejoinInput, type Separation } from '@shared/dashboards/payrollPay';
import { Modal, PhoneField, PmsDate, RequiredMark, Select, Button } from '@/dashboards/pallav/ui';
import { useAsync, useSubmit, useToast } from '@/components/ui';
import { Fld } from '../payrollCore/pms';
import { payrollApi } from '../payrollCore/api';
import { payApi, payToday } from './api';

import { tr, trf } from '@/lib/i18n/language';
/** Today: the mock's fixed date in mock mode, the hotel's IST date against the real server. */
const TODAY = payToday();

const rupees = (paise: number | null) => (paise ? String(paise / 100) : '');

function RejoinFields({ companyId, item, onSaved, onReady }: { companyId: string; item: Separation; onSaved: () => void; onReady: (save: () => void, busy: boolean) => void }) {
  const toast = useToast();
  const options = useAsync(() => payrollApi.getOptions(companyId), [companyId]);
  const employee = useAsync(() => payrollApi.getEmployee(companyId, item.employeeId), [companyId, item.employeeId]);
  const o: PayrollOptions | null = options.state.status === 'ready' ? options.state.data : null;
  const e = employee.state.status === 'ready' ? employee.state.data : null;
  const [v, setV] = useState<RejoinInput>({
    joiningDate: TODAY, designation: item.designation, department: '', salaryPaise: null, dailyWorkingHours: '9', phone: '', contactCountry: '91', address: '', paymentMode: 'Cash', bankName: '', accountHolderName: '', branchName: '', ifscCode: '',
  });
  const [salary, setSalary] = useState('');
  const [account, setAccount] = useState('');
  const [filled, setFilled] = useState(false);
  // The previous record is carried over once it has loaded.
  if (e && !filled) {
    setFilled(true);
    setV((p) => ({ ...p, designation: e.designation, department: e.department, dailyWorkingHours: String(e.dailyWorkingHours), phone: e.contactNumber, contactCountry: e.contactCountry, address: e.address, paymentMode: e.paymentMode, bankName: e.bankName, accountHolderName: e.accountHolderName, branchName: e.branchName, ifscCode: e.ifscCode, salaryPaise: e.salaryPaise }));
    setSalary(rupees(e.salaryPaise));
    setAccount(e.accountNumber ?? '');
  }
  const { busy, errors, submit } = useSubmit(['joiningDate', 'designation', 'salaryPaise', 'dailyWorkingHours', 'phone', 'paymentMode', 'bankName', 'accountHolderName', 'accountNumber', 'ifscCode', 'address']);
  const set = <K extends keyof RejoinInput>(k: K, val: RejoinInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const bank = v.paymentMode === 'Bank';
  const cls = (k: string, base = 'form-control') => `${base} ${errors[k] ? 'is-invalid' : ''}`;
  const uid = item.id;

  const save = () =>
    void submit(
      () => payApi.rejoin(companyId, item.id, { ...v, salaryPaise: Math.round((Number(salary) || 0) * 100) || null, ...(account.trim() ? { accountNumber: account.trim() } : {}) }),
      () => {
        toast.show({ tone: 'success', text: trf("{0} has rejoined.", [item.employeeName]) });
        onSaved();
      },
    );
  // The modal's form submits through this (the fields and their state live here).
  useEffect(() => {
    onReady(save, busy);
  });

  return (
    <>
      <p className="ha-ms-why mb-3">{trf('Filled in from the last record of {0}. Change what is different, then Rejoin. Their staff ID and past payroll stay.', [item.employeeName])}</p>
      <div className="row g-3">
        <Fld md={4} label={tr("Staff ID")} hint={tr("Kept, so the history stays linked.")}>
          <input className="form-control" value={e?.employeeCode ?? ''} disabled readOnly />
        </Fld>
        <Fld md={4} label={tr("New joining date")} required error={errors.joiningDate}>
          <PmsDate type="date" className={cls('joiningDate')} value={v.joiningDate} onChange={(x) => set('joiningDate', x.target.value)} />
        </Fld>
        <Fld md={4} label={tr("Designation")} required error={errors.designation}>
          <input className={cls('designation')} value={v.designation} onChange={(x) => set('designation', x.target.value)} />
        </Fld>
        <Fld md={4} label={tr("Department")} optional>
          <input className="form-control" value={v.department} onChange={(x) => set('department', x.target.value)} />
        </Fld>
        <Fld md={4} label={tr("Monthly salary")} required error={errors.salaryPaise}>
          <input type="number" step="0.01" min="0" className={cls('salaryPaise')} value={salary} onChange={(x) => setSalary(x.target.value)} />
        </Fld>
        <Fld md={4} label={tr("Hours a day")} required error={errors.dailyWorkingHours}>
          <input type="number" step="0.5" min="0.5" max="24" className={cls('dailyWorkingHours')} value={v.dailyWorkingHours} onChange={(x) => set('dailyWorkingHours', x.target.value)} />
        </Fld>
        <Fld md={5} label={tr("Mobile number")} optional error={errors.phone}>
          <PhoneField id={`rj_mobile_${uid}`} country={v.contactCountry ?? '91'} number={v.phone} countries={o?.phoneCountries ?? []} onCountry={(d) => set('contactCountry', d)} onNumber={(x) => set('phone', x)} invalid={!!errors.phone} />
        </Fld>
        <Fld md={7} label={tr("Address")} optional error={errors.address}>
          <input className="form-control" value={v.address ?? ''} onChange={(x) => set('address', x.target.value)} />
        </Fld>
        <Fld md={4} label={tr("Paid by")} required error={errors.paymentMode}>
          <Select className="form-select payment-mode" value={v.paymentMode} onChange={(x) => set('paymentMode', x.target.value)}>
            {[...(o?.paymentModes ?? ['Cash', 'Bank'])].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Fld>
        {bank ? (
          <>
            <div className="col-12">
              <hr className="mt-2" />
              <div className="fw-bold text-p700">
                {tr("Bank")}
              </div>
            </div>
            <Fld md={6} label={tr("Bank")} required error={errors.bankName}>
              <input className={cls('bankName')} value={v.bankName} onChange={(x) => set('bankName', x.target.value)} />
            </Fld>
            <Fld md={6} label={tr("Account holder")} required error={errors.accountHolderName}>
              <input className={cls('accountHolderName')} value={v.accountHolderName} onChange={(x) => set('accountHolderName', x.target.value)} />
            </Fld>
            <Fld md={4} label={tr("Account number")} required error={errors.accountNumber}>
              <input className={cls('accountNumber')} value={account} onChange={(x) => setAccount(x.target.value)} />
            </Fld>
            <Fld md={4} label={tr("IFSC")} required error={errors.ifscCode}>
              <input className={`${cls('ifscCode')} text-uppercase`} value={v.ifscCode} onChange={(x) => set('ifscCode', x.target.value.toUpperCase())} />
            </Fld>
            <Fld md={4} label={tr("Branch")} optional>
              <input className="form-control" value={v.branchName ?? ''} onChange={(x) => set('branchName', x.target.value)} />
            </Fld>
          </>
        ) : null}
    </div>
    </>
  );
}

/**
 * Rejoin an employee who left. From the Resignation page it is one person (`item`); from Staff, `choices` lists everyone who can rejoin
 * and a picker above chooses whose details to show.
 */
export function RejoinModal({ companyId, item, choices, onClose, onSaved }: { companyId: string; item?: Separation; choices?: Separation[]; onClose: () => void; onSaved: () => void }) {
  const [pickedId, setPickedId] = useState(item?.id ?? '');
  const current = item ?? choices?.find((s) => s.id === pickedId);
  const saver = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      size="lg"
      className="pay-form-modal"
      centered={false}
      onClose={onClose}
      onSubmit={() => {
        if (current) saver.current?.();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr("Cancel")}</Button>
          <Button icon="check-lg" type="submit" disabled={!current || busy}>{tr("Rejoin")}</Button>
        </>
      }
      eyebrow={item ? tr('Rejoining') : tr('Staff')}
      title={item ? item.employeeName : tr('Rejoin a former staff member')}
    >
      {choices ? (
        <div>
          <div className="mb-3">
            <label className="form-label" htmlFor="rejoinPicker">
              {tr("Who is coming back")}<RequiredMark />
            </label>
            <Select className="form-select" id="rejoinPicker" value={pickedId} onChange={(e) => setPickedId(e.target.value)}>
              <option value="">{tr("Choose who is rejoining…")}</option>
              {choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {trf('{0}, left {1}', [s.employeeName, formatMonth(s.lastWorkingDate.slice(0, 7))])}
                </option>
              ))}
            </Select>
            <div className="fs-hint">{tr("Their old record is used again, so history and documents stay with it.")}</div>
          </div>
        </div>
      ) : null}
      {current ? <RejoinFields
          key={current.id}
          companyId={companyId}
          item={current}
          onSaved={onSaved}
          onReady={(save, b) => {
            saver.current = save;
            if (b !== busy) setBusy(b);
          }}
        /> : null}
    </Modal>
  );
}
