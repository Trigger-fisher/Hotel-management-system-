'use client';

// Resignation (hotel.payroll.resignations): one card per exit, the last working day at the left; forms: SeparationForm.tsx, RejoinModal.tsx.
import { useEffect, useMemo, useState } from 'react';
import { formatDate, formatMonth } from '@shared/dashboards/format';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { type Employee } from '@shared/dashboards/payrollCore';
import { payrollPayCopy, separationStatuses, type PayrollCompanyRef, type Separation, type SeparationSort, type SeparationStatus, type SeparationSummary } from '@shared/dashboards/payrollPay';
import { Bi, DetailCard, DetailList, DetailNone, Dialog, Dropdown, FilterBar, Pager, SearchField, Th, useTableView, CellStack, Alert, Button, IconButton, Table, MayEdit } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { payrollApi } from '../payrollCore/api';
import { EmptyState, PayLayout } from '../payrollCore/pms';
import { payApi } from './api';
import { RejoinModal } from './RejoinModal';
import { SeparationFormModal } from './SeparationForm';
import { PayPage, failText } from './shared';
import { StaleNote, Wait, useLoaded, useMockPdf } from '../payrollCore/load';
import { useServerList } from './serverList';

import { tr, trf } from '@/lib/i18n/language';
const L = payrollPayCopy.lists;
const NUMERIC: SeparationSort[] = ['lastWorkingDate', 'resignationDate', 'entryNo'];
const STATUS_DOT: Record<SeparationStatus, 'due' | 'paid' | 'muted'> = { Pending: 'due', Accepted: 'paid', Relieved: 'muted' };

/** hotel.payroll.resignations */
export function Resignations({ user, navigate }: ScreenProps) {
  return <PayPage role={user.role} navigate={navigate}>{(company) => <Body company={company} navigate={navigate} />}</PayPage>;
}

