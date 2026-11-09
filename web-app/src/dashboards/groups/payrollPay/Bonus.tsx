'use client';

// Bonus and incentives (hotel.payroll.bonus): one card per entry, the amount at the right; the form is BonusForm.tsx.
import { useEffect, useState } from 'react';
import { formatDate, formatINR } from '@shared/dashboards/format';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { type Employee } from '@shared/dashboards/payrollCore';
import { bonusTypes, payrollPayCopy, type BonusEntry, type BonusSort, type BonusSummary, type BonusType, type PayrollCompanyRef } from '@shared/dashboards/payrollPay';
import { Bi, DetailCard, DetailList, DetailNone, Dropdown, FilterBar, Pager, SearchField, Button, MayEdit } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { payrollApi } from '../payrollCore/api';
import { EmptyState, PayLayout } from '../payrollCore/pms';
import { payApi } from './api';
import { BonusFormModal } from './BonusForm';
import { PayPage, failText } from './shared';
import { StaleNote, Wait, useLoaded, useMockPdf } from '../payrollCore/load';
import { useServerList } from './serverList';

import { tr, trf } from '@/lib/i18n/language';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const L = payrollPayCopy.lists;
const NUMERIC: BonusSort[] = ['date', 'entryNo', 'amount'];
const TYPE_ICON: Record<BonusType, string> = { Bonus: 'gift', Incentive: 'graph-up-arrow' };
const salaryMonth = (date: string) => trf('{0} salary', [`${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`]);

/** hotel.payroll.bonus */
export function Bonus({ user, navigate }: ScreenProps) {
  return <PayPage role={user.role} navigate={navigate}>{(company) => <Body company={company} navigate={navigate} />}</PayPage>;
}

