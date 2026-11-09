'use client';

// hotel.fo.guestMessages - the read-only history of what guests once wrote from their portal's Help page. Guests now reach the hotel through Email and WhatsApp.
import { useState } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import { supportCopy, type SupportStatus } from '@shared/dashboards/supportRequests';

import { useAsync, useDebounced, usePageSize } from '@/components/ui';
import { Bi, Button, EmptyState, ListSearch, LoadError, PageHead, Pager, pagerView, PageSkeleton, StatusChip } from '../../pallav/ui';
import type { ScreenProps } from '../../types';
import { deskSupportApi } from '../support/api';

import { tr, trf } from '@/lib/i18n/language';

const TONE: Record<SupportStatus, 'ok' | 'warn' | 'neutral'> = { open: 'warn', answered: 'ok', closed: 'neutral' };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

export function GuestMessagesScreen({ navigate }: ScreenProps) {
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const pageSize = usePageSize(25);
  const list = useAsync(() => deskSupportApi.list({ status: 'all', search, page, pageSize }), [search, page, pageSize], { keep: true });
  const data = list.state.status === 'ready' ? list.state.data : null;
  const openEmail = <Button icon="envelope" onClick={() => navigate('hotel.email')}>{tr("Open Email")}</Button>;

  return (
    <>
      <PageHead sub={tr("Messages guests wrote from their portal before 18 Oct 2026, kept to read. Guests now write to you by Email and WhatsApp.")}>
        <ListSearch value={typed} onChange={(v) => { setTyped(v); setPage(1); }} onClear={() => setTyped('')} placeholder={tr("Search by guest, subject or number")} />
        {openEmail}
      </PageHead>
      {!data && list.state.status === 'loading' ? <PageSkeleton /> : null}
      {!data && list.state.status === 'error' ? <LoadError error={list.state.error} onRetry={list.reload} /> : null}
      {data && data.items.length === 0 ? (
        <div className="card reveal">
          <EmptyState
            icon="chat-dots"
            title={search ? tr("No message matches") : tr("No old messages")}
            text={search ? tr("Try the guest's name or the message number.") : tr("Guests write to you by Email and WhatsApp. Their messages are in Email.")}
          >
            {search ? <Button variant="outline" onClick={() => { setTyped(''); setPage(1); }}>{tr("Clear search")}</Button> : openEmail}
          </EmptyState>
        </div>
      ) : data ? (
        <>
          <div className="hu-msgs reveal">
            {data.items.map((m) => (
              <article key={m.id} className={`card hu-msg${m.status === 'closed' ? ' is-closed' : ''}`} aria-label={trf("Message {0}", [m.number])}>
                <div className="hu-msg-head">
                  <span className="hu-avatar pf-initials" aria-hidden="true">{initials(m.guestName)}</span>
                  <div className="hu-msg-who">
                    <b>{m.subject}</b>
                    <small>{m.guestName} · {m.number} · {formatDateTime(m.createdAt)}</small>
                  </div>
                  <StatusChip tone={TONE[m.status]}>{supportCopy.deskStatusLabel[m.status]}</StatusChip>
                </div>
                {(m.billRef || m.orderRef) && (
                  <div className="hu-refs">
                    {m.billRef && <span className="hu-book"><Bi name="receipt" /> {trf("Bill {0}", [m.billRef])}</span>}
                    {m.orderRef && <span className="hu-book"><Bi name="cup-straw" /> {trf("Order {0}", [m.orderRef])}</span>}
                  </div>
                )}
                <div className="hu-thread">
                  <div className="hu-bubble">
                    <p>{m.message}</p>
                  </div>
                  {m.reply ? (
                    <div className="hu-bubble is-hotel">
                      <small><Bi name="reply" /> {m.repliedByName ?? tr("The hotel")}{m.repliedAt ? ` · ${formatDateTime(m.repliedAt)}` : ''}</small>
                      <p>{m.reply}</p>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <Pager view={pagerView(data, { setPage })} server />
        </>
      ) : null}
    </>
  );
}
