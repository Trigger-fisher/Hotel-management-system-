'use client';

// Staff advances (hotel.payroll.advances): one card per advance, what is still to recover at the right; the form is AdvanceForm.tsx.
import { useEffect, useState } from 'react';
import { formatDate, formatINR } from '@shared/dashboards/format';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { type Employee } from '@shared/dashboards/payrollCore';
import { payrollPayCopy, type Advance, type AdvanceSort, type AdvanceStatus, type AdvanceSummary, type PayrollCompanyRef } from '@shared/dashboards/payrollPay';
import { Bi, Dialog, DetailCard, DetailList, DetailNone, Dropdown, FilterBar, Pager, SearchField, Button, MayEdit } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { payrollApi } from '../payrollCore/api';
import { EmptyState, PayLayout } from '../payrollCore/pms';
import { AdvanceFormModal } from './AdvanceForm';
import { payApi } from './api';
import { PayPage, failText } from './shared';
import { StaleNote, Wait, istClock, useLoaded, useMockPdf } from '../payrollCore/load';
import { useServerList } from './serverList';

import { tr, trf } from '@/lib/i18n/language';
const L = payrollPayCopy.lists;
const NUMERIC: AdvanceSort[] = ['date', 'entryNo', 'amount', 'outstanding'];

/** hotel.payroll.advances */
export function Advances({ user, navigate }: ScreenProps) {
  return <PayPage role={user.role} navigate={navigate}>{(company) => <Body company={company} navigate={navigate} />}</PayPage>;
}

