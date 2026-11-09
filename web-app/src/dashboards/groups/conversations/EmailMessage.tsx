'use client';

// One email of a thread. HMS keeps only the list entry (sender, subject, date, a short preview), so the email itself is opened from the mailbox when the
// message opens. The newest email of a thread opens by itself; the older ones show their first words until clicked. While it loads the message shows a
// skeleton; a failure is an inline note with the fixed sentence and "Try again". An opened body stays in this view's memory only (never in the browser's
// storage). The HTML is the server's sanitised copy on the MailFrame paper; remote pictures stay hidden until "Show images"; attachments download one by one;
// a bill PDF is locked without the Bills right. An email the mail server could not verify carries a warning (A12).
// Two looks: the chat bubble (decision 66, the combined Conversations screen) and the mailbox's plain message (look="mail", the mail-preview design, MJ, 5 Nov 2026).
import { useEffect, useState } from 'react';

import { conversationsCopy as c, mailboxPageCopy as mb, type ConversationsApi, type EmailAttachment, type EmailBody, type EmailEntry } from '@shared/dashboards/conversations';
import type { DashError } from '@shared/dashboards/common';
import { formatBytes, formatDateTime } from '@shared/dashboards/format';

import { errorText } from '@/components/ui';
import { Alert, Bi, Button, MailFrame, MessageTicks, Skeleton, StatusChip, TextAction } from '@/dashboards/pallav/ui';

import { AddressChip, PeopleLine } from './AddressChips';
import { addressOf, emailTick, nameOf } from './emailThread';

import { tr } from '@/lib/i18n/language';
export interface CachedBody {
  body: EmailBody;
  images: boolean;
}

