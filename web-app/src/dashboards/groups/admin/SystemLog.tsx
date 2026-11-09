'use client';

// System log and Force log (hotel.admin.log, hotel.admin.forceLog): read-only, a timeline a day at a time, filters by person, kind, area and date.
// The filters, search and page go to the server; the figures and the Area and Person choices come with the answer.
import { useMemo, useState } from 'react';
import { formatCount, formatDate, formatTime, formatTimeSeconds, formatWeekdayDate } from '@shared/dashboards/format';
import type { DashResult } from '@shared/dashboards/common';
import {
  SYSTEM_PAGE_SIZES, SYSTEM_PDF_ROUTES, entryNo, forceActions, forceLogViews, logActions, logModules, moduleOptions, pdfHref, systemLogViews,
  type ForceLogPage, type ForceLogRow, type SystemLogPage, type SystemLogRow,
} from '@shared/dashboards/adminSystem';
import { Bi, Button, DateRangeField, DetailList, EmptyState, FilterBar, FilterBarExtra, FilterMenu, Pager, SearchField, openPdf, pagerView, type TableView } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { useDebounced, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { StaleNote, Wait, istDay, useLoaded } from '../payrollCore/load';
import { systemApi, systemToday } from './systemApi';

import { tr, trf } from '@/lib/i18n/language';

function dayTitle(date: string, today: string): string {
  if (date === today) return 'Today';
  const y = new Date(`${today}T00:00:00`);
  y.setDate(y.getDate() - 1);
  const iso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  if (date === iso) return 'Yesterday';
  return formatWeekdayDate(date, { long: true });
}

/** "04 Oct 2026, 05:30:09 pm" in IST, to the second. */
const exact = (at: string) => `${formatDate(at)}, ${formatTimeSeconds(at)}`;

/** hotel.admin.log: the System Log (SuperAdmin only in Pallav). */
export const SystemLog = ({ navigate }: ScreenProps) => <Diary kind="system" navigate={navigate} />;

/** hotel.admin.forceLog: the Force Log. */
export const ForceLog = ({ navigate }: ScreenProps) => <Diary kind="force" navigate={navigate} />;

type Row = SystemLogRow | ForceLogRow;
type LogPage = SystemLogPage | ForceLogPage;

function Diary({ kind, navigate }: { kind: 'system' | 'force'; navigate: ScreenProps['navigate'] }) {
  const force = kind === 'force';
  const toast = useToast();
  const today = systemToday();
  const [view, setView] = useState('');
  const [action, setAction] = useState('');
  const [module, setModule] = useState('');
  const [who, setWho] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /** A filter change starts again at page 1. */
  const pick = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };
  const filters = { search, view, module, action, user: who, from, to };
  const loaded = useLoaded<LogPage>(
    (): Promise<DashResult<LogPage>> =>
      force ? systemApi.listForceLog({ ...filters, page, pageSize }) : systemApi.listSystemLog({ ...filters, status: status === 'success' || status === 'failed' ? status : '', page, pageSize }),
    [force, search, view, action, module, who, status, from, to, page, pageSize],
    kind,
  );
  const data = loaded.data;
  const items: Row[] = useMemo(() => data?.items ?? [], [data]);
  const days = useMemo(() => {
    const out: [string, Row[]][] = [];
    for (const e of items) {
      const day = istDay(e.at);
      const last = out[out.length - 1];
      if (last && last[0] === day) last[1].push(e);
      else out.push([day, [e]]);
    }
    return out;
  }, [items]);

  if (!data) return <Wait error={loaded.error} onRetry={loaded.reload} />;

  const views = force ? forceLogViews : systemLogViews;
  const actions = force ? forceActions : logActions;
  const modules = moduleOptions(data.modules);
  const people = data.people;
  const total = data.total;
  const tv: TableView<Row> = {
    ...pagerView<Row>(data, { setPage }),
    setPerPage: (n: number) => {
      setPageSize(n);
      setPage(1);
    },
  };

  const hasFilters = Boolean(view || action || module || who || status || from || to || typed.trim());
  const reset = () => {
    setView('');
    setAction('');
    setModule('');
    setWho('');
    setStatus('');
    setFrom('');
    setTo('');
    setTyped('');
    setPage(1);
  };
  // The printed log: the same filters as the page, without paging (the server prints at most 400 lines).
  const pdf = pdfHref(force ? SYSTEM_PDF_ROUTES.forceLog() : SYSTEM_PDF_ROUTES.systemLog(), { ...filters, status: force ? undefined : status });

  return (
    <>
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">{force ? tr('Only what was done with force mode on, newest first. Everything else is in the System log.') : tr('Everything done in the hotel, newest first. Payroll keeps its own log.')}</p>
        </div>
        <div className="sh-head-actions">
          <SearchField wrapClass="pay-toolbar" clear value={typed} onChange={pick(setTyped)} placeholder={tr('Search the log…')} label={tr('Search the log')} />
          {total > 0 ? (
            <a
              className="btn btn-outline-p"
              target="_blank"
              rel="noreferrer"
              href={pdf}
              onClick={(e) => {
                e.preventDefault();
                void openPdf(e.currentTarget.href, (text) => toast.show({ tone: 'error', text }), (text) => toast.show({ tone: 'info', text }));
              }}
            >
              <Bi name="file-earmark-pdf" /> {tr('Export PDF')}
            </a>
          ) : null}
        </div>
      </div>

      <StaleNote error={loaded.error} onRetry={loaded.reload} />

      <div className="ha-stack">
        <HomeStats
          stats={
            'locks' in data.stats
              ? [
                  { id: 'total', label: tr('Entries'), value: data.stats.total, format: (n) => formatCount(Math.round(n)), note: tr('On record') },
                  { id: 'today', label: tr('Today'), value: data.stats.today, format: (n) => formatCount(Math.round(n)), note: tr('Since midnight') },
                  { id: 'locks', label: tr('Locks stepped past'), value: data.stats.locks, format: (n) => formatCount(Math.round(n)), note: tr('Locked records changed') },
                  { id: 'checks', label: tr('Checks stepped past'), value: data.stats.checks, format: (n) => formatCount(Math.round(n)), note: tr('Saves the normal checks refuse') },
                ]
              : [
                  { id: 'total', label: tr('Entries'), value: data.stats.total, format: (n) => formatCount(Math.round(n)), note: tr('On record') },
                  { id: 'today', label: tr('Today'), value: data.stats.today, format: (n) => formatCount(Math.round(n)), note: tr('Since midnight') },
                  { id: 'people', label: tr('People'), value: data.stats.people, format: (n) => formatCount(Math.round(n)), note: tr('Did something') },
                  { id: 'failed', label: tr('Did not work'), value: data.stats.failed, format: (n) => formatCount(Math.round(n)), note: data.stats.failed ? tr('Errors and refusals') : tr('Nothing has failed') },
                ]
          }
        />

        <FilterBar
          tabs={[{ id: '', label: 'Everything', icon: 'collection' }, ...views.map(([id, label, icon]) => ({ id, label, icon, danger: id === 'problems' }))]}
          active={view}
          onTab={pick(setView)}
          tabsLabel="Views"
          summary={
            <>
              {hasFilters ? tr('Showing ') : tr('All ')}
              <b>{formatCount(total)}</b> {total === 1 ? tr('entry') : tr('entries')}
            </>
          }
          onReset={hasFilters ? reset : undefined}
          extra={
            force ? (
              <FilterBarExtra icon="journal-text" label={tr('System log')} title={tr('Everything else is in the System log')} onPress={() => navigate('hotel.admin.log')} />
            ) : (
              <FilterBarExtra icon="people-fill" label={tr('Payroll log')} title={tr('Payroll keeps its own log')} onPress={() => navigate('hotel.payroll.log')} />
            )
          }
        >
          <form className="d-contents log-filters" onSubmit={(e) => e.preventDefault()}>
            <FilterMenu label={tr('Person')} icon="person" any="Anyone" ariaLabel="Who did it" value={who} onChange={pick(setWho)} options={people.map((x) => ({ value: x, label: x }))} />
            <FilterMenu label={tr('Kind')} icon="lightning" any="Any kind" ariaLabel="What happened" value={action} onChange={pick(setAction)} options={Object.entries(actions).map(([value, label]) => ({ value, label }))} />
            <FilterMenu label={tr('Area')} icon="grid" any="Everywhere" ariaLabel="Where in the app" value={module} onChange={pick(setModule)} options={modules.map(([value, label]) => ({ value, label }))} />
            {force ? null : (
              <FilterMenu label={tr('Result')} icon="check2-circle" any="Any result" ariaLabel="Did it work" value={status} onChange={pick(setStatus)} options={[{ value: 'success', label: 'Worked' }, { value: 'failed', label: 'Did not work' }]} />
            )}
            <div className="bm-fbar-dates">
              <DateRangeField from={from} to={to} today={today} onChange={(a, b) => { setFrom(a); setTo(b); setPage(1); }} />
            </div>
          </form>
        </FilterBar>

        {items.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={force ? 'lightning-charge' : 'journal-text'}
              title={hasFilters ? tr('Nothing matches') : force ? tr('Force mode has not been used') : tr('Nothing logged yet')}
              text={hasFilters ? tr('Try a wider date range, or clear the filters.') : force ? tr('Whenever force mode is on, what it lets through appears here.') : tr('What is done in the hotel appears here as it happens.')}
            >
              {hasFilters ? <Button variant="outline" className="mt-3" onClick={reset}>{tr('Clear filters')}</Button> : null}
            </EmptyState>
          </div>
        ) : null}

        {days.map(([date, entries]) => (
          <section key={date} className="card ha-card ha-log-day" aria-label={dayTitle(date, today)}>
            <h3 className="ha-card-h">
              {tr(dayTitle(date, today))}
              <small>{entries.length} {entries.length === 1 ? tr('entry') : tr('entries')}</small>
            </h3>
            <ol className="pf-timeline ha-log">
              {entries.map((l) => {
                const failed = !force && (l as SystemLogRow).status === 'failed';
                const overridden = force && (l.action === 'lock' || l.action === 'checks');
                const who2 = l.userName || tr('System');
                const [modName] = logModules[l.module] ?? [l.module.charAt(0).toUpperCase() + l.module.slice(1)];
                const detailEntries = l.details ? Object.entries(l.details) : [];
                const sys = force ? null : (l as SystemLogRow);
                const fl = force ? (l as ForceLogRow) : null;
                return (
                  <li key={l.id} className={failed || overridden ? 'is-bad' : undefined}>
                    <span className="pf-tl-dot" aria-hidden="true" />
                    <div className="pf-tl-body">
                      <b>{l.summary}</b>
                      <small>
                        {formatTime(l.at)} · {who2} · {actions[l.action] ?? l.action} · {modName}
                        {failed ? <> · <span className="ha-log-bad">{tr('Did not work')}</span></> : null}
                        {overridden ? <> · <span className="ha-log-bad">{tr('Overridden')}</span></> : null}
                      </small>
                      <details className="ha-log-more">
                        <summary>{tr('Details')}</summary>
                        <DetailList
                          items={[
                            { label: tr('Entry'), value: entryNo(l.id) },
                            { label: tr('Exact time'), value: exact(l.at) },
                            { label: tr('By'), value: who2 },
                            { label: tr('Where'), value: sys ? `${modName} · ${sys.entity}` : modName },
                            sys?.subject ? { label: tr('Record'), value: sys.subject } : null,
                            fl?.method && fl.path ? { label: tr('Request'), value: `${fl.method} /${fl.path}` } : null,
                            l.ip ? { label: tr('From'), value: l.ip } : null,
                            ...detailEntries.map(([k, v]) => ({ label: k, value: String(v) })),
                          ]}
                        />
                        <div className="ha-log-acts">
                          {l.userName && who !== l.userName ? <Button size="sm" variant="outline" icon="person" onClick={() => pick(setWho)(l.userName ?? '')}>{tr('Only this person')}</Button> : null}
                          {module !== l.module ? <Button size="sm" variant="outline" icon="funnel" onClick={() => pick(setModule)(l.module)}>{trf('Only {0}', [modName])}</Button> : null}
                        </div>
                      </details>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}

        {total > 0 ? (
          <div className="card sh-pager-card">
            <Pager server view={tv} sizes={SYSTEM_PAGE_SIZES} />
          </div>
        ) : null}
      </div>
    </>
  );
}