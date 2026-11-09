'use client';

// Recycle bin for advances and bonus entries (admins with the recycle-bin ability): Restore, or Delete for ever inside More.
import { useMemo, useState } from 'react';
import { formatDate, formatINR } from '@shared/dashboards/format';
import { type Advance, type BonusEntry, type PayrollCompanyRef } from '@shared/dashboards/payrollPay';
import type { DashResult, Page } from '@shared/dashboards/common';
import { Bi, DetailCard, Dialog, Dropdown, Pager, SearchField, useTableView, Button } from '@/dashboards/pallav/ui';
import { useToast } from '@/components/ui';
import { EmptyState, PayLayout } from '../payrollCore/pms';
import { failText } from './shared';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';

import { tr, trf } from '@/lib/i18n/language';
type Entry = Advance | BonusEntry;

export function PayBin<T extends Entry>({ company, title, listTitle, navigate, load, restore, purge, onBack }: {
  company: PayrollCompanyRef;
  /** The page's own title ("Advance Management"), for the breadcrumb. */
  title: string;
  listTitle?: string;
  navigate: (viewId: string) => void;
  load: (q: { deleted: true; page: number; pageSize: number }) => Promise<DashResult<{ page: Page<T> }>>;
  restore: (id: string) => Promise<DashResult<unknown>>;
  purge: (id: string) => Promise<DashResult<unknown>>;
  onBack: () => void;
}) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const bin = useLoaded(() => load({ deleted: true, page: 1, pageSize: 1000 }), [company.id, version], company.id);
  const rows: T[] | null = bin.data?.page.items ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [purging, setPurging] = useState<T | null>(null);

  const all = useMemo(() => rows ?? [], [rows]);
  const view = useTableView(all, { perPage: 25, match: (e, q) => `${e.employeeName} ${e.employeeCode} ${e.entryNo}`.toLowerCase().includes(q), sorters: { employee: { kind: 'text', value: (e) => e.employeeName.toLowerCase() } } });

  async function run(e: T, call: () => Promise<DashResult<unknown>>, done: string) {
    setBusy(e.id);
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
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: title, onPress: onBack }, { label: 'Recycle bin' }]}
      sub={listTitle ?? tr('Deleted entries. Restore one, or delete it for ever.')}
      search={<SearchField bare value={view.search} onChange={view.setSearch} placeholder={tr('Search staff or entry number…')} label={tr("Search deleted entries")} />}
    >
      <StaleNote error={bin.error} onRetry={bin.reload} />
      {all.length === 0 ? (
        <div className="card">
          <EmptyState icon="trash" title={tr('The recycle bin is empty')} text={tr('Deleted entries wait here until they are restored or deleted for ever.')}>
            <Button variant="outline" icon="arrow-left" onClick={onBack} className="mt-3">{trf('Back to {0}', [title])}</Button>
          </EmptyState>
        </div>
      ) : view.total === 0 ? (
        <div className="card"><EmptyState icon="search" title={tr('No matching entries')} text={tr('Try another name or entry number.')} /></div>
      ) : (
        <div>
          {view.rows.map((e) => (
            <DetailCard
              key={e.id}
              label={trf('Deleted entry {0}', [e.entryNo])}
              lead={{ big: formatDate(e.date).slice(0, 6), tag: `#${e.entryNo}`, title: formatDate(e.date) }}
              facts={[
                { label: tr('Staff'), value: e.employeeName, sub: e.employeeCode },
                { label: tr('Date'), value: formatDate(e.date) },
              ]}
              amount={{ label: tr('Amount'), value: formatINR(e.amountPaise) }}
              actions={
                <>
                  <Button size="sm" icon="arrow-counterclockwise" disabled={busy !== null} onClick={() => void run(e, () => restore(e.id), trf('#{0} restored.', [e.entryNo]))}>{tr('Restore')}</Button>
                  <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" disabled={busy !== null} {...p}>{tr('More')}</Button>}>
                    <a href="#" className="dropdown-item text-danger" onClick={(ev) => { ev.preventDefault(); setPurging(e); }}><Bi name="trash" className="me-2" />{tr('Delete for ever')}</a>
                  </Dropdown>
                </>
              }
            />
          ))}
          <div className="card sh-pager-card"><Pager view={view} /></div>
        </div>
      )}      <Dialog
        open={purging !== null}
        tone="danger"
        title={purging ? `Delete #${purging.entryNo} for ever?` : ''}
        message="This removes the record and cannot be undone."
        confirmLabel="Delete for ever"
        busy={busy !== null}
        onConfirm={() => purging && void run(purging, () => purge(purging.id), `#${purging.entryNo} was deleted for ever.`)}
        onCancel={() => setPurging(null)}
      />
    </PayLayout>
  );
}
