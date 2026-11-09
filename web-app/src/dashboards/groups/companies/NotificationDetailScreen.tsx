'use client';

// hotel.co.notification - one sent notice: the message as it was sent, when and by whom, who it went to, and which company has read it (and what the
// "also email" did for each). Withdraw, the one red action, sits in More while the notice is live.
import { useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import type { NotificationDetail, NotificationStatus } from '@shared/dashboards/notifications';
import { notificationsCopy } from '@shared/dashboards/notificationsCopy';
import { userMayEdit } from '@shared/dashboards/features';

import { useAction } from '@/components/ui';
import { Bi, Button, DetailList, Dialog, Dropdown, EmptyState, StatusChip } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { HomeStats } from '../overview/HomeJobs';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { notificationsApi } from '../notifications/api';
import { Page } from './pageParts';

import { tr } from '@/lib/i18n/language';
const T = notificationsCopy.hotel;
const D = T.detail;
const STATUS_TONE: Record<NotificationStatus, 'ok' | 'neutral' | 'warn'> = { active: 'ok', expired: 'neutral', withdrawn: 'warn' };

export function NotificationDetailScreen({ params, navigate }: ScreenProps) {
  const id = params.id ?? '';
  const mayEdit = userMayEdit('companies');
  const [version, setVersion] = useState(0);
  const loaded = useLoaded(() => notificationsApi.get(id), [id, version], id);
  const [asking, setAsking] = useState(false);
  const { busy, run } = useAction();
  const back = () => navigate('hotel.co.notifications');
  const n: NotificationDetail | null = loaded.data;

  if (!n) {
    if (loaded.error?.code === 'NOT_FOUND') {
      return (
        <Page grid={false}>
          <div className="card reveal">
            <EmptyState icon="bell-slash" title={D.notFound.title} text={D.notFound.body}>
              <Button variant="outline" className="mt-3" icon="arrow-left" onClick={back}>
                {D.back}
              </Button>
            </EmptyState>
          </div>
        </Page>
      );
    }
    return <Wait error={loaded.error} onRetry={loaded.reload} tiles={false} />;
  }

  const withdraw = () =>
    void run(() => notificationsApi.withdraw(n.id), { success: D.withdrawn, onOk: () => setVersion((v) => v + 1) }).then(() => setAsking(false));
  const emailText = !n.alsoEmail ? D.emailOff : D.emailCounts(n.emailQueued, n.emailSkipped);
  const unread = Math.max(0, n.targetCount - n.readCount);
  const ended = n.status === 'withdrawn' && n.withdrawnAt ? D.withdrawnOn(formatDateTime(n.withdrawnAt)) : n.status === 'expired' && n.expiresAt ? D.expiredOn(formatDate(n.expiresAt)) : null;

  return (
    <Page grid={false}>
      <div className="page-head hu-stay-head">
        <div className="min-w-0">
          <a href="#" className="hu-back" onClick={(e) => { e.preventDefault(); back(); }}><Bi name="arrow-left" /> {D.back}</a>
          <h2 className="pms-title hu-title">
            {n.title}
            <StatusChip tone={STATUS_TONE[n.status]}>{T.status[n.status]}</StatusChip>
            {n.priority === 'important' ? <StatusChip tone="danger">{T.important}</StatusChip> : null}
          </h2>
          <p className="pms-sub">{T.sentBy(n.createdBy, formatDateTime(n.createdAt))}</p>
        </div>
        {mayEdit && n.status === 'active' ? (
          <div className="sh-head-actions">
            <Dropdown align="end" button={(p) => <Button variant="outline" icon="three-dots" {...p}>{tr("More")}</Button>}>
              <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setAsking(true); }}><Bi name="eye-slash" /> {D.withdraw}</a>
            </Dropdown>
          </div>
        ) : null}
      </div>
      <StaleNote error={loaded.error} onRetry={loaded.reload} />

      {ended ? (
        <div className="hm-q hu-oneline">
          <i className={`hm-dot ${n.status === 'withdrawn' ? 'tone-warn' : 'tone-muted'}`} aria-hidden="true" />
          <div className="hm-q-text"><b>{ended}</b></div>
        </div>
      ) : null}

      <HomeStats
        stats={[
          { id: 'to', label: D.sentTo, value: n.targetCount, format: (x) => String(Math.round(x)), note: n.audienceLabel },
          { id: 'read', label: tr("Read"), value: n.readCount, format: (x) => String(Math.round(x)), note: n.readCount === n.targetCount && n.targetCount > 0 ? D.allRead : undefined },
          { id: 'unread', label: tr("Not read yet"), value: unread, format: (x) => String(Math.round(x)) },
          { id: 'until', label: D.shownUntil, value: 0, format: () => (n.expiresAt ? formatDate(n.expiresAt) : D.noExpiry) },
        ]}
      />

      <div className="hu-stay-grid hu-two">
        <section className="card hu-card" aria-labelledby="hu-nt-msg">
          <h2 id="hu-nt-msg" className="hu-h hu-card-h">{tr("The message")}</h2>
          <pre className="mk-body">{n.body}</pre>
          <DetailList
            className="mt-3"
            items={[
              { label: D.sentTo, value: n.audienceLabel },
              { label: D.shownUntil, value: n.expiresAt ? formatDate(n.expiresAt) : D.noExpiry },
              { label: D.email, value: emailText },
              { label: D.link, value: n.linkView ? notificationsCopy.portal.openLink(n.linkView) : D.linkNone },
            ]}
          />
        </section>

        <section className="card hu-card" aria-labelledby="hu-nt-rcpt">
          <div className="hu-sec-head hu-card-h">
            <h2 id="hu-nt-rcpt" className="hu-h">{D.receipts}</h2>
            <span className="hu-sec-note">{n.readCount === n.targetCount && n.targetCount > 0 ? D.allRead : D.receiptsSub(n.readCount, n.targetCount)}</span>
          </div>
          <div className="hm-queue">
            {n.targets.map((t) => (
              <div key={t.companyId} className="hm-q hu-q-plain">
                <i className={`hm-dot ${t.readAt ? 'tone-ok' : 'tone-muted'}`} aria-hidden="true" />
                <div className="hm-q-text">
                  <b>{t.companyName}</b>
                  <small>{t.readAt ? `${D.readAt} ${formatDateTime(t.readAt)}` : D.notRead}{n.alsoEmail ? ` · ${D.email}: ${t.emailStatus ? D.emailStatus[t.emailStatus] : '-'}` : ''}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <Dialog open={asking} tone="danger" icon="eye-slash" title={D.withdrawTitle} message={D.withdrawBody} confirmLabel={D.withdraw} busy={busy} onConfirm={withdraw} onCancel={() => setAsking(false)} />
    </Page>
  );
}
