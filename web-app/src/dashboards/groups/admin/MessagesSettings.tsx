'use client';

// Hotel settings > Messages (MJ, 5 Nov 2026; design: docs/design/preview/whatsapp-preview.html, "Hotel Admin > Settings > WhatsApp"): the automatic messages set once by the
// Hotel Admin, with quiet hours, the fallback to email, the reminder stop, consent and a test send. Staff never see these switches; a thread only shows "Sent automatically".
// The on/off of the rows the server already keeps goes through Settings > WhatsApp's call; the rest lives in the ui-shared store until the server carries it (messagesApi.ts).
import { useEffect, useState } from 'react';

import type { HmsUser } from '@shared/auth-pallav/types';
import { adminCopy } from '@shared/dashboards/admin';
import type { DashError, DashResult } from '@shared/dashboards/common';
import { formatDateTime } from '@shared/dashboards/format';
import {
  MESSAGES_CHANNELS,
  MESSAGES_LANGUAGES,
  MESSAGES_SERVER_KEY,
  messagesSettingsCopy as c,
  whatsappCopy,
  type MessagesAutomaticRow,
  type MessagesSettings as Settings,
  type WhatsAppSettings,
} from '@shared/dashboards/whatsapp';

import { errorText, useSubmit, useToast } from '@/components/ui';
import { Alert, Bi, Button, ConflictNote, EmptyState, FieldError, FieldHint, LoadError, Select, Skeleton, StatusChip, Table } from '@/dashboards/pallav/ui';
import { apiMode } from '@/lib/api/mode';

import { conversationsApi } from '../conversations/api';
import { messagesApi, setMessagesActor } from './messagesApi';


type Wa = Pick<WhatsAppSettings, 'connected' | 'templates' | 'automatic'>;
type Loaded = { attempt: number; settings: Settings | null; wa: Wa; error: DashError | null };

const NOT_CONNECTED: Wa = { connected: false, templates: [], automatic: [] };
const same = (a: Settings, b: Settings): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The rows the server keeps take their on/off from Settings > WhatsApp, so both tabs show the same switch. */
function withServerSwitches(settings: Settings, wa: Wa): Settings {
  if (!wa.connected) return settings;
  return {
    ...settings,
    automatic: settings.automatic.map((r) => {
      const key = MESSAGES_SERVER_KEY[r.key];
      const kept = key ? wa.automatic.find((a) => a.key === key) : undefined;
      return kept ? { ...r, on: kept.on } : r;
    }),
  };
}

export function MessagesSettings({ user }: { user: HmsUser }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The hotel's own Hotel Admin only (MJ): not a hotel user, and not a Super Admin, Platform Admin or Group Hotel Admin visiting the hotel.
  const admin = user.role === 'hotel_admin';

  useEffect(() => {
    setMessagesActor(user.displayName);
  }, [user.displayName]);

  useEffect(() => {
    if (!admin) return;
    let live = true;
    void Promise.all([messagesApi.getMessagesSettings(), conversationsApi.getWhatsAppSettings()]).then(([m, w]) => {
      if (!live) return;
      // WhatsApp not connected (409) or no right to it (403): the tab still works, rows set to WhatsApp just have no templates to pick from.
      const wa: Wa = w.ok && w.data.connected ? w.data : NOT_CONNECTED;
      setLoaded({ attempt, settings: m.ok ? m.data : null, wa, error: m.ok ? null : m.error });
    });
    return () => {
      live = false;
    };
  }, [attempt, admin]);

  if (!admin) return <EmptyState icon="lock" title={adminCopy.common.adminOnly.title} text={adminCopy.common.adminOnly.body} />;
  if (!loaded || loaded.attempt !== attempt) {
    return (
      <div className="st-card ms-body">
        <Skeleton rows={3} />
      </div>
    );
  }
  if (loaded.error || !loaded.settings) return <LoadError error={loaded.error ?? { code: 'SERVER_ERROR', message: 'SERVER_ERROR', traceId: 'client' }} onRetry={() => setAttempt((n) => n + 1)} />;
  return <MessagesForm key={`${attempt}-${loaded.settings.version}`} settings={loaded.settings} wa={loaded.wa} onSaved={() => setAttempt((n) => n + 1)} />;
}