const days = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);
const trailOf = (company: PayrollCompanyRef, navigate: ScreenProps['navigate'], last: string) => [
  { label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') },
  { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') },
  { label: last },
];

function Body({ company, navigate }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const [active, setActive] = useState<Employee[]>([]);
  const [version, setVersion] = useState(0);
  // One page at a time: status, search and order go to the server; the tiles and tab counts are the server's figures for every exit.
  const paged = useServerList<SeparationStatus, SeparationSort>(NUMERIC, 'resignationDate');
  const list = useLoaded(() => payApi.listSeparations(company.id, paged.query), [company.id, version, ...paged.deps]);
  const rows: Separation[] | null = list.data?.page.items ?? null;
  const summary: SeparationSummary = list.data?.summary ?? { inNotice: 0, relieved: 0, rejoined: 0, all: 0, byStatus: { Pending: 0, Accepted: 0, Relieved: 0 } };
  const view = paged.viewOf<Separation>(rows ?? [], list.data?.page.total ?? 0);
  const [form, setForm] = useState<{ item: Separation | null } | null>(null);
  const [rejoin, setRejoin] = useState<Separation | null>(null);
  const [del, setDel] = useState<Separation | null>(null);
  const [busy, setBusy] = useState(false);
  const onPdf = useMockPdf();

  const [codes, setCodes] = useState<Map<string, string>>(() => new Map());
  // separation.blade.php warns when the company has no experience letter template, and only then hides the letter button.
  const [hasTemplate, setHasTemplate] = useState(true);

  useEffect(() => {
    let live = true;
    void payrollApi.listEmployees(company.id, { tab: 'active', pageSize: 1000 }).then((res) => live && res.ok && setActive(res.data.items));
    // Every employee (leavers too), for the code under each name.
    void payrollApi.listEmployees(company.id, { pageSize: 1000 }).then((res) => live && res.ok && setCodes(new Map(res.data.items.map((e) => [e.id, e.employeeCode]))));
    void payApi.getLetterTemplate(company.id, 'experience').then((res) => live && res.ok && setHasTemplate(res.data !== null));
    return () => {
      live = false;
    };
  }, [company.id, version]);

  async function remove() {
    if (!del) return;
    setBusy(true);
    const res = await payApi.deleteSeparation(company.id, del.id);
    setBusy(false);
    setDel(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: res.data.message });
      setVersion((n) => n + 1);
    } else toast.show({ tone: 'error', text: failText(res.error) });
  }

  const pending = summary.inNotice;
  const addButton = (
    <MayEdit module="payroll"><Button icon="box-arrow-right" onClick={() => setForm({ item: null })}>{tr('Record exit')}</Button></MayEdit>
  );

  if (!rows) return <Wait error={list.error} onRetry={list.reload} />;

  return (
    <PayLayout
      trail={trailOf(company, navigate, 'Resignations')}
      sub={trf('People leaving {0}, newest first. Record the notice and reason; give the experience letter once they are relieved.', [company.name])}
      search={<SearchField bare value={view.search} onChange={view.setSearch} placeholder={tr('Search name, reason or type…')} label={tr('Search exits')} />}
      actions={addButton}
    >
      <StaleNote error={list.error} onRetry={list.reload} />
      <div className="ha-stack">
        {!hasTemplate ? (
          <Alert tone="warning" icon="info-circle">
            {trf('{0} has no experience letter yet.', [company.name])}{' '}
            <a href="#" className="fw-semibold" onClick={(e) => { e.preventDefault(); navigate('hotel.payroll.experienceLetter'); }}>{tr('Set up the letter')}</a>
          </Alert>
        ) : null}
        <HomeStats
          stats={[
            { id: 'notice', label: tr('In notice'), value: pending, format: (n) => String(Math.round(n)), note: pending ? tr('Still working their notice') : tr('Nobody serving notice') },
            { id: 'relieved', label: tr('Relieved'), value: summary.relieved, format: (n) => String(Math.round(n)), note: tr('Left the payroll') },
            { id: 'rejoined', label: tr('Rejoined'), value: summary.rejoined, format: (n) => String(Math.round(n)), note: tr('Came back after leaving') },
            { id: 'all', label: tr('All exits'), value: summary.all, format: (n) => String(Math.round(n)), note: tr('On record') },
          ]}
        />
        {summary.all > 0 ? (
          <FilterBar
            tabs={[
              { id: '', label: L.all, icon: 'collection', count: summary.all },
              ...separationStatuses.map((st) => ({ id: st, label: st, dot: STATUS_DOT[st], count: summary.byStatus[st] ?? 0 })),
            ]}
            active={paged.status}
            onTab={(id) => paged.setStatus(id as '' | SeparationStatus)}
            tabsLabel={L.resignations.tabsLabel}
            summary={
              paged.narrowed ? (
                <>
                  {L.showing} <b>{view.total}</b> {L.of} {summary.all} {summary.all === 1 ? L.resignations.noun : L.resignations.nouns}
                </>
              ) : (
                <>
                  {L.all} <b>{summary.all}</b> {summary.all === 1 ? L.resignations.noun : L.resignations.nouns}
                </>
              )
            }
          />
        ) : null}

        {summary.all === 0 ? (
          <div className="card">
            <EmptyState icon="box-arrow-right" title={tr('No exits recorded')} text={tr('When someone resigns, record it here: the notice, the reason and the signed acceptance. Their experience letter comes from here once they are relieved.')}>
              <MayEdit module="payroll"><Button icon="box-arrow-right" onClick={() => setForm({ item: null })} className="mt-3">{tr('Record the first exit')}</Button></MayEdit>
            </EmptyState>
          </div>
        ) : view.total === 0 ? (
          <div className="card"><EmptyState icon="search" title={tr('No matching records')} text={tr('Try another tab, name, reason or exit type.')} /></div>
        ) : (
          <div>
            {view.rows.map((s) => {
              const letterReady = s.status === 'Relieved' && !s.rejoinedOn && hasTemplate;
              const statusFact = s.rejoinedOn
                ? { label: tr('Status'), value: tr('Rejoined'), sub: formatMonth(s.rejoinedOn.slice(0, 7)), tone: 'ok' as const }
                : { label: tr('Status'), value: s.status, tone: s.status === 'Relieved' ? ('muted' as const) : ('warn' as const) };
              return (
                <DetailCard
                  key={s.id}
                  label={trf('Exit of {0}', [s.employeeName])}
                  warn={s.status === 'Pending'}
                  lead={{ big: formatDate(s.lastWorkingDate).slice(0, 6), tag: tr('Last day'), title: formatDate(s.lastWorkingDate) }}
                  facts={[
                    { label: tr('Staff'), value: s.employeeName, sub: [codes.get(s.employeeId), s.designation].filter(Boolean).join(' · ') },
                    { label: tr('Type'), value: s.type, sub: trf('Resigned {0}', [formatDate(s.resignationDate)]) },
                    { label: tr('Notice'), value: trf('{0} days', [days(s.resignationDate, s.lastWorkingDate)]) },
                    statusFact,
                  ]}
                  sections={[
                    {
                      icon: 'calendar-range',
                      title: tr('Exit'),
                      content: (
                        <DetailList
                          items={[
                            { label: tr('Type'), value: s.type },
                            { label: tr('Resigned on'), value: formatDate(s.resignationDate) },
                            { label: tr('Last working day'), value: formatDate(s.lastWorkingDate) },
                            { label: tr('Notice'), value: trf('{0} days', [days(s.resignationDate, s.lastWorkingDate)]) },
                            s.rejoinedOn ? { label: tr('Rejoined'), value: formatDate(s.rejoinedOn) } : null,
                          ]}
                        />
                      ),
                    },
                    {
                      icon: 'chat-left-text',
                      title: tr('Reason'),
                      content: (
                        <>
                          {s.reason ? <p className="ha-note">{s.reason}</p> : <DetailNone>{tr('No reason given')}</DetailNone>}
                          {s.documentName ? (
                            <a href="#" className="ha-link d-inline-flex align-items-center gap-1 mt-2" onClick={(e) => { e.preventDefault(); onPdf(`Acceptance document "${s.documentName}"`, { print: false })(e); }}>
                              <Bi name="paperclip" /> {tr('Signed acceptance')}
                            </a>
                          ) : null}
                        </>
                      ),
                    },
                  ]}
                  actions={
                    <>
                      {letterReady ? (
                        <a className="btn btn-sm btn-p" href={PDF_ROUTES.experienceLetter(company.id, s.id)} target="_blank" rel="noreferrer" onClick={onPdf(`Experience letter for ${s.employeeName}`)}>
                          <Bi name="file-earmark-check" className="me-1" />
                          {tr('Experience letter')}
                        </a>
                      ) : null}
                      <a className="btn btn-sm btn-outline-p" href={PDF_ROUTES.separation(company.id, s.id)} target="_blank" rel="noreferrer" onClick={onPdf(`Exit summary for ${s.employeeName}`)}>
                        <Bi name="file-earmark-pdf" className="me-1" />
                        {tr('Exit summary')}
                      </a>
                      {s.canEdit ? <MayEdit module="payroll"><Button size="sm" variant="outline" icon="pencil-square" onClick={() => setForm({ item: s })}>{tr('Edit')}</Button></MayEdit> : null}
                      {(s.canEdit && !s.rejoinedOn) || s.canDelete ? (
                        <MayEdit module="payroll">
                          <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [s.employeeName])} {...p}>{tr('More')}</Button>}>
                            {s.canEdit && !s.rejoinedOn ? <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setRejoin(s); }}><Bi name="arrow-counterclockwise" className="me-2" />{tr('Rejoin')}</a> : null}
                            {s.canDelete ? <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setDel(s); }}><Bi name="trash" className="me-2" />{tr('Delete exit record')}</a> : null}
                          </Dropdown>
                        </MayEdit>
                      ) : null}
                    </>
                  }
                />
              );
            })}
            <div className="card sh-pager-card"><Pager server view={view} /></div>
          </div>
        )}
      </div>
      {form ? (
        <SeparationFormModal
          key={form.item?.id ?? 'new'}
          companyId={company.id}
          companyName={company.name}
          item={form.item}
          active={active}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setVersion((n) => n + 1);
          }}
        />
      ) : null}
      {rejoin ? (
        <RejoinModal
          companyId={company.id}
          item={rejoin}
          onClose={() => setRejoin(null)}
          onSaved={() => {
            setRejoin(null);
            setVersion((n) => n + 1);
          }}
        />
      ) : null}
      <Dialog
        open={del !== null}
        tone="danger"
        title={tr("Delete exit record?")}
        message={del ? trf('Remove the exit record for {0}? They become active staff again.', [del.employeeName]) : undefined}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDel(null)}
      />
    </PayLayout>
  );
}

