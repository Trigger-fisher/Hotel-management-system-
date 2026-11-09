'use client';

// Add or edit a bonus or incentive (hotel.payroll.bonus).
import { useState } from 'react';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { type Employee } from '@shared/dashboards/payrollCore';
import { type BonusEntry, type BonusInput, type BonusType } from '@shared/dashboards/payrollPay';
import { Bi, FormSection, Modal, PickGroup, PmsDate, Select, Textarea, Button } from '@/dashboards/pallav/ui';
import { useSubmit, useToast } from '@/components/ui';
import { Fld } from '../payrollCore/pms';
import { payApi, payToday } from './api';
import { PdfLink, istLocal } from '../payrollCore/load';

import { tr, trf } from '@/lib/i18n/language';
/** Today: the mock's fixed date in mock mode, the hotel's IST date against the real server. */
const TODAY = payToday();

const rupees = (paise: number | null) => (paise ? String(paise / 100) : '');
const nowLocal = () => `${TODAY}T${new Date().toTimeString().slice(0, 5)}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function BonusFormModal({ companyId, companyName, entry, active, onClose, onSaved }: { companyId: string; companyName: string; entry: BonusEntry | null; active: Employee[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [employeeId, setEmployeeId] = useState(entry?.employeeId ?? '');
  const [date, setDate] = useState(entry ? istLocal(entry.date) : nowLocal());
  const [type, setType] = useState<BonusType>(entry?.type ?? 'Bonus');
  const [amount, setAmount] = useState(rupees(entry?.amountPaise ?? null));
  const [remarks, setRemarks] = useState(entry?.remarks ?? '');
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { busy, errors: serverErrors, submit } = useSubmit(['employeeId', 'date', 'type', 'amountPaise']);
  const errors = { ...localErrors, ...serverErrors };
  const uid = entry?.id ?? 'new';
  const cls = (k: string, base = 'form-control') => `${base} ${errors[k] ? 'is-invalid' : ''}`;
  const monthStart = `${TODAY.slice(0, 7)}-01T00:00`;
  const monthName = `${MONTHS[Number(TODAY.slice(5, 7)) - 1]} ${TODAY.slice(0, 4)}`;

  const save = () => {
    const local: Record<string, string> = {};
    if (!employeeId) local.employeeId = tr('Choose the person.');
    if (!(Number(amount) > 0)) local.amountPaise = 'Enter the amount.';
    if (date > nowLocal() || date < monthStart) local.date = `The date must fall within ${monthName}.`;
    setLocalErrors(local);
    if (Object.keys(local).length) return;
    const input: BonusInput = { employeeId, date, type, amountPaise: Math.round(Number(amount) * 100), remarks };
    void submit(
      () => (entry ? payApi.updateBonus(companyId, entry.id, input) : payApi.createBonus(companyId, input)),
      () => {
        toast.show({ tone: 'success', text: trf('{0} saved.', [type]) });
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
      eyebrow={<>{entry ? entry.type : companyName}</>}
      title={entry ? entry.employeeName : tr('Add bonus or incentive')}
      footer={
        <>
          {entry ? (
            <PdfLink className="btn btn-outline-p me-auto" href={PDF_ROUTES.payrollBonus(companyId, entry.id)} doc={`${entry.type} voucher for ${entry.employeeName}`}>
              <Bi name="file-earmark-pdf" /> {tr("Voucher")}
            </PdfLink>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" disabled={busy}>{entry ? tr("Save changes") : trf("Save {0}", [type.toLowerCase()])}</Button>
        </>
      }
    >
      <FormSection icon="gift" title={tr('What is paid')} hint={tr('Paid on top of salary, as its own line on the slip.')}>
        <PickGroup
          label={tr('Type')}
          value={type}
          onChange={setType}
          choices={[
            { value: 'Bonus', icon: 'gift', title: tr('Bonus'), text: tr('A one-off reward') },
            { value: 'Incentive', icon: 'graph-up-arrow', title: tr('Incentive'), text: tr('For a target or sales') },
          ]}
        />
        <div className="row g-3 mt-1">
          <Fld md={6} id={`bon_emp_${uid}`} label={tr('Staff')} required error={errors.employeeId}>
            <Select id={`bon_emp_${uid}`} className={cls('employeeId', 'form-select')} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">{tr('Choose a person…')}</option>
              {active.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.employeeCode})
                </option>
              ))}
              {entry && !active.some((e) => e.id === entry.employeeId) ? <option value={entry.employeeId}>{entry.employeeName}</option> : null}
            </Select>
          </Fld>
          <Fld md={6} id={`bon_amt_${uid}`} label={tr('Amount')} required error={errors.amountPaise}>
            <input type="number" inputMode="decimal" step="0.01" min="0.01" id={`bon_amt_${uid}`} className={cls('amountPaise')} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Fld>
          <Fld md={6} id={`bon_date_${uid}`} label={tr('Date')} required hint={trf('Within {0}: it joins this month\'s salary.', [monthName])} error={errors.date}>
            <PmsDate type="datetime-local" id={`bon_date_${uid}`} className={cls('date')} min={monthStart} max={nowLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Fld>
          <Fld md={6} id={`bon_rem_${uid}`} label={tr('Instruction')} optional>
            <Textarea id={`bon_rem_${uid}`} className="form-control" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Fld>
        </div>
      </FormSection>
    </Modal>
  );
}