/** The icon, the colour and the short type of an attachment card. */
function fileKind(type: string, name: string): { icon: string; tone: 'pdf' | 'image' | 'doc' | 'sheet' | 'zip' | 'file'; label: string } {
  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? '').toLowerCase();
  if (type === 'application/pdf' || ext === 'pdf') return { icon: 'file-earmark-pdf', tone: 'pdf', label: 'PDF' };
  if (type.startsWith('image/')) return { icon: 'file-earmark-image', tone: 'image', label: (ext || 'image').toUpperCase() };
  if (/word|document/.test(type) || ['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) return { icon: 'file-earmark-text', tone: 'doc', label: (ext || 'doc').toUpperCase() };
  if (/sheet|excel|csv/.test(type) || ['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return { icon: 'file-earmark-spreadsheet', tone: 'sheet', label: (ext || 'sheet').toUpperCase() };
  if (/zip|compressed|archive/.test(type) || ['zip', 'rar', '7z'].includes(ext)) return { icon: 'file-earmark-zip', tone: 'zip', label: (ext || 'zip').toUpperCase() };
  return { icon: 'file-earmark', tone: 'file', label: (ext || 'file').toUpperCase() };
}

// A guest's ID picture stays in the guest file: a picture named like one is a locked chip in the mailbox, never a download
const ID_PHOTO = /aadha?ar|passport|voter|licen[cs]e|pan[\s_-]?card|\bid[\s_-]?(photo|card|proof)?\b/i;
const isIdPhoto = (a: EmailAttachment) => a.type.startsWith('image/') && ID_PHOTO.test(a.name);

/** What the Email page adds to an email (Gmail's conversation view): Reply, Reply all and Forward on the message itself, and Expand all / Collapse all. */
export interface GmailExtras {
  /** Opens (true) or folds (false) every message of the thread at once (Expand all / Collapse all); undefined = each as it was. */
  forceOpen?: boolean | null;
  onReply?: (m: EmailEntry) => void;
  onReplyAll?: (m: EmailEntry) => void;
  onForward?: (m: EmailEntry, body: EmailBody | null) => void;
}

const initialOf = (from: string) => (nameOf(from).replace(/[^A-Za-z0-9]/g, '').charAt(0) || '?').toUpperCase();
const initialsOf = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return (words.length >= 2 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? '?').slice(0, 2)).toUpperCase();
};

/** A mail HMS sent by itself (a confirmation, a bill, a pay link): no staff name behind it. */
export const isAutomatic = (m: EmailEntry): boolean => m.direction === 'out' && m.sentFrom === 'hms' && !m.sentBy;

export function EmailMessage({
  convId,
  m,
  api,
  autoOpen,
  cached,
  onLoaded,
  gmail,
  look = 'bubble',
  hotelName,
  fresh = false,
}: {
  convId: string;
  m: EmailEntry;
  api: Pick<ConversationsApi, 'getEmailBody' | 'attachmentHref'>;
  autoOpen: boolean;
  cached: CachedBody | undefined;
  onLoaded: (messageId: string, c: CachedBody) => void;
  gmail?: GmailExtras;
  /** 'mail': the mailbox's plain message (avatar, name, time, text, attachment chips). */
  look?: 'bubble' | 'mail';
  /** Mailbox look: the hotel's name beside a staff member's mail and on an automatic one. */
  hotelName?: string;
  /** Mailbox look: the newest unread mail from the guest carries a small "New" mark. */
  fresh?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  // "Expand all" / "Collapse all" of the thread
  const force = gmail?.forceOpen;
  const [seenForce, setSeenForce] = useState(force);
  if (force !== seenForce) {
    setSeenForce(force);
    if (force === true || force === false) setOpen(force);
  }
  const [images, setImages] = useState(false);
  const [quoted, setQuoted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ attempt: number; images: boolean; error: DashError } | null>(null);
  // the body already read stays on screen while "Show images" reads it again
  const body = cached?.body ?? null;
  const failed = failure && failure.attempt === attempt && failure.images === images ? failure.error : null;
  const needsFetch = open && !failed && (!cached || (images && !cached.images));

  useEffect(() => {
    if (!needsFetch) return undefined;
    let live = true;
    void api.getEmailBody(convId, m.id, images ? { images: true } : undefined).then((r) => {
      if (!live) return;
      if (r.ok) onLoaded(m.id, { body: r.data, images });
      else setFailure({ attempt, images, error: r.error });
    });
    return () => {
      live = false;
    };
  }, [needsFetch, api, convId, m.id, images, attempt, onLoaded]);

  const out = m.direction === 'out';
  const unverified = !out && m.verified === false;
  const who = out ? (m.sentFrom === 'mailbox' ? c.email.sentFromMailbox : m.sentBy ? c.email.sentBy.replace('{name}', m.sentBy.name) : null) : null;
  const mail = look === 'mail';

  const attachmentChips = (list: EmailAttachment[]) =>
    list.map((a) => {
      const kind = fileKind(a.type, a.name);
      if (a.billLocked || isIdPhoto(a)) {
        return (
          <span key={a.part} className="mb-att is-lock" title={a.billLocked ? c.email.billLocked : mb.threadView.idPhoto}>
            <Bi name="lock" /> {a.billLocked ? `${a.name} · ${c.email.billLocked}` : mb.threadView.idPhoto}
          </span>
        );
      }
      return (
        <a key={a.part} className="mb-att" href={api.attachmentHref(convId, m.id, a.part)} download={a.name} rel="noopener noreferrer" title={`${c.email.download} ${a.name}`}>
          <Bi name={kind.icon} /> <span className="mb-att-name">{a.name}</span> <span className="mb-att-size">{formatBytes(a.size)}</span>
        </a>
      );
    });

  // the opened email: warnings, the body (the server's sanitised HTML or the text with its quoted part), images on request, and the attachments
  const renderBody = () => (
    <>
          {unverified ? (
            <Alert tone="warning" icon="shield-exclamation">
              {c.unverifiedHelp.replace('{address}', addressOf(m.from))}
            </Alert>
          ) : null}
          {failed ? (
            <Alert
              tone="warning"
              action={
                <TextAction kind="reset" icon="arrow-clockwise" onClick={() => setAttempt((n) => n + 1)}>
                  {c.email.tryAgain}
                </TextAction>
              }
            >
              {failed.code === 'NOT_FOUND' ? (failed.message && failed.message !== failed.code ? failed.message : c.email.gone) : failed.code === 'NETWORK_OFFLINE' ? errorText(failed) : failed.message && failed.message !== failed.code ? failed.message : c.email.loadFailed}
            </Alert>
          ) : !body ? (
            <Skeleton lines={4} label={c.email.subject} />
          ) : body.tooLarge ? (
            <Alert tone="neutral" icon="envelope-exclamation">
              {c.email.tooLarge.replace('{size}', formatBytes(body.tooLarge.size))}
            </Alert>
          ) : (
            <>
              {body.remoteImages > 0 && !images ? (
                <Alert
                  tone="info"
                  icon="image-alt"
                  action={
                    <Button size="sm" variant="outline" icon="eye" onClick={() => setImages(true)}>
                      {c.email.showImages}
                    </Button>
                  }
                >
                  {c.email.imagesHidden}
                </Alert>
              ) : null}
              {body.droppedInline > 0 ? <p className="cv-reply-hint mb-2">{c.email.droppedInline.replace('{n}', String(body.droppedInline))}</p> : null}
              {body.html ? (
                <MailFrame html={body.html} title={body.subject || c.email.noSubject} hasQuoted={body.hasQuoted} />
              ) : mail ? (
                <>
                  <pre className="mb-msg-text">{body.text}</pre>
                  {body.quotedText ? (
                    <details className="mb-earlier">
                      <summary>{mb.threadView.showEarlier}</summary>
                      <blockquote>{body.quotedText}</blockquote>
                    </details>
                  ) : null}
                </>
              ) : (
                <>
                  <pre className="cv-mail-text">{body.text}</pre>
                  {body.quotedText ? (
                    <>
                      {quoted ? <pre className="cv-mail-quoted">{body.quotedText}</pre> : null}
                      <Button variant="ghost" size="sm" icon={quoted ? 'chevron-up' : 'three-dots'} className="cv-quote-toggle" aria-expanded={quoted} onClick={() => setQuoted((v) => !v)}>
                        {quoted ? c.email.hideQuoted : c.email.showQuoted}
                      </Button>
                    </>
                  ) : null}
                </>
              )}
              {body.attachments.length > 0 && mail ? <div className="mb-atts">{attachmentChips(body.attachments)}</div> : null}
              {body.attachments.length > 0 && !mail ? (
                <div className="cv-attach">
                  <div className="cv-attach-title">{c.email.attachments}</div>
                  <div className="cv-attach-cards">
                    {body.attachments.map((a) => {
                      const kind = fileKind(a.type, a.name);
                      return (
                        <div key={a.part} className="cv-attach-row cv-attach-card">
                          <span className={`cv-attach-icon is-${kind.tone}`} aria-hidden="true">
                            <Bi name={kind.icon} />
                          </span>
                          <span className="cv-attach-info">
                            <span className="cv-attach-name" title={a.name}>
                              {a.name}
                            </span>
                            <span className="cv-attach-size">
                              {kind.label} · {formatBytes(a.size)}
                            </span>
                            {a.billLocked ? (
                              <span className="cv-attach-lock">
                                <Bi name="lock" /> {c.email.billLocked}
                              </span>
                            ) : null}
                          </span>
                          {a.billLocked ? null : (
                            <a className="btn-icon cv-attach-get" href={api.attachmentHref(convId, m.id, a.part)} download={a.name} rel="noopener noreferrer" aria-label={`${c.email.download} ${a.name}`} title={c.email.download}>
                              <Bi name="download" />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </>
          )}
    </>
  );

  if (mail) {
    const auto = isAutomatic(m);
    const name = out ? (auto ? (hotelName || mb.threadView.hotel) : (m.sentBy?.name ?? mb.you)) : nameOf(m.from);
    return (
      <article className={`mb-msg${out ? ' is-out' : ''}${auto ? ' is-auto' : ''}${open ? ' is-open' : ''}`} aria-label={`${name}, ${formatDateTime(m.at)}`}>
        <span className={`mb-av${auto ? ' is-bot' : out ? ' is-me' : ''}`} aria-hidden="true">{auto ? <Bi name="lightning-charge" /> : initialsOf(name)}</span>
        <div className="mb-msg-main">
          <button /* check-shared-ignore: a message's own header opens and folds it (no kit equivalent) */ type="button" className="mb-msg-hd" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <b>{name}</b>
            {auto ? <span className="mb-automark">{mb.threadView.auto}</span> : out && hotelName && m.sentBy ? <span className="mb-msg-hotel">{hotelName}</span> : null}
            <time dateTime={m.at}>{formatDateTime(m.at)}</time>
            {fresh && !out ? <span className="mb-chip is-gold">{mb.threadView.newMark}</span> : null}
            {unverified ? <StatusChip tone="warn">{c.unverified}</StatusChip> : null}
            {m.status === 'failed' ? <StatusChip tone="danger">{c.email.failed}</StatusChip> : null}
            {!open && m.hasAttachments ? <Bi name="paperclip" className="mb-msg-clip" /> : null}
            {out && m.status !== 'failed' && open ? <MessageTicks status={emailTick(m.status)} className="ms-1" /> : null}
          </button>
          {!open ? <span className="mb-msg-snip">{m.preview}</span> : null}
          {open && m.cc.length ? (
            <div className="mb-msg-cc">
              <span>{mb.threadView.cc}</span>
              {m.cc.map((p, i) => <AddressChip key={`${addressOf(p)}-${i}`} raw={p} />)}
            </div>
          ) : null}
          {open ? <div className="mb-msg-body">{renderBody()}</div> : null}
        </div>
      </article>
    );
  }

  // The chat bubble (MJ, 3 Nov 2026): the other person's emails sit on the left, the hotel's own on the right with the sender, the time and the delivery tick.
  // The header names the sender; opened, a To line and (when there is one) a Cc line show the people as chips (a click shows the full address). Folded, it shows the
  // first words. The Email page adds Reply, Reply all and Forward on the message itself.
  const sender = out ? (m.sentBy?.name ?? 'Me') : nameOf(m.from);
  const tools = gmail && open ? (
    <span className="cv-bub-tools">
      {gmail.onReply ? <button type="button" className="btn-icon" aria-label={tr("Reply")} title={tr("Reply")} onClick={() => gmail.onReply?.(m)}><Bi name="reply" /></button> : null}
      {gmail.onReplyAll ? <button type="button" className="btn-icon" aria-label={tr("Reply all")} title={tr("Reply all")} onClick={() => gmail.onReplyAll?.(m)}><Bi name="reply-all" /></button> : null}
      {gmail.onForward ? <button type="button" className="btn-icon" aria-label={tr("Forward")} title={tr("Forward")} onClick={() => gmail.onForward?.(m, body)}><Bi name="forward" /></button> : null}
    </span>
  ) : null;
  return (
    <article className={`cv-email cv-bub ${out ? 'is-out' : 'is-in'}${open ? ' is-open' : ''}`} aria-label={`${sender}, ${formatDateTime(m.at)}`}>
      <div className="cv-bub-head">
        <button /* check-shared-ignore: a message's own header opens and folds it (no kit equivalent) */ type="button" className="cv-bub-main" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className={`cv-bub-avatar${out ? ' is-me' : ''}`} aria-hidden="true">{out ? initialOf(sender) : initialOf(m.from)}</span>
          <span className="cv-bub-who">
            <span className="cv-bub-line">
              <strong className="cv-bub-name">{sender}</strong>
              {open && !out ? <span className="cv-bub-addr">{tr("<")}{addressOf(m.from)}{tr(">")}</span> : null}
              {unverified ? <StatusChip tone="warn">{c.unverified}</StatusChip> : null}
              {m.status === 'failed' ? <StatusChip tone="danger">{c.email.failed}</StatusChip> : null}
            </span>
            {!open ? <span className="cv-bub-snippet">{m.preview}</span> : null}
          </span>
          <span className="cv-bub-time">
            {m.hasAttachments ? <Bi name="paperclip" className="me-1" /> : null}
            <time dateTime={m.at}>{formatDateTime(m.at)}</time>
            {out && m.status !== 'failed' ? <MessageTicks status={emailTick(m.status)} className="ms-1" /> : null}
          </span>
        </button>
        {tools}
      </div>
      {open ? (
        <div className="cv-bub-people">
          <PeopleLine label={`${c.email.to}:`} list={m.to} />
          <PeopleLine label={`${c.email.cc}:`} list={m.cc} />
        </div>
      ) : null}
      {open ? (
        <div className="cv-email-body">
          {renderBody()}
          {who ? <div className="cv-email-by">{who}</div> : null}
        </div>
      ) : null}
    </article>
  );
}
