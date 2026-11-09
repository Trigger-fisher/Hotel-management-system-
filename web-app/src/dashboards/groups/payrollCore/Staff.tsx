'use client';

// Staff (hotel.payroll.staff): one card per person, monthly salary at the right; the add / edit form is StaffForm.tsx.
import { useEffect, useMemo, useState } from 'react';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { formatDate, formatINR } from '@shared/dashboards/format';
import { type Employee, type PayrollCompanyRow } from '@shared/dashboards/payrollCore';
import { Bi, Dialog, CellStack, Alert, Button, DetailCard, DetailList, Dropdown, FilterBar, IconButton, Table, MayEdit } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { errorText, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { payrollApi } from './api';
import { EmptyState, Pager, PayLayout, SearchField, Th, initials, newestFirst, useTableView } from './pms';
import { PayrollPage } from './shared';
import { StaleNote, Wait, useLoaded, useMockPdf } from './load';
import { EmployeeFormModal } from './StaffForm';
import { payApi } from '../payrollPay/api';
import { RejoinModal } from '../payrollPay/RejoinModal';
import type { Separation } from '@shared/dashboards/payrollPay';
import { recordHistoryCopy } from '@shared/dashboards/adminSystem';
import { RecordHistoryModal } from '../admin/RecordHistory';

import { tr, trf } from '@/lib/i18n/language';
/** hotel.payroll.staff */
export function PayrollStaff({ navigate, params }: ScreenProps) {
  // The Dashboard's "Add staff" opens this screen with the add form already open.
  return <PayrollPage navigate={navigate}>{(company) => <Body company={company} navigate={navigate} openAdd={params.add === '1'} />}</PayrollPage>;
}

function Body({ company, navigate, openAdd }: { company: PayrollCompanyRow; navigate: ScreenProps['navigate']; openAdd?: boolean }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const list = useLoaded(() => payrollApi.listEmployees(company.id, { pageSize: 1000 }), [company.id, version]);
  const rows = list.data?.items ?? null;
  const [form, setForm] = useState<{ employee: Employee | null } | null>(openAdd ? { employee: null } : null);
  const [letter, setLetter] = useState<Employee | null>(null);
  const [history, setHistory] = useState<Employee | null>(null);
  const [noDeductions, setNoDeductions] = useState(false);
  const [rejoinable, setRejoinable] = useState<Separation[]>([]);
  const [rejoinOpen, setRejoinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const onPdf = useMockPdf();

  useEffect(() => {
    let live = true;
    void payApi.listSeparations(company.id, { tab: 'relieved', page: 1, pageSize: 1000 }).then((res) => {
      if (live && res.ok) setRejoinable(res.data.page.items.filter((x) => !x.rejoinedOn));
    });
    void payrollApi.getOptions(company.id).then((res) => {
      if (live && res.ok) setNoDeductions(!res.data.deductions.some((d) => d.isActive));
    });
    return () => {
      live = false;
    };
  }, [company.id, version]);

  const all = useMemo(() => newestFirst(rows ?? [], (e) => e.joiningDate), [rows]);
  const [tab, setTab] = useState<'' | 'active' | 'inactive'>('');
  const shown = useMemo(() => (tab ? all.filter((e) => e.isActive === (tab === 'active')) : all), [all, tab]);
  const view = useTableView(shown, {
    perPage: 25,
    match: (e, q) => `${e.name} ${e.employeeCode} ${e.designation} ${e.department} ${e.shift} ${e.display.contact} ${e.email} ${e.paymentMode}`.toLowerCase().includes(q),
    sorters: { employee: { kind: 'text', value: (e) => e.name.toLowerCase() } },
  });

  const active = all.filter((e) => e.isActive);
  const year = String(new Date().getFullYear());
  const joinedThisYear = all.filter((e) => e.joiningDate.startsWith(year)).length;
  const byBank = active.filter((e) => e.paymentMode.toLowerCase() === 'bank').length;

  async function act(run: () => Promise<{ ok: true; data: unknown } | { ok: false; error: Parameters<typeof errorText>[0] }>, ok: string | ((data: unknown) => string), after?: () => void) {
    setBusy(true);
    const res = await run();
    setBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: typeof ok === 'function' ? ok(res.data) : ok });
      after?.();
      setVersion((n) => n + 1);
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  async function remove(e: Employee) {
    const res = await payrollApi.deleteEmployee(company.id, e.id);
    if (!res.ok) {
      toast.show({ tone: 'error', text: errorText(res.error) });
      return;
    }
    setVersion((n) => n + 1);
    toast.show({
      tone: 'success',
      text: trf('{0} deleted.', [e.name]),
      action: {
        label: 'Undo',
        onClick: () =>
          void payrollApi.restoreEmployee(company.id, e.id).then((r) => {
            if (r.ok) setVersion((n) => n + 1);
            else toast.show({ tone: 'error', text: errorText(r.error) });
          }),
      },
    });
  }

  // The list leaves out the IFSC and the full emergency number, so the form opens on the full record.
  async function openEdit(e: Employee) {
    setBusy(true);
    const res = await payrollApi.getEmployee(company.id, e.id);
    setBusy(false);
    if (res.ok) setForm({ employee: res.data });
    else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  const addButton = (
    <MayEdit module="payroll"><Button icon="person-plus" onClick={() => setForm({ employee: null })}>{tr('Add staff member')}</Button></MayEdit>
  );

  if (!rows) return <Wait error={list.error} onRetry={list.reload} />;

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Staff' }]}
      sub={trf('Everyone on {0}\'s payroll. Open a card for the full record.', [company.name])}
      search={<SearchField bare value={view.search} onChange={view.setSearch} placeholder={tr('Search name, ID, mobile, email…')} label={tr('Search staff')} />}
      actions={
        <>
          {rejoinable.length > 0 ? (
            <MayEdit module="payroll"><Button variant="outline" icon="arrow-counterclockwise" onClick={() => setRejoinOpen(true)}>{tr('Rejoin')}</Button></MayEdit>
          ) : null}
          {addButton}
        </>
      }
    >
      <StaleNote error={list.error} onRetry={list.reload} />
      <div className="ha-stack">
        {noDeductions ? (
          <Alert tone="warning" icon="exclamation-triangle">
            {trf('No deductions are set up for {0} yet.', [company.name])}{' '}
            <a href="#" className="fw-semibold" onClick={(e) => { e.preventDefault(); navigate('hotel.payroll.deductions'); }}>{tr('Set up deductions')}</a>
          </Alert>
        ) : null}
        <HomeStats
          stats={[
            { id: 'active', label: tr('Active staff'), value: active.length, format: (n) => String(Math.round(n)), note: trf('{0} inactive', [all.length - active.length]) },
            { id: 'salary', label: tr('Monthly salary'), value: active.reduce((n, e) => n + e.salaryPaise, 0), format: (n) => formatINR(Math.round(n)), note: tr('Active staff, per month') },
            { id: 'joined', label: tr('Joined this year'), value: joinedThisYear, format: (n) => String(Math.round(n)), note: year },
            { id: 'bank', label: tr('Paid by bank'), value: byBank, format: (n) => String(Math.round(n)), note: trf('{0} paid in cash', [active.length - byBank]) },
          ]}
        />
        {all.length > 0 ? (
          <FilterBar
            tabs={[
              { id: '', label: tr('All'), icon: 'collection', count: all.length },
              { id: 'active', label: tr('Active'), dot: 'settled', count: active.length },
              { id: 'inactive', label: tr('Inactive'), dot: 'due', count: all.length - active.length },
            ]}
            active={tab}
            onTab={(id) => setTab(id as '' | 'active' | 'inactive')}
            tabsLabel={tr('Staff by status')}
            summary={<>{tr('Showing')} <b>{view.total}</b> {tr('of')} {all.length}</>}
          />
        ) : null}

        {all.length === 0 ? (
          <div className="card">
            <EmptyState icon="people" title={tr('No staff yet')} text={trf('Add the first person to take attendance, advances and salary for {0}.', [company.name])}>
              <MayEdit module="payroll"><Button icon="person-plus" onClick={() => setForm({ employee: null })} className="mt-3">{tr('Add the first staff member')}</Button></MayEdit>
            </EmptyState>
          </div>
        ) : view.total === 0 ? (
          <div className="card"><EmptyState icon="search" title={tr('No matching staff')} text={tr('Try another tab, name, staff ID, designation or department.')} /></div>
        ) : (
          <div>
            {view.rows.map((e) => (
              <DetailCard
                key={e.id}
                label={trf('Staff member {0}', [e.name])}
                className={e.isActive ? undefined : 'is-off'}
                lead={{ big: initials(e.name), tag: e.isActive ? undefined : tr('Inactive'), muted: !e.isActive, title: e.name }}
                facts={[
                  { label: tr('Staff'), value: e.name, sub: e.employeeCode },
                  { label: tr('Designation'), value: e.designation, sub: e.department },
                  { label: tr('Joined'), value: e.joiningDate ? formatDate(e.joiningDate) : '' },
                  { label: tr('Paid by'), value: e.paymentMode, sub: e.shift },
                ]}
                amount={{ label: tr('Monthly salary'), value: formatINR(e.salaryPaise) }}
                sections={[
                  {
                    icon: 'person-vcard',
                    title: tr('Contact'),
                    content: (
                      <DetailList
                        items={[
                          { label: tr('Mobile'), value: e.display.contact || '-' },
                          { label: tr('Email'), value: e.email || '-' },
                          { label: tr('Shift'), value: e.shift || '-' },
                        ]}
                      />
                    ),
                  },
                  {
                    icon: 'cash-stack',
                    title: tr('Pay'),
                    content: (
                      <DetailList
                        items={[
                          { label: tr('Designation'), value: e.designation || '-' },
                          { label: tr('Department'), value: e.department || '-' },
                          { label: tr('Paid by'), value: e.paymentMode || '-' },
                          { label: tr('Monthly salary'), value: formatINR(e.salaryPaise), total: true },
                        ]}
                      />
                    ),
                  },
                ]}
                actions={
                  <>
                    <a className="btn btn-sm btn-outline-p" href={PDF_ROUTES.staffRecordSheet(company.id, e.id)} target="_blank" rel="noreferrer" onClick={onPdf(`Staff record of ${e.name}`)}>
                      <Bi name="file-earmark-pdf" className="me-1" />
                      {tr('Staff record')}
                    </a>
                    {e.canEdit ? <MayEdit module="payroll"><Button size="sm" variant="outline" icon="pencil-square" disabled={busy} onClick={() => void openEdit(e)}>{tr('Edit')}</Button></MayEdit> : null}
                    <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [e.name])} {...p}>{tr('More')}</Button>}>
                      <a className="dropdown-item" href={PDF_ROUTES.joiningLetter(company.id, e.id)} target="_blank" rel="noreferrer" onClick={onPdf(`Joining letter of ${e.name}`)}><Bi name="file-earmark-text" className="me-2" />{tr('Joining letter')}</a>
                      {e.email ? <a href="#" className="dropdown-item" onClick={(ev) => { ev.preventDefault(); setLetter(e); }}><Bi name="envelope-paper" className="me-2" />{tr('Email appointment letter')}</a> : null}
                      <a href="#" className="dropdown-item" onClick={(ev) => { ev.preventDefault(); navigate('hotel.payroll.staffEmails', { employee: e.id }); }}><Bi name="send" className="me-2" />{tr('Email details to someone')}</a>
                      <a href="#" className="dropdown-item" onClick={(ev) => { ev.preventDefault(); setHistory(e); }}><Bi name="clock-history" className="me-2" />{recordHistoryCopy.open}</a>
                      {e.canEdit ? (
                        <MayEdit module="payroll">
                          <a href="#" className="dropdown-item" onClick={(ev) => { ev.preventDefault(); void act(() => payrollApi.toggleEmployee(company.id, e.id), e.isActive ? trf('{0} is inactive.', [e.name]) : trf('{0} is active.', [e.name])); }}><Bi name={e.isActive ? 'pause-circle' : 'play-circle'} className="me-2" />{e.isActive ? tr('Mark inactive') : tr('Mark active')}</a>
                        </MayEdit>
                      ) : null}
                      {e.canDelete ? (
                        <MayEdit module="payroll">
                          <a href="#" className="dropdown-item text-danger" onClick={(ev) => { ev.preventDefault(); void remove(e); }}><Bi name="trash" className="me-2" />{tr('Delete staff member')}</a>
                        </MayEdit>
                      ) : null}
                    </Dropdown>
                  </>
                }
              />
            ))}
            {view.total > 25 ? <div className="card sh-pager-card"><Pager view={view} /></div> : null}
          </div>
        )}
      </div>
      {form ? (
        <EmployeeFormModal
          key={form.employee?.id ?? 'new'}
          company={company}
          employee={form.employee}
          taken={all}
          onClose={() => setForm(null)}
          onAdded={() => setVersion((n) => n + 1)}
          onSaved={() => {
            setForm(null);
            setVersion((n) => n + 1);
          }}
        />
      ) : null}

      {history ? <RecordHistoryModal id={history.id} title={history.name} hint={recordHistoryCopy.hintPayroll} onClose={() => setHistory(null)} /> : null}

      {rejoinOpen ? (
        <RejoinModal
          companyId={company.id}
          choices={rejoinable}
          onClose={() => setRejoinOpen(false)}
          onSaved={() => {
            setRejoinOpen(false);
            setVersion((n) => n + 1);
          }}
        />
      ) : null}
      <Dialog
        open={letter !== null}
        icon="envelope-paper"
        title={tr("Email the appointment letter?")}
        message={letter ? `It is sent to ${letter.email || 'the email on record'}.` : undefined}
        confirmLabel="Send letter"
        busy={busy}
        onConfirm={() => letter && void act(() => payrollApi.sendOfferLetter(company.id, letter.id), (data) => (data as { message: string }).message).then(() => setLetter(null))}
        onCancel={() => setLetter(null)}
      />
    </PayLayout>
  );
}

