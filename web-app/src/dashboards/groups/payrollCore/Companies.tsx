'use client';

// Payroll home (hotel.payroll.home): one card per company to open, the figures across companies, and the company details form.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePanelHeadSlot } from '@/dashboards/pallav';
import { formatINR } from '@shared/dashboards/format';
import { payrollCoreCopy as copy, validateCompany, type PayrollCompanyInput, type PayrollCompanyRow } from '@shared/dashboards/payrollCore';
import { Bi, Modal, FieldHint, Textarea, Button, Dropdown, MayEdit, StatusChip } from '@/dashboards/pallav/ui';
import { useSubmit, useToast } from '@/components/ui';
import { PDF_ROUTES } from '@shared/dashboards/common';
import type { ScreenProps } from '../../types';
import { HomeStats } from '../overview/HomeJobs';
import { payrollApi } from './api';
import { Fld, EmptyState, Pager, PayLayout, SearchField, WizardSteps, initials, useTableView, useWizard, wizardEnter } from './pms';
import { CompanySwitch, usePayrollCompanyId } from './shared';
import { PdfLink, StaleNote, Wait, count, useLoaded, useMockPdf } from './load';

import { tr, trf } from '@/lib/i18n/language';
const c = copy.companies;

type Money = { net: number; paid: number };

