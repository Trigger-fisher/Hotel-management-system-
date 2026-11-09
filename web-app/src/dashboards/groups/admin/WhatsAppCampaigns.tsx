'use client';

// Settings > WhatsApp > Campaigns (phase 6): send one approved message to the guests who agreed to hear from the hotel, a few at a time. Write a campaign, see how many guests it reaches, start it (the hotel
// admin), pause or cancel it. STOP, the guests' agreement and the daily limit are applied for every guest by the sender; this screen only shows how it goes. Nothing is sent from the demo.
import { useEffect, useState } from 'react';

import type { DashError, DashResult } from '@shared/dashboards/common';
import { formatDateTime } from '@shared/dashboards/format';

import { Alert, Button, EmptyState, Field, Modal, Skeleton, StatusChip, type ChipTone } from '@/dashboards/pallav/ui';

import { whatsappCampaignsApi, type CampaignInput, type CampaignStatus, type CampaignView } from './whatsappCampaignsApi';
import { whatsappTemplatesApi, type TemplateView } from './whatsappTemplatesApi';

const TONE: Record<CampaignStatus, ChipTone> = { draft: 'neutral', running: 'ok', paused: 'warn', done: 'ok', cancelled: 'neutral' };
const LABEL: Record<CampaignStatus, string> = { draft: 'Draft', running: 'Sending', paused: 'Paused', done: 'Finished', cancelled: 'Cancelled' };
const errorOf = (e: DashError): string => (e.details?.fields ? Object.values(e.details.fields).join(' ') || e.message : e.message);
const blanksOf = (body: string): number => new Set([...body.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)].map((m) => m[1])).size;
const EMPTY: CampaignInput = { name: '', templateId: '', audience: {}, variables: [] };

