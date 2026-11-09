'use client';

// The contact panel of a WhatsApp chat (decision 66): who the person is (their addresses and numbers), what the chat is linked to (a stay, a booking, a
// guest, a company; on the console an account or a hotel), the team's notes and the quick replies (one shared desk: no owner). The details follow A14: room and
// dates only with the matching Front Office right, the bill only with the Bills right (the server leaves out what may not be seen). "Link guest" offers the
// kinds the person may open. Without the right to change things the controls stay, disabled, with the reason.
import { Fragment, useState } from 'react';

import { conversationsCopy as c, CONV_NOTE_MAX, type ConversationsApi, type ConversationThread, type ConvLink, type ConvScope, type QuickReply } from '@shared/dashboards/conversations';
import { formatDate, formatDateTime, formatINR } from '@shared/dashboards/format';

import { errorText } from '@/components/ui';
import { Bi, Button, ChannelIcon, Dialog, IconButton, StatusChip, Textarea } from '@/dashboards/pallav/ui';

import { LinkGuestDialog } from './LinkGuestDialog';
import { QuickRepliesModal } from './QuickRepliesModal';
import { readOnlyText } from './ReplyBox';
import { userMayOpen } from '@shared/dashboards/features';
import { WhatsAppConsent } from './WhatsAppConsent';

