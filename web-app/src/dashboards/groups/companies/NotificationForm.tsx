'use client';

// The send form of Companies > Notifications: who (all, or companies picked from the lookup), title, message, importance, last day, an optional link to a company-portal page
// and "also send by email"; a live preview shows how the company will read it. "Review and send" asks once (a sent notification cannot be edited), then sends.
import { useEffect, useState } from 'react';

import type { LookupItem } from '@shared/dashboards/common';
import { todayIst } from '@shared/dashboards/frontOffice';
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
  type NotificationInput,
  type NotificationLinkView,
  type NotificationPriority,
} from '@shared/dashboards/notifications';
import { notificationLinkChoices, notificationsCopy } from '@shared/dashboards/notificationsCopy';

import { useDebounced, useSubmit, useToast } from '@/components/ui';
import { Bi, Button, Dialog, FieldError, FieldHint, RequiredMark, Select, Textarea } from '@/dashboards/pallav/ui';
import { api as companiesApi } from './api';
import { notificationsApi } from '../notifications/api';
import { Page } from './pageParts';

import { tr } from '@/lib/i18n/language';
const T = notificationsCopy.hotel.form;
const FIELDS = ['title', 'body', 'companyIds', 'expiresAt', 'linkView', 'linkId', 'alsoEmail'] as const;