function Body({ company, navigate }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const [active, setActive] = useState<Employee[]>([]);
  const [version, setVersion] = useState(0);
  // One page at a time: status, search and order go to the server; the tiles and tab counts are the server's figures for every advance.
  const paged = useServerList<AdvanceStatus, AdvanceSort>(NUMERIC, 'date');
  const list = useLoaded(() => payApi.listAdvances(company.id, paged.query), [company.id, version, ...paged.deps]);
  const rows: Advance[] | null = list.data?.page.items ?? null;
  const summary: AdvanceSummary = list.data?.summary ?? { issuedPaise: 0, recoveredPaise: 0, outstandingPaise: 0, open: 0 };
  const counts = list.data?.counts ?? { all: 0, open: 0, settled: 0 };
  const view = paged.viewOf<Advance>(rows ?? [], list.data?.page.total ?? 0);
  const [form, setForm] = useState<{ advance: Advance | null } | null>(null);
  const [del, setDel] = useState<Advance | null>(null);
  const [busy, setBusy] = useState(false);
  const onPdf = useMockPdf();

  useEffect(() => {
    let live = true;
    void payrollApi.listEmployees(company.id, { tab: 'active', pageSize: 1000 }).then((res) => live && res.ok && setActive(res.data.items));
    return () => {
      live = false;
    };
  }, [company.id, version]);

  async function remove() {
    if (!del) return;
    setBusy(true);
    const res = await payApi.deleteAdvance(company.id, del.id);
    setBusy(false);
    setDel(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: 'Advance deleted.' });
      setVersion((n) => n + 1);
    } else toast.show({ tone: 'error', text: failText(res.error) });
  }

  const addButton = (
    <MayEdit module="payroll"><Button icon="plus-lg" onClick={() => setForm({ advance: null })}>{tr("Add advance")}</Button></MayEdit>
  );

  if (!rows) return <Wait error={list.error} onRetry={list.reload} />;

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Staff advances' }]}
      sub={tr('Money paid ahead of salary. Salary takes it back by itself, and anything still outstanding carries into the next month.')}
      search={<SearchField bare value={view.search} onChange={view.setSearch} placeholder={tr('Search staff or instruction…')} label={tr("Search advances")} />}
      actions={addButton}
    >
      <StaleNote error={list.error} onRetry={list.reload} />
      <div className="ha-stack">
        <HomeStats
          stats={[
            { id: 'issued', label: tr('Total issued'), value: summary.issuedPaise, format: (n) => formatINR(Math.round(n)), note: trf('{0} on record', [counts.all]) },
            { id: 'recovered', label: tr('Recovered'), value: summary.recoveredPaise, format: (n) => formatINR(Math.round(n)), note: tr('Taken back through salary') },
            { id: 'outstanding', label: tr('Outstanding'), value: summary.outstandingPaise, format: (n) => formatINR(Math.round(n)), note: tr('Still to recover') },
            { id: 'open', label: tr('Open advances'), value: summary.open, format: (n) => String(Math.round(n)), note: tr('Not fully recovered') },
          ]}
        />

        {counts.all > 0 ? (
          <FilterBar
            tabs={[
              { id: '', label: L.all, icon: 'collection', count: counts.all },
              { id: 'open', label: L.advances.open, dot: 'due', count: counts.open },
              { id: 'settled', label: L.advances.settled, dot: 'settled', count: counts.settled },
            ]}
            active={paged.status}
            onTab={(id) => paged.setStatus(id as '' | AdvanceStatus)}
            tabsLabel={L.advances.tabsLabel}
            summary={
              paged.narrowed ? (
                <>
                  {L.showing} <b>{view.total}</b> {L.of} {counts.all} {counts.all === 1 ? L.advances.noun : L.advances.nouns}
                </>
              ) : (
                <>
                  {L.all} <b>{counts.all}</b> {counts.all === 1 ? L.advances.noun : L.advances.nouns}
                </>
              )
            }
          />
        ) : null}

        {counts.all === 0 ? (
          <div className="card">
            <EmptyState icon="wallet2" title={tr('No advances recorded')} text={tr('Record an advance here and salary will take it back by itself, carrying any balance into the next month.')}>
              <MayEdit module="payroll"><Button icon="plus-lg" onClick={() => setForm({ advance: null })} className="mt-3">{tr('Record the first advance')}</Button></MayEdit>
            </EmptyState>
          </div>
        ) : view.total === 0 ? (
          <div className="card"><EmptyState icon="search" title={tr('No matching advances')} text={tr('Try another status or a different name or remark.')} /></div>
        ) : (
          <div>
            {view.rows.map((a) => {
              const who = a.employeeName || tr('Removed staff member');
              const editable = !a.isCarryForward && !a.locked;
              const recovery = a.recoveryType === 'Monthly' ? trf('{0} a month', [formatINR(a.instalmentPaise)]) : a.recoveryType;
              return (
                <DetailCard
                  key={a.id}
                  label={trf('Advance to {0}', [who])}
                  lead={{ big: formatDate(a.date).slice(0, 6), tag: istClock(a.date), title: formatDate(a.date) }}
                  facts={[
                    { label: tr('Staff'), value: who, sub: a.employeeCode },
                    { label: tr('Advance'), value: formatINR(a.amountPaise), sub: recovery },
                    { label: tr('Recovered'), value: formatINR(a.recoveredPaise) },
                    { label: tr('Instruction'), value: a.remarks, text: true, sub: a.isCarryForward ? tr('Carried forward') : undefined },
                  ]}
                  amount={a.outstandingPaise > 0 ? { label: tr('Outstanding'), value: formatINR(a.outstandingPaise), tone: 'warn' } : { label: tr('Outstanding'), value: tr('Settled'), tone: 'ok' }}
                  sections={[
                    {
                      icon: 'wallet2',
                      title: tr('Advance'),
                      content: (
                        <DetailList
                          items={[
                            { label: tr('Paid on'), value: `${formatDate(a.date)}, ${istClock(a.date)}` },
                            { label: tr('Amount'), value: formatINR(a.amountPaise) },
                            { label: tr('Taken back'), value: recovery },
                            { label: tr('Recovered'), value: formatINR(a.recoveredPaise) },
                            { label: tr('Outstanding'), value: formatINR(a.outstandingPaise), total: true },
                          ]}
                        />
                      ),
                    },
                    { icon: 'chat-left-text', title: tr('Instruction'), content: a.remarks ? <p className="ha-note">{a.remarks}</p> : <DetailNone>{tr('No instruction')}</DetailNone> },
                  ]}
                  meta={a.isCarryForward ? tr('Carried forward from last month: it changes only through salary.') : a.locked ? tr('Locked: part of a salary already worked out.') : undefined}
                  actions={
                    <>
                      <a className="btn btn-sm btn-outline-p" href={PDF_ROUTES.payrollAdvance(company.id, a.id)} target="_blank" rel="noreferrer" onClick={onPdf(`Advance receipt for ${who}`)}>
                        <Bi name="file-earmark-pdf" className="me-1" />
                        {tr('Receipt')}
                      </a>
                      {editable && a.canEdit ? (
                        <MayEdit module="payroll"><Button size="sm" variant="outline" icon="pencil-square" onClick={() => setForm({ advance: a })}>{tr('Edit')}</Button></MayEdit>
                      ) : null}
                      {editable && a.canDelete ? (
                        <MayEdit module="payroll">
                          <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" {...p}>{tr('More')}</Button>}>
                            <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setDel(a); }}><Bi name="trash" className="me-2" />{tr('Delete advance')}</a>
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
        <AdvanceFormModal
          key={form.advance?.id ?? 'new'}
          companyId={company.id}
          companyName={company.name}
          advance={form.advance}
          active={active}
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
        title={tr("Delete advance?")}
        message={del ? `Delete the ${formatINR(del.amountPaise)} advance for ${del.employeeName}?` : undefined}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDel(null)}
      />
    </PayLayout>
  );
}
