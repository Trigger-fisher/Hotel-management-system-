'use client';

// Attendance marks (hotel.payroll.attendanceStatuses): one line per mark with its key, what it pays and an on/off switch.
import { useMemo, useState } from 'react';
import { attendancePercentages, markTone, validateStatus, type AttendanceStatus, type AttendanceStatusInput, type PayrollCompanyRow } from '@shared/dashboards/payrollCore';
import { userMayEdit } from '@shared/dashboards/features';
import { Bi, Dialog, Dropdown, FormSection, Modal, Select, Button, MayEdit, PickGroup, StatusChip } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { errorText, useSubmit, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { payrollApi } from './api';
import { EmptyState, Fld, PayLayout, SearchField, servesMeals, useTableView, newestFirst } from './pms';
import { PayrollPage } from './shared';
import { StaleNote, Wait, useLoaded } from './load';

import { tr, trf } from '@/lib/i18n/language';
/** hotel.payroll.attendanceStatuses */
export function PayrollStatuses({ navigate }: ScreenProps) {
  return <PayrollPage navigate={navigate}>{(company) => <Body company={company} navigate={navigate} />}</PayrollPage>;
}

function Body({ company, navigate }: { company: PayrollCompanyRow; navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const list = useLoaded(() => payrollApi.listStatuses(company.id), [company.id, version]);
  const rows = list.data;
  const [form, setForm] = useState<{ status: AttendanceStatus | null } | null>(null);
  const [del, setDel] = useState<AttendanceStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => newestFirst(rows ?? [], () => ''), [rows]);
  const view = useTableView(all, {
    perPage: 1000,
    // The page search (decision 51): every word must match the name, the shortcut key or the type.
    match: (s, q) => q.split(/\s+/).every((w) => `${s.name} ${s.shortcutKey} ${s.statusType}`.toLowerCase().includes(w)),
    sorters: {
      status: { kind: 'text', value: (s) => s.name.toLowerCase() },
      shortcut: { kind: 'text', value: (s) => s.shortcutKey.toLowerCase() },
      pct: { kind: 'num', value: (s) => s.attendancePercentage },
      type: { kind: 'text', value: (s) => s.statusType },
      active: { kind: 'text', value: (s) => (s.isActive ? 'active' : 'inactive') },
    },
  });
  const active = all.filter((s) => s.isActive);
  const paid = active.filter((s) => s.statusType === 'Paid');

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
    <MayEdit module="payroll"><Button icon="plus-lg" onClick={() => setForm({ status: null })}>{tr('Add mark')}</Button></MayEdit>
  );
  const mayEdit = userMayEdit('payroll');
  const pays = { none: tr('No pay'), part: tr('Part day'), full: tr('Full day') };

  if (!rows) return <Wait error={list.error} onRetry={list.reload} />;

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Attendance marks' }]}
      sub={tr('The marks on the attendance sheet. Each has a key to type and the share of a day it pays; salary is worked out from them.')}
      search={all.length > 6 ? <SearchField bare clear value={view.search} onChange={view.setSearch} placeholder={tr('Search attendance marks…')} label={tr('Search attendance marks')} /> : undefined}
      actions={addButton}
    >
      <StaleNote error={list.error} onRetry={list.reload} />
      <div className="ha-stack">
        {all.length ? (
          <HomeStats
            stats={[
              { id: 'marks', label: tr('Marks'), value: all.length, format: (n) => String(Math.round(n)), note: trf('{0} on the sheet', [active.length]) },
              { id: 'paid', label: tr('Paid'), value: paid.length, format: (n) => String(Math.round(n)), note: tr('Count towards salary') },
              { id: 'unpaid', label: tr('Unpaid'), value: active.length - paid.length, format: (n) => String(Math.round(n)), note: tr('Take pay off the day') },
              ...(servesMeals(company) ? [{ id: 'meals', label: tr('Skip meals'), value: active.filter((s) => s.skipsFood).length, format: (n: number) => String(Math.round(n)), note: tr('Meals not counted that day') }] : []),
            ]}
          />
        ) : null}
        <div className="card ha-ms">
          {all.length === 0 ? (
            <EmptyState icon="palette2" title={tr('No attendance marks yet')} text={tr('Attendance needs at least one mark, such as Present (P, full day) and Absent (A, no pay). Add them here first.')}>
              <MayEdit module="payroll"><Button icon="plus-lg" onClick={() => setForm({ status: null })} className="mt-3">{tr('Add the first mark')}</Button></MayEdit>
            </EmptyState>
          ) : view.rows.length === 0 ? (
            <EmptyState icon="search" title={tr('No attendance mark matches that search')} text={tr('Try another word.')}>
              <Button variant="outline" className="mt-3" onClick={() => view.setSearch('')}>{tr('Clear search')}</Button>
            </EmptyState>
          ) : (
            <section className="ha-ms-sec" aria-label={tr('Attendance marks')}>
              <ul className="ha-items">
                {view.rows.map((s) => (
                  <li key={s.id} className={s.isActive ? undefined : 'is-off'}>
                    {/* check-shared-ignore: the colour of an attendance mark is user data */}
                    <span className="lc-key" data-tone={markTone(s.attendancePercentage)} style={{ background: s.color }}>{s.shortcutKey.toUpperCase()}</span>
                    <span className="ha-item-main">
                      <b>{s.name}</b>
                      <small>
                        {trf('{0}% of a day', [s.attendancePercentage])} · {s.statusType === 'Paid' ? tr('Paid') : tr('Unpaid')} · {pays[markTone(s.attendancePercentage)]}
                        {s.skipsFood ? <> · <Bi name="cup-hot" /> {tr('Meals not counted')}</> : null}
                      </small>
                    </span>
                    {!mayEdit ? (s.isActive ? <StatusChip tone="ok">{tr('On the sheet')}</StatusChip> : <StatusChip tone="neutral">{tr('Off')}</StatusChip>) : null}
                    <MayEdit module="payroll">
                      <label className="form-check form-switch ha-switch">
                        <input className="form-check-input" type="checkbox" role="switch" checked={s.isActive} disabled={busy} onChange={() => void act(() => payrollApi.toggleStatus(company.id, s.id), s.isActive ? trf('{0} is off the sheet.', [s.name]) : trf('{0} is on the sheet.', [s.name]))} aria-label={trf('{0} on the sheet', [s.name])} />
                        <span>{s.isActive ? tr('On the sheet') : tr('Off')}</span>
                      </label>
                      <Button size="sm" variant="outline" icon="pencil-square" onClick={() => setForm({ status: s })}>{tr('Edit')}</Button>
                      <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [s.name])} {...p} />}>
                        <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setDel(s); }}><Bi name="trash" className="me-2" />{tr('Delete mark')}</a>
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
        <StatusForm
          key={form.status?.id ?? 'new'}
          company={company}
          status={form.status}
          taken={all}
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
        title={tr("Delete this mark?")}
        message={del ? trf('Delete the mark "{0}"?', [del.name]) : undefined}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => del && void act(() => payrollApi.deleteStatus(company.id, del.id), 'Mark deleted.')}
        onCancel={() => setDel(null)}
      />
    </PayLayout>
  );
}

