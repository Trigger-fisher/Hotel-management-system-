'use client';

// The reply box under a thread (decision 66). Email: the reply goes to the sender's address (From, A12): an email that asks for replies elsewhere (Reply-To)
// shows that address in a note, to be chosen on purpose. Cc, the subject ("Re: ..." already filled), quick replies, and "Attach bill" only when the person may
// open bills, the conversation is linked and the reply goes to the guest's own address. WhatsApp (the design, live only once connected): free text while
// the 24-hour window is open; once it closed, an approved message, and a draft typed before it closed is kept. Ctrl+Enter (Cmd+Enter) sends; Enter is a new line.
// Without the right to reply (view only, or a Group Hotel Admin's visit) the box stays on screen, disabled, with the reason.
import { useState, type ChangeEvent, type KeyboardEvent } from 'react';

import { channelPageCopy as cp, conversationsCopy as c, CONV_CC_MAX, CONV_REPLY_MAX, mailboxPageCopy as mb, type ConvChannel, type ConvMessage, type ConversationsApi, type ConversationThread, type QuickReply } from '@shared/dashboards/conversations';
import { formatDate } from '@shared/dashboards/format';
import { whatsappCopy as w, type WhatsAppMessage, type WhatsAppTemplate } from '@shared/dashboards/whatsapp';

import { errorText, fieldErrors } from '@/components/ui';
import { Alert, Bi, Button, Dropdown, IconButton, Select, Skeleton, Textarea, TextAction } from '@/dashboards/pallav/ui';

import { CcChipsInput } from './AddressChips';
import { replyAllRecipients, threadParticipants } from './emailThread';
import { TemplatePicker, type TemplateDefaults } from './TemplatePicker';

import { tr } from '@/lib/i18n/language';
/** The emoji the picker offers (a small set, as WhatsApp's recent row). */
const EMOJI = ['😀', '😊', '🙏', '👍', '👌', '🎉', '❤️', '😂', '😍', '🙌', '✅', '⭐', '🏨', '🛏️', '🍽️', '🚗', '📍', '📞', '🕐', '🌅', '🌸', '💐', '🎂', '👋'];

const reSubject = (s: string) => (!s.trim() ? '' : /^re:/i.test(s.trim()) ? s.trim() : `${c.reply.re} ${s.trim()}`);

export function readOnlyText(reason: ConversationThread['access']['readOnlyReason']): string | null {
  return reason === 'visit' ? c.readOnly.visit : reason === 'view_only' ? c.readOnly.viewOnly : null;
}

