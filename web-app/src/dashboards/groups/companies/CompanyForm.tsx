'use client';

// company/_fields.blade.php inside the Add / Edit Company pop-up of company/index.blade.php (three steps: Company, People, Billing).
import { lastChangeLine } from '@shared/dashboards/profileReview';
import { useRef, useState } from 'react';
import { checkGstin, gstCopy } from '@shared/dashboards/gst';
import { blankCompany, companiesCopy, companyRateFields } from '@shared/dashboards/companies';
import type { CompanyContact, CompanyInput, CompanyProfile } from '@shared/dashboards/companies';
import { Bi, Button, Modal, RequiredMark, Select, Textarea, RemoveButton, TextAction } from '@/dashboards/pallav/ui';
import { useAsync, useSubmit, useToast } from '@/components/ui';
import { Fld, WizardSteps, useWizard, wizardEnter } from '../payrollCore/pms';
import { api } from './api';
import { SharedConfirmDialog, useSharedConfirm } from './sharedConfirm';
import { gstAddress, useGstLookup } from './gstLookup';

import { tr } from '@/lib/i18n/language';
const t = companiesCopy.profiles;
type RateKey = (typeof companyRateFields)[number]['key'];
const SHOWN = ['name', 'gstNumber', 'mobile', 'phone', 'email', 'address', 'contacts', ...companyRateFields.map((r) => r.key)];
const STEPS = ['Company', 'People', 'Billing'];
const RATE_ICON: Record<string, string> = { discountPct: 'tag', gstPct: 'receipt', tcsPct: 'cash-coin', tdsPct: 'scissors' };

function toForm(co: CompanyProfile | null): { values: CompanyInput; rates: Record<RateKey, string> } {
  const values: CompanyInput = co
    ? {
        name: co.name, gstNumber: co.gstNumber, mobile: co.mobile, phone: co.phone, email: co.email, address: co.address, country: co.country,
        pincode: co.pincode, nationality: co.nationality, discountPct: co.discountPct, gstPct: co.gstPct, tcsPct: co.tcsPct, tdsPct: co.tdsPct,
        instruction: co.instruction, contacts: co.contacts.length ? co.contacts.map((p) => ({ ...p })) : blankCompany().contacts,
      }
    : blankCompany();
  const r = (v: number | null) => (v === null ? '' : String(v));
  return { values, rates: { discountPct: r(values.discountPct), gstPct: r(values.gstPct), tcsPct: r(values.tcsPct), tdsPct: r(values.tdsPct) } };
}

