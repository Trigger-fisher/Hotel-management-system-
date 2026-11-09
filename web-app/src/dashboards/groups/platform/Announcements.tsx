'use client';

// platform.announcements (Super Admin only): notices every hotel sees on its dashboard until dismissed. On now and ended are separate tabs.
import { useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { platformCopy, type PlatformAnnouncement, type PlatformAnnouncementInput } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction } from '@/components/ui';
import { Bi, Button, DetailCard, DetailList, Dialog, EmptyState, Field, FieldHint, FilterBar, FormSection, Modal, PageHead, Pager, PickGroup, PmsDate, StatusChip, Textarea, useTableView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { SuperOnlyCard, actAs } from './PlatformStaff';

import { tr } from '@/lib/i18n/language';
const T = platformCopy.announcements;
const P = platformCopy.announcementsPage;

type Tab = 'now' | 'over';
const NONE: PlatformAnnouncement[] = [];

export function PlatformAnnouncementsScreen(props: ScreenProps) {
  if (props.user.role !== 'super_admin') return <SuperOnlyCard />;
  return <Body {...props} />;
}

function Body({ user }: ScreenProps) {
  const [version, setVersion] = useState(0);
  const { data, error, reload } = useLoaded(() => {
    actAs(user);
    return platformApi.listAnnouncements();
  }, [version]);
  const { busy, run } = useAction();
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState<PlatformAnnouncement | null>(null);
  const [tab, setTab] = useState<Tab>('now');
  const refresh = () => setVersion((n) => n + 1);
  const all = data ?? NONE;
  const now = all.filter((a) => a.state !== 'over');
  const shown = tab === 'now' ? now : all.filter((a) => a.state === 'over');
  const view = useTableView(shown, { perPage: 25 });
  const newButton = (cls: string) => (
    <Button icon="megaphone" className={cls} onClick={() => setCreating(true)}>
      {T.newOne}
    </Button>
  );

  return (
    <>
      <PageHead className="reveal" sub={T.subtitle}>
        {newButton('sh-new')}
      </PageHead>
      {!data ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={3} />
      ) : data.length === 0 ? (
        <>
          <StaleNote error={error} onRetry={reload} />
          <div className="card reveal">
            <EmptyState icon="megaphone" title={T.empty.title} text={T.empty.body}>
              {newButton('mt-3')}
            </EmptyState>
          </div>
        </>
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          <FilterBar
            tabsLabel={P.tabsLabel}
            tabs={[
              { id: 'now', label: P.tabs.now, count: now.length, dot: 'paid' },
              { id: 'over', label: P.tabs.over, count: all.length - now.length, dot: 'muted' },
            ]}
            active={tab}
            onTab={(id) => {
              setTab(id === 'over' ? 'over' : 'now');
              view.setPage(1);
            }}
          />
          {shown.length === 0 ? (
            <div className="card reveal">
              <EmptyState icon="megaphone" title={tab === 'now' ? P.noneNow : P.noneOver} text={tab === 'now' ? P.noneNowText : undefined}>
                {tab === 'now' ? newButton('mt-3') : null}
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="reveal">
                {view.rows.map((a) => (
                  <NoticeCard key={a.id} a={a} busy={busy} onEnd={() => setEnding(a)} />
                ))}
              </div>
              <div className="card sh-pager-card">
                <Pager view={view} />
              </div>
            </>
          )}
        </>
      )}
      {creating ? (
        <NewAnnouncement
          user={user}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setTab('now');
            refresh();
          }}
        />
      ) : null}
      <Dialog
        open={ending !== null}
        title={T.end}
        message={ending ? T.endAsk(ending.title) : ''}
        confirmLabel={T.end}
        tone="danger"
        icon="stop-circle"
        busy={busy}
        onCancel={() => setEnding(null)}
        onConfirm={() => {
          if (!ending) return;
          actAs(user);
          void run(() => platformApi.endAnnouncement(ending.id), { success: T.ended(ending.title), onOk: refresh }).then(() => setEnding(null));
        }}
      />
    </>
  );
}

