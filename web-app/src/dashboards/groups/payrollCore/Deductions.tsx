'use client';

// Deduction types (hotel.payroll.deductions): one line per deduction with an on/off switch; Delete in red inside More.
import { useMemo, useState } from 'react';
import { formatINR } from '@shared/dashboards/format';
import { validateDeduction, type Deduction, type DeductionInput, type PayrollCompanyRow } from '@shared/dashboards/payrollCore';
import { userMayEdit } from '@shared/dashboards/features';
import { Bi, Dialog, Dropdown, FormSection, Modal, Button, MayEdit, StatusChip } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { errorText, useSubmit, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { payrollApi } from './api';
import { EmptyState, Fld, PayLayout, SearchField, useTableView, newestFirst } from './pms';
import { PayrollPage } from './shared';
import { StaleNote, Wait, useLoaded } from './load';

import { tr, trf } from '@/lib/i18n/language';
/** hotel.payroll.deductions */
export function PayrollDeductions({ navigate }: ScreenProps) {
  return <PayrollPage navigate={navigate}>{(company) => <Body company={company} navigate={navigate} />}</PayrollPage>;
}

const rupees = (paise: number) => (paise ? String(paise / 100) : '');

function Body({ company, navigate }: { company: PayrollCompanyRow; navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const list = useLoaded(() => payrollApi.listDeductions(company.id), [company.id, version]);
  const rows = list.data;
  const [form, setForm] = useState<{ deduction: Deduction | null } | null>(null);
  const [del, setDel] = useState<Deduction | null>(null);
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => newestFirst(rows ?? [], () => ''), [rows]);
  const view = useTableView(all, {
    perPage: 1000,
    // The page search (decision 51): every word must match the deduction name.
    match: (d, q) => q.split(/\s+/).every((w) => d.name.toLowerCase().includes(w)),
    sorters: {
      name: { kind: 'text', value: (d) => d.name.toLowerCase() },
      amount: { kind: 'num', value: (d) => d.standardAmountPaise },
      assigned: { kind: 'num', value: (d) => d.assignedCount },
      active: { kind: 'text', value: (d) => (d.isActive ? 'active' : 'inactive') },
    },
  });
  const inUse = all.filter((d) => d.assignedCount > 0);
  const activeCount = all.filter((d) => d.isActive).length;
  const mayEdit = userMayEdit('payroll');

  async function act(run: () => Promise<{ ok: true; data: unknown } | { ok: false; error: Parameters<typeof errorText>[0] }>, ok: string) {
    setBusy(true);
    const res = await run();
    setBusy(false);
    setDel(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: ok });
      setVersion((n) => n + 1);
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  const addButton = (
    <MayEdit module="payroll"><Button icon="plus-lg" onClick={() => setForm({ deduction: null })}>{tr('Add deduction')}</Button></MayEdit>
  );

  if (!rows) return <Wait error={list.error} onRetry={list.reload} />;

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Deduction types' }]}
      sub={tr('What salary can take off, such as uniform or room. Set each one here once, then give it to a person on their staff record.')}
      search={all.length > 6 ? <SearchField bare clear value={view.search} onChange={view.setSearch} placeholder={tr('Search deductions…')} label={tr('Search deductions')} /> : undefined}
      actions={addButton}
    >
      <StaleNote error={list.error} onRetry={list.reload} />
      <div className="ha-stack">
        {all.length ? (
          <HomeStats
            stats={[
              { id: 'all', label: tr('Deductions'), value: all.length, format: (n) => String(Math.round(n)), note: trf('{0} in use', [activeCount]) },
              { id: 'off', label: tr('Switched off'), value: all.length - activeCount, format: (n) => String(Math.round(n)), note: tr('Not in use') },
{ id: 'given', label: tr('Given to staff'), value: inUse.length, format: (n) => String(Math.round(n)), note: trf('{0} not given yet', [all.length - inUse.length]) },
              { id: 'people', label: tr('Staff records'), value: all.reduce((n, d) => n + d.assignedCount, 0), format: (n) => String(Math.round(n)), note: tr('With a deduction') },
            ]}
          />
        ) : null}
        <div className="card ha-ms">
          {all.length === 0 ? (
            <EmptyState icon="dash-circle" title={tr('No deductions yet')} text={tr('Add one here, such as Uniform at 300.00, then give it to a person on their staff record with their own amount if needed.')}>
              <MayEdit module="payroll"><Button icon="plus-lg" onClick={() => setForm({ deduction: null })} className="mt-3">{tr('Add the first deduction')}</Button></MayEdit>
            </EmptyState>
          ) : view.rows.length === 0 ? (
            <EmptyState icon="search" title={tr('No deduction matches that search')} text={tr('Try another word.')}>
              <Button variant="outline" className="mt-3" onClick={() => view.setSearch('')}>{tr('Clear search')}</Button>
            </EmptyState>
          ) : (
            <section className="ha-ms-sec" aria-label={tr('Deductions')}>
              <ul className="ha-items">
                {view.rows.map((d) => (
                  <li key={d.id} className={d.isActive ? undefined : 'is-off'}>
                    <span className="ha-item-main">
                      <b>{d.name}</b>
                      <small>
                        {trf('Standard {0}', [formatINR(d.standardAmountPaise)])} · {d.assignedCount ? trf('on {0} staff records', [d.assignedCount]) : tr('not given to anyone yet')}
                      </small>
                    </span>
                    {!mayEdit ? (d.isActive ? <StatusChip tone="ok">{tr('In use')}</StatusChip> : <StatusChip tone="neutral">{tr('Off')}</StatusChip>) : null}
                    <MayEdit module="payroll">
                      <label className="form-check form-switch ha-switch">
                        <input className="form-check-input" type="checkbox" role="switch" checked={d.isActive} disabled={busy} onChange={() => void act(() => payrollApi.toggleDeduction(company.id, d.id), d.isActive ? trf('{0} is off.', [d.name]) : trf('{0} is in use.', [d.name]))} aria-label={trf('{0} in use', [d.name])} />
                        <span>{d.isActive ? tr('In use') : tr('Off')}</span>
                      </label>
                      <Button size="sm" variant="outline" icon="pencil-square" onClick={() => setForm({ deduction: d })}>{tr('Edit')}</Button>
                      <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [d.name])} {...p} />}>
                        <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setDel(d); }}><Bi name="trash" className="me-2" />{tr('Delete deduction')}</a>
                      </Dropdown>
                    </MayEdit>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      {form ? (
        <DeductionForm
          key={form.deduction?.id ?? 'new'}
          company={company}
          deduction={form.deduction}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setVersion((n) => n + 1);
          }}
        />
      ) : null}
      <Dialog
        open={del !== null}
        tone="danger"
        title={tr("Delete deduction?")}
        message={del ? `Delete the deduction "${del.name}"?` : undefined}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => del && void act(() => payrollApi.deleteDeduction(company.id, del.id), 'Deduction deleted.')}
        onCancel={() => setDel(null)}
      />
    </PayLayout>
  );
}

