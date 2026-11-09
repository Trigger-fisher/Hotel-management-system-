'use client';

// platform.audit (Super Admin): every platform action, newest first, one card each (when, who with role, what, which hotel and record; opened:
// role, inside a hotel, reason, network address, browser). Filters: search, action, hotel, who, dates; Export CSV of the filtered rows. Append-only.
import { useState } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import { PLATFORM_MOCK_TODAY, platformCopy, type PlatformActivityAction, type PlatformAuditEntry, type PlatformAuditQuery } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { errorText, useDebounced, useToast } from '@/components/ui';
import { Bi, Button, DateRangeField, DetailCard, DetailList, EmptyState, FilterBar, FilterMenu, PageHead, Pager, SearchField, pagerView, type TableView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, istDay, useLoaded } from '../payrollCore/load';
import { exportAuditCsvReal } from '@/lib/api/adapters/platformConsole';
import { apiMode } from '@/lib/api/mode';
import { platformApi } from './api';
import { LevelPill, SuperOnly, When } from './superParts';

const T = platformCopy.audit;
const M = platformCopy.audit.moreColumns;
const L = platformCopy.status.level;
const A = platformCopy.auditPage;

const ACTIONS = Object.keys(T.actions) as PlatformActivityAction[];
const isAction = (v: string | undefined): v is PlatformActivityAction => ACTIONS.includes(v as PlatformActivityAction);

export function PlatformAudit(props: ScreenProps) {
  if (props.user.role !== 'super_admin') return <SuperOnly />;
  return <AuditList {...props} />;
}

const roleText = (e: PlatformAuditEntry) => (e.actorRole ? L[e.actorRole] : e.actorName === 'System' ? T.systemActor : T.outsideActor);

/** One CSV cell: quoted when needed; a leading = + - @ is defused so a spreadsheet never runs it as a formula. */
function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function auditCsv(rows: PlatformAuditEntry[]): string {
  const C = T.columns;
  const head = [C.when, C.who, M.role, M.insideHotel, C.action, C.target, C.hotel, M.result, M.reason, M.ip, M.browser, C.what];
  const lines = rows.map((e) =>
    [
      formatDateTime(e.at),
      e.actorName,
      roleText(e),
      e.insideHotel ? T.yes : T.no,
      e.actionLabel,
      e.target,
      e.hotelName ?? e.groupName ?? T.noHotel,
      T.results[e.result],
      e.reason ?? '',
      e.ip,
      e.browser,
      e.result === 'success' ? e.text : '',
    ]
      .map(cell)
      .join(','),
  );
  // BOM so Excel reads the file as UTF-8.
  return `﻿${[head.map(cell).join(','), ...lines].join('\r\n')}\r\n`;
}

