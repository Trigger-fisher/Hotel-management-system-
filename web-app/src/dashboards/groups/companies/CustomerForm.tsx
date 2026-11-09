'use client';

// customer/form.blade.php: the Add / Edit Customer page (an `.st-card` with a grid of fields). Needs settings.css on this view.
import { lastChangeLine } from '@shared/dashboards/profileReview';
import { useState } from 'react';
import { blankCustomer, companiesCopy } from '@shared/dashboards/companies';
import type { Customer, CustomerInput } from '@shared/dashboards/companies';
import { Bi, Button, FieldHint, RequiredMark, Textarea } from '@/dashboards/pallav/ui';
import { useSubmit, useToast } from '@/components/ui';
import { api } from './api';
import { Page } from './pageParts';
import { SharedConfirmDialog, useSharedConfirm } from './sharedConfirm';

import { tr } from '@/lib/i18n/language';
const t = companiesCopy.customers;

export function CustomerForm({ customer, onBack, onSaved }: { customer: Customer | null; onBack: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<CustomerInput>(() =>
    customer
      ? { name: customer.name, mobile: customer.mobile, email: customer.email, address: customer.address, city: customer.city, idProofType: customer.idProofType, notes: customer.notes, isActive: customer.isActive }
      : blankCustomer(),
  );
  const [idNumber, setIdNumber] = useState(customer?.idProofNumber ?? '');
  const { busy, errors, submit } = useSubmit(['name', 'mobile', 'email', 'address', 'city', 'idProofType', 'idProofNumber', 'notes']);
  const set = <K extends keyof CustomerInput>(k: K, val: CustomerInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const cls = (k: string) => `form-control ${errors[k] ? 'is-invalid' : ''}`;

  const shared = useSharedConfirm();

  function save(confirmShared = false) {
    const input: CustomerInput = { ...v, idProofNumber: idNumber.trim(), ...(confirmShared ? { confirmShared: true } : {}) };
    if (customer) {
      void submit(
        () => shared.guard(() => api.updateCustomer(customer.id, input)),
        shared.done((r) => {
          toast.show({ tone: 'success', text: t.updated(r.name) });
          onSaved();
        }),
      );
    } else {
      void submit(
        () => api.createCustomer(input),
        (r) => {
          toast.show({ tone: 'success', text: t.created(r.customer.name, r.emailed) });
          onSaved();
        },
      );
    }
  }

  return (
    <Page
      sub={customer ? "Change this customer's details." : 'Their login is made for them and emailed, and they choose their own password on first sign-in.'}
      headActions={
        <a href="#" className="btn btn-outline-p" onClick={(e) => { e.preventDefault(); onBack(); }}>
          <Bi name="arrow-left" /> {tr("Customers")}
        </a>
      }
    >
      <form className="st-card reveal" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="st-head">
          <div className="st-icon">
            <Bi name="person-vcard" />
          </div>
          <div>
            <h2 className="st-title">{customer ? `Edit ${customer.name}` : tr("New customer")}</h2>
            <p className="st-about">{tr("Name and mobile number are needed; the mobile number is their portal sign-in.")}</p>
          </div>
        </div>
        {/* B's contract (companies.ts Customer.common): the name, email, address and city are the guest's one profile */}
        {customer?.common ? (
          <div className="alert alert-info d-flex align-items-start gap-2 py-2 small" role="note">
            <Bi name="people" className="mt-1" />
            <span>
              <strong>{tr("Shared profile.")}</strong> {tr("The name, email, address and city are the guest's own profile: a change here shows at every hotel and in the guest's portal. The mobile number, ID proof and notes stay this hotel's.")}
              {customer.lastChange ? <span className="d-block text-muted mt-1">{lastChangeLine(customer.lastChange)}</span> : null}
            </span>
          </div>
        ) : null}

        <div className="st-grid">
          <div className="st-field">
            <label className="form-label" htmlFor="c_name">
              {tr("Name")}<RequiredMark />
            </label>
            <input id="c_name" className={cls('name')} maxLength={100} value={v.name} onChange={(e) => set('name', e.target.value)} />
            {errors.name ? <div className="invalid-feedback">{errors.name}</div> : null}
          </div>
          <div className="st-field">
            <label className="form-label" htmlFor="c_mobile">
              {tr("Mobile number")}<RequiredMark />
            </label>
            <input id="c_mobile" className={cls('mobile')} inputMode="numeric" maxLength={20} value={v.mobile} onChange={(e) => set('mobile', e.target.value)} />
            {errors.mobile ? <div className="invalid-feedback">{errors.mobile}</div> : null}
          </div>
          <div className="st-field">
            <label className="form-label" htmlFor="c_email">
              {tr("Email")}
            </label>
            <input id="c_email" type="email" className={cls('email')} maxLength={254} value={v.email} onChange={(e) => set('email', e.target.value)} />
            <FieldHint>{tr("The login details and statements are sent here.")}</FieldHint>
            {errors.email ? <div className="invalid-feedback">{errors.email}</div> : null}
          </div>
          <div className="st-field">
            <label className="form-label" htmlFor="c_city">
              {tr("City")}
            </label>
            <input id="c_city" className={cls('city')} maxLength={100} value={v.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div className="st-field wide">
            <label className="form-label" htmlFor="c_address">
              {tr("Address")}
            </label>
            <input id="c_address" className={cls('address')} maxLength={255} value={v.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="st-field">
            <label className="form-label" htmlFor="c_proof">
              {tr("ID proof")}
            </label>
            <input id="c_proof" className={cls('idProofType')} maxLength={60} placeholder={tr("Aadhaar, Passport, Licence…")} value={v.idProofType} onChange={(e) => set('idProofType', e.target.value)} />
          </div>
          <div className="st-field">
            <label className="form-label" htmlFor="c_proofno">
              {tr("ID proof number")}
            </label>
            <input id="c_proofno" className={cls('idProofNumber')} maxLength={50} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            {customer?.idProofMasked && idNumber === customer.idProofNumber ? <div className="form-text">Only the last 4 are shown. Leave it as it is to keep the saved number, or type the whole number to change it.</div> : null}
          </div>
          <div className="st-field wide">
            <label className="form-label" htmlFor="c_notes">
              {tr("Notes")}
            </label>
            <Textarea id="c_notes" rows={2} className={cls('notes')} maxLength={2000} value={v.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {customer ? (
            <div className="st-field wide">
              <label className="st-toggle" htmlFor="c_active">
                <input type="checkbox" id="c_active" checked={v.isActive} onChange={(e) => set('isActive', e.target.checked)} />
                <span className="st-switch" aria-hidden="true" />
                <span className="st-toggle-text">
                  <strong>{tr("Portal sign-in allowed")}</strong>
                  <small>{tr("Turn off to stop them signing in without deleting them.")}</small>
                </span>
              </label>
            </div>
          ) : null}
        </div>

        <div className="st-foot">
          <a href="#" className="btn btn-ghost me-auto" onClick={(e) => { e.preventDefault(); onBack(); }}>
            {tr("Cancel")}
          </a>
          <Button type="submit" icon="check2" disabled={busy}>
            {customer ? tr("Save changes") : tr("Add customer")}
          </Button>
        </div>
      </form>
      <SharedConfirmDialog shared={shared} busy={busy} onConfirm={() => save(true)} />
    </Page>
  );
}