export function NotificationForm({ onBack, onSent }: { onBack: () => void; onSent: (id: string) => void }) {
  const toast = useToast();
  const { busy, errors, setErrors, submit } = useSubmit(FIELDS);
  const [all, setAll] = useState(true);
  const [chosen, setChosen] = useState<LookupItem[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<NotificationPriority>('normal');
  const [expiresAt, setExpiresAt] = useState('');
  const [linkView, setLinkView] = useState<NotificationLinkView | ''>('');
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const clear = (k: string) => setErrors((p) => (p[k] ? { ...p, [k]: '' } : p));
  const cls = (k: string, base = 'form-control') => `${base} ${errors[k] ? 'is-invalid' : ''}`;
  const who = all ? T.audienceAll(null) : chosen.length === 1 ? (chosen[0]?.label ?? '') : `${chosen.length} companies`;

  const input = (): NotificationInput => ({
    companyIds: all ? 'all' : chosen.map((c) => c.id),
    title,
    body,
    priority,
    expiresAt: expiresAt || null,
    alsoEmail,
    linkView: linkView || null,
    linkId: null,
  });

  function review() {
    if (!all && chosen.length === 0) {
      setErrors((p) => ({ ...p, companyIds: T.errors.companyIds }));
      return;
    }
    setConfirming(true);
  }
  function send() {
    setConfirming(false);
    void submit(
      async () => {
        const res = await notificationsApi.send(input());
        if (res.ok || res.error.code !== 'RATE_LIMITED') return res;
        // The server has no sentence for the 21st send in an hour: say it here (shown as a toast, it belongs to no field).
        const wait = res.error.details?.retryAfterSeconds;
        return { ok: false as const, error: { ...res.error, code: 'VALIDATION_FAILED' as const, details: { ...res.error.details, fields: { rate: T.rateLimited(wait ? Math.max(1, Math.ceil(wait / 60)) : null) } } } };
      },
      (n) => {
        toast.show({ tone: 'success', text: T.sent(who) });
        onSent(n.id);
      },
    );
  }

  return (
    <Page
      sub={T.about}
      headActions={
        <a href="#" className="btn btn-outline-p" onClick={(e) => { e.preventDefault(); onBack(); }}>
          <Bi name="arrow-left" /> {T.back}
        </a>
      }
    >
      <form className="st-card reveal" autoComplete="off" noValidate onSubmit={(e) => { e.preventDefault(); review(); }}>
        <div className="st-head">
          <div className="st-icon">
            <Bi name="bell" />
          </div>
          <div>
            <h2 className="st-title">{T.title}</h2>
            <p className="st-about">{T.formAbout}</p>
          </div>
        </div>

        <div className="st-grid">
          <div className="st-field wide">
            <span className="form-label">
              {T.audience}
              <RequiredMark />
            </span>
            <div className="mk-audience" role="radiogroup" aria-label={T.audience}>
              <label className={`mk-choice ${all ? 'on' : ''}`}>
                <input type="radio" name="nt_audience" checked={all} onChange={() => { setAll(true); clear('companyIds'); }} />
                <Bi name="buildings" />
                <span className="mk-choice-text">
                  <strong>{T.audienceAll(null)}</strong>
                  <small>{T.audienceAllHint}</small>
                </span>
              </label>
              <label className={`mk-choice ${!all ? 'on' : ''}`}>
                <input type="radio" name="nt_audience" checked={!all} onChange={() => setAll(false)} />
                <Bi name="building-check" />
                <span className="mk-choice-text">
                  <strong>{T.audiencePick}</strong>
                  <small>{T.audiencePickHint}</small>
                </span>
              </label>
            </div>
            {!all ? <CompanyPicker chosen={chosen} onChange={(c) => { setChosen(c); clear('companyIds'); }} invalid={Boolean(errors.companyIds)} /> : null}
            <FieldError>{errors.companyIds}</FieldError>
          </div>

          <div className="st-field wide">
            <label className="form-label" htmlFor="nt_title">
              {T.subject}
              <RequiredMark />
            </label>
            <input id="nt_title" className={cls('title')} maxLength={NOTIFICATION_TITLE_MAX} value={title} onChange={(e) => { setTitle(e.target.value); clear('title'); }} aria-invalid={errors.title ? true : undefined} />
            <FieldHint>
              {T.subjectHint} {title.length}/{NOTIFICATION_TITLE_MAX}
            </FieldHint>
            <FieldError>{errors.title}</FieldError>
          </div>

          <div className="st-field wide">
            <label className="form-label" htmlFor="nt_body">
              {T.message}
              <RequiredMark />
            </label>
            <Textarea id="nt_body" rows={7} className={cls('body')} maxLength={NOTIFICATION_BODY_MAX} value={body} onChange={(e) => { setBody(e.target.value); clear('body'); }} aria-invalid={errors.body ? true : undefined} />
            <FieldHint>
              {T.messageHint} {body.length}/{NOTIFICATION_BODY_MAX}
            </FieldHint>
            <FieldError>{errors.body}</FieldError>
          </div>

          <div className="st-field">
            <span className="form-label">{T.priority}</span>
            <div className="mk-audience" role="radiogroup" aria-label={T.priority} style={{ gridTemplateColumns: '1fr 1fr' }}>
              {(['normal', 'important'] as const).map((p) => (
                <label key={p} className={`mk-choice ${priority === p ? 'on' : ''}`}>
                  <input type="radio" name="nt_priority" checked={priority === p} onChange={() => setPriority(p)} />
                  <Bi name={p === 'important' ? 'exclamation-circle' : 'bell'} />
                  <span className="mk-choice-text">
                    <strong>{p === 'important' ? T.priorityImportant : T.priorityNormal}</strong>
                  </span>
                </label>
              ))}
            </div>
            <FieldHint>{T.priorityHint}</FieldHint>
          </div>

          <div className="st-field">
            <label className="form-label" htmlFor="nt_expires">
              {T.expires}
            </label>
            <input id="nt_expires" type="date" className={cls('expiresAt')} min={todayIst()} value={expiresAt} onChange={(e) => { setExpiresAt(e.target.value); clear('expiresAt'); }} aria-invalid={errors.expiresAt ? true : undefined} />
            <FieldHint>{T.expiresHint}</FieldHint>
            <FieldError>{errors.expiresAt}</FieldError>
          </div>

          <div className="st-field">
            <label className="form-label" htmlFor="nt_link">
              {T.link}
            </label>
            <Select id="nt_link" value={linkView} invalid={Boolean(errors.linkView)} onChange={(e) => { setLinkView(e.target.value as NotificationLinkView | ''); clear('linkView'); }}>
              <option value="">{T.linkNone}</option>
              {notificationLinkChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
            <FieldHint>{T.linkHint}</FieldHint>
            <FieldError>{errors.linkView ?? errors.linkId}</FieldError>
          </div>

          <div className="st-field">
            <label className="st-toggle" htmlFor="nt_email">
              <input type="checkbox" id="nt_email" checked={alsoEmail} onChange={(e) => { setAlsoEmail(e.target.checked); clear('alsoEmail'); }} />
              <span className="st-switch" aria-hidden="true" />
              <span className="st-toggle-text">
                <strong>{T.alsoEmail}</strong>
                <small>{T.alsoEmailHint}</small>
              </span>
            </label>
            <FieldError>{errors.alsoEmail}</FieldError>
          </div>

          <div className="st-field wide">
            <span className="form-label">{T.preview}</span>
            <div className="mk-preview" aria-live="polite">
              <div className="mk-preview-head">
                <span className="mk-preview-lab">{priority === 'important' ? notificationsCopy.hotel.important : tr("Notification")}</span>
                <span className="mk-preview-subject">{title || T.previewTitle}</span>
              </div>
              <pre className="mk-body">{body || T.previewBody}</pre>
              {linkView ? (
                <p className="mk-preview-foot">
                  <Bi name="box-arrow-up-right" /> {notificationsCopy.portal.openLink(linkView)}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="st-foot">
          <a href="#" className="btn btn-ghost me-auto" onClick={(e) => { e.preventDefault(); onBack(); }}>
            {T.cancel}
          </a>
          <Button type="submit" icon="send" disabled={busy}>
            {busy ? T.sending : T.review}
          </Button>
        </div>
      </form>

      <Dialog
        open={confirming}
        icon="send"
        title={T.confirmTitle(who)}
        message={`${T.confirmBody}${alsoEmail ? ` ${T.confirmEmail(null)}` : ''}`}
        confirmLabel={T.send}
        busy={busy}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
    </Page>
  );
}

/** Search the hotel's companies (the lookup answers up to 50) and tick the ones to send to; the ticked ones stay as removable chips. */
function CompanyPicker({ chosen, onChange, invalid }: { chosen: LookupItem[]; onChange: (c: LookupItem[]) => void; invalid: boolean }) {
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim(), 250);
  const [found, setFound] = useState<LookupItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void companiesApi.lookupCompanies({ q, limit: 50 }).then((res) => {
      if (!live) return;
      setFailed(!res.ok);
      if (res.ok) setFound(res.data);
    });
    return () => {
      live = false;
    };
  }, [q]);
  const isChosen = (id: string) => chosen.some((c) => c.id === id);
  const toggle = (c: LookupItem) => onChange(isChosen(c.id) ? chosen.filter((x) => x.id !== c.id) : [...chosen, c]);

  return (
    <div className="mt-2">
      <input
        className={`form-control${invalid ? ' is-invalid' : ''}`}
        type="search"
        autoComplete="off"
        placeholder={T.pickSearch}
        aria-label={T.pickSearch}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      <div className="d-flex flex-wrap gap-2 my-2" aria-live="polite">
        <span className="small text-muted align-self-center">{T.picked(chosen.length)}</span>
        {chosen.map((c) => (
          <button key={c.id} type="button" className="btn btn-sm btn-outline-p text-start" style={{ maxWidth: '100%' }} onClick={() => toggle(c)} title={T.remove(c.label)} aria-label={T.remove(c.label)}>
            <span className="text-truncate d-inline-block align-bottom" style={{ maxWidth: 'min(22rem, 70vw)' }}>
              {c.label}
            </span>{' '}
            <Bi name="x-lg" />
          </button>
        ))}
      </div>
      <div className="border rounded-3" style={{ maxHeight: 240, overflowY: 'auto' }} role="group" aria-label={T.audiencePick}>
        {failed ? (
          <p className="small text-danger p-3 mb-0">{tr("The companies could not be loaded. Try typing again.")}</p>
        ) : found === null ? (
          <p className="small text-muted p-3 mb-0">{tr("Loading…")}</p>
        ) : found.length === 0 ? (
          <p className="small text-muted p-3 mb-0">{T.pickNone}</p>
        ) : (
          found.map((c) => (
            <label key={c.id} className="d-flex align-items-start gap-2 px-3 py-2 mb-0" style={{ cursor: 'pointer' }}>
              <input type="checkbox" className="form-check-input mt-1 flex-none" checked={isChosen(c.id)} onChange={() => toggle(c)} />
              <span className="min-w-0 text-break">
                {c.label}
                {c.hint ? <small className="d-block text-muted">{c.hint}</small> : null}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}