function StatusForm({ company, status, taken, onClose, onSaved }: { company: PayrollCompanyRow; status: AttendanceStatus | null; taken: AttendanceStatus[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<AttendanceStatusInput>(() => ({
    name: status?.name ?? '',
    shortcutKey: status?.shortcutKey ?? '',
    color: status?.color ?? '#6B7080',
    attendancePercentage: status?.attendancePercentage ?? 100,
    statusType: status?.statusType ?? 'Paid',
    skipsFood: status?.skipsFood ?? false,
    isActive: status?.isActive ?? true,
  }));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { busy, errors: serverErrors, submit } = useSubmit(['name', 'shortcutKey', 'color']);
  const errors = { ...localErrors, ...serverErrors };
  const set = <K extends keyof AttendanceStatusInput>(k: K, val: AttendanceStatusInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const uid = status?.id ?? 'new';
  const keyTaken = v.shortcutKey.trim() !== '' && taken.some((x) => x.id !== status?.id && x.shortcutKey.toLowerCase() === v.shortcutKey.trim().toLowerCase());

  function save() {
    const local = validateStatus(v);
    if (keyTaken) local.shortcutKey = tr('Another mark already uses this key.');
    setLocalErrors(local);
    if (Object.keys(local).length) return;
    void submit(
      () => (status ? payrollApi.updateStatus(company.id, status.id, v) : payrollApi.createStatus(company.id, v)),
      () => {
        toast.show({ tone: 'success', text: status ? tr('Mark saved.') : tr('Mark added.') });
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
      eyebrow={<>{status ? tr('Attendance mark') : company.name}</>}
      title={status ? status.name : tr('Add attendance mark')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" disabled={busy}>{status ? tr("Save changes") : tr("Add mark")}</Button>
        </>
      }
    >
      <FormSection icon="tag" title={tr('The mark')} hint={tr('The key is typed on the attendance sheet: one easy letter. Key and colour are each used once in this company.')}>
        <div className="row g-3">
          <Fld md={6} id={`as_name_${uid}`} label={tr('Name')} required error={errors.name}>
            <input id={`as_name_${uid}`} className={`form-control ${errors.name ? 'is-invalid' : ''}`} placeholder={tr('Present, Absent, Half day…')} value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Fld>
          <Fld md={3} id={`as_key_${uid}`} label={tr('Key')} required error={errors.shortcutKey}>
            <input id={`as_key_${uid}`} className={`form-control text-uppercase ${errors.shortcutKey ? 'is-invalid' : ''}`} maxLength={10} value={v.shortcutKey} onChange={(e) => set('shortcutKey', e.target.value.toUpperCase())} />
          </Fld>
          <Fld md={3} id={`as_color_${uid}`} label={tr('Colour')} required error={errors.color}>
            <input id={`as_color_${uid}`} type="color" className="form-control form-control-color w-100" value={v.color} onChange={(e) => set('color', e.target.value.toUpperCase())} />
          </Fld>
        </div>
      </FormSection>
      <FormSection icon="calculator" title={tr('What it pays')} hint={tr('Salary is worked out from this: a day at 50% pays half a day.')}>
        <PickGroup
          label={tr('Paid or unpaid')}
          value={v.statusType}
          onChange={(x) => set('statusType', x)}
          choices={[
            { value: 'Paid', icon: 'check2-circle', title: tr('Paid'), text: tr('Counts towards salary') },
            { value: 'Unpaid', icon: 'x-circle', title: tr('Unpaid'), text: tr('Takes pay off the day') },
          ]}
        />
        <div className="row g-3 mt-1">
          <Fld md={6} id={`as_pct_${uid}`} label={tr('Counts as')} required>
            <Select id={`as_pct_${uid}`} className="form-select" value={v.attendancePercentage} onChange={(e) => set('attendancePercentage', Number(e.target.value) as AttendanceStatusInput['attendancePercentage'])}>
              {attendancePercentages.map((p) => (
                <option key={p} value={p}>
                  {trf('{0}% of a working day', [p])}
                </option>
              ))}
            </Select>
          </Fld>
          {servesMeals(company) ? (
            <div className="col-12">
              <div className="offer-toggle">
                <div className="form-check form-switch mb-0">
                  <input className="form-check-input" type="checkbox" role="switch" id={`as_food_${uid}`} checked={v.skipsFood} onChange={(e) => set('skipsFood', e.target.checked)} />
                  <label className="form-check-label" htmlFor={`as_food_${uid}`}>
                    {tr('Meals are not counted on this mark')}
                  </label>
                </div>
                <div className="offer-hint">
                  <Bi name="cup-hot" /> {tr('A day with this mark is left out of the meals bill.')}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </FormSection>    </Modal>
  );
}
