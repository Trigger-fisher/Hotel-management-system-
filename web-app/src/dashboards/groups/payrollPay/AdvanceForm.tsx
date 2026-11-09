'use client';

// payroll/partials/_advance-fields.blade.php inside the Add / Edit Advance modals of payroll/pages/advance.blade.php.
import { useState } from 'react';
import { formatINR } from '@shared/dashboards/format';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { type Employee } from '@shared/dashboards/payrollCore';
import { type Advance, type AdvanceInput, type RecoveryType } from '@shared/dashboards/payrollPay';
import { Bi, Modal, PmsDate, RequiredMark, Select, Textarea, Button } from '@/dashboards/pallav/ui';
import { useSubmit, useToast } from '@/components/ui';
import { Fld } from '../payrollCore/pms';
import { payApi, payToday } from './api';
import { PdfLink, istLocal } from '../payrollCore/load';

import { tr } from '@/lib/i18n/language';
/** Today: the mock's fixed date in mock mode, the hotel's IST date against the real server. */
const TODAY = payToday();

const rupees = (paise: number | null) => (paise ? String(paise / 100) : '');
const nowLocal = () => `${TODAY}T${new Date().toTimeString().slice(0, 5)}`;

/** How long a monthly recovery takes to clear, worked out as they type. */
function instalmentHint(amount: number, instalment: number): { text: string; warn: boolean } {
  if (!(amount > 0) || !(instalment > 0)) return { text: 'Enter the amount and instalment to see how long this takes to clear.', warn: false };
  if (instalment > amount) return { text: 'The instalment is more than the advance itself.', warn: true };
  const months = Math.ceil(amount / instalment);
  const last = amount - instalment * (months - 1);
  const money = (n: number) => formatINR(Math.round(n * 100));
  return { text: months === 1 ? 'Clears in a single month.' : `Clears in ${months} months${Math.abs(last - instalment) > 0.005 ? `, the last one being ${money(last)}.` : '.'}`, warn: false };
}