function MessagesForm({ settings, wa, onSaved }: { settings: Settings; wa: Wa; onSaved: () => void }) {
  const toast = useToast();
  const { busy, errors, conflict, submit } = useSubmit(['quietFrom', 'quietTo', 'testPhone', 'automatic']);
  const [start] = useState(() => withServerSwitches(settings, wa));
  const [v, setV] = useState(start);
  const [testing, setTesting] = useState(false);
  const dirty = !same(v, start);
  const live = apiMode() === 'real';

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setV((p) => ({ ...p, [key]: value }));
  const setRow = (key: MessagesAutomaticRow['key'], patch: Partial<MessagesAutomaticRow>) => setV((p) => ({ ...p, automatic: p.automatic.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));

  const save = () =>
    void submit(
      async (): Promise<DashResult<{ settings: Settings; message: string }>> => {
        // the switches the server keeps go first, each only when it changed
        if (wa.connected) {
          for (const r of v.automatic) {
            const key = MESSAGES_SERVER_KEY[r.key];
            const before = key ? wa.automatic.find((a) => a.key === key)?.on : undefined;
            if (key && before !== undefined && before !== r.on) {
              const res = await conversationsApi.setWhatsAppAutomatic(key, r.on);
              if (!res.ok) return res;
            }
          }
        }
        return messagesApi.saveMessagesSettings({ version: v.version, automatic: v.automatic, quietFrom: v.quietFrom, quietTo: v.quietTo, fallbackEmail: v.fallbackEmail, stopWhenPaid: v.stopWhenPaid, consentOnly: v.consentOnly, testPhone: v.testPhone });
      },
      (d) => {
        toast.show({ tone: 'success', text: d.message });
        onSaved();
      },
    );

  const testSend = async () => {
    setTesting(true);
    const r = await messagesApi.testSendMessage(v.testPhone.trim());
    setTesting(false);
    toast.show(r.ok ? { tone: 'success', text: r.data.message } : { tone: 'error', text: errorText(r.error) });
  };

  const templateName = (id: string) => wa.templates.find((t) => t.id === id)?.name.replace(/_/g, ' ') ?? id;

  return (
    <form
      className="st-card"
      autoComplete="off"
      noValidate
      data-testid="ms-settings"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="st-head">
        <div className="st-icon">
          <Bi name="chat-left-text" />
        </div>
        <div>
          <h2 className="st-title">{c.title}</h2>
          <p className="st-about">{c.about}</p>
        </div>
      </div>

      <div className="ms-body">
        {live ? <Alert tone="info">{c.noServer}</Alert> : null}
        {!wa.connected ? <Alert tone="neutral">{c.notConnected}</Alert> : null}
        {errors.automatic ? <Alert tone="danger">{errors.automatic}</Alert> : null}

        <Table className="ms-table">
          <thead>
            <tr>
              <th scope="col">{c.columns.message}</th>
              <th scope="col">{c.columns.on}</th>
              <th scope="col">{c.columns.channel}</th>
              <th scope="col">{c.columns.language}</th>
              <th scope="col">{c.columns.template}</th>
            </tr>
          </thead>
          <tbody>
            {v.automatic.map((r) => {
              const id = `ms-${r.key}`;
              const name = c.names[r.key];
              const picked = r.templateId ? wa.templates.find((t) => t.id === r.templateId) : undefined;
              return (
                <tr key={r.key}>
                  <td>
                    <div className="ms-name">
                      <strong>{name}</strong>
                      <small>{c.when[r.key]}</small>
                    </div>
                  </td>
                  <td>
                    <label className="st-toggle ms-toggle" htmlFor={`${id}-on`}>
                      <input type="checkbox" id={`${id}-on`} checked={r.on} disabled={busy} onChange={(e) => setRow(r.key, { on: e.target.checked })} />
                      <span className="st-switch" aria-hidden="true" />
                      <span className="visually-hidden">{c.onLabel(name)}</span>
                    </label>
                  </td>
                  <td>
                    <span className="ms-cell-label" aria-hidden="true">{c.columns.channel}</span>
                    <Select id={`${id}-channel`} className="form-select-sm" aria-label={`${name}: ${c.columns.channel}`} value={r.channel} disabled={busy} onChange={(e) => setRow(r.key, { channel: e.target.value as MessagesAutomaticRow['channel'] })}>
                      {MESSAGES_CHANNELS.map((ch) => (
                        <option key={ch} value={ch}>{c.channel[ch]}</option>
                      ))}
                    </Select>
                  </td>
                  <td>
                    <span className="ms-cell-label" aria-hidden="true">{c.columns.language}</span>
                    <Select id={`${id}-language`} className="form-select-sm" aria-label={`${name}: ${c.columns.language}`} value={r.language} disabled={busy} onChange={(e) => setRow(r.key, { language: e.target.value as MessagesAutomaticRow['language'] })}>
                      {MESSAGES_LANGUAGES.map((l) => (
                        <option key={l} value={l}>{c.language[l]}</option>
                      ))}
                    </Select>
                  </td>
                  <td>
                    <span className="ms-cell-label" aria-hidden="true">{c.columns.template}</span>
                    {r.channel === 'email' ? (
                      <span className="ms-none">{c.template.emailOnly}</span>
                    ) : (
                      <div className="ms-template">
                        <Select id={`${id}-template`} className="form-select-sm" aria-label={`${name}: ${c.columns.template}`} value={r.templateId ?? ''} disabled={busy} onChange={(e) => setRow(r.key, { templateId: e.target.value || null })}>
                          <option value="">{c.template.none}</option>
                          {wa.templates.map((t) => (
                            <option key={t.id} value={t.id}>{templateName(t.id)}</option>
                          ))}
                          {r.templateId && !picked ? <option value={r.templateId}>{r.templateId}</option> : null}
                        </Select>
                        {picked && picked.status !== 'approved' ? <StatusChip tone={picked.status === 'pending' ? 'warn' : 'danger'}>{whatsappCopy.template.status[picked.status]}</StatusChip> : null}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>

        <div className="st-grid ms-grid">
          <div className="st-field">
            <label className="form-label" htmlFor="ms-quiet-from">{c.quiet.label}</label>
            <div className="ms-inrow">
              <input id="ms-quiet-from" type="time" className={`form-control${errors.quietFrom ? ' is-invalid' : ''}`} aria-label={c.quiet.from} value={v.quietFrom} disabled={busy} onChange={(e) => set('quietFrom', e.target.value)} />
              <span className="ms-to">{c.quiet.to}</span>
              <input id="ms-quiet-to" type="time" className={`form-control${errors.quietTo ? ' is-invalid' : ''}`} aria-label={c.quiet.until} value={v.quietTo} disabled={busy} onChange={(e) => set('quietTo', e.target.value)} />
            </div>
            <FieldHint>{c.quiet.help}</FieldHint>
            {errors.quietFrom ? <FieldError>{errors.quietFrom}</FieldError> : null}
            {errors.quietTo ? <FieldError>{errors.quietTo}</FieldError> : null}
          </div>

          <div className="st-field">
            <label className="st-toggle" htmlFor="ms-fallback">
              <input type="checkbox" id="ms-fallback" checked={v.fallbackEmail} disabled={busy} onChange={(e) => set('fallbackEmail', e.target.checked)} />
              <span className="st-switch" aria-hidden="true" />
              <span className="st-toggle-text">
                <strong>{c.fallback.label}</strong>
                <small>{c.fallback.text}</small>
              </span>
            </label>
            <FieldHint>{c.fallback.help}</FieldHint>
          </div>

          <div className="st-field">
            <label className="st-toggle" htmlFor="ms-stop-paid">
              <input type="checkbox" id="ms-stop-paid" checked={v.stopWhenPaid} disabled={busy} onChange={(e) => set('stopWhenPaid', e.target.checked)} />
              <span className="st-switch" aria-hidden="true" />
              <span className="st-toggle-text">
                <strong>{c.stopWhenPaid.label}</strong>
                <small>{c.stopWhenPaid.text}</small>
              </span>
            </label>
            <FieldHint>{c.stopWhenPaid.help}</FieldHint>
          </div>

          <div className="st-field">
            <label className="st-toggle" htmlFor="ms-consent">
              <input type="checkbox" id="ms-consent" checked={v.consentOnly} disabled={busy} onChange={(e) => set('consentOnly', e.target.checked)} />
              <span className="st-switch" aria-hidden="true" />
              <span className="st-toggle-text">
                <strong>{c.consentOnly.label}</strong>
                <small>{c.consentOnly.text}</small>
              </span>
            </label>
            <FieldHint>{c.consentOnly.help}</FieldHint>
          </div>

          <div className="st-field wide">
            <label className="form-label" htmlFor="ms-test-phone">{c.test.label}</label>
            <div className="ms-inrow">
              <input id="ms-test-phone" type="tel" inputMode="tel" className={`form-control ms-phone${errors.testPhone ? ' is-invalid' : ''}`} placeholder={c.test.placeholder} maxLength={20} value={v.testPhone} disabled={busy} onChange={(e) => set('testPhone', e.target.value)} />
              <Button variant="outline" size="sm" icon="send" busy={testing} disabled={busy || v.testPhone.trim() === ''} onClick={() => void testSend()}>
                {c.test.button}
              </Button>
            </div>
            <FieldHint>{c.test.help}</FieldHint>
            {errors.testPhone ? <FieldError>{errors.testPhone}</FieldError> : null}
          </div>
        </div>
      </div>

      {conflict ? (
        <div className="ms-conflict">
          <ConflictNote onReload={onSaved} />
        </div>
      ) : null}

      <div className="st-foot">
        <span className="text-muted small me-auto">{v.savedAt ? c.lastSaved(v.savedBy ?? '', formatDateTime(v.savedAt)) : c.neverSaved}</span>
        <Button type="submit" icon="check2" busy={busy} disabled={!dirty && !conflict}>
          {c.save}
        </Button>
      </div>
    </form>
  );
}
