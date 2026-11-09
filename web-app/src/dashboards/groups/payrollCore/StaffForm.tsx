'use client';

// Add or edit a staff member (hotel.payroll.staff): the person, the job and the pay first, the rest folded under "More about the person".
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BANK_PAYMENT_MODE, emptyEmployeeInput, employeeToInput, validateEmployee, type DeductionType, type Employee, type EmployeeInput, type PayrollCompanyRow, type PayrollOptions } from '@shared/dashboards/payrollCore';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { Bi, FormSection, Modal, PhoneField, PickGroup, Select, Textarea, Button } from '@/dashboards/pallav/ui';
import { useAsync, useSubmit, useToast } from '@/components/ui';
import { payrollApi } from './api';
import { Fld, initials } from './pms';
import { PdfLink } from './load';
import { nextStaffCode } from './staffCode';

import { tr, trf } from '@/lib/i18n/language';
const KEYS = Object.keys(emptyEmployeeInput());
const MORE_KEYS = ['dateOfBirth', 'gender', 'address', 'nationality', 'countryAndPincode', 'emergencyContactName', 'emergencyContactRelation', 'emergencyContactNumber', 'qualification', 'qualificationInstitution', 'skills', 'responsibilities', 'idProofType', 'idProofNumber'];
const MODE_ICON: Record<string, string> = { Bank: 'bank', Cash: 'cash-coin', UPI: 'phone', Cheque: 'card-text' };

const rupees = (paise: number) => (paise ? String(paise / 100) : '');
const toPaise = (v: string) => Math.round((Number(v) || 0) * 100);

function FileBox({ id, current, label, accept, onName }: { id: string; current?: string | null; label: string; accept: string; onName: (name: string) => void }) {
  return (
    <>
      <input id={id} type="file" className="form-control" accept={accept} onChange={(e) => onName(e.target.files?.[0]?.name ?? '')} />
      {current ? (
        <div className="form-text">
          <Bi name="paperclip" /> {label}: {current}
        </div>
      ) : null}
    </>
  );
}