export function AdvanceFormModal({ companyId, companyName, advance, active, onClose, onSaved }: { companyId: string; companyName: string; advance: Advance | null; active: Employee[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState(advance?.employeeId ?? '');
  const [date, setDate] = useState(advance ? istLocal(advance.date) : nowLocal());
  const [touched, setTouched] = useState(false);
  const [amount, setAmount] = useState(rupees(advance?.amountPaise ?? null));
  const [type, setType] = useState<RecoveryType>(advance?.recoveryType ?? 'One Time');
  const [instalment, setInstalment] = useState(rupees(advance && advance.recoveryType === 'Monthly' ? advance.instalmentPaise : null));
  const [remarks, setRemarks] = useState(advance?.remarks ?? '');
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { busy, errors: serverErrors, submit } = useSubmit(['employeeId', 'date', 'amountPaise', 'recoveryType', 'instalmentPaise']);
  const errors = { ...localErrors, ...serverErrors };
  const uid = advance?.id ?? 'new';
  const cls = (k: string, base = 'form-control') => `${base} ${errors[k] ? 'is-invalid' : ''}`;
  const hint = instalmentHint(Number(amount), Number(instalment));

  const save = () => {
    const local: Record<string, string> = {};
    if (!employeeId) local.employeeId = 'Choose an employee.';
    if (!(Number(amount) > 0)) local.amountPaise = 'Enter the advance amount.';
    if (type === 'Monthly' && !(Number(instalment) > 0)) local.instalmentPaise = 'Enter the monthly instalment.';
    if (date > nowLocal()) local.date = 'The advance date cannot be in the future.';
    setLocalErrors(local);
    if (Object.keys(local).length) return;
    const input: AdvanceInput = {
      employeeId,
      // A new advance left at "now" is stamped with the moment it is saved; one picked by hand keeps its time.
      date: advance ? (touched ? date : advance.date) : touched ? date : TODAY,
      amountPaise: Math.round(Number(amount) * 100),
      recoveryType: type,
      instalmentPaise: type === 'Monthly' ? Math.round(Number(instalment) * 100) : null,
      remarks,
    };
    void submit(
      () => (advance ? payApi.updateAdvance(companyId, advance.id, input) : payApi.createAdvance(companyId, input)),
      () => {
        toast.show({ tone: 'success', text: 'Advance saved.' });
        onSaved();
      },
    );
  };

  return (
    <Modal
      open
      size="lg"
      className="pay-form-modal"
      centered={false}
      onSubmit={save}
      onClose={onClose}
      eyebrow={<>{advance ? tr("Advance") : `New · ${companyName}`}</>}
      title={advance ? advance.employeeName : 'Add advance'}
      footer={
        <>
          {advance ? (
            <PdfLink className="btn btn-outline-p me-auto" href={PDF_ROUTES.payrollAdvance(companyId, advance.id)} doc={`Advance receipt for ${advance.employeeName}`}>
              <Bi name="file-earmark-pdf" /> {tr("Advance PDF")}
            </PdfLink>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" disabled={busy}>{advance ? tr("Save changes") : tr("Save advance")}</Button>
        </>
      }
    >
      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="person" /> {tr("Who and when")}
          </div>
        </div>
        <div className="row g-3">
          <Fld md={6} id={`adv_emp_${uid}`} label={tr("Employee")} required error={errors.employeeId}>
            <Select id={`adv_emp_${uid}`} className={cls('employeeId', 'form-select')} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">{tr("Choose an employee…")}</option>
              {active.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.employeeCode})
                </option>
              ))}
              {advance && !active.some((e) => e.id === advance.employeeId) ? <option value={advance.employeeId}>{advance.employeeName}</option> : null}
            </Select>
          </Fld>
          <Fld md={6} id={`adv_date_${uid}`} label={tr("Advance date")} required hint="Cannot be in the future." error={errors.date}>
            <PmsDate
              type="datetime-local"
              id={`adv_date_${uid}`}
              className={cls('date')}
              max={nowLocal()}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setTouched(true);
              }}
            />
          </Fld>
        </div>
      </div>

      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="cash-stack" /> {tr("Amount and recovery")}
          </div>
          <div className="fs-hint">{tr("Salary processing recovers this automatically. A monthly advance is recovered in instalments until it clears; anything left carries into the next month.")}</div>
        </div>
        <div className="row g-3">
          <Fld md={6} id={`adv_amt_${uid}`} label={tr("Advance amount")} required error={errors.amountPaise}>
            <input type="number" step="0.01" min="0.01" id={`adv_amt_${uid}`} className={`${cls('amountPaise')} advance-amount`} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Fld>
          <Fld md={6} id={`adv_type_${uid}`} label={tr("Recovery")} required hint={type === 'One Time' ? 'Taken in full from the next salary.' : undefined} error={errors.recoveryType}>
            <Select id={`adv_type_${uid}`} className="form-select advance-type" value={type} onChange={(e) => setType(e.target.value as RecoveryType)}>
              <option value="One Time">{tr("One Time")}</option>
              <option value="Monthly">{tr("Monthly")}</option>
            </Select>
          </Fld>
          {type === 'Monthly' ? (
            <>
              <Fld
                md={6}
                id={`adv_inst_${uid}`}
                label={
                  <>
                    {tr("Instalment")}<RequiredMark />
                    <span className="opt">{tr("per month")}</span>
                  </>
                }
                error={errors.instalmentPaise}
              >
                <input type="number" step="0.01" min="0.01" id={`adv_inst_${uid}`} className={`${cls('instalmentPaise')} advance-instalment`} value={instalment} onChange={(e) => setInstalment(e.target.value)} />
              </Fld>
              <div className="col-md-6">
                <div className={`instalment-hint ${hint.warn ? 'warn' : ''}`}>
                  <Bi name="calendar2-check" />
                  <span>{hint.text}</span>
                </div>
              </div>
            </>
          ) : null}
          <Fld md={12} id={`adv_rem_${uid}`} label={tr("Instruction")} optional hint="Optional. Anything worth knowing about this entry.">
            <Textarea id={`adv_rem_${uid}`} className="form-control" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Fld>
        </div>
      </div>
    </Modal>
  );
}
