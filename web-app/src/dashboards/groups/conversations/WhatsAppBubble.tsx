'use client';

// One WhatsApp message in the thread (decision 66, the design of docs/plans/WHATSAPP-PLAN-2026-10-24.md section 7), on the kit's ChatBubble: every type Meta
// sends (text, photo, video, document, voice note, sticker, location, contact card, approved message, and a kind HMS cannot show), the message it answers,
// the reactions, the ticks of an outgoing message, and who sent it (a staff member, the hotel's own phone, or HMS by itself). Words from whatsappCopy only.
import { Fragment } from 'react';

import { formatBytes, formatTime } from '@shared/dashboards/format';
import { channelPageCopy as cp, type ConvMessageStatus } from '@shared/dashboards/conversations';
import { whatsappCopy, type WaTick, type WhatsAppMessage } from '@shared/dashboards/whatsapp';

import { Bi, Button, ChatBubble, Dropdown, IconButton } from '@/dashboards/pallav/ui';

import { splitHits } from './waDesk';

import { tr } from '@/lib/i18n/language';
const TICK: Partial<Record<ConvMessageStatus, WaTick>> = { pending: 'pending', sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };

/** The tick an outgoing message's status draws ("received" and anything unknown count as sent). */
export const tickOf = (status: ConvMessageStatus): WaTick => TICK[status] ?? 'sent';

/** The ticks as strokes (MJ's design): a clock while it waits, one tick when WhatsApp took it, two when the phone has it, two in blue when read, a mark when it failed. */
export function WaTicks({ status, className = '' }: { status: WaTick; className?: string }) {
  const words = whatsappCopy.ticks[status];
  return (
    <span className={`wa-tk is-${status} ${className}`.trim()} role="img" aria-label={words} title={words}>
      {status === 'failed' ? (
        <svg viewBox="0 0 16 12" aria-hidden="true"><path d="M8 1.5v5.5" /><path d="M8 9.8v.4" /></svg>
      ) : status === 'pending' ? (
        <svg viewBox="0 0 16 12" aria-hidden="true"><circle cx="8" cy="6" r="4.2" /><path d="M8 3.6v2.6l1.6 1" /></svg>
      ) : (
        <svg viewBox="0 0 16 12" aria-hidden="true"><path d="m1.5 6.5 3 3 6-7" />{status === 'sent' ? null : <path d="m6.5 9.5 7-8" />}</svg>
      )}
    </span>
  );
}

/** What an automatic message was, in the desk's words: the automatic message's name when HMS knows it, else the template's name in plain words. */
function autoWhat(m: WhatsAppMessage): string {
  const name = m.template?.name ?? '';
  const known = (whatsappCopy.automatic as Record<string, string>)[name];
  if (known) return known;
  const plain = name.replace(/_v?\d+$/, '').replace(/_/g, ' ').trim();
  return plain ? plain[0].toUpperCase() + plain.slice(1) : whatsappCopy.template.pick;
}