/** The recycle bin list (deleted staff). Kept for the SuperAdmin Settings "Recycle bin" tab; Pallav has no bin on this page. */
export function StaffBin({ company, navigate, onBack }: { company: PayrollCompanyRow; navigate: ScreenProps['navigate']; onBack: () => void }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const bin = useLoaded(() => payrollApi.listEmployees(company.id, { deleted: true, pageSize: 1000 }), [company.id, version], company.id);
  const rows: Employee[] | null = bin.data?.items ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [purging, setPurging] = useState<Employee | null>(null);

  const all = useMemo(() => rows ?? [], [rows]);
  const view = useTableView(all, {
    perPage: 25,
    match: (e, q) => `${e.name} ${e.employeeCode} ${e.designation}`.toLowerCase().includes(q),
    sorters: { employee: { kind: 'text', value: (e) => e.name.toLowerCase() } },
  });

  async function run(e: Employee, call: () => Promise<{ ok: true; data: unknown } | { ok: false; error: Parameters<typeof errorText>[0] }>, ok: string) {
    setBusy(e.id);
    const res = await call();
    setBusy(null);
    setPurging(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: ok });
      setVersion((n) => n + 1);
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  if (!rows) return <Wait error={bin.error} onRetry={bin.reload} tiles={false} />;

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: 'Staff', onPress: onBack }, { label: 'Recycle bin' }]}
      sub="Deleted staff. Restore someone, or delete them for ever."
      search={<SearchField bare value={view.search} onChange={view.setSearch} placeholder={tr("Search name or ID…")} label={tr("Search deleted staff")} />}
    >
      <StaleNote error={bin.error} onRetry={bin.reload} />
      <div className="card">
        {rows && all.length === 0 ? (
          <EmptyState icon="trash" title={tr("The recycle bin is empty")} text="Deleted staff appear here until they are restored or removed for ever." />
        ) : (
          <>
            <div className="table-responsive">
              <Table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th className="col-sno">{tr("S.No.")}</th>
                    <Th view={view} id="employee">{tr("Employee")}</Th>
                    <th>{tr("Designation")}</th>
                    <th>{tr("Joined")}</th>
                    <th className="text-end">{tr("Action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((e, i) => (
                    <tr key={e.id}>
                      <td className="sno">{view.offset + i + 1}</td>
                      <td>
                        <CellStack main={e.name} sub={e.employeeCode} />
                      </td>
                      <td>{e.designation}</td>
                      <td>{e.joiningDate ? formatDate(e.joiningDate) : '-'}</td>
                      <td className="text-end text-nowrap">
                        <Button variant="outline" size="sm" icon="arrow-counterclockwise" disabled={busy !== null} onClick={() => void run(e, () => payrollApi.restoreEmployee(company.id, e.id), `${e.name} is back on the staff list.`)}>{tr("Restore")}</Button>{' '}
                        <IconButton icon="trash" label={tr("Delete for ever")} tone="danger" disabled={busy !== null} onClick={() => setPurging(e)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pager view={view} />
          </>
        )}
      </div>
      <Dialog
        open={purging !== null}
        tone="danger"
        title={purging ? `Delete ${purging.name} for ever?` : ''}
        message="This removes the record and cannot be undone."
        confirmLabel="Delete for ever"
        busy={busy !== null}
        onConfirm={() => purging && void run(purging, () => payrollApi.purgeEmployee(company.id, purging.id), `${purging.name} was deleted for ever.`)}
        onCancel={() => setPurging(null)}
      />
    </PayLayout>
  );
}