function download(name: string, text: string) {
  const href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function AuditList({ params }: ScreenProps) {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [action, setAction] = useState<string>(() => (isAction(params.action) ? params.action : ''));
  const [hotelId, setHotelId] = useState(params.hotelId ?? '');
  const [actor, setActor] = useState(params.actor ?? '');
  const [from, setFrom] = useState(params.from ?? '');
  const [to, setTo] = useState(params.to ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState(false);

  const query: PlatformAuditQuery = {
    search,
    action: isAction(action) ? action : 'all',
    hotelId: hotelId || undefined,
    actor: actor || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const { data, error, reload } = useLoaded(() => platformApi.listAudit({ ...query, page, pageSize }), [search, action, hotelId, actor, from, to, page, pageSize]);
  // Every hotel the log can name: 'all' leaves out archived hotels, so the archived ones are asked for too (finding 13).
  const hotels = useLoaded(async () => {
    const [live, gone] = await Promise.all([platformApi.listHotels({ pageSize: 500 }), platformApi.listHotels({ status: 'archived', pageSize: 500 })]);
    if (!live.ok) return live;
    if (!gone.ok) return gone;
    const items = [...live.data.items.map((h) => ({ value: h.id, label: h.name })), ...gone.data.items.map((h) => ({ value: h.id, label: T.archivedHotel(h.name) }))];
    return { ok: true as const, data: { items: items.sort((a, b) => a.label.localeCompare(b.label, 'en')) } };
  }, []);

  const filtered = Boolean(typed.trim() || action || hotelId || actor || from || to);
  const reset = () => {
    setTyped('');
    setAction('');
    setHotelId('');
    setActor('');
    setFrom('');
    setTo('');
    setPage(1);
  };
  const pick = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };

  const view: TableView<PlatformAuditEntry> | null = data
    ? {
        ...pagerView(data, { setPage }),
        setPerPage: (n: number) => {
          setPageSize(n);
          setPage(1);
        },
      }
    : null;

  async function exportCsv() {
    setExporting(true);
    try {
      if (apiMode() === 'real') {
        // The server builds the file (GET /platform/audit/export: same filters, 50,000 rows at most, itself audited).
        const out = await exportAuditCsvReal(query);
        if (!out.ok) {
          toast.show({ tone: 'error', text: errorText(out.error) });
          return;
        }
        download(out.data.filename, out.data.csv);
        toast.show({ tone: 'success', text: T.exported(Math.min(data?.total ?? 0, 50_000), out.data.filename) });
        return;
      }
      // Mock: every row the filters match, not only this page, built here.
      const res = await platformApi.listAudit({ ...query, page: 1, pageSize: 100_000 });
      if (!res.ok) {
        toast.show({ tone: 'error', text: errorText(res.error) });
        return;
      }
      const rows = res.data.items;
      if (rows.length === 0) {
        toast.show({ tone: 'info', text: T.nothingToExport });
        return;
      }
      const first = from || istDay(rows[rows.length - 1].at);
      const last = to || istDay(rows[0].at);
      const file = `audit-${first}-${last}.csv`;
      download(file, auditCsv(rows));
      toast.show({ tone: 'success', text: T.exported(rows.length, file) });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHead className="reveal" sub={T.subtitle}>
        <SearchField
          wrapClass="pay-toolbar"
          clear
          value={typed}
          placeholder={T.searchPlaceholder}
          label={T.searchLabel}
          onChange={(v) => {
            setTyped(v);
            setPage(1);
          }}
        />
        <Button icon="filetype-csv" className="sh-new" disabled={!data || exporting} onClick={() => void exportCsv()}>
          {exporting ? T.exporting : T.exportCsv}
        </Button>
      </PageHead>

      {!data || !view ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={8} />
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          <div className="hm-queue pf-ontheway reveal">
            <div className="hm-q">
              <i className="hm-dot tone-muted" aria-hidden="true" />
              <div className="hm-q-text">
                <b>{A.appendTitle}</b>
                <small>{T.appendOnly}</small>
              </div>
              <span />
            </div>
          </div>
          <FilterBar summary={T.summary(data.total)} onReset={filtered ? reset : undefined}>
            <form className="d-contents log-filters" onSubmit={(e) => e.preventDefault()}>
              <FilterMenu
                label={T.filters.action}
                icon="lightning"
                any={T.filters.allActions}
                ariaLabel={T.filters.action}
                value={action}
                options={ACTIONS.map((a) => ({ value: a, label: T.actions[a] }))}
                onChange={pick(setAction)}
              />
              <FilterMenu
                label={T.filters.hotel}
                icon="building"
                any={T.filters.allHotels}
                ariaLabel={T.filters.hotel}
                value={hotelId}
                options={hotels.data?.items ?? []}
                onChange={pick(setHotelId)}
              />
              <FilterMenu
                label={T.filters.actor}
                icon="person"
                any={T.filters.allActors}
                ariaLabel={T.filters.actor}
                value={actor}
                options={data.actors.map((a) => ({ value: a, label: a }))}
                onChange={pick(setActor)}
              />
              <div className="bm-fbar-dates">
                <DateRangeField
                  from={from}
                  to={to}
                  today={PLATFORM_MOCK_TODAY}
                  onChange={(a, b) => {
                    setFrom(a);
                    setTo(b);
                    setPage(1);
                  }}
                />
              </div>
            </form>
          </FilterBar>

          {data.total === 0 ? (
            <div className="card reveal">
              {filtered ? (
                <EmptyState icon="search" title={T.noMatch.title} text={T.noMatch.body}>
                  <Button variant="outline" className="mt-3" onClick={reset}>
                    {T.clearFilters}
                  </Button>
                </EmptyState>
              ) : (
                <EmptyState icon="journal-text" title={T.empty.title} text={T.empty.body} />
              )}
            </div>
          ) : (
            <>
              <div className="reveal">
                {data.items.map((e) => (
                  <AuditCard key={e.id} e={e} />
                ))}
              </div>
              <div className="card sh-pager-card">
                <Pager server view={view} />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function AuditCard({ e }: { e: PlatformAuditEntry }) {
  const ok = e.result === 'success';
  return (
    <DetailCard
      label={`${A.entry} ${e.actionLabel}`}
      className="pf-admin"
      warn={!ok}
      lead={
        <span className={`pay-pill ${ok ? 'pay-paid' : 'pay-failed'}`}>
          <Bi name={ok ? 'check-circle' : 'x-octagon'} />
          {T.results[e.result]}
        </span>
      }
      facts={[
        { label: T.columns.when, value: <When iso={e.at} /> },
        { label: T.columns.who, value: e.actorName, sub: e.actorRole ? <LevelPill level={e.actorRole} /> : roleText(e) },
        { label: T.columns.action, value: e.actionLabel, sub: ok ? e.text : e.reason ?? undefined, wide: true },
        { label: T.columns.hotel, value: e.hotelName ?? e.groupName ?? T.noHotel, sub: e.target || undefined },
      ]}
      sections={[
        {
          icon: 'info-circle',
          title: A.details,
          content: (
            <DetailList
              items={[
                { label: T.columns.target, value: e.target || T.noReason },
                { label: M.role, value: roleText(e) },
                e.insideHotel ? { label: M.insideHotel, value: T.insideHotelFlag } : null,
                e.reason ? { label: M.reason, value: e.reason } : null,
                e.ip ? { label: M.ip, value: <span className="pf-mono">{e.ip}</span> } : null,
                e.browser ? { label: M.browser, value: e.browser } : null,
                { label: A.at, value: formatDateTime(e.at) },
              ]}
            />
          ),
        },
      ]}
    />
  );
}
