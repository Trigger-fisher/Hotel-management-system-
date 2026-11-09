'use client';

// Payroll log (hotel.payroll.log, admin only): everything done in payroll by day, one card per entry; the company is one of the filters.
import { useEffect, useMemo, useState } from 'react';
import { formatDateTime, formatTime } from '@shared/dashboards/format';
import { SYSTEM_PDF_ROUTES } from '@shared/dashboards/adminSystem';
import { logActionLabel, logViews, type LogAction, type LogResult, type LogStatus, type LogView, type MasterScope, type PayrollCompanyRef, type PayrollLogEntry } from '@shared/dashboards/payrollPay';
import { Bi, DateRangeField, DetailCard, DetailList, DetailNone, FilterBar, FilterMenu, Pager, SearchField, openPdf, useTableView, Button } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { useToast } from '@/components/ui';
import { buildQuery } from '@/lib/api/client';
import type { ScreenProps } from '../../types';
import { EmptyState, PayLayout } from '../payrollCore/pms';
import { payApi, payToday } from './api';
import { PayPage } from './shared';
import { StaleNote, Wait, count, istDay, longDay, useLoaded } from '../payrollCore/load';

import { tr, trf } from '@/lib/i18n/language';
/** Today: the mock's fixed date in mock mode, the hotel's IST date against the real server. */
const TODAY = payToday();

const VIEW_ICON: Record<string, string> = { today: 'brightness-high', week: 'calendar-week', emails: 'envelope', money: 'cash-stack', deletions: 'trash', problems: 'exclamation-triangle' };

/** hotel.payroll.log */
export function PayrollLog({ user, navigate }: ScreenProps) {
  return (
    <PayPage role={user.role} navigate={navigate} adminOnly>
      {(company) => <Body company={company} navigate={navigate} />}
    </PayPage>
  );
}

function dayTitle(date: string): string {
  if (date === TODAY) return 'Today';
  const y = new Date(`${TODAY}T00:00:00`);
  y.setDate(y.getDate() - 1);
  if (date === y.toISOString().slice(0, 10)) return 'Yesterday';
  return longDay(date);
}

