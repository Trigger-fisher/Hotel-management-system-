'use client';

// Record or edit an exit (hotel.payroll.resignations): one form in three short sections.
import { useState } from 'react';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { type Employee } from '@shared/dashboards/payrollCore';
import { separationStatuses, type Separation, type SeparationInput, type SeparationStatus } from '@shared/dashboards/payrollPay';
import { Bi, FormSection, Modal, PickGroup, PmsDate, Select, Textarea, Button } from '@/dashboards/pallav/ui';
import { useAsync, useSubmit, useToast } from '@/components/ui';
import { Fld } from '../payrollCore/pms';
import { payApi, payToday } from './api';
import { PdfLink, useMockPdf } from '../payrollCore/load';

import { tr } from '@/lib/i18n/language';
/** Today: the mock's fixed date in mock mode, the hotel's IST date against the real server. */
const TODAY = payToday();

const STATUS_ICON: Record<SeparationStatus, string> = { Pending: 'hourglass-split', Accepted: 'check2-circle', Relieved: 'box-arrow-right' };
const FIELDS = ['employeeId', 'type', 'resignationDate', 'lastWorkingDate', 'reason', 'remarks', 'status'];

export function SeparationFormModal({ companyId, companyName, item, active, onClose, onSaved }: { companyId: string; companyName: string; item: Separation | null; active: Employee[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const onFile = useMockPdf();
  const types = useAsync(() => payApi.masterChoices(companyId, 'separation_type'), [companyId]);
  const typeList = types.state.status === 'ready' ? types.state.data : [];
  const [v, setV] = useState<SeparationInput>({
    employeeId: item?.employeeId ?? '',
    type: item?.type ?? 'Resignation',
    resignationDate: item?.resignationDate ?? TODAY,
    lastWorkingDate: item?.lastWorkingDate ?? TODAY,
    reason: item?.reason ?? '',
    remarks: item?.remarks ?? '',
    status: item?.status ?? 'Pending',
    documentName: item?.documentName ?? null,
  });
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { busy, errors: serverErrors, submit } = useSubmit(FIELDS);
  const errors = { ...localErrors, ...serverErrors };
  const set = <K extends keyof SeparationInput>(k: K, val: SeparationInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const cls = (k: string, base = 'form-control') => `${base} ${errors[k] ? 'is-invalid' : ''}`;

  const save = () => {
    const local: Record<string, string> = {};
    if (!v.employeeId) local.employeeId = tr('Choose the person.');
    if (!v.resignationDate) local.resignationDate = 'Enter the notice date.';
    if (!v.lastWorkingDate) local.lastWorkingDate = 'Enter the last working day.';
    else if (v.resignationDate && v.lastWorkingDate < v.resignationDate) local.lastWorkingDate = 'The last working day cannot be before the notice date.';
    if (!v.reason.trim()) local.reason = 'Enter the reason.';
    setLocalErrors(local);
    if (Object.keys(local).length) return;
    void submit(
      () => (item ? payApi.updateSeparation(companyId, item.id, v) : payApi.createSeparation(companyId, v)),
      () => {
        toast.show({ tone: 'success', text: item ? tr('Exit saved.') : tr('Exit recorded.') });
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
      onClose={onClose}
      eyebrow={<>{item ? item.type : companyName}</>}
      title={item ? item.employeeName : tr('Record exit')}
      onSubmit={save}
      footer={
        <>
          {item ? (
            <PdfLink className="btn btn-outline-p me-auto" href={PDF_ROUTES.separation(companyId, item.id)} doc={`Exit summary for ${item.employeeName}`}>
              <Bi name="file-earmark-pdf" /> {tr('Exit summary')}
            </PdfLink>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr('Cancel')}</Button>
          <Button type="submit" disabled={busy}>{item ? tr('Save changes') : tr('Save exit')}</Button>
        </>
      }
    >
      <FormSection icon="person" title={tr('Who and when')}>
        <div className="row g-3">
          <Fld md={7} label={tr('Staff')} required error={errors.employeeId} hint={item ? undefined : tr('Only active staff are listed.')}>
            {item ? (
              <input className="form-control" value={item.employeeName} disabled readOnly />
            ) : (
              <Select className={cls('employeeId', 'form-select')} value={v.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
                <option value="">{tr('Choose a person…')}</option>
                {active.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.employeeCode})
                  </option>
                ))}
              </Select>
            )}
          </Fld>
          <Fld md={5} label={tr('Type')} required error={errors.type}>
            <Select className={cls('type', 'form-select')} value={v.type} onChange={(e) => set('type', e.target.value)}>
              {[...typeList, ...(typeList.includes(v.type) ? [] : [v.type])].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </Fld>
          <Fld md={6} label={tr('Notice given on')} required error={errors.resignationDate}>
            <PmsDate type="date" className={cls('resignationDate')} value={v.resignationDate} onChange={(e) => set('resignationDate', e.target.value)} />
          </Fld>
          <Fld md={6} label={tr('Last working day')} required error={errors.lastWorkingDate}>
            <PmsDate type="date" className={cls('lastWorkingDate')} value={v.lastWorkingDate} onChange={(e) => set('lastWorkingDate', e.target.value)} />
          </Fld>
        </div>
      </FormSection>

      <FormSection icon="chat-left-text" title={tr('Why')}>
        <div className="row g-3">
          <Fld md={12} label={tr('Reason')} required error={errors.reason}>
            <Textarea className={cls('reason')} rows={3} placeholder={tr('Why is the person leaving?')} value={v.reason} onChange={(e) => set('reason', e.target.value)} />
          </Fld>
          <Fld md={12} label={tr('Notes')} optional>
            <Textarea className="form-control" rows={2} placeholder={tr('Handover, dues cleared, would take back…')} value={v.remarks} onChange={(e) => set('remarks', e.target.value)} />
          </Fld>
        </div>
      </FormSection>

      <FormSection icon="flag" title={tr('Where it stands')} hint={tr('Relieved takes the person off the staff list and lets you give the experience letter.')}>
        <PickGroup
          label={tr('Status')}
          value={v.status}
          onChange={(x) => set('status', x)}
          choices={separationStatuses.map((x: SeparationStatus) => ({ value: x, icon: STATUS_ICON[x], title: x }))}
        />
        <div className="row g-3 mt-1">
          <Fld md={12} label={tr('Signed acceptance')} optional hint={tr('The signed resignation acceptance or relieving letter: PDF or a photo.')}>
            <input type="file" className="form-control" accept="application/pdf,image/*" onChange={(e) => set('documentName', e.target.files?.[0]?.name ?? item?.documentName ?? null)} />
            {item?.documentName ? (
              <a
                className="ha-link d-inline-flex align-items-center gap-1 mt-2"
                href="#"
                title={item.documentName}
                onClick={(e) => {
                  e.preventDefault();
                  onFile(`Acceptance document "${item.documentName}"`, { print: false })(e);
                }}
              >
                <Bi name="paperclip" /> {tr('View the current file')}
              </a>
            ) : null}
          </Fld>
        </div>
      </FormSection>
    </Modal>
  );
}