function NoticeCard({ a, busy, onEnd }: { a: PlatformAnnouncement; busy: boolean; onEnd: () => void }) {
  const K = P.card;
  const shows = T.shows(formatDate(a.startsAt.slice(0, 10)), a.endsAt ? formatDate(a.endsAt.slice(0, 10)) : null);
  return (
    <DetailCard
      label={`${K.notice} ${a.title}`}
      leadWidth="lg"
      className="pf-hotel"
      warn={a.important && a.state !== 'over'}
      lead={
        <>
          <span className="pf-kind" aria-hidden="true">
            <Bi name="megaphone" />
          </span>
          <StatusChip tone={a.state === 'live' ? 'ok' : a.state === 'scheduled' ? 'warn' : 'neutral'}>{T.states[a.state]}</StatusChip>
        </>
      }
      facts={[
        { label: K.notice, value: a.title, sub: a.important ? K.important : undefined, tone: a.state === 'over' ? 'muted' : undefined },
        { label: K.audience, value: T.audiences[a.audience] },
        { label: K.shows, value: shows },
        { label: K.reads, value: T.people(a.reads) },
      ]}
      sections={[
        { icon: 'chat-square-text', title: K.message, wide: true, content: <p className="pf-text mb-0">{a.body}</p> },
        {
          icon: 'info-circle',
          title: K.about,
          content: (
            <DetailList
              items={[
                { label: K.published, value: formatDateTime(a.createdAt) },
                a.createdBy ? { label: K.by, value: a.createdBy } : null,
                { label: K.importance, value: a.important ? T.importances.important : T.importances.normal },
              ]}
            />
          ),
        },
      ]}
      actions={
        a.state !== 'over' ? (
          <Button variant="ghost" size="sm" icon="stop-circle" className="pf-quiet" title={`${T.end}: ${a.title}`} disabled={busy} onClick={onEnd}>
            {T.end}
          </Button>
        ) : undefined
      }
    />
  );
}

function NewAnnouncement({ user, onClose, onSaved }: { user: ScreenProps['user']; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<PlatformAnnouncementInput>({ title: '', body: '', audience: 'admins', important: false, endsOn: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const clear = (k: string) => {
    if (errors[k]) setErrors((p) => ({ ...p, [k]: '' }));
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={T.newOne}
      size="lg"
      staticBackdrop
      onSubmit={() => {
        actAs(user);
        void run(() => platformApi.createAnnouncement(v), { success: (a) => T.published(a.title), onFields: (f) => setErrors(f), onOk: onSaved });
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button type="submit" icon="megaphone" disabled={busy}>
            {busy ? T.publishing : T.publish}
          </Button>
        </>
      }
    >
      <fieldset disabled={busy}>
        <FormSection icon="chat-square-text" title={P.form.what}>
          <div className="row g-3">
            <Field label={T.title} required error={errors.title}>
              <input className={`form-control${errors.title ? ' is-invalid' : ''}`} maxLength={120} required value={v.title} onChange={(e) => { setV((p) => ({ ...p, title: e.target.value })); clear('title'); }} />
            </Field>
            <Field label={T.body} required error={errors.body}>
              <Textarea rows={5} maxLength={2000} required invalid={Boolean(errors.body)} value={v.body} onChange={(e) => { setV((p) => ({ ...p, body: e.target.value })); clear('body'); }} />
            </Field>
          </div>
        </FormSection>
        <FormSection icon="people" title={P.form.who}>
          <PickGroup<'admins' | 'everyone'>
            label={T.audience}
            value={v.audience}
            onChange={(x) => setV((p) => ({ ...p, audience: x }))}
            choices={[
              { value: 'admins', icon: 'person-badge', title: T.audiences.admins, text: P.form.adminsHint },
              { value: 'everyone', icon: 'people', title: T.audiences.everyone, text: P.form.everyoneHint },
            ]}
          />
        </FormSection>
        <FormSection icon="calendar-event" title={P.form.how}>
          <div className="row g-3">
            <Field label={T.endsOn} col="col-sm-6" optional error={errors.endsOn}>
              <PmsDate type="date" value={v.endsOn ?? ''} onChange={(e) => { setV((p) => ({ ...p, endsOn: e.target.value })); clear('endsOn'); }} />
              <FieldHint>{T.endsOnHint}</FieldHint>
            </Field>
            <div className="col-sm-6">
              <div className="form-check pf-switch form-switch">
                <input className="form-check-input" type="checkbox" role="switch" id="an-important" checked={v.important} onChange={(e) => setV((p) => ({ ...p, important: e.target.checked }))} />
                <label className="form-check-label" htmlFor="an-important">
                  {T.importances.important}
                </label>
              </div>
              <FieldHint>{P.form.importantHint}</FieldHint>
            </div>
          </div>
        </FormSection>
      </fieldset>
    </Modal>
  );
}
