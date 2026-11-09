'use client';

// The Email page when no inbox is connected (MJ, 1 Nov 2026): Amazon SES only sends, so instead of "set up your inbox" the page lists every email sent through it: to, what it was, when and how it
// went. A hotel's page lists that hotel's mail; the platform's page lists everything, with the hotel named. Only who, what kind, when and status; never the text of a mail, a code or a link.
import { useState } from 'react';

import type { ConvScope } from '@shared/dashboards/conversations';
import { formatDateTime } from '@shared/dashboards/format';
import { SENT_MAIL_STATUSES, sentMailCopy as t, type SentMailFilter, type SentMailPage, type SentMailStatus } from '@shared/dashboards/sentMail';

import { useDebounced } from '@/components/ui';
import { apiMode } from '@/lib/api/mode';
import { get } from '@/lib/api/client';
import { Bi, Button, EmptyState, SearchField, SegTabs, StatusChip, Table, type ChipTone } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';

import { tr } from '@/lib/i18n/language';
const SIZE = 25;
const TONE: Record<SentMailStatus, ChipTone> = { sent: 'ok', pending: 'warn', failed: 'danger' };
const EMPTY: SentMailPage = { rows: [], total: 0, page: 1, size: SIZE };

export function SentMail({ scope }: { scope: ConvScope }) {
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [status, setStatus] = useState<SentMailFilter>('all');
  const [page, setPage] = useState(1);
  const path = scope === 'platform' ? '/platform/conversations/sent-mail' : scope === 'group' ? '/group/conversations/sent-mail' : '/conversations/sent-mail';
  const { data, error, reload } = useLoaded(
    () => (apiMode() === 'mock' ? Promise.resolve({ ok: true as const, data: EMPTY }) : get<SentMailPage>(path, { search: search || undefined, status, page, size: SIZE }, undefined, { fresh: true })),
    [path, search, status, page],
  );
  const showHotel = scope === 'platform';
  const pages = data ? Math.max(1, Math.ceil(data.total / SIZE)) : 1;

  return (
    <section className="cv-setup-card" aria-labelledby="cv-sent-title" style={{ gridColumn: '1 / -1' }}>
      <span className="cv-setup-icon" aria-hidden="true">
        <Bi name="envelope-check" />
      </span>
      <h2 id="cv-sent-title">{t.title}</h2>
      <p>{scope === 'platform' ? t.platformAbout : t.hotelAbout}</p>

      <div className="d-flex flex-wrap align-items-center gap-3 mb-2">
        <SearchField wrapClass="pay-toolbar" smart clear value={typed} placeholder={t.searchPlaceholder} label={t.searchPlaceholder} onChange={(v) => { setTyped(v); setPage(1); }} />
        <SegTabs
          label={t.title}
          active={status}
          onChange={(id) => { setStatus(id as SentMailFilter); setPage(1); }}
          tabs={SENT_MAIL_STATUSES.map((s) => ({ id: s, label: t.filters[s] }))}
        />
      </div>

      {!data ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={4} />
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          {data.rows.length === 0 ? (
            <EmptyState icon="envelope" title={search || status !== 'all' ? t.noMatch : t.empty} text="" />
          ) : (
            <div className="table-responsive">
              <Table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>{t.columns.to}</th>
                    <th>{t.columns.kind}</th>
                    {showHotel ? <th>{t.columns.hotel}</th> : null}
                    <th>{t.columns.when}</th>
                    <th>{t.columns.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="text-break">{r.to}</td>
                      <td>{r.label}</td>
                      {showHotel ? <td>{r.hotel ?? <span className="text-muted">{t.platformMail}</span>}</td> : null}
                      <td>{formatDateTime(r.at)}</td>
                      <td>
                        <StatusChip tone={TONE[r.status]}>{t.statuses[r.status]}</StatusChip>
                        {r.status === 'failed' && r.problem ? <span className="cell-sub">{r.problem}</span> : null}
                        {r.status !== 'sent' && r.attempts > 0 ? <span className="cell-sub">{t.attempts(r.attempts)}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          {pages > 1 ? (
            <div className="d-flex align-items-center gap-2 mt-3">
              <Button variant="outline" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                {tr("Newer")}
              </Button>
              <span className="text-muted small">
                {page} / {pages}
              </span>
              <Button variant="outline" size="sm" icon="chevron-right" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                {tr("Older")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