/** A message HMS sent by itself: one quiet centre line with the gold shield, never a bubble (the full text sits in the tooltip). Automation is set under Settings, not here. */
export function WhatsAppAutoLine({ m }: { m: WhatsAppMessage }) {
  return (
    <div className="wa-sys" role="note" title={m.template?.text ?? m.text ?? ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 8.6 7.5 9.9 4.3-1.3 7.5-5.3 7.5-9.9v-6L12 2.5Z" /><path d="m8.8 12 2.2 2.2 4.3-4.6" /></svg>
      <span>{whatsappCopy.desk.autoLine.replace('{what}', autoWhat(m)).replace('{auto}', whatsappCopy.sentAutomatically).replace('{time}', formatTime(m.at))}</span>
    </div>
  );
}

const seconds = (s?: number) => (s === undefined ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

/** The words under a file that cannot be opened (it is still coming, or it is not kept). */
const KEPT_NOTE = { waiting: 'The file is being downloaded…', no: 'This file is not kept here (WhatsApp files are kept for a limited time, and only photos, voice notes, videos, PDFs and Office files are accepted).' } as const;

/** The text with the chat search's matches marked. */
function Marked({ text, find }: { text: string; find?: string }) {
  if (!find) return <>{text}</>;
  return (
    <>
      {splitHits(text, find).map((p, i) => (p.hit ? <mark key={i} className="wa-hit">{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  );
}

function Body({ m, fileUrl, find }: { m: WhatsAppMessage; fileUrl?: string | null; find?: string }) {
  const kept = m.media?.kept;
  const mediaType = m.type === 'image' || m.type === 'video' || m.type === 'document' || m.type === 'audio' || m.type === 'sticker';
  return (
    <>
      <Content m={m} fileUrl={kept === 'yes' ? fileUrl : null} find={find} />
      {mediaType && (kept === 'waiting' || kept === 'no') ? <div className="cv-note-hint">{KEPT_NOTE[kept]}</div> : null}
    </>
  );
}

function Content({ m, fileUrl, find }: { m: WhatsAppMessage; fileUrl?: string | null; find?: string }) {
  const media = m.media && fileUrl ? { ...m.media, previewUrl: m.media.previewUrl ?? (m.type === 'image' || m.type === 'sticker' ? fileUrl : undefined) } : m.media;
  switch (m.type) {
    case 'image':
      return (
        <>
          {media?.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a picture kept in the hotel's bucket, served by our own route
            <img className="cv-media-img" src={media.previewUrl} alt={media.caption || whatsappCopy.photo} />
          ) : (
            <File icon="image" name={media?.name ?? whatsappCopy.photo} size={media?.size} />
          )}
          {media?.caption ? <div className="cv-caption"><Marked text={media.caption} find={find} /></div> : null}
        </>
      );
    case 'video':
      return (
        <>
          {fileUrl ? (
            <video className="cv-media-img" controls preload="none" src={fileUrl} aria-label={whatsappCopy.video} />
          ) : media?.previewUrl ? (
            <span className="cv-video">
              {/* eslint-disable-next-line @next/next/no-img-element -- the sample poster of the mock */}
              <img className="cv-media-img" src={media.previewUrl} alt={`${whatsappCopy.video} ${seconds(media.duration)}`.trim()} />
              <Bi name="play-circle" />
              {/* the length in the corner, never across the play icon (the alt text says it for a screen reader) */}
              {media.duration !== undefined ? <span className="cv-video-len" aria-hidden="true"><Bi name="camera-video" /> {seconds(media.duration)}</span> : null}
            </span>
          ) : (
            <File icon="camera-video" name={media?.name ?? whatsappCopy.video} size={media?.size} extra={seconds(media?.duration)} />
          )}
          {media?.caption ? <div className="cv-caption"><Marked text={media.caption} find={find} /></div> : null}
        </>
      );
    case 'document':
      return (
        <>
          {fileUrl ? (
            <a href={fileUrl} download rel="noopener noreferrer" className="text-decoration-none">
              <File icon={media?.mime === 'application/pdf' ? 'file-earmark-pdf' : 'file-earmark'} name={media?.name || whatsappCopy.document} size={media?.size} extra="Download" />
            </a>
          ) : (
            <File icon={media?.mime === 'application/pdf' ? 'file-earmark-pdf' : 'file-earmark'} name={media?.name || whatsappCopy.document} size={media?.size} />
          )}
          {media?.caption ? <div className="cv-caption"><Marked text={media.caption} find={find} /></div> : null}
        </>
      );
    case 'audio':
      if (fileUrl) return <audio controls preload="none" src={fileUrl} aria-label={whatsappCopy.voiceNote} style={{ maxWidth: '100%' }} />;
      return (
        <span className="cv-audio">
          <Bi name="mic" />
          <span className="visually-hidden">{whatsappCopy.voiceNote}</span>
          <span className="cv-audio-bar" aria-hidden="true" />
          <span className="cv-file-size">{seconds(media?.duration)}</span>
        </span>
      );
    case 'sticker':
      return media?.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- the sample sticker of the mock
        <img className="cv-sticker" src={media.previewUrl} alt={whatsappCopy.sticker} />
      ) : (
        <span>
          <Bi name="emoji-smile" /> {whatsappCopy.sticker}
        </span>
      );
    case 'location':
      return (
        <span className="cv-file">
          <Bi name="geo-alt" />
          <span>
            <span className="cv-file-name">{m.location?.label}</span>
            <span className="d-block cv-file-size">{whatsappCopy.location}</span>
          </span>
        </span>
      );
    case 'contacts':
      return (
        <>
          {(m.contacts ?? []).map((c, i) => (
            <span key={i} className="cv-file">
              <Bi name="person-vcard" />
              <span>
                <span className="cv-file-name">{c.name}</span>
                <span className="d-block cv-file-size">{c.phone ?? whatsappCopy.contactCard}</span>
              </span>
            </span>
          ))}
          {m.text ? <div className="cv-caption"><Marked text={m.text} find={find} /></div> : null}
        </>
      );
    case 'template':
      return (
        <>
          <span className="cv-tpl-tag">
            <Bi name="patch-check" /> {whatsappCopy.template.pick}
          </span>
          <div><Marked text={m.template?.text ?? m.text ?? ''} find={find} /></div>
        </>
      );
    case 'unsupported':
      return <span className="cv-unsupported">{whatsappCopy.unsupported}</span>;
    default:
      return <Marked text={m.text ?? ''} find={find} />;
  }
}

function File({ icon, name, size, extra }: { icon: string; name: string; size?: number; extra?: string }) {
  return (
    <span className="cv-file">
      <Bi name={icon} />
      <span>
        <span className="cv-file-name">{name}</span>
        <span className="d-block cv-file-size">{[size !== undefined ? formatBytes(size) : '', extra ?? ''].filter(Boolean).join(' · ')}</span>
      </span>
    </span>
  );
}

const REACTIONS = ['👍', '❤️', '😂', '🙏', '🎉'] as const;

/** The bubble's menu (WhatsApp Web's chevron): react, reply, copy, star, message info. A bottom sheet on a phone. */
function BubbleMenu({ m, out, onReply, onStar, onInfo, onCopy, onReact }: { m: WhatsAppMessage; out: boolean; onReply?: (m: WhatsAppMessage) => void; onStar?: (m: WhatsAppMessage, on: boolean) => void; onInfo?: (m: WhatsAppMessage) => void; onCopy?: (m: WhatsAppMessage) => void; onReact?: (m: WhatsAppMessage, emoji: string | null) => void }) {
  const item = (icon: string, label: string, run: () => void) => (
    <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); run(); }}>
      <Bi name={icon} /> {label}
    </a>
  );
  return (
    <Dropdown align={out ? 'end' : 'start'} className="wa-bmenu" menuClassName="wa-bmenu-list" button={(p) => <IconButton icon="chevron-down" label={tr('Message options')} className="wa-bmenu-btn" {...p} />}>
      {onReact ? (
        <div className="wa-react-row" role="group" aria-label={tr('React')}>
          {REACTIONS.map((e) => {
            const mine = (m.reactions ?? []).some((r) => !r.fromContact && r.emoji === e);
            return <Button key={e} variant="ghost" size="sm" className={`wa-react${mine ? ' is-on' : ''}`} aria-pressed={mine} onClick={() => onReact(m, mine ? null : e)}>{e}</Button>;
          })}
        </div>
      ) : null}
      {onReply ? item('reply', whatsappCopy.reply, () => onReply(m)) : null}
      {onCopy && (m.text || m.template?.text) ? item('copy', cp.whatsapp.copy, () => onCopy(m)) : null}
      {onStar ? item(m.starred ? 'star-fill' : 'star', m.starred ? cp.whatsapp.unstarMessage : cp.whatsapp.starMessage, () => onStar(m, !m.starred)) : null}
      {onInfo && out ? item('info-circle', cp.whatsapp.messageInfo, () => onInfo(m)) : null}
    </Dropdown>
  );
}

export function WhatsAppBubble({ m, contactName, fileUrl, find, first, onQuote, onReply, onStar, onInfo, onCopy, onReact, onRetry, onDiscard }: { m: WhatsAppMessage; contactName: string; /** Where this message's kept file is served from (our own route), when it has one. */ fileUrl?: string | null; /** The chat search's words, marked in the text. */ find?: string; /** The first bubble of a run draws the tail. */ first?: boolean; onQuote?: (id: string) => void; onReply?: (m: WhatsAppMessage) => void; onStar?: (m: WhatsAppMessage, on: boolean) => void; onInfo?: (m: WhatsAppMessage) => void; onCopy?: (m: WhatsAppMessage) => void; onReact?: (m: WhatsAppMessage, emoji: string | null) => void; /** A message that did not go from this page: send it again, or take it away. */ onRetry?: () => void; onDiscard?: () => void }) {
  const out = m.direction === 'out';
  const tick = out ? TICK[m.status] : undefined;
  const by = !out ? null : m.sentFrom === 'phone' ? (
    <>
      <Bi name="phone" /> {whatsappCopy.sentFromPhone}
    </>
  ) : m.sentFrom === 'auto' ? (
    <>
      <Bi name="robot" /> {whatsappCopy.sentAutomatically}
    </>
  ) : m.sentBy ? (
    whatsappCopy.sentBy.replace('{name}', m.sentBy.name)
  ) : null;
  const visualMedia = (m.type === 'image' || m.type === 'video') && Boolean(m.media?.previewUrl);
  const menu = onReply || onStar || onInfo || onCopy || onReact;
  return (
    <ChatBubble
      id={`wa-m-${m.id}`}
      className={first ? 'is-first' : ''}
      direction={m.direction}
      tone={m.status === 'failed' ? 'failed' : m.sentFrom === 'auto' ? 'auto' : 'default'}
      media={visualMedia}
      label={`${out ? (m.sentBy?.name ?? whatsappCopy.name) : contactName}, ${formatTime(m.at)}`}
      by={by}
      quote={
        m.replyTo ? (
          <>
            <span className="visually-hidden">{whatsappCopy.replyingTo}: </span>
            {onQuote ? (
              <a href={`#wa-m-${m.replyTo.id}`} className="wa-quote-jump" onClick={(e) => { e.preventDefault(); onQuote(m.replyTo!.id); }}>{m.replyTo.preview}</a>
            ) : (
              m.replyTo.preview
            )}
          </>
        ) : undefined
      }
      meta={
        <>
          {menu ? <BubbleMenu m={m} out={out} onReply={onReply} onStar={onStar} onInfo={onInfo} onCopy={onCopy} onReact={onReact} /> : null}
          {m.starred ? <Bi name="star-fill" className="cv-bubble-star" aria-label={cp.whatsapp.starMessage} /> : null}
          <time dateTime={m.at}>{formatTime(m.at)}</time>
          {tick ? <WaTicks status={tick} /> : null}
        </>
      }
      reactions={
        m.reactions?.length
          ? m.reactions.map((r, i) => (
              <span key={i} className="cv-reaction" role="img" aria-label={`${r.emoji} ${r.fromContact ? contactName : ''}`.trim()}>
                {r.emoji}
              </span>
            ))
          : undefined
      }
    >
      <Body m={m} fileUrl={fileUrl} find={find} />
      {m.status === 'failed' ? <div className="cv-failed-line">{whatsappCopy.failedLine.replace('{reason}', m.failure ?? '')}</div> : null}
      {onRetry || onDiscard ? (
        <div className="wa-retry">
          {onRetry ? <Button variant="ghost" size="sm" icon="arrow-clockwise" onClick={onRetry}>{tr('Try again')}</Button> : null}
          {onDiscard ? <Button variant="ghost" size="sm" onClick={onDiscard}>{tr('Remove')}</Button> : null}
        </div>
      ) : null}
    </ChatBubble>
  );
}