const statusWords = (s: string) => {
  const t = s.replace(/_/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

function LinkCard({ link, canChange, onChange, onRemove, hint }: { link: ConvLink; canChange: boolean; onChange: () => void; onRemove: () => void; hint: string | null }) {
  const d = link.detail ?? {};
  const facts: [string, string][] = [];
  if (d.room) facts.push([c.contact.room, d.room]);
  if (d.checkIn || d.checkOut) facts.push([c.contact.dates, [d.checkIn ? formatDate(d.checkIn) : '', d.checkOut ? formatDate(d.checkOut) : ''].filter(Boolean).join(' to ')]);
  if (d.status) facts.push([c.contact.status, statusWords(d.status)]);
  if (d.billNo) facts.push([c.contact.bill, d.billTotal !== undefined ? `${d.billNo} · ${formatINR(d.billTotal)}` : d.billNo]);
  if (d.hotelName && link.kind !== 'hotel') facts.push([c.contact.linkKinds.hotel, d.hotelName]);
  return (
    <div className="cv-link">
      <div className="d-flex align-items-start gap-2">
        <div className="flex-grow-1 min-w-0">
          <div className="cv-link-kind">{c.contact.linkKinds[link.kind]}</div>
          <div className="cv-link-label">{link.label}</div>
        </div>
        <StatusChip tone={link.source === 'auto' ? 'ok' : 'neutral'}>{link.source === 'auto' ? c.contact.auto : c.contact.manual}</StatusChip>
      </div>
      {facts.length ? (
        <dl className="cv-facts">
          {facts.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      <div className="cv-link-actions">
        <Button size="sm" variant="outline" icon="arrow-repeat" disabled={!canChange} title={hint ?? undefined} onClick={onChange}>
          {c.contact.change}
        </Button>
        <Button size="sm" variant="danger" icon="x-lg" disabled={!canChange} title={hint ?? undefined} onClick={onRemove}>
          {c.contact.remove}
        </Button>
      </div>
    </div>
  );
}

export function ContactPanel({
  scope,
  thread,
  api,
  quickReplies,
  isAdmin,
  onThread,
  onQuickReplies,
}: {
  /** The platform hub links to accounts and hotels, and says so. */
  scope: ConvScope;
  thread: ConversationThread;
  api: Pick<ConversationsApi, 'addNote' | 'deleteNote' | 'deleteLink' | 'listLinkCandidates' | 'setLink' | 'addQuickReply' | 'updateQuickReply' | 'deleteQuickReply'>;
  quickReplies: QuickReply[];
  /** The Hotel Admin may remove anyone's note. */
  isAdmin: boolean;
  onThread: (t: ConversationThread) => void;
  onQuickReplies: (q: QuickReply[]) => void;
}) {
  const { access } = thread;
  const platform = scope === 'platform';
  const hint = readOnlyText(access.readOnlyReason);
  const canLink = access.canEdit && access.canLink.length > 0;
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState<ConvLink | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const addNote = async () => {
    if (!note.trim()) return setNoteError(c.errors.noteRequired);
    setBusy(true);
    setNoteError(null);
    const r = await api.addNote(thread.id, note.trim());
    setBusy(false);
    if (!r.ok) return setNoteError(errorText(r.error));
    setNote('');
    onThread({ ...thread, notes: [...thread.notes, r.data] });
  };

  const removeNote = async () => {
    if (!removing) return;
    setBusy(true);
    const r = await api.deleteNote(thread.id, removing);
    setBusy(false);
    if (r.ok) onThread({ ...thread, notes: thread.notes.filter((n) => n.id !== removing) });
    else setNoteError(errorText(r.error));
    setRemoving(null);
  };

  const unlink = async () => {
    setBusy(true);
    const r = await api.deleteLink(thread.id);
    setBusy(false);
    setUnlinking(null);
    if (r.ok) onThread(r.data);
    else setNoteError(errorText(r.error));
  };

  return (
    <div className="cv-panel">
      <section className="cv-panel-sec" aria-label={c.contact.title}>
        <h3>{c.contact.title}</h3>
        <div className="cv-panel-name">{thread.contact.name}</div>
        {thread.contact.handles.map((h) => (
          <div key={h} className="cv-panel-handle">
            <ChannelIcon channel={h.includes('@') ? 'email' : 'whatsapp'} />
            <span>{h}</span>
          </div>
        ))}
        {thread.contact.muted ? (
          <p className="cv-note-hint mt-2 mb-0">
            <Bi name="inbox" /> {c.actions.muteSender}
          </p>
        ) : null}
      </section>

      <section className="cv-panel-sec">
        <h3>{c.contact.linkTitle}</h3>
        {thread.links.length ? (
          thread.links.map((l) => <LinkCard key={`${l.kind}:${l.id}`} link={l} canChange={canLink} hint={hint} onChange={() => setLinking(true)} onRemove={() => setUnlinking(l)} />)
        ) : (
          <>
            <p className="cv-note-hint">{platform ? c.contact.noLinkPlatform : c.contact.noLink}</p>
            <Button size="sm" variant="outline" icon="person-plus" disabled={!canLink} title={hint ?? undefined} onClick={() => setLinking(true)}>
              {platform ? c.contact.linkPlatform : c.contact.linkGuest}
            </Button>
          </>
        )}
      </section>

      {!platform && userMayOpen('hotel.whatsapp') && thread.contact.handles.some((h) => !h.includes('@')) && thread.links.some((l) => l.kind === 'customer') ? (
        <WhatsAppConsent customerId={(thread.links.find((l) => l.kind === 'customer') as ConvLink).id} canEdit={access.canEdit} hint={hint} />
      ) : null}

      <section className="cv-panel-sec">
        <h3>{c.notes.title}</h3>
        <div className="cv-notes">
          {thread.notes.length === 0 ? <p className="cv-note-hint mb-0">{c.notes.empty}</p> : null}
          {thread.notes.map((n) => (
            <div key={n.id} className="cv-note">
              <div className="cv-note-text">{n.text}</div>
              <div className="cv-note-by">
                <span>
                  {n.author.name} · <time dateTime={n.at}>{formatDateTime(n.at)}</time>
                </span>
                {(n.mine || isAdmin) && access.canEdit ? <IconButton icon="trash" tone="danger" label={c.notes.remove} onClick={() => setRemoving(n.id)} /> : null}
              </div>
            </div>
          ))}
          {hint ? <p className="cv-note-hint mb-0">{hint}</p> : null}
          <Textarea rows={2} aria-label={c.notes.placeholder} placeholder={c.notes.placeholder} value={note} maxLength={CONV_NOTE_MAX} disabled={!access.canEdit} invalid={Boolean(noteError)} onChange={(e) => setNote(e.target.value)} />
          {noteError ? <div className="field-error">{noteError}</div> : null}
          <div className="d-flex align-items-center gap-2">
            <span className="cv-note-hint flex-grow-1">
              <Bi name="lock" /> {c.notes.hint}
            </span>
            <Button size="sm" variant="outline" icon="sticky" busy={busy && removing === null} disabled={!access.canEdit} onClick={() => void addNote()}>
              {c.notes.add}
            </Button>
          </div>
        </div>
      </section>

      <section className="cv-panel-sec">
        <h3>{c.quick.title}</h3>
        <Button size="sm" variant="ghost" icon="lightning" onClick={() => setQuickOpen(true)}>
          {c.quick.manage}
        </Button>
      </section>

      {linking ? <LinkGuestDialog open platform={platform} thread={thread} api={api} onClose={() => setLinking(false)} onLinked={onThread} /> : null}
      {quickOpen ? (
        <QuickRepliesModal open items={quickReplies} canEdit={access.canEdit} readOnlyText={hint} api={api} onClose={() => setQuickOpen(false)} onChanged={onQuickReplies} />
      ) : null}
      <Dialog
        open={unlinking !== null}
        tone="danger"
        title={c.contact.remove}
        message={unlinking ? c.contact.removeConfirm.replace('{label}', unlinking.label) : ''}
        confirmLabel={c.contact.remove}
        busy={busy}
        onConfirm={() => void unlink()}
        onCancel={() => setUnlinking(null)}
      />
      <Dialog
        open={removing !== null}
        tone="danger"
        title={c.notes.remove}
        message={c.notes.removeConfirm}
        confirmLabel={c.notes.remove}
        busy={busy}
        onConfirm={() => void removeNote()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