function Body({ company, navigate }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const [active, setActive] = useState<Employee[]>([]);
  const [version, setVersion] = useState(0);
  const paged = useServerList<BonusType, BonusSort>(NUMERIC, 'date');
  const list = useLoaded(() => payApi.listBonus(company.id, paged.query), [company.id, version, ...paged.deps]);
  const rows: BonusEntry[] | null = list.data?.page.items ?? null;
  const summary: BonusSummary = list.data?.summary ?? { bonusPaise: 0, incentivePaise: 0, people: 0 };
  const counts = list.data?.counts ?? { all: 0, Bonus: 0, Incentive: 0 };
  const view = paged.viewOf<BonusEntry>(rows ?? [], list.data?.page.total ?? 0);
  const [form, setForm] = useState<{ entry: BonusEntry | null } | null>(null);
  const onPdf = useMockPdf();

  useEffect(() => {
    let live = true;
    void payrollApi.listEmployees(company.id, { tab: 'active', pageSize: 1000 }).then((res) => live && res.ok && setActive(res.data.items));
    return () => {
      live = false;
    };
  }, [company.id, version]);

  async function remove(b: BonusEntry) {
    const res = await payApi.deleteBonus(company.id, b.id);
    if (!res.ok) {
      toast.show({ tone: 'error', text: failText(res.error) });
      return;
    }
    setVersion((n) => n + 1);
    toast.show({
      tone: 'success',
      text: trf('{0} for {1} deleted.', [b.type, b.employeeName || tr('a removed staff member')]),
      action: {
        label: 'Undo',
        onClick: () =>
          void payApi.restoreBonus(company.id, b.id).then((r) => {
            if (r.ok) setVersion((n) => n + 1);
            else toast.show({ tone: 'error', text: failText(r.error) });
          }),
      },
    });
  }

  const addButton = (
    <MayEdit module="payroll"><Button icon="plus-lg" onClick={() => setForm({ entry: null })}>{tr('Add bonus or incentive')}</Button></MayEdit>
  );

  if (!rows) return <Wait error={list.error} onRetry={list.reload} />;

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Bonus and incentives' }]}
      sub={tr('Paid on top of salary. Each entry joins the salary of the month its date falls in, as its own line on the slip.')}
      search={<SearchField bare value={view.search} onChange={view.setSearch} placeholder={tr('Search staff, type or instruction…')} label={tr('Search entries')} />}
      actions={addButton}
    >
      <StaleNote error={list.error} onRetry={list.reload} />
      <div className="ha-stack">
        <HomeStats
          stats={[
            { id: 'bonus', label: tr('Bonus'), value: summary.bonusPaise, format: (n) => formatINR(Math.round(n)), note: trf('{0} entries', [counts.Bonus]) },
            { id: 'incentive', label: tr('Incentive'), value: summary.incentivePaise, format: (n) => formatINR(Math.round(n)), note: trf('{0} entries', [counts.Incentive]) },
            { id: 'total', label: tr('Above salary'), value: summary.bonusPaise + summary.incentivePaise, format: (n) => formatINR(Math.round(n)), note: tr('Bonus and incentive together') },
            { id: 'people', label: tr('Staff'), value: summary.people, format: (n) => String(Math.round(n)), note: tr('Have received one') },
          ]}
        />

        {counts.all > 0 ? (
          <FilterBar
            tabs={[{ id: '', label: L.all, icon: 'collection', count: counts.all }, ...bonusTypes.map((t) => ({ id: t, label: t, icon: TYPE_ICON[t], count: counts[t] }))]}
            active={paged.status}
            onTab={(id) => paged.setStatus(id as '' | BonusType)}
            tabsLabel={L.bonus.tabsLabel}
            summary={
              paged.narrowed ? (
                <>
                  {L.showing} <b>{view.total}</b> {L.of} {counts.all} {counts.all === 1 ? L.bonus.noun : L.bonus.nouns}
                </>
              ) : (
                <>
                  {L.all} <b>{counts.all}</b> {counts.all === 1 ? L.bonus.noun : L.bonus.nouns}
                </>
              )
            }
          />
        ) : null}

        {counts.all === 0 ? (
          <div className="card">
            <EmptyState icon="gift" title={tr('No bonus or incentive yet')} text={tr('Add one here and it joins that month\'s salary by itself.')}>
              <MayEdit module="payroll"><Button icon="plus-lg" onClick={() => setForm({ entry: null })} className="mt-3">{tr('Add the first entry')}</Button></MayEdit>
            </EmptyState>
          </div>
        ) : view.total === 0 ? (
          <div className="card"><EmptyState icon="search" title={tr('No matching entries')} text={tr('Try another type or a different name or instruction.')} /></div>
        ) : (
          <div>
            {view.rows.map((b) => {
              const who = b.employeeName || tr('Removed staff member');
              return (
                <DetailCard
                  key={b.id}
                  label={trf('{0} for {1}', [b.type, who])}
                  lead={{ big: formatDate(b.date).slice(0, 6), tag: b.type, title: formatDate(b.date) }}
                  facts={[
                    { label: tr('Staff'), value: who, sub: b.employeeCode },
                    { label: tr('Paid with'), value: salaryMonth(b.date) },
                    { label: tr('Instruction'), value: b.remarks, text: true, wide: true },
                  ]}
                  amount={{ label: b.type, value: formatINR(b.amountPaise), tone: 'ok' }}
                  sections={[
                    {
                      icon: TYPE_ICON[b.type],
                      title: b.type,
                      content: (
                        <DetailList
                          items={[
                            { label: tr('Date'), value: formatDate(b.date) },
                            { label: tr('Paid with'), value: salaryMonth(b.date) },
                            { label: tr('Entry'), value: `#${b.entryNo}` },
                            { label: tr('Amount'), value: formatINR(b.amountPaise), total: true },
                          ]}
                        />
                      ),
                    },
                    { icon: 'chat-left-text', title: tr('Instruction'), content: b.remarks ? <p className="ha-note">{b.remarks}</p> : <DetailNone>{tr('No instruction')}</DetailNone> },
                  ]}
                  meta={b.locked ? tr('Locked: part of a salary already worked out.') : undefined}
                  actions={
                    <>
                      <a className="btn btn-sm btn-outline-p" href={PDF_ROUTES.payrollBonus(company.id, b.id)} target="_blank" rel="noreferrer" onClick={onPdf(`${b.type} voucher for ${who}`)}>
                        <Bi name="file-earmark-pdf" className="me-1" />
                        {tr('Voucher')}
                      </a>
                      {!b.locked && b.canEdit ? (
                        <MayEdit module="payroll"><Button size="sm" variant="outline" icon="pencil-square" onClick={() => setForm({ entry: b })}>{tr('Edit')}</Button></MayEdit>
                      ) : null}
                      {!b.locked && b.canDelete ? (
                        <MayEdit module="payroll">
                          <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" {...p}>{tr('More')}</Button>}>
                            <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); void remove(b); }}><Bi name="trash" className="me-2" />{trf('Delete {0}', [b.type.toLowerCase()])}</a>
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
        <BonusFormModal
          key={form.entry?.id ?? 'new'}
          companyId={company.id}
          companyName={company.name}
          entry={form.entry}
          active={active}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setVersion((n) => n + 1);
          }}
        />
      ) : null}
    </PayLayout>
  );
}