export function WhatsAppCampaigns() {
  const [items, setItems] = useState<CampaignView[] | null>(null);
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<{ id: string | null; input: CampaignInput } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [reach, setReach] = useState<number | null>(null);

  useEffect(() => {
    let on = true;
    void Promise.all([whatsappCampaignsApi.list(), whatsappTemplatesApi.list()]).then(([c, t]) => {
      if (!on) return;
      if (c.ok) setItems(c.data);
      else setNote({ tone: 'danger', text: errorOf(c.error) });
      if (t.ok) setTemplates(t.data.filter((x) => x.status === 'approved'));
    });
    return () => {
      on = false;
    };
  }, [attempt]);

  const days = form?.input.audience.stayedWithinDays;
  useEffect(() => {
    if (!form) return;
    let on = true;
    void whatsappCampaignsApi.audience(days ? { stayedWithinDays: days } : {}).then((r) => on && setReach(r.ok ? r.data.guests : null));
    return () => {
      on = false;
    };
  }, [form, days]);

  const act = async (key: string, run: () => Promise<DashResult<unknown>>, done: string): Promise<void> => {
    setBusy(key);
    const r = await run();
    setBusy(null);
    if (r.ok) {
      setNote({ tone: 'success', text: done });
      setAttempt((n) => n + 1);
    } else setNote({ tone: 'danger', text: errorOf(r.error) });
  };

  const chosen = templates.find((t) => t.id === form?.input.templateId);
  const blanks = chosen ? blanksOf(chosen.body) : 0;
  const save = async (): Promise<void> => {
    if (!form) return;
    setFormError(null);
    setBusy('save');
    const input: CampaignInput = { ...form.input, variables: Array.from({ length: blanks }, (_, i) => form.input.variables[i] ?? '') };
    const r = form.id ? await whatsappCampaignsApi.update(form.id, input) : await whatsappCampaignsApi.create(input);
    setBusy(null);
    if (!r.ok) return setFormError(errorOf(r.error));
    setForm(null);
    setNote({ tone: 'success', text: 'The campaign is saved as a draft. Start it when it is ready.' });
    setAttempt((n) => n + 1);
  };

  return (
    <div data-testid="wa-campaigns">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <Button size="sm" icon="megaphone" disabled={templates.length === 0} title={templates.length === 0 ? 'A campaign sends one of your approved messages. Get one approved first.' : undefined} onClick={() => { setFormError(null); setReach(null); setForm({ id: null, input: EMPTY }); }}>
          New campaign
        </Button>
        {templates.length === 0 ? <span className="fs-hint">A campaign sends one of your approved messages. Get one approved first.</span> : null}
      </div>
      {note ? (
        <Alert tone={note.tone} className="mb-2" action={<Button size="sm" variant="ghost" onClick={() => setNote(null)}>Dismiss</Button>}>
          {note.text}
        </Alert>
      ) : null}
      {!items ? (
        <Skeleton rows={2} />
      ) : items.length === 0 ? (
        <EmptyState icon="megaphone" title="No campaigns yet." text="A campaign sends one approved message to the guests who agreed to WhatsApp messages." />
      ) : (
        items.map((c) => {
          const done = c.sent + c.failed + c.skipped;
          const pct = c.recipientCount > 0 ? Math.round((done / c.recipientCount) * 100) : 0;
          return (
            <div key={c.id} className="cv-tpl-row">
              <div className="cv-tpl-row-main">
                <div className="cv-tpl-row-name">
                  {c.name} <span className="cv-note-hint">· {c.templateName ?? 'message removed'}{c.audience.stayedWithinDays ? ` · guests of the last ${c.audience.stayedWithinDays} days` : ' · every guest who agreed'}</span>
                </div>
                {c.status !== 'draft' ? (
                  <div className="cv-note-hint">
                    {c.sent} sent · {c.skipped} skipped · {c.failed} not delivered{c.waiting > 0 ? ` · ${c.waiting} waiting` : ''} · {pct}% of {c.recipientCount}
                    {c.startedAt ? ` · started ${formatDateTime(c.startedAt)}` : ''}
                  </div>
                ) : null}
                {c.statusReason ? <div className="cv-note-hint">{c.statusReason}</div> : null}
                <div className="d-flex flex-wrap gap-2 mt-1">
                  {c.can.edit ? <Button size="sm" variant="outline" icon="pencil" onClick={() => { setFormError(null); setForm({ id: c.id, input: { name: c.name, templateId: c.templateId, audience: c.audience, variables: c.variables } }); }}>Edit</Button> : null}
                  {c.can.start ? <Button size="sm" icon="send" busy={busy === `start-${c.id}`} onClick={() => void act(`start-${c.id}`, () => whatsappCampaignsApi.step(c.id, 'start'), 'The campaign is sending. It goes out a few guests at a time.')}>Start</Button> : null}
                  {c.can.pause ? <Button size="sm" variant="outline" icon="pause-circle" busy={busy === `pause-${c.id}`} onClick={() => void act(`pause-${c.id}`, () => whatsappCampaignsApi.step(c.id, 'pause'), 'The campaign is paused.')}>Pause</Button> : null}
                  {c.can.resume ? <Button size="sm" icon="play-circle" busy={busy === `resume-${c.id}`} onClick={() => void act(`resume-${c.id}`, () => whatsappCampaignsApi.step(c.id, 'resume'), 'The campaign is sending again.')}>Resume</Button> : null}
                  {c.can.cancel ? <Button size="sm" variant="danger" icon="x-circle" busy={busy === `cancel-${c.id}`} onClick={() => void act(`cancel-${c.id}`, () => whatsappCampaignsApi.step(c.id, 'cancel'), 'The campaign is cancelled. Guests it already reached keep their message.')}>Cancel</Button> : null}
                  {c.can.remove ? <Button size="sm" variant="danger" icon="trash" busy={busy === `remove-${c.id}`} onClick={() => void act(`remove-${c.id}`, () => whatsappCampaignsApi.remove(c.id), 'The campaign is removed.')}>Remove</Button> : null}
                </div>
              </div>
              <StatusChip tone={TONE[c.status]}>{LABEL[c.status]}</StatusChip>
            </div>
          );
        })
      )}

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.id ? 'Change the campaign' : 'New campaign'} size="lg" staticBackdrop onSubmit={() => void save()} footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button type="submit" busy={busy === 'save'}>Save as draft</Button></>}>
        {form ? (
          <div className="row g-2">
            {formError ? <Alert tone="danger" className="mb-2">{formError}</Alert> : null}
            <Field label="Name" col="col-md-6" required>
              <input className="form-control" value={form.input.name} maxLength={120} onChange={(e) => setForm({ ...form, input: { ...form.input, name: e.target.value } })} placeholder="Diwali offer" />
            </Field>
            <Field label="Message" col="col-md-6" required>
              <select className="form-select" value={form.input.templateId} onChange={(e) => setForm({ ...form, input: { ...form.input, templateId: e.target.value, variables: [] } })}>
                <option value="">Choose an approved message</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            {chosen ? <div className="col-12"><div className="cv-tpl-row-text" style={{ whiteSpace: 'pre-wrap' }}>{chosen.body}</div></div> : null}
            {Array.from({ length: blanks }, (_, i) => (
              <Field key={i} label={`Blank {{${i + 1}}}`} col="col-md-6" required>
                <input className="form-control" value={form.input.variables[i] ?? ''} maxLength={60} placeholder={i === 0 ? '{guest_name}' : ''} onChange={(e) => { const v = [...form.input.variables]; v[i] = e.target.value; setForm({ ...form, input: { ...form.input, variables: v } }); }} />
                {i === 0 ? <div className="fs-hint">Write {'{guest_name}'} to put each guest&rsquo;s first name.</div> : null}
              </Field>
            ))}
            <Field label="Who" col="col-md-6">
              <select className="form-select" value={days ?? ''} onChange={(e) => setForm({ ...form, input: { ...form.input, audience: e.target.value ? { stayedWithinDays: Number(e.target.value) } : {} } })}>
                <option value="">Every guest who agreed</option>
                <option value="30">Guests of the last 30 days</option>
                <option value="90">Guests of the last 90 days</option>
                <option value="365">Guests of the last year</option>
              </select>
            </Field>
            <div className="col-md-6 d-flex align-items-end"><div className="fs-hint">{reach === null ? '' : `${reach} guest${reach === 1 ? '' : 's'} would get it now. The list is fixed when you start.`}</div></div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