/** Deleted resignations list. Kept for the SuperAdmin Settings "Recycle bin" tab; Pallav has no bin on this page. */
export function SeparationBin({ company, navigate, onBack }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate']; onBack: () => void }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const bin = useLoaded(() => payApi.listSeparations(company.id, { deleted: true, page: 1, pageSize: 1000 }), [company.id, version], company.id);
  const rows: Separation[] | null = bin.data?.page.items ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [purging, setPurging] = useState<Separation | null>(null);

  const all = useMemo(() => rows ?? [], [rows]);
  const view = useTableView(all, { perPage: 25, match: (s, q) => `${s.employeeName} ${s.type} ${s.entryNo}`.toLowerCase().includes(q), sorters: { employee: { kind: 'text', value: (s) => s.employeeName.toLowerCase() } } });

  async function run(s: Separation, call: () => Promise<{ ok: true; data: unknown } | { ok: false; error: Parameters<typeof failText>[0] }>, done: string) {
    setBusy(s.id);
    const res = await call();
    setBusy(null);
    setPurging(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: done });
      setVersion((n) => n + 1);
    } else toast.show({ tone: 'error', text: failText(res.error) });
  }

  if (!rows) return <Wait error={bin.error} onRetry={bin.reload} tiles={false} />;

  return (
    <PayLayout
      trail={[...trailOf(company, navigate, 'Recycle bin').slice(0, 2), { label: 'Resignations', onPress: onBack }, { label: 'Recycle bin' }]}
      sub="Deleted exit records. Restore one, or delete it for ever."
      search={<SearchField bare value={view.search} onChange={view.setSearch} placeholder={tr("Search name or type…")} label={tr("Search deleted exits")} />}
    >
      <StaleNote error={bin.error} onRetry={bin.reload} />
      <div className="card">
        {rows && all.length === 0 ? (
          <EmptyState icon="trash" title={tr("The recycle bin is empty")} text="Deleted records appear here until they are restored or removed for ever." />
        ) : (
          <>
            <div className="table-responsive">
              <Table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th className="col-sno">{tr("S.No.")}</th>
                    <Th view={view} id="employee">{tr("Employee")}</Th>
                    <th>{tr("Type")}</th>
                    <th>{tr("Last working day")}</th>
                    <th className="text-end">{tr("Action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((s, i) => (
                    <tr key={s.id}>
                      <td className="sno">{view.offset + i + 1}</td>
                      <td>
                        <CellStack main={s.employeeName} sub={<>#{s.entryNo}</>} />
                      </td>
                      <td>{s.type}</td>
                      <td className="text-nowrap">{formatDate(s.lastWorkingDate)}</td>
                      <td className="text-end text-nowrap">
                        <Button variant="outline" size="sm" icon="arrow-counterclockwise" disabled={busy !== null} onClick={() => void run(s, () => payApi.restoreSeparation(company.id, s.id), `${s.entryNo} was restored.`)}>{tr("Restore")}</Button>{' '}
                        <IconButton icon="trash" label={tr("Delete for ever")} tone="danger" disabled={busy !== null} onClick={() => setPurging(s)} />
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
        title={purging ? `Delete ${purging.entryNo} for ever?` : ''}
        message="This removes the record and cannot be undone."
        confirmLabel="Delete for ever"
        busy={busy !== null}
        onConfirm={() => purging && void run(purging, () => payApi.purgeSeparation(company.id, purging.id), `${purging.entryNo} was deleted for ever.`)}
        onCancel={() => setPurging(null)}
      />
    </PayLayout>
  );
}