export function EmployeeFormModal({ company, employee, taken, onClose, onSaved, onAdded }: { company: PayrollCompanyRow; employee: Employee | null; taken: Employee[]; onClose: () => void; onSaved: () => void; onAdded?: () => void }) {
  const toast = useToast();
  const options = useAsync(() => payrollApi.getOptions(company.id), [company.id]);
  const o: PayrollOptions | null = options.state.status === 'ready' ? options.state.data : null;
  const [added, setAdded] = useState<string[]>([]);
  const codes = [...taken.map((x) => x.employeeCode), ...added];
  const fresh = (list: string[]) => ({ ...emptyEmployeeInput(), employeeCode: nextStaffCode(list) });
  const [v, setV] = useState<EmployeeInput>(() => (employee ? employeeToInput(employee) : fresh(taken.map((x) => x.employeeCode))));
  const [salary, setSalary] = useState(() => rupees(employee?.salaryPaise ?? 0));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { busy, errors: serverErrors, submit } = useSubmit(KEYS);
  const errors = { ...localErrors, ...serverErrors };
  const [moreOpen, setMoreOpen] = useState(false);
  const set = <K extends keyof EmployeeInput>(k: K, val: EmployeeInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const bank = v.paymentMode === BANK_PAYMENT_MODE;
  const uid = employee?.id ?? 'new';
  const cls = (k: string, base = 'form-control') => `${base} ${errors[k] ? 'is-invalid' : ''}`;
  const firstField = useRef<HTMLDivElement>(null);

  const [photo, setPhoto] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string>(employee?.photoName ?? '');
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo);
    },
    [photo],
  );

  const others = taken.filter((x) => x.id !== employee?.id);
  const codeTaken = v.employeeCode.trim() !== '' && (others.some((x) => x.employeeCode.toLowerCase() === v.employeeCode.trim().toLowerCase()) || added.some((c) => c.toLowerCase() === v.employeeCode.trim().toLowerCase()));
  const emailTaken = v.email.trim() !== '' && others.some((x) => x.email.toLowerCase() === v.email.trim().toLowerCase());
  const modes = o?.paymentModes ?? [];
  const modeList = [...modes, ...(modes.includes(v.paymentMode) ? [] : [v.paymentMode])];

  const save = (another: boolean) => {
    const input: EmployeeInput = { ...v, salaryPaise: toPaise(salary), photoName: photoName || undefined };
    if (employee) delete input.sendOfferLetter;
    if (!bank) {
      input.bankName = '';
      input.accountHolderName = '';
      input.ifscCode = '';
      input.branchName = '';
      input.accountNumber = '';
    }
    const local = validateEmployee(input, employee);
    if (!input.email.trim()) local.email = 'Enter the email address: the appointment letter is sent to it.';
    if (codeTaken) local.employeeCode = 'This staff ID is already used in this company.';
    if (emailTaken) local.email = 'Another staff member in this company already uses this email.';
    setLocalErrors(local);
    if (Object.keys(local).length) {
      if (Object.keys(local).some((k) => MORE_KEYS.includes(k))) setMoreOpen(true);
      return;
    }
    void submit(
      async () => {
        const res = employee ? await payrollApi.updateEmployee(company.id, employee.id, input) : await payrollApi.createEmployee(company.id, input);
        return res.ok ? { ok: true as const, data: res.data } : res;
      },
      (data) => {
        const letter = !employee && 'letter' in data ? data.letter : null;
        const done = employee ? trf('{0} saved.', [input.name]) : trf('{0} added.', [input.name]);
        toast.show({ tone: 'success', text: letter ? `${done} ${letter.message}` : done });
        if (another && !employee) {
          const list = [...codes, input.employeeCode];
          setAdded((a) => [...a, input.employeeCode]);
          setV(fresh(list));
          setSalary('');
          setPhoto(null);
          setPhotoName('');
          setLocalErrors({});
          setMoreOpen(false);
          onAdded?.();
          firstField.current?.querySelector('input')?.focus();
          return;
        }
        onSaved();
      },
    );
  };

  const setDeduction = (i: number, patch: Partial<EmployeeInput['deductions'][number]>) => set('deductions', v.deductions.map((d, n) => (n === i ? { ...d, ...patch } : d)));
  const txt = (k: keyof EmployeeInput, o2: { id: string; type?: string; list?: string; placeholder?: string; upper?: boolean }): ReactNode => (
    <input
      id={`emp_${o2.id}_${uid}`}
      type={o2.type ?? 'text'}
      className={`${cls(String(k))} ${o2.upper ? 'text-uppercase' : ''}`}
      autoComplete="off"
      list={o2.list ? `${o2.list}_${uid}` : undefined}
      placeholder={o2.placeholder}
      value={String(v[k] ?? '')}
      onChange={(e) => set(k, (o2.upper ? e.target.value.toUpperCase() : e.target.value) as never)}
    />
  );
  const sel = (k: keyof EmployeeInput, id: string, list: string[] | undefined, blank?: string) => {
    const cur = String(v[k] ?? '');
    const items = list ?? [];
    return (
      <Select id={`emp_${id}_${uid}`} className={cls(String(k), 'form-select')} value={cur} onChange={(e) => set(k, e.target.value as never)}>
        {blank !== undefined ? <option value="">{blank}</option> : null}
        {[...items, ...(cur && !items.includes(cur) ? [cur] : [])].map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </Select>
    );
  };

  const pdf = employee ? PDF_ROUTES.staffRecordSheet(company.id, employee.id) : null;
  const letterOff = o?.hasJoiningTemplate === false;

  return (
    <Modal
      open
      size="lg"
      className="pay-form-modal employee-modal"
      centered={false}
      onClose={onClose}
      eyebrow={employee ? employee.employeeCode : company.name}
      title={employee ? employee.name : tr('Add staff member')}
      onSubmit={() => save(false)}
      footer={
        <>
          {pdf ? (
            <PdfLink className="btn btn-outline-p me-auto" href={pdf} doc={`Staff record of ${employee?.name ?? ''}`}>
              <Bi name="file-earmark-pdf" /> {tr('Staff record')}
            </PdfLink>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr('Cancel')}</Button>
          {!employee ? <Button variant="outline" disabled={busy || !o} onClick={() => save(true)}>{tr('Save and add another')}</Button> : null}
          <Button type="submit" disabled={busy || !o}>{employee ? tr('Save changes') : tr('Add staff member')}</Button>
        </>
      }
    >
      <datalist id={`dl_desig_${uid}`}>
        {(o?.designations ?? []).map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <datalist id={`dl_dept_${uid}`}>
        {(o?.departments ?? []).map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>

      <FormSection icon="person" title={tr('The person')}>
        <div className="row g-3" ref={firstField}>
          <Fld md={12} id={`emp_name_${uid}`} label={tr('Full name')} required error={errors.name}>
            {txt('name', { id: 'name' })}
          </Fld>
          <Fld md={6} id={`emp_mobile_${uid}`} label={tr('Mobile')} required error={errors.contactNumber}>
            <PhoneField id={`emp_mobile_${uid}`} country={v.contactCountry} number={v.contactNumber} countries={o?.phoneCountries ?? []} onCountry={(d) => set('contactCountry', d)} onNumber={(x) => set('contactNumber', x)} invalid={!!errors.contactNumber} />
          </Fld>
          <Fld md={6} id={`emp_email_${uid}`} label={tr('Email')} required hint={tr('The appointment letter goes here.')} error={errors.email}>
            {txt('email', { id: 'email', type: 'email', placeholder: 'name@example.com' })}
          </Fld>
        </div>
      </FormSection>

      <FormSection icon="briefcase" title={tr('The job')}>
        <div className="row g-3">
          <Fld md={4} id={`emp_code_${uid}`} label={tr('Staff ID')} required hint={!employee && v.employeeCode ? tr('The next free ID.') : undefined} error={errors.employeeCode ?? (codeTaken ? tr('This staff ID is already used in this company.') : undefined)}>
            {txt('employeeCode', { id: 'code' })}
          </Fld>
          <Fld md={4} id={`emp_desig_${uid}`} label={tr('Designation')} required error={errors.designation}>
            {txt('designation', { id: 'desig', list: 'dl_desig', placeholder: tr('e.g. Front office') })}
          </Fld>
          <Fld md={4} id={`emp_dept_${uid}`} label={tr('Department')} optional>
            {txt('department', { id: 'dept', list: 'dl_dept' })}
          </Fld>
          <Fld md={4} id={`emp_join_${uid}`} label={tr('Joined on')} required error={errors.joiningDate}>
            {txt('joiningDate', { id: 'join', type: 'date' })}
          </Fld>
          <Fld md={4} id={`emp_shift_${uid}`} label={tr('Shift')} optional>
            {sel('shift', 'shift', o?.shifts, tr('No fixed shift'))}
          </Fld>
          <Fld md={4} id={`emp_hrs_${uid}`} label={tr('Hours a day')} required error={errors.dailyWorkingHours}>
            <input id={`emp_hrs_${uid}`} type="number" inputMode="decimal" step="0.5" min="0.5" max="24" className={cls('dailyWorkingHours')} value={v.dailyWorkingHours} onChange={(e) => set('dailyWorkingHours', Number(e.target.value))} />
          </Fld>
        </div>
      </FormSection>

      <FormSection icon="cash-stack" title={tr('Pay')}>
        <div className="row g-3">
          <Fld md={6} id={`emp_sal_${uid}`} label={tr('Monthly salary')} required error={errors.salaryPaise}>
            <div className="input-group">
              <span className="input-group-text">₹</span>
              <input id={`emp_sal_${uid}`} type="number" inputMode="decimal" step="0.01" min="0" className={cls('salaryPaise')} value={salary} onChange={(e) => setSalary(e.target.value)} />
            </div>
          </Fld>
          {modeList.length > 3 ? (
            <Fld md={6} id={`emp_mode_${uid}`} label={tr('Paid by')} required>
              <Select id={`emp_mode_${uid}`} className="form-select" value={v.paymentMode} onChange={(e) => set('paymentMode', e.target.value)}>
                {modeList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Fld>
          ) : null}
        </div>
        {modeList.length > 0 && modeList.length <= 3 ? (
          <div className="mt-3">
            <PickGroup
              label={tr('Paid by')}
              value={v.paymentMode}
              onChange={(m) => set('paymentMode', m)}
              choices={modeList.map((m) => ({ value: m, icon: MODE_ICON[m] ?? 'wallet2', title: m, text: m === BANK_PAYMENT_MODE ? tr('Into a bank account') : undefined }))}
            />
          </div>
        ) : null}

        {bank ? (
          <div className="row g-3 mt-1">
            <Fld md={6} id={`emp_bank_${uid}`} label={tr('Bank')} required error={errors.bankName}>
              {txt('bankName', { id: 'bank' })}
            </Fld>
            <Fld md={6} id={`emp_holder_${uid}`} label={tr('Account holder')} required error={errors.accountHolderName}>
              {txt('accountHolderName', { id: 'holder' })}
            </Fld>
            <Fld md={4} id={`emp_acc_${uid}`} label={tr('Account number')} required error={errors.accountNumber}>
              <input id={`emp_acc_${uid}`} className={cls('accountNumber')} inputMode="numeric" value={v.accountNumber ?? ''} onChange={(e) => set('accountNumber', e.target.value)} />
            </Fld>
            <Fld md={4} id={`emp_ifsc_${uid}`} label={tr('IFSC')} required error={errors.ifscCode}>
              {txt('ifscCode', { id: 'ifsc', upper: true, placeholder: 'SBIN0001234' })}
            </Fld>
            <Fld md={4} id={`emp_branch_${uid}`} label={tr('Branch')} optional>
              {txt('branchName', { id: 'branch' })}
            </Fld>
          </div>
        ) : null}
      </FormSection>

      <FormSection
        icon="dash-circle"
        title={tr('Deductions')}
        hint={tr('Taken from the salary each time it is worked out.')}
        aside={<Button variant="outline" size="sm" icon="plus-lg" disabled={(o?.deductions.length ?? 0) === 0} onClick={() => set('deductions', [...v.deductions, { deductionId: '', type: 'Monthly', amountPaise: 0 }])}>{tr('Add deduction')}</Button>}
      >
        {v.deductions.length === 0 ? (
          <p className="sf-none">{(o?.deductions.length ?? 0) === 0 ? tr('No deductions are set up for this company yet.') : tr('None for this person.')}</p>
        ) : (
          <div className="sf-deds">
            {v.deductions.map((d, i) => (
              <div key={d.id ?? `new-${i}`} className="sf-ded">
                <div className="sf-ded-name">
                  <Select
                    aria-label={tr('Deduction')}
                    className={`form-select ${errors[`deductions.${i}`] ? 'is-invalid' : ''}`}
                    value={d.deductionId}
                    onChange={(e) => {
                      const std = o?.deductions.find((y) => y.id === e.target.value)?.standardAmountPaise;
                      setDeduction(i, { deductionId: e.target.value, amountPaise: d.amountPaise || std || 0 });
                    }}
                  >
                    <option value="">{tr('Choose a deduction…')}</option>
                    {(o?.deductions ?? [])
                      .filter((x) => x.isActive || x.id === d.deductionId)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </Select>
                  {errors[`deductions.${i}`] ? <div className="field-error">{errors[`deductions.${i}`]}</div> : null}
                </div>
                <Select aria-label={tr('How often')} className="form-select" value={d.type} onChange={(e) => setDeduction(i, { type: e.target.value as DeductionType })}>
                  <option value="Monthly">{tr('Every month')}</option>
                  <option value="One Time">{tr('Once')}</option>
                </Select>
                <div className="input-group">
                  <span className="input-group-text">₹</span>
                  <input type="number" inputMode="decimal" step="0.01" className="form-control" aria-label={tr('Amount')} value={rupees(d.amountPaise)} onChange={(e) => setDeduction(i, { amountPaise: toPaise(e.target.value) })} />
                </div>
                <Button variant="ghost" icon="x-lg" aria-label={tr('Remove deduction')} onClick={() => set('deductions', v.deductions.filter((_, n) => n !== i))} />
              </div>
            ))}
          </div>
        )}
      </FormSection>

      {!employee ? (
        <div className={`offer-toggle ${letterOff ? 'is-off' : ''}`}>
          <div className="form-check form-switch mb-0">
            <input className="form-check-input" type="checkbox" role="switch" id={`emp_offer_${uid}`} checked={!!v.sendOfferLetter} disabled={letterOff || !v.email} onChange={(e) => set('sendOfferLetter', e.target.checked)} />
            <label className="form-check-label" htmlFor={`emp_offer_${uid}`}>
              {tr('Email the appointment letter when I save')}
            </label>
          </div>
          <div className="offer-hint">{letterOff ? tr('Set up the joining letter on the Letters page first.') : v.email ? trf('It goes to {0}.', [v.email]) : tr('Enter the email first.')}</div>
        </div>
      ) : null}

      <details className="sf-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <span>
            <b>{tr('More about the person')}</b>
            <small>{tr('Photo, birthday, address, emergency contact, education, ID proof. All optional.')}</small>
          </span>
          <Bi name="chevron-down" />
        </summary>
        <div className="sf-more-body">
          <div className="photo-field">
            <label className={`photo-drop ${photo ? 'has-photo' : ''}`} htmlFor={`photo_${uid}`} title={photo ? tr('Change photo') : tr('Add a photo')}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="photo-preview" src={photo ?? undefined} alt="" hidden={!photo} />
              <span className="photo-placeholder" hidden={!!photo}>
                {employee ? <span className="photo-initials">{initials(employee.name)}</span> : <Bi name="person" />}
              </span>
              <span className="photo-badge" aria-hidden="true">
                <Bi name="camera-fill" />
              </span>
            </label>
            <div className="photo-text">
              <div className="photo-title">{tr('Photo')}</div>
              <div className="photo-hint">{tr('PNG, JPG or WebP, up to 4 MB.')}</div>
              <div className="photo-actions">
                <label className="btn btn-sm btn-outline-p mb-0" htmlFor={`photo_${uid}`}>
                  <Bi name="upload" /> <span>{photo || employee?.photoName ? tr('Change photo') : tr('Upload photo')}</span>
                </label>
                {photo ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="arrow-counterclockwise"
                    onClick={() => {
                      setPhoto(null);
                      setPhotoName(employee?.photoName ?? '');
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                  >
                    {tr('Undo')}
                  </Button>
                ) : null}
              </div>
              {photoName ? <div className="photo-file">{photoName}</div> : null}
            </div>
            <input
              ref={fileInput}
              type="file"
              id={`photo_${uid}`}
              className="photo-input"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setPhoto(URL.createObjectURL(f));
                setPhotoName(f.name);
              }}
            />
          </div>

          <div className="row g-3">
            <Fld md={6} id={`emp_dob_${uid}`} label={tr('Date of birth')} error={errors.dateOfBirth}>
              {txt('dateOfBirth', { id: 'dob', type: 'date' })}
            </Fld>
            <Fld md={6} id={`emp_gender_${uid}`} label={tr('Gender')} error={errors.gender}>
              {sel('gender', 'gender', o?.genders, tr('Choose…'))}
            </Fld>
            <Fld md={12} id={`emp_addr_${uid}`} label={tr('Address')}>
              <Textarea id={`emp_addr_${uid}`} className="form-control" rows={2} placeholder={tr('House, street, area, city')} value={v.address} onChange={(e) => set('address', e.target.value)} />
            </Fld>
            <Fld md={6} id={`emp_nat_${uid}`} label={tr('Nationality')}>
              {txt('nationality', { id: 'nat' })}
            </Fld>
            <Fld md={6} id={`emp_pin_${uid}`} label={tr('Country and pincode')}>
              {txt('countryAndPincode', { id: 'pin', placeholder: 'India, 360001' })}
            </Fld>
          </div>

          <h3 className="sf-sub">{tr('Emergency contact')}</h3>
          <div className="row g-3">
            <Fld md={4} id={`emp_ecn_${uid}`} label={tr('Name')}>
              {txt('emergencyContactName', { id: 'ecn' })}
            </Fld>
            <Fld md={3} id={`emp_ecr_${uid}`} label={tr('Relation')} error={errors.emergencyContactRelation}>
              {txt('emergencyContactRelation', { id: 'ecr', placeholder: tr('Spouse') })}
            </Fld>
            <Fld md={5} id={`emp_ecm_${uid}`} label={tr('Mobile')} error={errors.emergencyContactNumber}>
              <PhoneField id={`emp_ecm_${uid}`} country={v.emergencyContactCountry} number={v.emergencyContactNumber} countries={o?.phoneCountries ?? []} onCountry={(d) => set('emergencyContactCountry', d)} onNumber={(x) => set('emergencyContactNumber', x)} invalid={!!errors.emergencyContactNumber} />
            </Fld>
          </div>

          <h3 className="sf-sub">{tr('Education and skills')}</h3>
          <div className="row g-3">
            <Fld md={6} id={`emp_qual_${uid}`} label={tr('Qualification')}>
              {txt('qualification', { id: 'qual' })}
            </Fld>
            <Fld md={6} id={`emp_inst_${uid}`} label={tr('Institution')}>
              {txt('qualificationInstitution', { id: 'inst' })}
            </Fld>
            <Fld md={12} id={`emp_skills_${uid}`} label={tr('Skills')}>
              {txt('skills', { id: 'skills', placeholder: tr('Comma separated') })}
            </Fld>
            <Fld md={12} id={`emp_resp_${uid}`} label={tr('Responsibilities')} hint={tr('Printed in the appointment letter.')}>
              <Textarea id={`emp_resp_${uid}`} className="form-control" rows={3} value={v.responsibilities} onChange={(e) => set('responsibilities', e.target.value)} />
            </Fld>
          </div>

          <h3 className="sf-sub">{tr('ID proof and resume')}</h3>
          <div className="row g-3">
            <Fld md={6} id={`emp_idt_${uid}`} label={tr('ID proof')} error={errors.idProofType}>
              {sel('idProofType', 'idt', o?.idProofTypes, tr('Choose a type…'))}
            </Fld>
            <Fld md={6} id={`emp_idn_${uid}`} label={tr('ID number')} error={errors.idProofNumber}>
              <input id={`emp_idn_${uid}`} className={cls('idProofNumber')} value={v.idProofNumber ?? ''} onChange={(e) => set('idProofNumber', e.target.value.toUpperCase())} />
            </Fld>
            <Fld md={6} id={`emp_idf_${uid}`} label={tr('ID front')}>
              <FileBox id={`emp_idf_${uid}`} accept="image/png,image/jpeg,image/webp" current={employee?.idProofImageName} label={tr('Current')} onName={(n) => set('idProofImageName', n || undefined)} />
            </Fld>
            <Fld md={6} id={`emp_idb_${uid}`} label={tr('ID back')}>
              <FileBox id={`emp_idb_${uid}`} accept="image/png,image/jpeg,image/webp" label={tr('Current')} onName={() => undefined} />
            </Fld>
            <Fld md={12} id={`emp_cv_${uid}`} label={tr('Resume')} hint={tr('PDF or a picture.')}>
              <FileBox id={`emp_cv_${uid}`} accept="application/pdf,image/*" current={employee?.resumeFileName} label={tr('Current')} onName={() => undefined} />
            </Fld>
          </div>
        </div>
      </details>
    </Modal>
  );
}
