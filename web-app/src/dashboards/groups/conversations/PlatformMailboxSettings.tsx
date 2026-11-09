'use client';

// Set-up centre > Email > Reading the platform mailbox (Super Admin only, MJ 5 Nov 2026): reading on or off, the mail server only inside Advanced when the mailbox
// is on the platform's own mail server, and a test of the SAVED settings that answers in fixed sentences per check (reading, sending).
import { useEffect, useState } from 'react';

import { conversationsCopy as c, type MailCheck, type MailConnectionTest, type PlatformMailbox } from '@shared/dashboards/conversations';
import type { DashError } from '@shared/dashboards/common';
import { formatDateTime } from '@shared/dashboards/format';

import { errorText, fieldErrors } from '@/components/ui';
import { Alert, Bi, Button, Field, FormSection, LoadError, Select, Skeleton, StatusChip, TextAction } from '@/dashboards/pallav/ui';

import { platformMailboxApi } from './api';

import { tr } from '@/lib/i18n/language';
function CheckRow({ name, check, running }: { name: string; check: MailCheck | null; running: boolean }) {
  return (
    <div className="cv-test-row">
      <span className="cv-test-name">{name}</span>
      <span className="cv-test-text">
        {running || !check ? (
          c.settings.testing
        ) : (
          <>
            <StatusChip tone={check.ok ? 'ok' : 'danger'}>{check.ok ? c.settings.checkOk : c.settings.checkFailed}</StatusChip> {check.message}
            {check.hint ? <span className="cv-test-hint d-block">{check.hint}</span> : null}
          </>
        )}
      </span>
    </div>
  );
}

export function PlatformMailboxSettings({ superAdmin, onOpenMailSettings }: { superAdmin: boolean; onOpenMailSettings: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; box: PlatformMailbox | null; error: DashError | null } | null>(null);
  const [form, setForm] = useState<{ reading: boolean; host: string; port: 993 | 143 } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<MailConnectionTest | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    void platformMailboxApi.getMailbox().then((r) => {
      if (!live) return;
      setLoaded({ attempt, box: r.ok ? r.data : null, error: r.ok ? null : r.error });
      if (r.ok) {
        setForm({ reading: r.data.reading, host: r.data.imapHost ?? '', port: r.data.imapPort });
        setTest(r.data.lastTest);
      }
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  if (!loaded || loaded.attempt !== attempt) return <Skeleton rows={2} />;
  if (loaded.error || !loaded.box || !form) return <LoadError error={loaded.error ?? { code: 'SERVER_ERROR', message: 'SERVER_ERROR', traceId: 'client' }} onRetry={() => setAttempt((n) => n + 1)} />;
  const box = loaded.box;
  const own = box.provider === 'smtp' && !box.imapFixed;
  const dirty = form.reading !== box.reading || (own && (form.host.trim() !== (box.imapHost ?? '') || form.port !== box.imapPort));

  const save = async () => {
    setSaving(true);
    setError(null);
    setFields({});
    setSaved(false);
    const r = await platformMailboxApi.setMailbox({ reading: form.reading, ...(own ? { imapHost: form.host.trim(), imapPort: form.port } : {}) });
    setSaving(false);
    if (!r.ok) {
      setFields(fieldErrors(r.error));
      setError(errorText(r.error));
      return;
    }
    setLoaded({ attempt, box: r.data, error: null });
    setForm({ reading: r.data.reading, host: r.data.imapHost ?? '', port: r.data.imapPort });
    setSaved(true);
  };

  const runTest = async () => {
    setTesting(true);
    setError(null);
    const r = await platformMailboxApi.startMailboxTest();
    setTesting(false);
    if (r.ok) setTest(r.data);
    else setError(errorText(r.error));
  };

  return (
    <FormSection icon="envelope-open" title={c.settings.mailboxTitle} hint={box.address ?? undefined}>
      <p className="cv-note-hint">
        <Bi name="key" /> {c.settings.loginWhere}{' '}
        {superAdmin ? (
          <TextAction kind="reset" icon="box-arrow-up-right" onClick={onOpenMailSettings}>
            {c.settings.openMailSettings}
          </TextAction>
        ) : null}
      </p>
      {!box.canRead ? (
        <Alert tone="neutral">{box.reason === 'send_only' ? c.mailbox.sendOnly : box.reason === 'not_set' ? c.mailbox.notSet : box.reason === 'password_unreadable' ? c.mailbox.passwordUnreadable : box.reason === 'needs_update' ? c.mailbox.needsUpdate : c.mailbox.off}</Alert>
      ) : null}
      <div className="form-check form-switch mb-3">
        <input
          id="cv-reading"
          className="form-check-input"
          type="checkbox"
          role="switch"
          checked={form.reading}
          disabled={!box.canRead && !form.reading}
          onChange={(e) => {
            setForm({ ...form, reading: e.target.checked });
            setSaved(false);
          }}
        />
        <label className="form-check-label" htmlFor="cv-reading">
          {c.settings.reading}
        </label>
      </div>
      {form.reading ? (
        <Alert tone="warning" icon="shield-exclamation">
          {c.setup.privacy}
        </Alert>
      ) : null}
      {own ? (
        <details className="mb-2" open={Boolean(fields.imapHost || fields.imapPort)}>
          <summary className="small fw-semibold">{tr("Advanced")}</summary>
          <div className="row g-2 mt-1">
            <Field label={c.settings.imapHost} col="col-sm-8" error={fields.imapHost}>
              <input className="form-control" value={form.host} maxLength={253} placeholder={tr("mail.example.com")} autoComplete="off" onChange={(e) => setForm({ ...form, host: e.target.value })} />
            </Field>
            <Field label={c.settings.imapPort} col="col-sm-4" error={fields.imapPort}>
              <Select value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) === 143 ? 143 : 993 })}>
                <option value={993}>{tr("993 (SSL/TLS)")}</option>
                <option value={143}>{tr("143 (STARTTLS)")}</option>
              </Select>
            </Field>
          </div>
        </details>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved ? <Alert tone="success">{c.settings.saved}</Alert> : null}
      <div className="d-flex flex-wrap align-items-center gap-2">
        <Button icon="check-lg" busy={saving} disabled={!dirty} onClick={() => void save()}>
          {c.settings.save}
        </Button>
        <Button variant="outline" icon="plug" busy={testing} busyLabel={c.settings.testing} disabled={dirty || testing} onClick={() => void runTest()}>
          {c.settings.test}
        </Button>
        {dirty ? <span className="cv-note-hint">{c.settings.saveFirst}</span> : null}
      </div>
      <div className="cv-test" role="status" aria-live="polite">
        {testing || test ? (
          <>
            <CheckRow name={c.settings.reading_imap} check={test?.imap ?? null} running={testing} />
            <CheckRow name={c.settings.sending_smtp} check={test?.smtp ?? null} running={testing} />
            {test && !testing ? <span className="cv-note-hint">{c.settings.testedAt.replace('{time}', formatDateTime(test.at))}</span> : null}
          </>
        ) : null}
      </div>
    </FormSection>
  );
}