function DeductionForm({ company, deduction, onClose, onSaved }: { company: PayrollCompanyRow; deduction: Deduction | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(deduction?.name ?? '');
  const [amount, setAmount] = useState(rupees(deduction?.standardAmountPaise ?? 0));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { busy, errors: serverErrors, submit } = useSubmit(['name', 'standardAmountPaise']);
  const errors = { ...localErrors, ...serverErrors };
  const uid = deduction?.id ?? 'new';

  function save() {
    const v: DeductionInput = { name, standardAmountPaise: Math.round((Number(amount) || 0) * 100), isActive: deduction?.isActive ?? true };
    const local = validateDeduction(v);
    setLocalErrors(local);
    if (Object.keys(local).length) return;
    void submit(
      () => (deduction ? payrollApi.updateDeduction(company.id, deduction.id, v) : payrollApi.createDeduction(company.id, v)),
      () => {
        toast.show({ tone: 'success', text: deduction ? tr('Deduction saved.') : tr('Deduction added.') });
        onSaved();
      },
    );
  }

  return (
    <Modal
      open
      className="pay-form-modal"
      centered={false}
      onSubmit={save}
      onClose={onClose}
      eyebrow={<>{deduction ? tr('Deduction') : company.name}</>}
      title={deduction ? deduction.name : tr('Add deduction')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" disabled={busy}>{deduction ? tr("Save changes") : tr("Add deduction")}</Button>
        </>
      }
    >
      <FormSection icon="dash-circle" title={tr('Deduction')} hint={tr('The standard amount. A person\'s staff record can give them their own amount.')}>
        <div className="row g-3">
          <Fld md={7} id={`ded_name_${uid}`} label={tr('Name')} required error={errors.name}>
            <input id={`ded_name_${uid}`} className={`form-control ${errors.name ? 'is-invalid' : ''}`} placeholder={tr('Uniform, Room, Food…')} value={name} onChange={(e) => setName(e.target.value)} />
          </Fld>
          <Fld md={5} id={`ded_amt_${uid}`} label={tr('Standard amount')} required error={errors.standardAmountPaise}>
            <input id={`ded_amt_${uid}`} type="number" inputMode="decimal" step="0.01" min="0" className={`form-control ${errors.standardAmountPaise ? 'is-invalid' : ''}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Fld>
        </div>
      </FormSection>    </Modal>
  );
}