/** hotel.payroll.home: Company Listing, the payroll landing page. */
export function PayrollCompanies({ navigate }: ScreenProps) {
  const [editing, setEditing] = useState<PayrollCompanyRow | null>(null);
  const [companyId, setCompanyId] = usePayrollCompanyId();
  const slot = usePanelHeadSlot();
  const [money, setMoney] = useState<Record<string, Money>>({});
  const [version, setVersion] = useState(0);
  const list = useLoaded(() => payrollApi.listCompanies(), [version]);
  const rows = list.data;
  const onPdf = useMockPdf();

  useEffect(() => {
    if (!rows) return;
    let live = true;
    void Promise.all(rows.map((x) => payrollApi.getDashboard(x.id))).then((dashes) => {
      if (!live) return;
      const next: Record<string, Money> = {};
      dashes.forEach((d, i) => {
        if (d.ok && rows[i]) next[rows[i].id] = { net: d.data.netPaise, paid: d.data.paidPaise };
      });
      setMoney(next);
    });
    return () => {
      live = false;
    };
  }, [rows]);

  const all = useMemo(() => rows ?? [], [rows]);
  const view = useTableView(all, {
    perPage: 24,
    match: (r, q) => `${r.name} ${r.code} ${r.ownerName}`.toLowerCase().includes(q),
    sorters: { company: { kind: 'text', value: (r) => r.name.toLowerCase() } },
  });

  const open = (r: PayrollCompanyRow) => {
    if (!r.isActive) return;
    setCompanyId(r.id);
    navigate('hotel.payroll.dashboard');
  };
  const totalStaff = all.reduce((n, r) => n + r.activeStaffCount, 0);
  const due = Object.values(money).reduce((n, m) => n + Math.max(0, m.net - m.paid), 0);
  const unpaid = Object.values(money).filter((m) => m.net > m.paid).length;

  if (!rows) return <Wait error={list.error} onRetry={list.reload} />;

  return (
    <PayLayout
      sub={tr('Open a company. Staff, attendance, salary and documents stay inside the company you open.')}
      search={all.length > 6 ? <SearchField value={view.search} onChange={view.setSearch} placeholder={tr('Search name, code or owner…')} label={tr('Search companies')} /> : undefined}
    >
      {slot && rows ? createPortal(<CompanySwitch companies={all} current={all.find((x) => x.id === companyId && x.isActive)} onPick={setCompanyId} onListing={() => navigate('hotel.payroll.home')} />, slot) : null}
      <StaleNote error={list.error} onRetry={list.reload} />
      <div className="ha-home">
        <HomeStats
          stats={[
            { id: 'companies', label: tr('Companies'), value: all.length, format: (n) => count(Math.round(n)), note: trf('{0} active', [all.filter((r) => r.isActive).length]) },
            { id: 'staff', label: tr('Staff on payroll'), value: totalStaff, format: (n) => count(Math.round(n)), note: tr('Active, all companies') },
            { id: 'unpaid', label: tr('Not fully paid'), value: unpaid, format: (n) => count(Math.round(n)), note: tr('Companies this month') },
{ id: 'due', label: tr('Still to pay'), value: due, format: (n) => formatINR(Math.round(n)), note: unpaid ? trf('{0} companies not fully paid', [unpaid]) : tr('Everything is settled') },
          ]}
        />

        {all.length === 0 ? (
          <div className="card"><EmptyState icon="buildings" title={tr('No companies yet')} text={tr('The payroll companies are created with the hotel; reload the page.')} /></div>
        ) : view.total === 0 ? (
          <div className="card"><EmptyState icon="search" title={tr('No matching companies')} text={tr('Try a different name, code or owner.')} /></div>
        ) : (
          <ul className="ha-co-grid">
            {view.rows.map((r) => {
              const m = money[r.id];
              const left = m ? Math.max(0, m.net - m.paid) : 0;
              return (
                <li key={r.id} className={`card ha-co${r.isActive ? '' : ' is-off'}${left > 0 ? ' is-due' : ''}`}>
                  <div className="ha-co-top">
                    <span className="pf-initials ha-co-mark" aria-hidden="true">{initials(r.name)}</span>
                    <div className="ha-co-name">
                      <h3>{r.name}</h3>
                      <small>{[r.code, [r.city, r.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</small>
                    </div>
                    {r.isActive ? null : <StatusChip tone="neutral">{tr('Inactive')}</StatusChip>}
                  </div>
                  <dl className="ha-co-facts">
                    <div><dt>{tr('Staff')}</dt><dd>{count(r.activeStaffCount)}{r.staffCount > r.activeStaffCount ? <small> {trf('of {0}', [r.staffCount])}</small> : null}</dd></div>
                    <div><dt>{tr('Owner')}</dt><dd title={r.ownerName}>{r.ownerName || <span className="text-muted">{tr('None')}</span>}</dd></div>
                    <div><dt>{tr('Still to pay')}</dt><dd className={left > 0 ? 'is-warn' : undefined}>{m ? (left > 0 ? formatINR(left) : tr('Settled')) : '-'}</dd></div>
                  </dl>
                  <div className="ha-co-acts">
                    <Dropdown align="end" button={(p) => <Button variant="ghost" icon="three-dots" {...p}>{tr('More')}</Button>}>
                      <MayEdit module="payroll">
                        <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setEditing(r); }}><Bi name="pencil-square" className="me-2" />{tr('Edit company details')}</a>
                      </MayEdit>
                        <a className="dropdown-item" href={PDF_ROUTES.payrollCompany(r.id)} target="_blank" rel="noreferrer" onClick={onPdf(`Company profile of ${r.name}`)}><Bi name="file-earmark-pdf" className="me-2" />{tr('Company PDF')}</a>
                    </Dropdown>
                    {r.isActive ? (
                      <Button onClick={() => open(r)}>{tr('Open')} <Bi name="arrow-right-short" /></Button>
                    ) : (
                      <span className="ha-co-off">{tr('Activate the company before opening it')}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {view.total > 24 ? <Pager view={view} /> : null}
      </div>
      {editing ? (
        <CompanyFormModal
          key={editing.id}
          company={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setVersion((v) => v + 1);
          }}
        />
      ) : null}
    </PayLayout>
  );
}

/** What the form edits. The name, code and on/off never change; the account number is shown and edited as it is. */
function toInput(r: PayrollCompanyRow): PayrollCompanyInput {
  const { id: _id, staffCount: _s, activeStaffCount: _a, name: _n, code: _c, isActive: _i, accountNumber, ...rest } = r;
  void _id; void _s; void _a; void _n; void _c; void _i;
  return { ...rest, accountNumber: accountNumber ?? '' };
}

type Key = keyof PayrollCompanyInput;
/** Which wizard step each field sits on, so a refusal opens the step that holds it. */
const stepOf: Partial<Record<Key, number>> = {
  ownerName: 0, mobileNumber: 0, email: 0, address: 0, city: 0, state: 0, pincode: 0, logoName: 0,
  panNumber: 1, tanNumber: 1, pfRegistrationNumber: 1, esicRegistrationNumber: 1, professionalTaxRegistrationNumber: 1,
  authorizedPersonName: 2, authorizedDesignation: 2, authorizedMobile: 2, authorizedEmail: 2, signatureName: 2,
  bankName: 3, branchName: 3, accountNumber: 3, ifscCode: 3,
};
const STEPS = ['Company', 'Registrations', 'Signs letters', 'Bank'];
const FIELD_KEYS = Object.keys(stepOf) as Key[];

function CompanyFormModal({ company, onClose, onSaved }: { company: PayrollCompanyRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<PayrollCompanyInput>(() => toInput(company));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { busy, errors: serverErrors, submit } = useSubmit(FIELD_KEYS);
  const wiz = useWizard(STEPS.length);
  const errors = { ...localErrors, ...serverErrors };
  const set = (k: Key, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const val = (k: Key) => String(form[k] ?? '');

  const save = () => {
    const local = validateCompany(form);
    setLocalErrors(local);
    const bad = Object.keys(local);
    if (bad.length) {
      wiz.goTo(Math.min(...bad.map((k) => stepOf[k as Key] ?? 0)));
      return;
    }
    const input = { ...form };
    void submit(
      () => payrollApi.updateCompany(company.id, input),
      () => {
        toast.show({ tone: 'success', text: c.saved });
        onSaved();
      },
    );
  };

  const text = (k: Key, o: { upper?: boolean; type?: string } = {}) => (
    <input
      id={`co-${k}`}
      name={k}
      type={o.type ?? 'text'}
      className={`form-control ${o.upper ? 'text-uppercase' : ''} ${errors[k] ? 'is-invalid' : ''}`}
      value={val(k)}
      onChange={(e) => set(k, o.upper ? e.target.value.toUpperCase() : e.target.value)}
    />
  );
  const file = (k: 'logoName' | 'signatureName', current: string | null | undefined, label: string): ReactNode => (
    <>
      <input id={`co-${k}`} type="file" className="form-control" accept="image/png,image/jpeg,image/webp" onChange={(e) => set(k, e.target.files?.[0]?.name ?? '')} />
      <FieldHint>{tr("PNG, JPG or WebP, up to 4 MB.")}</FieldHint>
      {current ? (
        <div className="form-text">
          <Bi name="paperclip" /> {label}: {current}
        </div>
      ) : null}
    </>
  );
  const step = (n: number) => `form-step ${wiz.index === n ? 'active' : ''}`;

  return (
    <Modal
      open
      size="xl"
      className="pay-form-modal"
      centered={false}
      onClose={onClose}
      eyebrow={<>{tr("Company")}</>}
      title={company.name}
      onSubmit={() => (wiz.last ? save() : wiz.next())}
      footer={
        <>
          <PdfLink className="btn btn-outline-p me-auto" href={PDF_ROUTES.payrollCompany(company.id)} doc={`Company profile of ${company.name}`}>
            <Bi name="file-earmark-pdf" /> {tr("Company PDF")}
          </PdfLink>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          {wiz.index > 0 ? (
            <Button variant="outline" icon="arrow-left" onClick={wiz.back}>{tr("Back")}</Button>
          ) : null}
          {wiz.last ? null : <Button variant="outline" key="next" onClick={wiz.next}>{tr("Next")} <Bi name="arrow-right" /></Button>}
          <Button key="save" disabled={busy} onClick={save}>{tr("Save changes")}</Button>
        </>
      }
    >
      <div className="form-wizard" onKeyDown={wizardEnter(wiz)}>
        <WizardSteps names={STEPS} index={wiz.index} onGoTo={wiz.goTo} />

        <div className={step(0)}>
          <div className="row g-3">
            <Fld md={7} label={tr("Company name")} required>
              <input className="form-control" value={company.name} readOnly />
            </Fld>
            <Fld md={5} label={tr("Company code")} required hint={tr("The name and code stay as they are.")}>
              <input className="form-control text-uppercase" value={company.code} readOnly />
            </Fld>
            <Fld label={tr("Owner")} optional error={errors.ownerName}>
              {text('ownerName')}
            </Fld>
            <Fld label={tr("Logo")} optional>
              {file('logoName', form.logoName, 'Current logo')}
            </Fld>
            <Fld label={tr("Mobile")} required hint={tr("Shown on salary slips and letters.")} error={errors.mobileNumber}>
              {text('mobileNumber')}
            </Fld>
            <Fld label={tr("Email address")} optional error={errors.email}>
              {text('email', { type: 'email' })}
            </Fld>
            <Fld md={12} label={tr("Address")} required error={errors.address}>
              <Textarea className={`form-control ${errors.address ? 'is-invalid' : ''}`} rows={2} value={val('address')} onChange={(e) => set('address', e.target.value)} />
            </Fld>
            <Fld md={4} label={tr("City")} required error={errors.city}>
              {text('city')}
            </Fld>
            <Fld md={4} label={tr("State")} required error={errors.state}>
              {text('state')}
            </Fld>
            <Fld md={4} label={tr("Pincode")} optional error={errors.pincode}>
              {text('pincode')}
            </Fld>
          </div>
        </div>

        <div className={step(1)}>
          <div className="form-text mb-3">{tr("Statutory registrations. Leave blank any the company doesn't hold yet.")}</div>
          <div className="row g-3">
            <Fld label={tr("PAN")} optional error={errors.panNumber}>
              {text('panNumber', { upper: true })}
            </Fld>
            <Fld label={tr("TAN")} optional error={errors.tanNumber}>
              {text('tanNumber', { upper: true })}
            </Fld>
            <Fld label={tr("PF registration")} optional error={errors.pfRegistrationNumber}>
              {text('pfRegistrationNumber')}
            </Fld>
            <Fld label={tr("ESIC registration")} optional error={errors.esicRegistrationNumber}>
              {text('esicRegistrationNumber')}
            </Fld>
            <Fld md={12} label={tr("Professional tax registration")} optional error={errors.professionalTaxRegistrationNumber}>
              {text('professionalTaxRegistrationNumber')}
            </Fld>
          </div>
        </div>

        <div className={step(2)}>
          <div className="form-text mb-3">{tr("This person signs the salary slips and letters of this company.")}</div>
          <div className="row g-3">
            <Fld label={tr("Signs as")} required error={errors.authorizedPersonName}>
              {text('authorizedPersonName')}
            </Fld>
            <Fld label={tr("Designation")} required error={errors.authorizedDesignation}>
              {text('authorizedDesignation')}
            </Fld>
            <Fld md={4} label={tr("Mobile")} optional error={errors.authorizedMobile}>
              {text('authorizedMobile')}
            </Fld>
            <Fld md={4} label={tr("Email address")} optional error={errors.authorizedEmail}>
              {text('authorizedEmail', { type: 'email' })}
            </Fld>
            <Fld md={4} label={tr("Signature")} optional>
              {file('signatureName', form.signatureName, 'Current signature')}
            </Fld>
          </div>
        </div>

        <div className={step(3)}>
          <div className="form-text mb-3">{tr("The account salaries are paid from. Optional if you only pay in cash.")}</div>
          <div className="row g-3">
            <Fld label={tr("Bank")} optional error={errors.bankName}>
              {text('bankName')}
            </Fld>
            <Fld label={tr("Branch")} optional error={errors.branchName}>
              {text('branchName')}
            </Fld>
            <Fld label={tr("Account number")} optional error={errors.accountNumber}>
              {text('accountNumber')}
            </Fld>
            <Fld label={tr("IFSC")} optional error={errors.ifscCode}>
              {text('ifscCode', { upper: true })}
            </Fld>
          </div>
        </div>
      </div>
    </Modal>
  );
}
