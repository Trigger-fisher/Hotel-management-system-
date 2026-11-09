'use client';

// The team's quick replies (decision 66): short texts staff insert into a reply, for email, WhatsApp or both. Anyone with Conversations Edit may add, change
// and remove them; everyone else reads them. Each title is used once (in any case).
import { useState } from 'react';

import { conversationsCopy as c, CONV_QUICK_BODY_MAX, CONV_QUICK_TITLE_MAX, type ConversationsApi, type QuickReply, type QuickReplyInput } from '@shared/dashboards/conversations';
import { dashLabels } from '@shared/dashboards/common';
import { STARTER_LANGUAGES, STARTER_LANGUAGE_NAMES, missingQuickReplies, type StarterLanguage } from '@shared/dashboards/whatsappStarters';

import { errorText, fieldErrors } from '@/components/ui';
import { Alert, Button, Dialog, EmptyState, Field, IconButton, Modal, Select, Textarea } from '@/dashboards/pallav/ui';

type Draft = { id: string | null; title: string; body: string; channel: QuickReply['channel'] };
const EMPTY: Draft = { id: null, title: '', body: '', channel: 'any' };
const READY = {
  open: 'Add ready-made replies',
  language: 'Language',
  none: 'Your team already has every ready-made reply in this language.',
  hint: 'Change the times and the ways to pay to your own after adding them.',
  add: (n: number) => (n === 1 ? 'Add 1 reply' : `Add ${n} replies`),
};

export function QuickRepliesModal({
  open,
  items,
  canEdit,
  readOnlyText,
  api,
  onClose,
  onChanged,
}: {
  open: boolean;
  items: QuickReply[];
  canEdit: boolean;
  readOnlyText: string | null;
  api: Pick<ConversationsApi, 'addQuickReply' | 'updateQuickReply' | 'deleteQuickReply'>;
  onClose: () => void;
  onChanged: (items: QuickReply[]) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<QuickReply | null>(null);
  const [readyLang, setReadyLang] = useState<StarterLanguage | null>(null);
  const ready = readyLang ? missingQuickReplies(readyLang, items) : [];

  const addReady = async () => {
    if (!readyLang || ready.length === 0) return;
    setBusy(true);
    setError(null);
    const added: QuickReply[] = [];
    for (const q of ready) {
      const r = await api.addQuickReply({ title: q.title, body: q.body, channel: 'any' });
      if (!r.ok) {
        setError(errorText(r.error));
        break;
      }
      added.push(r.data);
    }
    setBusy(false);
    if (added.length > 0) onChanged([...items, ...added]);
    setReadyLang(null);
  };

  const save = async () => {
    if (!draft) return;
    const f: Record<string, string> = {};
    if (!draft.title.trim()) f.title = c.errors.quickTitle;
    if (!draft.body.trim()) f.body = c.errors.quickBody;
    setFields(f);
    if (Object.keys(f).length) return;
    setBusy(true);
    setError(null);
    const input: QuickReplyInput = { title: draft.title.trim(), body: draft.body.trim(), channel: draft.channel };
    const r = draft.id ? await api.updateQuickReply(draft.id, input) : await api.addQuickReply(input);
    setBusy(false);
    if (!r.ok) {
      setFields(fieldErrors(r.error));
      setError(errorText(r.error));
      return;
    }
    onChanged(draft.id ? items.map((q) => (q.id === r.data.id ? r.data : q)) : [...items, r.data]);
    setDraft(null);
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const r = await api.deleteQuickReply(removing.id);
    setBusy(false);
    if (r.ok) onChanged(items.filter((q) => q.id !== removing.id));
    else setError(errorText(r.error));
    setRemoving(null);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={c.quick.title}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {dashLabels.close}
          </Button>
          {!draft && !readyLang ? (
            <Button variant="outline" icon="lightning" disabled={!canEdit} onClick={() => setReadyLang('en')}>
              {READY.open}
            </Button>
          ) : null}
          {!draft ? (
            <Button icon="plus" disabled={!canEdit} onClick={() => { setReadyLang(null); setDraft(EMPTY); }}>
              {c.quick.add}
            </Button>
          ) : null}
        </>
      }
    >
      {readOnlyText ? <Alert tone="neutral">{readOnlyText}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {readyLang && !draft ? (
        <div className="row g-2 mb-3">
          <Field label={READY.language} col="col-sm-6">
            <Select value={readyLang} onChange={(e) => setReadyLang(e.target.value as StarterLanguage)}>
              {STARTER_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {STARTER_LANGUAGE_NAMES[l]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="col-12">
            {ready.length === 0 ? (
              <div className="cv-reply-hint">{READY.none}</div>
            ) : (
              <div className="cv-quick-list">
                {ready.map((q) => (
                  <div key={q.title} className="cv-quick">
                    <div className="cv-quick-head">
                      <span className="cv-quick-title">{q.title}</span>
                    </div>
                    <div className="cv-quick-body">{q.body}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="cv-reply-hint mt-1">{READY.hint}</div>
          </div>
          <div className="col-12 d-flex gap-2 justify-content-end">
            <Button variant="ghost" onClick={() => setReadyLang(null)}>
              {dashLabels.cancel}
            </Button>
            <Button busy={busy} busyLabel={dashLabels.saving} disabled={ready.length === 0} onClick={() => void addReady()}>
              {READY.add(ready.length)}
            </Button>
          </div>
        </div>
      ) : null}
      {draft ? (
        <div className="row g-2 mb-3">
          <Field label={c.quick.titleLabel} col="col-sm-8" required error={fields.title}>
            <input className="form-control" value={draft.title} maxLength={CONV_QUICK_TITLE_MAX} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label={c.quick.channelLabel} col="col-sm-4">
            <Select value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value as QuickReply['channel'] })}>
              <option value="any">{c.quick.channelAny}</option>
              <option value="email">{c.channels.email}</option>
              <option value="whatsapp">{c.channels.whatsapp}</option>
            </Select>
          </Field>
          <Field label={c.quick.bodyLabel} col="col-12" required error={fields.body}>
            <Textarea rows={4} value={draft.body} maxLength={CONV_QUICK_BODY_MAX} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </Field>
          <div className="col-12 d-flex gap-2 justify-content-end">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {dashLabels.cancel}
            </Button>
            <Button busy={busy} busyLabel={dashLabels.saving} onClick={() => void save()}>
              {c.quick.save}
            </Button>
          </div>
        </div>
      ) : null}
      {items.length === 0 ? (
        <EmptyState icon="lightning" title={c.quick.empty} />
      ) : (
        <div className="cv-quick-list">
          {items.map((q) => (
            <div key={q.id} className="cv-quick">
              <div className="cv-quick-head">
                <span className="cv-quick-title">{q.title}</span>
                <span className="cv-reply-hint">{q.channel === 'any' ? c.quick.channelAny : c.channels[q.channel]}</span>
                <IconButton icon="pencil" label={`${c.quick.edit} ${q.title}`} disabled={!canEdit} onClick={() => setDraft({ id: q.id, title: q.title, body: q.body, channel: q.channel })} />
                <IconButton icon="trash" tone="danger" label={`${c.quick.remove} ${q.title}`} disabled={!canEdit} onClick={() => setRemoving(q)} />
              </div>
              <div className="cv-quick-body">{q.body}</div>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={removing !== null}
        tone="danger"
        title={c.quick.remove}
        message={removing ? c.quick.removeConfirm.replace('{title}', removing.title) : ''}
        confirmLabel={c.quick.remove}
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </Modal>
  );
}