function Body({ company, navigate }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate'] }) {
  const [companies, setCompanies] = useState<PayrollCompanyRef[]>([]);
  const [scope, setScope] = useState<MasterScope>(company.id);
  const [view, setView] = useState<LogView | ''>('');
  const [action, setAction] = useState<LogAction | ''>('');
  const [entity, setEntity] = useState('');
  const [status, setStatus] = useState<LogStatus | ''>('');
  const [who, setWho] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [typed, setTyped] = useState('');
  const list = useLoaded(() => payApi.listLog(scope, { view, action, entity, status, user: who, from: from || undefined, to: to || undefined, search: typed, page: 1, pageSize: 1000 }), [scope, view, action, entity, status, who, from, to, typed]);
  const data: LogResult | null = list.data;
  const toast = useToast();
  // The PDF is the page without paging: the same filters go to GET /payroll/log/pdf (real mode); the mock says what it would make and prints.
  const pdfHref = `${SYSTEM_PDF_ROUTES.payrollLog()}${buildQuery({ scope, search: typed.trim() || undefined, view: view || undefined, action: action || undefined, entity: entity || undefined, status: status || undefined, user: who || undefined, from: from || undefined, to: to || undefined })}`;
  const scopeName = scope === 'all' ? 'All companies' : (companies.find((c) => c.id === scope)?.name ?? company.name);

  useEffect(() => {
    let live = true;
    void payApi.listCompanies().then((res) => live && res.ok && setCompanies(res.data));
    return () => {
      live = false;
    };
  }, []);

  const items = useMemo(() => data?.page.items ?? [], [data]);
  const tv = useTableView(items, { perPage: 25 });
  const days = useMemo(() => {
    const out: [string, PayrollLogEntry[]][] = [];
    for (const e of tv.rows) {
      const d = istDay(e.at);
      const last = out[out.length - 1];
      if (last && last[0] === d) last[1].push(e);
      else out.push([d, [e]]);
    }
    return out;
  }, [tv.rows]);

  const hasFilters = Boolean(view || action || entity || status || who || from || to || typed);
  const reset = () => {
    setView('');
    setAction('');
    setEntity('');
    setStatus('');
    setWho('');
    setFrom('');
    setTo('');
    setTyped('');
    setScope(company.id);
  };
  const stats = data?.stats ?? { total: 0, today: 0, emails: 0, failed: 0 };
  const total = data?.page.total ?? 0;
  if (!data) return <Wait error={list.error} onRetry={list.reload} />;

  const exportPdf = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    void openPdf(pdfHref, (text) => toast.show({ tone: 'error', text }), (text) => toast.show({ tone: 'info', text: trf('Payroll log ({0}, {1} {2}): {3}', [scopeName, count(total), total === 1 ? 'entry' : 'entries', text]) }));
  };

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Payroll log' }]}
      sub={scope !== 'all' ? trf('Everything done in {0}, newest first.', [scopeName]) : tr('Everything done across the companies, newest first.')}
      search={<SearchField bare clear value={typed} onChange={setTyped} placeholder={tr('Search the log…')} label={tr('Search the log')} />}
      actions={total > 0 ? <a className="btn btn-outline-p" target="_blank" rel="noreferrer" href={pdfHref} onClick={exportPdf}><Bi name="file-earmark-pdf" className="me-1" />{tr('Export PDF')}</a> : null}
    >
      <StaleNote error={list.error} onRetry={list.reload} />
      <div className="ha-stack">
        <HomeStats
          stats={[
            { id: 'total', label: tr('Entries'), value: stats.total, format: (n) => count(Math.round(n)), note: scopeName },
            { id: 'today', label: tr('Today'), value: stats.today, format: (n) => count(Math.round(n)), note: tr('Since midnight') },
            { id: 'emails', label: tr('Emails sent'), value: stats.emails, format: (n) => count(Math.round(n)), note: tr('Letters and shared details') },
            { id: 'failed', label: tr('Problems'), value: stats.failed, format: (n) => count(Math.round(n)), note: stats.failed ? tr('Errors and emails that did not go') : tr('Nothing has failed') },
          ]}
        />

        <FilterBar
          tabs={[{ id: '', label: 'Everything', icon: 'collection' }, ...logViews.map((v) => ({ id: v.id, label: v.label, icon: VIEW_ICON[v.id], danger: v.id === 'problems' }))]}
          active={view}
          onTab={(id) => setView(id as LogView | '')}
          tabsLabel="Views"
          summary={
            <>
              {hasFilters ? tr('Showing ') : tr('All ')}
              <b>{count(total)}</b> {total === 1 ? tr('entry') : tr('entries')}
            </>
          }
          onReset={hasFilters || scope !== company.id ? reset : undefined}
        >
          <FilterMenu label={tr('Company')} icon="building" any="All companies" ariaLabel="Which company" value={scope === 'all' ? '' : scope} onChange={(v) => setScope(v || 'all')} options={companies.map((c) => ({ value: c.id, label: c.name }))} />
          <FilterMenu label={tr('Action')} icon="lightning" any="Any action" ariaLabel="What happened" value={action} onChange={(v) => setAction(v as LogAction | '')} options={(Object.keys(logActionLabel) as LogAction[]).map((a) => ({ value: a, label: logActionLabel[a] }))} />
          <FilterMenu label={tr('Record type')} icon="file-earmark" any="Any type" ariaLabel="What kind of record" value={entity} onChange={setEntity} options={(data?.entities ?? []).map((e) => ({ value: e, label: e }))} />
          <FilterMenu label={tr('Person')} icon="person" any="Anyone" ariaLabel="Who did it" value={who} onChange={setWho} options={(data?.people ?? []).map((e) => ({ value: e, label: e }))} />
          <FilterMenu label={tr('Result')} icon="check2-circle" any="Any result" ariaLabel="Did it work" value={status} onChange={(v) => setStatus(v as LogStatus | '')} options={[{ value: 'success', label: 'Worked' }, { value: 'failed', label: 'Did not work' }]} />
          <div className="bm-fbar-dates">
            <DateRangeField from={from} to={to} today={TODAY} onChange={(a, b) => { setFrom(a); setTo(b); }} />
          </div>
        </FilterBar>

        {items.length === 0 ? (
          <div className="card">
            <EmptyState icon="journal-text" title={hasFilters ? tr('Nothing matches') : tr('Nothing logged yet')} text={hasFilters ? tr('Try a wider date range, or clear the filters.') : tr('Payroll changes and emails appear here as they happen.')}>
              {hasFilters ? <Button variant="outline" onClick={reset} className="mt-3">{tr('Clear filters')}</Button> : null}
            </EmptyState>
          </div>
        ) : null}

        {days.map(([date, entries]) => (
          <section key={date} className="ha-day" aria-label={dayTitle(date)}>
            <div className="ha-day-head">
              <h3>{dayTitle(date)}</h3>
              <span>{entries.length} {entries.length === 1 ? tr('entry') : tr('entries')}</span>
            </div>
            {entries.map((l) => {
              const failed = l.status === 'failed';
              const by = l.userName || tr('System');
              return (
                <DetailCard
                  key={l.id}
                  label={trf('Log entry {0}', [l.id])}
                  warn={failed}
                  lead={{ big: formatTime(l.at), tag: logActionLabel[l.action] ?? l.action, title: formatDateTime(l.at) }}
                  facts={[
                    { label: tr('By'), value: by },
                    scope === 'all' ? { label: tr('Company'), value: l.companyName } : { label: tr('Record type'), value: l.entity },
                    { label: tr('What happened'), value: l.summary, text: true, wide: true },
                  ]}
                  amount={{ label: tr('Result'), value: failed ? tr('Did not work') : tr('Worked'), tone: failed ? 'danger' : 'ok' }}
                  sections={[
                    {
                      icon: 'info-circle',
                      title: tr('Entry'),
                      content: (
                        <DetailList
                          items={[
                            { label: tr('Entry'), value: `#${l.id}` },
                            { label: tr('When'), value: formatDateTime(l.at) },
                            { label: tr('By'), value: by },
                            l.companyName ? { label: tr('Company'), value: l.companyName } : false,
                            { label: tr('Record type'), value: l.entity },
                            l.subject ? { label: tr('Record'), value: l.subject } : false,
                          ]}
                        />
                      ),
                    },
                    {
                      icon: l.action === 'updated' ? 'arrow-left-right' : 'list-ul',
                      title: l.action === 'updated' ? tr('What changed') : tr('Details'),
                      tone: failed ? 'danger' : undefined,
                      content: (
                        <>
                          <p className="ha-note">{l.summary}</p>
                          {l.details ? <p className="ha-note ha-note-sub">{l.details}</p> : <DetailNone>{tr('No further detail was recorded for this entry.')}</DetailNone>}
                        </>
                      ),
                    },
                  ]}
                  actions={
                    <>
                      {l.userName && who !== l.userName ? <Button variant="outline" size="sm" icon="person" onClick={() => setWho(l.userName)}>{tr('Only this person')}</Button> : null}
                      {l.entity && entity !== l.entity ? <Button variant="outline" size="sm" icon="funnel" onClick={() => setEntity(l.entity)}>{trf('Only {0}', [l.entity])}</Button> : null}
                    </>
                  }
                />
              );
            })}
          </section>
        ))}

        {items.length > 0 ? (
          <div className="card sh-pager-card">
            <Pager view={tv} server />
          </div>
        ) : null}
      </div>
    </PayLayout>
  );
}