export function ReplyBox({
  thread,
  api,
  hotelName,
  templates,
  quickReplies,
  replyToMsg,
  onClearReplyTo,
  onSent,
  compact = false,
  replyAll = false,
  waTools = false,
  fromAddress = null,
}: {
  thread: ConversationThread;
  api: Pick<ConversationsApi, 'sendReply'>;
  hotelName: string;
  /** The approved WhatsApp messages (null while they load). */
  templates: WhatsAppTemplate[] | null;
  quickReplies: QuickReply[];
  /** A WhatsApp message being answered (its reply context). */
  replyToMsg: WhatsAppMessage | null;
  onClearReplyTo: () => void;
  onSent: (m: ConvMessage) => void;
  /** A phone: the box starts folded to one "Write a reply" line and Send, so the message above stays readable; touching the line opens the rest. */
  compact?: boolean;
  /** Email page: start with everyone on the newest email in Cc (Gmail's Reply all). */
  replyAll?: boolean;
  /** WhatsApp page: the emoji picker and the attach menu beside the box. */
  waTools?: boolean;
  /** Email: the address the reply leaves from ("Will go from ..."), shown in place of the shortcut hint. */
  fromAddress?: string | null;
}) {
  const { access } = thread;
  const usable = thread.replyChannels.filter((r) => r.available);
  const [channel, setChannel] = useState<ConvChannel>(() => (usable.some((r) => r.channel === thread.defaultChannel) ? thread.defaultChannel : (usable[0]?.channel ?? thread.defaultChannel)));
  const [text, setText] = useState('');
  const [typedWhileOpen, setTypedWhileOpen] = useState(false);
  const lastEmail = [...thread.messages].reverse().find((m) => m.kind === 'email');
  // Reply all: the others on the newest email (its Cc and any To after the first, which is the mailbox itself); a plain Reply starts with no one in Cc
  const everyoneFor = () => replyAllRecipients(lastEmail?.kind === 'email' ? lastEmail : undefined, thread.replyTo?.address ?? null, thread.messages);
  const [mode, setMode] = useState<'reply' | 'all'>(replyAll ? 'all' : 'reply');
  const [cc, setCc] = useState<string[]>(() => (replyAll ? everyoneFor() : []));
  const [showCc, setShowCc] = useState(cc.length > 0);
  const people = threadParticipants(thread.messages, thread.contact.handles);
  const chooseMode = (next: 'reply' | 'all') => {
    setMode(next);
    const list = next === 'all' ? everyoneFor() : [];
    setCc(list);
    setFields({});
    if (list.length > 0) setShowCc(true);
  };
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pick, setPick] = useState<'location' | 'contact' | null>(null);
  const [pickA, setPickA] = useState('');
  const [pickB, setPickB] = useState('');
  const [subject, setSubject] = useState(() => reSubject(lastEmail?.kind === 'email' ? lastEmail.subject : ''));
  const [toReplyTo, setToReplyTo] = useState(false);
  const [bill, setBill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [unfolded, setUnfolded] = useState(false);

  const readOnly = readOnlyText(access.readOnlyReason);
  const disabled = !access.canEdit;
  const chosen = thread.replyChannels.find((r) => r.channel === channel);
  const target = thread.replyTo ? (toReplyTo && thread.replyTo.differsFrom ? thread.replyTo.differsFrom : thread.replyTo.address) : null;
  const handles = thread.contact.handles.map((h) => h.toLowerCase());
  const billLink = thread.links.find((l) => l.detail?.billId);
  const billAllowed = access.canSeeBills && thread.links.length > 0 && Boolean(billLink?.detail?.billId) && target !== null && handles.includes(target.toLowerCase());
  const windowOpen = thread.window?.open ?? false;
  const waTemplateMode = channel === 'whatsapp' && !windowOpen;
  // folded only while there is nothing else to see: no error, no WhatsApp message being answered, and a free-text reply possible (never the template picker); a draft
  // stays in the one line
  const folded = compact && !unfolded && !error && Object.keys(fields).length === 0 && !replyToMsg && Boolean(chosen?.available) && !waTemplateMode && (channel === 'email' || templates !== null);

  const done = (m: ConvMessage) => {
    setUnfolded(false);
    setText('');
    setCc([]);
    setShowCc(false);
    setMode('reply');
    setBill(false);
    setTypedWhileOpen(false);
    setFields({});
    setError(null);
    onSent(m);
  };

  const send = async () => {
    if (disabled || busy) return;
    setError(null);
    setFields({});
    if (channel === 'email') {
      if (!text.trim()) return setFields({ text: c.errors.textRequired });
      const list = cc;
      if (list.length > CONV_CC_MAX) return setFields({ cc: c.errors.ccMany });
      setBusy(true);
      const res = await api.sendReply(thread.id, {
        channel: 'email',
        text,
        ...(lastEmail ? { inReplyTo: lastEmail.id } : {}),
        ...(toReplyTo && thread.replyTo?.differsFrom ? { to: thread.replyTo.differsFrom } : {}),
        ...(list.length ? { cc: list } : {}),
        ...(subject.trim() ? { subject: subject.trim() } : {}),
        ...(bill && billAllowed && billLink?.detail?.billId ? { billId: billLink.detail.billId } : {}),
      });
      setBusy(false);
      if (res.ok) done(res.data);
      else {
        setFields(fieldErrors(res.error));
        setError(errorText(res.error));
      }
      return;
    }
    if (!text.trim()) return setFields({ text: c.errors.textRequired });
    setBusy(true);
    const res = await api.sendReply(thread.id, { channel: 'whatsapp', text: text.trim(), ...(replyToMsg ? { replyToId: replyToMsg.id } : {}) });
    setBusy(false);
    if (res.ok) {
      onClearReplyTo();
      done(res.data);
    } else setError(errorText(res.error));
  };

  const sendTemplate = async (templateId: string, variables: string[]) => {
    setBusy(true);
    setError(null);
    const res = await api.sendReply(thread.id, { channel: 'whatsapp', templateId, variables });
    setBusy(false);
    if (res.ok) done(res.data);
    else setError(errorText(res.error));
  };

  // the attach menu of the WhatsApp page: a photo or video, a document, a voice message, a location or a contact card go out at once (the demo keeps the name only)
  const sendAttachment = async (attachment: NonNullable<Extract<Parameters<ConversationsApi['sendReply']>[1], { channel: 'whatsapp' }>['attachment']>) => {
    if (disabled || busy) return;
    setBusy(true);
    setError(null);
    const res = await api.sendReply(thread.id, { channel: 'whatsapp', ...(text.trim() ? { text: text.trim() } : {}), attachment });
    setBusy(false);
    if (res.ok) {
      setPick(null);
      setPickA('');
      setPickB('');
      done(res.data);
    } else setError(errorText(res.error));
  };
  const onFile = (type: 'image' | 'video' | 'document') => (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void sendAttachment({ type: type === 'image' && f.type.startsWith('video') ? 'video' : type, name: f.name, size: f.size, mime: f.type || undefined });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  };

  const link = thread.links[0];
  const defaults: TemplateDefaults = {
    hotel_name: hotelName,
    ...(link && thread.contact.name && !/^\+?[0-9 ]+$/.test(thread.contact.name) ? { guest_name: thread.contact.name } : {}),
    ...(link?.detail?.room ? { room: link.detail.room } : {}),
    ...(link?.detail?.checkIn ? { check_in: formatDate(link.detail.checkIn) } : {}),
    ...(link?.detail?.checkOut ? { check_out: formatDate(link.detail.checkOut) } : {}),
  };

  const quick = quickReplies.filter((q) => q.channel === 'any' || q.channel === channel);

  return (
    <section className={`cv-reply${folded ? ' is-folded' : ''}`} aria-label={c.reply.placeholder} onFocus={compact ? (e) => { if (e.target instanceof HTMLTextAreaElement) setUnfolded(true); } : undefined}>
      {readOnly ? (
        <p className="cv-readonly">
          <Bi name="lock" /> {readOnly}
        </p>
      ) : null}
      {compact && !folded && unfolded && !error ? (
        <div className="cv-reply-fold">
          <IconButton icon="chevron-down" label={c.reply.fold} onClick={() => setUnfolded(false)} />
        </div>
      ) : null}

      <div className="cv-reply-row">
        <label className="cv-reply-label" htmlFor={`rc-${thread.id}`}>
          {c.reply.channel}
        </label>
        <Select id={`rc-${thread.id}`} className="form-select-sm w-auto" value={channel} disabled={disabled} onChange={(e) => setChannel(e.target.value as ConvChannel)}>
          {thread.replyChannels.map((r) => (
            <option key={r.channel} value={r.channel} disabled={!r.available}>
              {c.channels[r.channel]}
              {!r.available ? ` (${r.channel === 'whatsapp' ? c.reply.comingSoon : (r.reason ?? c.reply.emailNotAvailable)})` : ''}
            </option>
          ))}
        </Select>
        {channel === 'email' && target ? (
          <span className="cv-reply-to">
            <span className="cv-reply-label me-1">{c.reply.to}</span>
            {target}
          </span>
        ) : null}
      </div>

      {chosen && !chosen.available ? (
        <Alert tone="neutral">{chosen.channel === 'whatsapp' ? w.notConnected : (chosen.reason ?? c.reply.emailNotAvailable)}</Alert>
      ) : channel === 'email' ? (
        <>
          {thread.replyTo?.differsFrom ? (
            // the switch sits under the warning (a quiet text action, never beside it): a long address wraps instead of pushing it out of the pane
            <Alert tone="warning" className="cv-replyto-alert">
              <div>{c.email.replyToAlert.replace('{address}', thread.replyTo.differsFrom)}</div>
              <TextAction kind="reset" icon="arrow-left-right" className="cv-replyto-switch" disabled={disabled} onClick={() => setToReplyTo((v) => !v)}>
                {(toReplyTo ? c.email.replyToBack.replace('{address}', thread.replyTo.address) : c.email.replyToChoose.replace('{address}', thread.replyTo.differsFrom)).trim()}
              </TextAction>
            </Alert>
          ) : null}
          <div className="cv-reply-row">
            <label className="cv-reply-label" htmlFor={`rs-${thread.id}`}>
              {c.reply.subject}
            </label>
            <input id={`rs-${thread.id}`} className={`form-control form-control-sm flex-grow-1 w-auto ${fields.subject ? 'is-invalid' : ''}`} value={subject} maxLength={600} disabled={disabled} onChange={(e) => setSubject(e.target.value)} />
            {!showCc ? (
              <TextAction kind="add" disabled={disabled} onClick={() => setShowCc(true)}>
                {c.reply.ccAdd}
              </TextAction>
            ) : null}
          </div>
          {showCc ? (
            <div className="cv-reply-row">
              <label className="cv-reply-label" htmlFor={`rcc-${thread.id}`}>
                {c.reply.cc}
              </label>
              <CcChipsInput id={`rcc-${thread.id}`} value={cc} onChange={setCc} people={people} target={target} max={CONV_CC_MAX} disabled={disabled} invalid={Boolean(fields.cc)} />
            </div>
          ) : null}
          {fields.cc ? <div className="field-error">{fields.cc}</div> : null}
          <Textarea
            aria-label={c.reply.placeholder}
            placeholder={c.reply.placeholder}
            value={text}
            maxLength={CONV_REPLY_MAX}
            disabled={disabled}
            invalid={Boolean(fields.text)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
          {fields.text ? <div className="field-error">{fields.text}</div> : null}
        </>
      ) : templates === null ? (
        <Skeleton lines={2} />
      ) : waTemplateMode ? (
        <>
          {/* the thread's window strip just above already says the window closed; only a number that never wrote has no strip */}
          {!thread.window && !(typedWhileOpen && text.trim()) ? <Alert tone="neutral">{w.window.never}</Alert> : null}
          <TemplatePicker key={thread.id} templates={templates} defaults={defaults} draftKept={typedWhileOpen && Boolean(text.trim())} disabled={disabled} busy={busy} onSend={(id, vars) => void sendTemplate(id, vars)} />
          {typedWhileOpen && text.trim() ? <pre className="cv-mail-quoted">{text}</pre> : null}
        </>
      ) : (
        <>
          {replyToMsg ? (
            <div className="cv-reply-replyto">
              <Bi name="reply" />
              <span>
                {w.replyingTo}: {replyToMsg.text ?? replyToMsg.media?.caption ?? replyToMsg.media?.name ?? ''}
              </span>
              <IconButton icon="x-lg" label={w.cancelReply} onClick={onClearReplyTo} />
            </div>
          ) : null}
          <Textarea
            aria-label={c.reply.placeholder}
            placeholder={c.reply.placeholder}
            value={text}
            maxLength={4096}
            disabled={disabled}
            invalid={Boolean(fields.text)}
            onChange={(e) => {
              setText(e.target.value);
              if (windowOpen) setTypedWhileOpen(true);
            }}
            onKeyDown={onKey}
          />
          {fields.text ? <div className="field-error">{fields.text}</div> : null}
        </>
      )}

      {error ? (
        <Alert tone="danger" className="mt-2 mb-0">
          {error}
        </Alert>
      ) : null}

      {waTools && channel === 'whatsapp' && chosen?.available && !waTemplateMode && pick ? (
        <div className="cv-pick">
          <input className="form-control form-control-sm" aria-label={pick === 'location' ? cp.whatsapp.attachMenu.location : cp.whatsapp.attachMenu.contact} placeholder={pick === 'location' ? 'Place name' : 'Contact name'} value={pickA} onChange={(e) => setPickA(e.target.value)} />
          {pick === 'contact' ? <input className="form-control form-control-sm" inputMode="tel" aria-label={tr("Phone")} placeholder="+91 ..." value={pickB} onChange={(e) => setPickB(e.target.value)} /> : null}
          <Button size="sm" icon="send" busy={busy} disabled={!pickA.trim()} onClick={() => void sendAttachment(pick === 'location' ? { type: 'location', label: pickA.trim() } : { type: 'contacts', name: pickA.trim(), ...(pickB.trim() ? { phone: pickB.trim() } : {}) })}>
            {c.reply.send}
          </Button>
          <IconButton icon="x-lg" label={w.cancelReply} onClick={() => setPick(null)} />
        </div>
      ) : null}
      {waTools && channel === 'whatsapp' && chosen?.available && !waTemplateMode && emojiOpen ? (
        <div className="cv-emoji" role="group" aria-label={cp.whatsapp.emoji}>
          {EMOJI.map((e) => (
            <button key={e} type="button" className="cv-emoji-btn" onClick={() => { setText((t) => t + e); if (windowOpen) setTypedWhileOpen(true); }}>
              {e}
            </button>
          ))}
        </div>
      ) : null}
      {chosen?.available && !waTemplateMode ? (
        <div className="cv-reply-foot">
          {waTools && channel === 'whatsapp' ? (
            <>
              <IconButton icon="emoji-smile" label={cp.whatsapp.emoji} disabled={disabled} aria-pressed={emojiOpen} onClick={() => setEmojiOpen((v) => !v)} />
              <Dropdown align="start" button={(p) => <IconButton icon="paperclip" label={cp.whatsapp.attach} disabled={disabled} {...p} />}>
                <label className="dropdown-item cv-attach-item">
                  <Bi name="image" /> {cp.whatsapp.attachMenu.photo}
                  <input type="file" accept="image/*,video/*" hidden onChange={onFile('image')} />
                </label>
                <label className="dropdown-item cv-attach-item">
                  <Bi name="file-earmark" /> {cp.whatsapp.attachMenu.document}
                  <input type="file" hidden onChange={onFile('document')} />
                </label>
                <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setPick('location'); }}>
                  <Bi name="geo-alt" /> {cp.whatsapp.attachMenu.location}
                </a>
                <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setPick('contact'); }}>
                  <Bi name="person-vcard" /> {cp.whatsapp.attachMenu.contact}
                </a>
                <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); void sendAttachment({ type: 'audio', duration: 7, name: cp.whatsapp.attachMenu.voice }); }}>
                  <Bi name="mic" /> {cp.whatsapp.attachMenu.voice}
                </a>
              </Dropdown>
            </>
          ) : null}
          {quick.length ? (
            <Dropdown
              align="start"
              menuClassName="cv-quick-menu"
              button={(p) => (
                <Button variant="ghost" size="sm" icon="lightning" disabled={disabled} {...p}>
                  {c.reply.quickReplies}
                </Button>
              )}
            >
              {quick.map((q) => (
                <a
                  key={q.id}
                  href="#"
                  className="dropdown-item"
                  onClick={(e) => {
                    e.preventDefault();
                    setText((t) => (t.trim() ? `${t.trimEnd()}\n\n${q.body}` : q.body));
                    if (windowOpen) setTypedWhileOpen(true);
                  }}
                >
                  <strong>{q.title}</strong>
                  <small>{q.body}</small>
                </a>
              ))}
            </Dropdown>
          ) : null}
          {channel === 'email' && billAllowed && billLink?.detail?.billNo ? (
            bill ? (
              <span className="cv-bill">
                <Bi name="file-earmark-pdf" /> {c.reply.billAttached.replace('{no}', billLink.detail.billNo)}
                <IconButton icon="x-lg" label={c.reply.removeBill} disabled={disabled} onClick={() => setBill(false)} />
              </span>
            ) : (
              <Button variant="ghost" size="sm" icon="paperclip" disabled={disabled} onClick={() => setBill(true)}>
                {c.reply.attachBill}
              </Button>
            )
          ) : null}
          <span className="cv-grow" />
          <span className="cv-reply-hint">{channel === 'email' && fromAddress ? mb.compose.from.replace('{address}', fromAddress) : c.reply.shortcut}</span>
          {channel === 'email' ? (
            <Dropdown
              align="end"
              button={(p) => (
                <Button variant="outline" size="sm" icon={mode === 'all' ? 'reply-all' : 'reply'} disabled={disabled} aria-label={`${c.reply.mode}: ${mode === 'all' ? c.reply.modeReplyAll : c.reply.modeReply}`} {...p}>
                  {mode === 'all' ? c.reply.modeReplyAll : c.reply.modeReply}
                </Button>
              )}
            >
              <a href="#" className={`dropdown-item${mode === 'reply' ? ' active' : ''}`} onClick={(e) => { e.preventDefault(); chooseMode('reply'); }}>
                <Bi name="reply" /> {c.reply.modeReply}
              </a>
              <a href="#" className={`dropdown-item${mode === 'all' ? ' active' : ''}`} onClick={(e) => { e.preventDefault(); chooseMode('all'); }}>
                <Bi name="reply-all" /> {c.reply.modeReplyAll}
              </a>
            </Dropdown>
          ) : null}
          <Button className="cv-send" icon="send" busy={busy} busyLabel={c.reply.sending} disabled={disabled} onClick={() => void send()}>
            {c.reply.send}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
