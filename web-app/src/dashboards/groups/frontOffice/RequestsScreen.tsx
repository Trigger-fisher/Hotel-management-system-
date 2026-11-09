'use client';

// hotel.fo.requests - Guest requests (MJ's plan, G2): what guests asked for from the portal, waiting (oldest first) or closed. Mark each done or not
// possible, with an optional word back the guest sees on their portal. Needs the In House part (view to look, edit to close).
import { useState } from 'react';
import { formatDateTime, formatTime } from '@shared/dashboards/format';
import { GUEST_REQUEST_STATUS, guestRequestKindLabel, guestRequestsCopy, type GuestRequestRow } from '@shared/dashboards/guestRequests';
import { userMayEdit } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { useAction, useAsync, usePageSize } from '@/components/ui';
import { Bi, Button, DetailCard, DetailList, EmptyState, LoadError, Modal, PageHead, Pager, pagerView, PageSkeleton, Textarea } from '../../pallav/ui';
import { foApi } from './api';
import { FoFilterBar, FoNav } from './foKit';

import { tr, trf } from '@/lib/i18n/language';
const c = guestRequestsCopy.desk;
type Tab = 'open' | 'closed';
/** An open request older than this waits too long: the amber edge. */
const LATE_MIN = 30;
const minutesSince = (iso: string, now: number) => Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
const waited = (m: number) => (m < 60 ? trf('{0} min', [m]) : m < 24 * 60 ? trf('{0} h {1} min', [Math.floor(m / 60), m % 60]) : trf('{0} days', [Math.floor(m / 1440)]));

export function RequestsScreen({ navigate }: ScreenProps) {
  const [tab, setTab] = useState<Tab>('open');
  const [page, setPage] = useState(1);
  const pageSize = usePageSize(25);
  const [version, setVersion] = useState(0);
  // the waiting minutes count from the moment the list arrived (it reloads on every change), stamped here and not while drawing
  const list = useAsync(async () => {
    const r = await foApi.listRequests({ tab, page, pageSize });
    return r.ok ? { ...r, data: { ...r.data, loadedAt: Date.now() } } : r;
  }, [tab, page, pageSize, version], { keep: true });
  const data = list.state.status === 'ready' ? list.state.data : null;
  const [closing, setClosing] = useState<GuestRequestRow | null>(null);
  const canEdit = userMayEdit('pms');
  const now = data?.loadedAt ?? 0;
  return (
    <>
      <PageHead sub={c.sub}>
        <FoNav active="requests" navigate={navigate} />
      </PageHead>
      <FoFilterBar
        tabs={[{ id: 'open', label: c.tabs.open, count: data?.counts.open || undefined }, { id: 'closed', label: c.tabs.closed }]}
        active={tab}
        onTab={(id) => { setTab(id === 'closed' ? 'closed' : 'open'); setPage(1); }}
        summary={c.summary(data?.page.total ?? 0)}
      />
      {!data && list.state.status === 'loading' ? <PageSkeleton /> : null}
      {!data && list.state.status === 'error' ? <LoadError error={list.state.error} onRetry={list.reload} /> : null}
      {data && data.page.items.length === 0 ? (
        <div className="card reveal">
          <EmptyState icon="bell" title={c.empty[tab]} text="What guests ask for from their portal, such as a clean room or an extra towel, shows here for the front desk to answer." />
        </div>
      ) : data ? (
        <>
          <div className="reveal">
            {data.page.items.map((r: GuestRequestRow) => {
              const kind = guestRequestKindLabel(r.kind);
              const mins = minutesSince(r.at, now);
              const open = tab === 'open';
              return (
                <DetailCard className="hu-dc"
                  key={r.id}
                  label={`${kind}, ${tr('room')} ${r.roomNumber || '-'}`}
                  warn={open && mins >= LATE_MIN}
                  lead={{ big: r.roomNumber || '-', muted: !r.roomNumber, tag: formatTime(r.at), title: formatDateTime(r.at) }}
                  facts={[
                    { label: c.columns.request, value: kind },
                    { label: c.columns.guest, value: r.guestName },
                    { label: c.columns.note, value: r.note, text: true, wide: true, empty: tr('No note') },
                    open
                      ? { label: tr('Waiting'), value: waited(mins), tone: mins >= LATE_MIN ? 'warn' : undefined }
                      : { label: c.columns.status, value: GUEST_REQUEST_STATUS[r.status], tone: r.status === 'done' ? 'ok' : 'muted', sub: r.doneBy ?? undefined },
                  ]}
                  sections={[
                    {
                      icon: 'bell', title: tr('Request'),
                      content: <DetailList items={[{ label: tr('Asked'), value: formatDateTime(r.at) }, { label: c.columns.request, value: kind }, { label: c.columns.note, value: r.note || '-' }]} />,
                    },
                    ...(!open
                      ? [{
                          icon: 'check2-circle', title: tr('Answer'),
                          content: <DetailList items={[{ label: c.columns.status, value: GUEST_REQUEST_STATUS[r.status] }, { label: c.columns.by, value: r.doneBy ?? '-' }, r.doneAt ? { label: tr('When'), value: formatDateTime(r.doneAt) } : undefined, { label: tr('Reply to the guest'), value: r.reply || '-' }]} />,
                        }]
                      : []),
                  ]}
                  actions={open && canEdit ? <Button size="sm" icon="check2" onClick={() => setClosing(r)}>{c.done}</Button> : undefined}
                />
              );
            })}
          </div>
          <Pager view={pagerView(data.page, { setPage })} server />
        </>
      ) : null}
      {closing ? <CloseModal row={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); setVersion((n) => n + 1); }} /> : null}
    </>
  );
}

function CloseModal({ row, onClose, onDone }: { row: GuestRequestRow; onClose: () => void; onDone: () => void }) {
  const [reply, setReply] = useState('');
  const { busy, run } = useAction();
  const label = `${guestRequestKindLabel(row.kind)} · ${row.roomNumber}`;
  const close = (status: 'done' | 'declined') => void run(() => foApi.closeRequest(row.id, { status, reply }), { success: c.closed(label, status), onOk: onDone });
  return (
    <Modal
      open
      onClose={onClose}
      title={c.closeTitle(label)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button variant="outline" icon="x" onClick={() => close('declined')} disabled={busy}>{c.decline}</Button>
          <Button icon="check2" onClick={() => close('done')} disabled={busy}>{c.done}</Button>
        </>
      }
    >
      <p className="mb-2">
        <strong>{row.guestName}</strong>{row.note ? <> · {row.note}</> : null}
      </p>
      <label className="w-100">
        <span className="form-label">{c.reply}</span>
        <Textarea rows={2} maxLength={300} value={reply} placeholder={c.replyPlaceholder} onChange={(e) => setReply(e.target.value)} />
      </label>
      <p className="small text-muted mt-2 mb-0"><Bi name="info-circle" /> {tr("The guest sees the reply on their portal.")}</p>
    </Modal>
  );
}