/** Mount it only while open (with a key per record): the fields start from `company`. */
export function CompanyForm({ company, onClose, onSaved, onDelete, onOpenExisting }: { company: CompanyProfile | null; onClose: () => void; onSaved: (co: CompanyProfile) => void; onDelete?: () => void; onOpenExisting?: (id: string) => void }) {
  const toast = useToast();
  const [values, setValues] = useState<CompanyInput>(() => toForm(company).values);
  const [rates, setRates] = useState<Record<RateKey, string>>(() => toForm(company).rates);
  const wiz = useWizard(STEPS.length);
  const { busy, errors: submitErrors, submit } = useSubmit([...SHOWN, ...values.contacts.flatMap((_, i) => [`contacts.${i}.name`, `contacts.${i}.email`])]);
  // M1(b)/(c): a change of a shared profile asks first (Save for all hotels); "Ask a manager to change the GSTIN / the company name" sits under that field.
  const shared = useSharedConfirm({ forbiddenField: (m) => (/gstin|gst/i.test(m) ? 'gstNumber' : 'name'), onRefused: () => wiz.goTo(0) });
  const errors = shared.refusal ? { ...submitErrors, [shared.refusal.field]: shared.refusal.text } : submitErrors;
  const options = useAsync(() => api.getOptions(), []);
  const roles = options.state.status === 'ready' ? options.state.data.contactRoles : [];
  const savedRoles = [...new Set(values.contacts.map((p) => p.role).filter((r) => r && !roles.includes(r)))];
  const roleList = [...roles, ...savedRoles];

  const set = <K extends keyof CompanyInput>(k: K, v: CompanyInput[K]) => {
    if (shared.refusal && (k === 'name' || k === 'gstNumber')) shared.clearRefusal();
    setValues((p) => ({ ...p, [k]: v }));
  };
  // The form starts with the GST number (platform 0167, MJ): as soon as a whole, valid GSTIN is typed (or on leaving the field) the company is fetched and its name, address,
  // pincode, country and nationality fill in where nothing is typed yet; "Fetch details" fetches again and replaces them. The same number is not asked twice in a row.
  const gst = useGstLookup(company?.id);
  const lastGst = useRef('');
  const [fromGst, setFromGst] = useState<string[]>([]);
  const fillFromGst = async (raw: string, replace = false): Promise<void> => {
    const gstin = raw.replace(/\s+/g, '').toUpperCase();
    if (gstin === '' || (!replace && gstin === lastGst.current)) return;
    lastGst.current = gstin;
    const r = await gst.look(gstin);
    const e = r?.entry;
    if (!e) return;
    const found: Partial<Record<keyof CompanyInput, string>> = {
      name: (e.tradeName ?? e.legalName ?? '').slice(0, 100),
      address: gstAddress(e),
      pincode: e.pincode ?? '',
      country: 'India',
      nationality: 'Indian',
    };
    // a field already typed in is kept, unless "Fetch details" was pressed
    const filled = (Object.keys(found) as (keyof CompanyInput)[]).filter((k) => found[k] && (replace || !String(values[k] ?? '').trim()));
    if (filled.length) setValues((p) => ({ ...p, ...Object.fromEntries(filled.map((k) => [k, found[k]])) }));
    setFromGst(filled);
    toast.show({ tone: 'success', text: filled.length ? `${e.legalName ?? e.tradeName ?? 'Company'}: details filled in from GST.` : 'GST record found. Your typed details were kept; press Fetch details to replace them.' });
  };
  const found = gst.result?.entry ?? null;
  const gstHint = (k: keyof CompanyInput) => (fromGst.includes(k) ? '✓ Filled from GST' : undefined);
  const setTyped = <K extends keyof CompanyInput>(k: K, v: CompanyInput[K]) => {
    set(k, v);
    if (fromGst.includes(k)) setFromGst((f) => f.filter((x) => x !== k));
  };
  const setPerson = (i: number, k: keyof CompanyContact, v: string) => setValues((p) => ({ ...p, contacts: p.contacts.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const cls = (k: string, base = 'form-control') => `${base} ${errors[k] ? 'is-invalid' : ''}`;
  const step = (n: number) => `form-step ${wiz.index === n ? 'active' : ''}`;

  function save(confirmShared = false) {
    const parse = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
    const input: CompanyInput = { ...values, discountPct: parse(rates.discountPct), gstPct: parse(rates.gstPct), tcsPct: parse(rates.tcsPct), tdsPct: parse(rates.tdsPct), ...(confirmShared ? { confirmShared: true } : {}) };
    void submit(
      () => shared.guard(async () => {
        const res = await (company ? api.updateCompany(company.id, input) : api.createCompany(input));
        // Open the first step that holds a refusal: the Save button sits on the last step, so an error on Company or People was invisible.
        if (!res.ok) {
          const keys = Object.keys(res.error.details?.fields ?? {});
          const on0 = keys.some((k) => ['name', 'gstNumber', 'mobile', 'phone', 'email', 'address', 'country', 'pincode', 'nationality'].includes(k));
          const on1 = keys.some((k) => k === 'contacts' || k.startsWith('contacts.'));
          if (on0) wiz.goTo(0);
          else if (on1) wiz.goTo(1);
        }
        return res;
      }),
      shared.done((res) => {
        toast.show({ tone: 'success', text: company ? t.updated(res.name) : t.created(res.name) });
        onSaved(res);
      }),
    );
  }

  return (
    <Modal
      open
      size="lg"
      className="pay-form-modal cb-modal co-modal"
      staticBackdrop
      onClose={onClose}
      onSubmit={() => (wiz.last ? save() : wiz.next())}
      eyebrow={company ? `Company Profiles · ${company.name}` : 'Company Profiles · New'}
      title={company ? 'Edit company' : 'Add company'}
      footer={
        <>
          {company && onDelete ? (
            <Button variant="danger" icon="trash" className="me-auto" onClick={onDelete}>
              {tr("Delete")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          {wiz.index > 0 ? (
            <Button variant="outline" icon="arrow-left" onClick={wiz.back}>
              {tr("Back")}
            </Button>
          ) : null}
          {wiz.last ? (
            <Button key="save" type="submit" icon="check2" disabled={busy}>
              {company ? tr("Save changes") : tr("Create company")}
            </Button>
          ) : (
            <Button key="next" onClick={wiz.next}>
              {tr("Continue")} <Bi name="arrow-right" />
            </Button>
          )}
        </>
      }
    >
      <div data-wizard onKeyDown={wizardEnter(wiz)}>
        <WizardSteps names={STEPS} index={wiz.index} onGoTo={wiz.goTo} />

        <div className={step(0)}>
          <div className="form-section">
            <div className="fs-head">
              <div className="fs-title">
                <Bi name="building" /> {tr("About the company")}
              </div>
            </div>
            {/* B's contract (companies.ts CompanyProfile.common): the company's details are one profile for every hotel */}
            {company?.common ? (
              <div className="alert alert-info d-flex align-items-start gap-2 py-2 small" role="note">
                <Bi name="people" className="mt-1" />
                <span>
                  <strong>{tr("Shared profile.")}</strong> {tr("The name, GST number, phone numbers, email, address and contacts are the company's own profile: a change here shows at every hotel and in the company's portal. The rates, instruction and nationality stay this hotel's.")}
                  {company.lastChange ? <span className="d-block text-muted mt-1">{lastChangeLine(company.lastChange)}</span> : null}
                </span>
              </div>
            ) : null}
            <div className="row g-3">
              <Fld md={12} id="co_gst" label={tr("GST number")} hint={gst.busy || gst.result ? undefined : 'Type the 15-character GSTIN: the company’s name and address fill in by themselves. No GSTIN? Fill the details in yourself.'} error={errors.gstNumber}>
                <div className="d-flex gap-2">
                  <input
                    id="co_gst"
                    className={`${cls('gstNumber')} text-uppercase`}
                    maxLength={50}
                    placeholder={tr("e.g. 24AAACC1206D1ZM")}
                    autoFocus={!company}
                    value={values.gstNumber}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase();
                      set('gstNumber', v);
                      gst.clear();
                      if (checkGstin(v).ok) void fillFromGst(v);
                      else lastGst.current = '';
                    }}
                    onBlur={() => void fillFromGst(values.gstNumber)}
                  />
                  <Button variant="primary" icon="search" className="text-nowrap" busy={gst.busy} busyLabel="Fetching…" disabled={!values.gstNumber.trim()} onClick={() => void fillFromGst(values.gstNumber, true)}>
                    {tr("Fetch details")}
                  </Button>
                </div>
              </Fld>
              <div className="col-12" aria-live="polite">
                {gst.busy ? (
                  <div className="alert alert-info d-flex align-items-center gap-2 py-2 small mb-0" role="status">
                    <span className="spinner-border spinner-border-sm" aria-hidden="true" /> {tr("Fetching the company from the GST record…")}
                  </div>
                ) : found ? (
                  <div className={`alert ${found.status === 'active' ? 'alert-success' : 'alert-warning'} py-2 small mb-0`} role="status">
                    <div className="d-flex flex-wrap align-items-center gap-2 fw-semibold mb-1">
                      <Bi name={found.status === 'active' ? 'patch-check-fill' : 'exclamation-triangle-fill'} />
                      <span>{found.legalName ?? found.tradeName}</span>
                      <span className={`badge ${found.status === 'active' ? 'text-bg-success' : 'text-bg-warning'} text-capitalize`}>{found.status}</span>
                      <span className="badge text-bg-light border">{gst.result?.from === 'saved' ? tr("From saved record · no credit used") : tr("Fetched now")}</span>
                    </div>
                    <div className="row g-1">
                      {[
                        ['Trade name', found.tradeName],
                        ['PAN', found.pan],
                        ['Taxpayer type', found.taxpayerType],
                        ['Constitution', found.constitution],
                        ['Registered on', found.registeredOn],
                        ['Cancelled on', found.cancelledOn],
                        ['Nature of business', found.natureOfBusiness.join(', ') || null],
                        ['State', [found.state, found.stateCode].filter(Boolean).join(' · ') || null],
                        ['District / city', [found.district, found.city].filter(Boolean).join(' · ') || null],
                        ['Pincode', found.pincode],
                        ['Blocked from filing', found.blockStatus],
                        ['State jurisdiction', found.stateJurisdiction],
                        ['Building', [found.buildingNumber, found.buildingName, found.floor ? `Floor ${found.floor}` : null].filter(Boolean).join(', ') || null],
                        ['Street / locality', [found.street, found.locality].filter(Boolean).join(', ') || null],
                        ['Landmark', found.landmark],
                        ['Address', found.address],
                      ]
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <div key={k} className={k === 'Address' ? 'col-12' : 'col-sm-6'}>
                            <span className="text-muted">{k}:</span> {v}
                          </div>
                        ))}
                    </div>
                    <div className="text-muted mt-1">
                      {fromGst.length ? `Filled in below: ${fromGst.map((k) => ({ name: 'company name', address: 'address', pincode: 'pincode', country: 'country', nationality: 'nationality' })[k as string] ?? k).join(', ')}. ` : ''}
                      {gstCopy.noContact}
                    </div>
                  </div>
                ) : gst.result?.from === 'hotel' && gst.result.inHotel ? (
                  <div className="alert alert-info d-flex flex-wrap align-items-center gap-2 py-2 small mb-0" role="status">
                    <Bi name="info-circle" /> <span className="flex-grow-1">{gst.result.message}</span>
                    {onOpenExisting ? (
                      <Button variant="outline" size="sm" icon="box-arrow-up-right" onClick={() => onOpenExisting(gst.result?.inHotel?.id ?? '')}>
                        {tr("Open")} {gst.result.inHotel.name}
                      </Button>
                    ) : null}
                  </div>
                ) : gst.result ? (
                  <div className="alert alert-warning d-flex align-items-center gap-2 py-2 small mb-0" role="status">
                    <Bi name="exclamation-triangle" /> {[gst.result.check.state, gst.result.message].filter(Boolean).join(' · ')}
                  </div>
                ) : null}
              </div>
              <Fld md={12} id="co_name" label={tr("Company name")} required hint={gstHint('name')} error={errors.name}>
                <input id="co_name" className={cls('name')} maxLength={100} value={values.name} onChange={(e) => setTyped('name', e.target.value)} />
              </Fld>
            </div>
          </div>
          <div className="form-section">
            <div className="fs-head">
              <div className="fs-title">
                <Bi name="geo-alt" /> {tr("Where they are")}
              </div>
            </div>
            <div className="row g-3">
              <Fld md={12} id="co_address" label={tr("Address")} hint={gstHint('address')} error={errors.address}>
                <Textarea id="co_address" className={cls('address')} rows={2} maxLength={100} value={values.address} onChange={(e) => setTyped('address', e.target.value)} />
              </Fld>
              <Fld md={4} id="co_country" label={tr("Country")} hint={gstHint('country')}>
                <input id="co_country" className="form-control" maxLength={100} value={values.country} onChange={(e) => setTyped('country', e.target.value)} />
              </Fld>
              <Fld md={4} id="co_pincode" label={tr("Pincode")} hint={gstHint('pincode')}>
                <input id="co_pincode" className="form-control" maxLength={20} inputMode="numeric" value={values.pincode} onChange={(e) => setTyped('pincode', e.target.value)} />
              </Fld>
              <Fld md={4} id="co_nationality" label={tr("Nationality")} hint={gstHint('nationality')}>
                <input id="co_nationality" className="form-control" maxLength={100} value={values.nationality} onChange={(e) => setTyped('nationality', e.target.value)} />
              </Fld>
            </div>
          </div>
          <div className="form-section">
            <div className="fs-head">
              <div className="fs-title">
                <Bi name="telephone" /> {tr("How to reach them")}
              </div>
              <div className="fs-hint">{tr("The company's own number and email.")}</div>
            </div>
            <div className="row g-3">
              <Fld md={6} id="co_mobile" label={tr("Mobile")} error={errors.mobile}>
                <input id="co_mobile" className={cls('mobile')} maxLength={15} inputMode="tel" value={values.mobile} onChange={(e) => set('mobile', e.target.value)} />
              </Fld>
              <Fld md={6} id="co_phone" label={tr("Landline")} error={errors.phone}>
                <input id="co_phone" className={cls('phone')} maxLength={15} inputMode="tel" value={values.phone} onChange={(e) => set('phone', e.target.value)} />
              </Fld>
              <Fld md={12} id="co_email" label={tr("Email")} error={errors.email}>
                <input type="email" id="co_email" className={cls('email')} maxLength={254} value={values.email} onChange={(e) => set('email', e.target.value)} />
              </Fld>
            </div>
          </div>
        </div>

        <div className={step(1)}>
          <div className="form-section">
            <div className="fs-head">
              <div className="fs-title">
                <Bi name="people" /> {tr("People to contact")}<RequiredMark /> <span className="co-count">{values.contacts.length}</span>
              </div>
              <div className="fs-hint">{tr("The main contact is always kept and cannot be removed. Add as many more as you need, and the same role may be used twice.")}</div>
            </div>
            {errors.contacts ? <div className="invalid-feedback d-block mb-2">{errors.contacts}</div> : null}
            <div className="co-people">
              {values.contacts.map((p, i) => (
                <div key={i} className="co-person">
                  <div className="co-person-head">
                    <span className="co-person-no">{i + 1}</span>
                    <span className="co-person-tag">{i === 0 ? tr("Main contact") : `Person ${i + 1}`}</span>
                    {i > 0 ? (
                      <RemoveButton look="person" aria-label={tr("Remove this person")} onClick={() => set('contacts', values.contacts.filter((_, j) => j !== i))} />
                    ) : null}
                  </div>
                  <div className="row g-3">
                    <Fld md={6} label={tr("Full name")} required error={errors[`contacts.${i}.name`]}>
                      <input className={cls(`contacts.${i}.name`)} maxLength={100} value={p.name} onChange={(e) => setPerson(i, 'name', e.target.value)} />
                    </Fld>
                    <Fld md={6} label={tr("Their role")}>
                      <Select className="form-select" value={p.role} onChange={(e) => setPerson(i, 'role', e.target.value)}>
                        {p.role === '' ? <option value="">{tr("Choose a role…")}</option> : null}
                        {roleList.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    </Fld>
                    <Fld md={6} label={tr("Mobile")}>
                      <input className="form-control" maxLength={15} inputMode="tel" value={p.mobile} onChange={(e) => setPerson(i, 'mobile', e.target.value)} />
                    </Fld>
                    <Fld md={6} label={tr("Email")} error={errors[`contacts.${i}.email`]}>
                      <input type="email" className={cls(`contacts.${i}.email`)} maxLength={254} value={p.email} onChange={(e) => setPerson(i, 'email', e.target.value)} />
                    </Fld>
                  </div>
                </div>
              ))}
            </div>
            <TextAction kind="add" disabled={values.contacts.length >= 30} onClick={() => set('contacts', [...values.contacts, { role: '', name: '', email: '', mobile: '' }])}>{tr("Add another person")}</TextAction>
          </div>
        </div>

        <div className={step(2)}>
          <div className="form-section">
            <div className="fs-head">
              <div className="fs-title">
                <Bi name="percent" /> {tr("Rates on their bills")}
              </div>
              <div className="fs-hint">{tr("Leave a rate empty if it does not apply.")}</div>
            </div>
            <div className="co-rates">
              {companyRateFields.map((r) => (
                <label key={r.key} className="co-rate" htmlFor={`co_${r.key}`}>
                  <span className="co-rate-label">
                    <Bi name={RATE_ICON[r.key] ?? 'percent'} /> {r.label}
                  </span>
                  <span className="co-rate-input">
                    <input type="number" step="0.01" min="0" max="100" id={`co_${r.key}`} className={cls(r.key)} inputMode="decimal" placeholder="0" value={rates[r.key]} onChange={(e) => setRates((p) => ({ ...p, [r.key]: e.target.value }))} />
                    <span className="co-rate-unit">%</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="form-section">
            <div className="fs-head">
              <div className="fs-title">
                <Bi name="chat-left-text" /> {tr("Instruction")}
              </div>
              <div className="fs-hint">{tr("Optional. Anything worth knowing about this entry.")}</div>
            </div>
            <label className="form-label visually-hidden" htmlFor="co_instruction">
              {tr("Instruction")}
            </label>
            <Textarea id="co_instruction" className="form-control" rows={4} value={values.instruction} onChange={(e) => set('instruction', e.target.value)} />
          </div>
        </div>
      </div>
      <SharedConfirmDialog shared={shared} busy={busy} onConfirm={() => save(true)} />
    </Modal>
  );
}
