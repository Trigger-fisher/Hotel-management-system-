'use client';

// The WhatsApp page's side panels: the chat's media, documents and links, its starred messages, and one message's info.
import { useState } from 'react';

import { channelPageCopy as cp } from '@shared/dashboards/conversations';
import { formatBytes, formatDate, formatDateTime } from '@shared/dashboards/format';
import { whatsappCopy as w, type WhatsAppMessage } from '@shared/dashboards/whatsapp';

import { Bi, Modal, SegTabs } from '@/dashboards/pallav/ui';

import { chatFiles, searchText } from './waDesk';
import { tickOf, WaTicks } from './WhatsAppBubble';

import { tr } from '@/lib/i18n/language';

const d = w.desk;
type FilesTab = 'media' | 'docs' | 'links';

function Jump({ id, onJump, className, children }: { id: string; onJump: (id: string) => void; className: string; children: React.ReactNode }) {
  return (
    <a
      href={`#wa-m-${id}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        onJump(id);
      }}
    >
      {children}
    </a>
  );
}

export function FilesPanel({ messages, fileUrlOf, onJump }: { messages: readonly WhatsAppMessage[]; fileUrlOf: (m: WhatsAppMessage) => string | null; onJump: (id: string) => void }) {
  const [tab, setTab] = useState<FilesTab>('media');
  const f = chatFiles(messages);
  return (
    <div className="wa-files">
      <SegTabs
        className="wa-files-tabs"
        label={d.files.title}
        active={tab}
        onChange={(id) => setTab(id as FilesTab)}
        tabs={[
          { id: 'media', label: `${d.files.media} · ${f.media.length}` },
          { id: 'docs', label: `${d.files.docs} · ${f.docs.length}` },
          { id: 'links', label: `${d.files.links} · ${f.links.length}` },
        ]}
      />
      {tab === 'media' ? (
        f.media.length ? (
          <div className="wa-media-grid">
            {f.media.map((m) => {
              const src = m.type === 'video' ? m.media?.previewUrl : (fileUrlOf(m) ?? m.media?.previewUrl);
              return (
                <Jump key={m.id} id={m.id} onJump={onJump} className="wa-media-tile">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a picture kept in the hotel's bucket or the sample's own */}
                  {src ? <img src={src} alt={m.media?.caption || (m.type === 'video' ? w.video : w.photo)} loading="lazy" /> : <Bi name={m.type === 'video' ? 'camera-video' : 'image'} />}
                  {m.type === 'video' ? <Bi name="play-circle-fill" className="wa-media-play" /> : null}
                </Jump>
              );
            })}
          </div>
        ) : (
          <p className="wa-files-none">{d.files.noMedia}</p>
        )
      ) : tab === 'docs' ? (
        f.docs.length ? (
          <ul className="wa-files-list">
            {f.docs.map((m) => (
              <li key={m.id}>
                <Jump id={m.id} onJump={onJump} className="wa-files-row">
                  <Bi name={m.type === 'audio' ? 'mic' : m.media?.mime === 'application/pdf' ? 'file-earmark-pdf' : 'file-earmark'} />
                  <span>
                    <b>{m.media?.name || (m.type === 'audio' ? w.voiceNote : w.document)}</b>
                    <small>{[m.media?.size !== undefined ? formatBytes(m.media.size) : '', formatDate(m.at)].filter(Boolean).join(' · ')}</small>
                  </span>
                </Jump>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wa-files-none">{d.files.noDocs}</p>
        )
      ) : f.links.length ? (
        <ul className="wa-files-list">
          {f.links.map((l, i) => (
            <li key={`${l.id}-${i}`}>
              <a className="wa-files-row" href={l.url} target="_blank" rel="noopener noreferrer">
                <Bi name="link-45deg" />
                <span>
                  <b>{l.url.replace(/^https?:\/\//, '')}</b>
                  <small>{formatDate(l.at)}</small>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="wa-files-none">{d.files.noLinks}</p>
      )}
    </div>
  );
}

export function StarredPanel({ messages, contactName, onJump }: { messages: readonly WhatsAppMessage[]; contactName: string; onJump: (id: string) => void }) {
  const starred = [...messages].filter((m) => m.starred).reverse();
  if (!starred.length) return <p className="wa-files-none">{cp.whatsapp.noStarred}</p>;
  return (
    <ul className="wa-files-list">
      {starred.map((m) => (
        <li key={m.id}>
          <Jump id={m.id} onJump={onJump} className="wa-files-row wa-star-row">
            <Bi name="star-fill" />
            <span>
              <small>{`${m.direction === 'out' ? (m.sentBy?.name ?? w.name) : contactName} · ${formatDateTime(m.at)}`}</small>
              <b>{searchText(m) || w.photo}</b>
            </span>
          </Jump>
        </li>
      ))}
    </ul>
  );
}

export function MessageInfo({ m, onClose }: { m: WhatsAppMessage | null; onClose: () => void }) {
  const by = !m ? '' : m.sentFrom === 'phone' ? d.info.hotelPhone : m.sentFrom === 'auto' ? d.info.auto : (m.sentBy?.name ?? w.name);
  return (
    <Modal open={m !== null} onClose={onClose} title={d.info.title} size="sm" className="wa-theme">
      {m ? (
        <div className="wa-info">
          <p className="wa-info-text">{searchText(m) || w.photo}</p>
          <dl className="wa-kv">
            <dt>{d.info.sent}</dt>
            <dd>{formatDateTime(m.at)}</dd>
            <dt>{d.info.state}</dt>
            <dd className="wa-info-state"><WaTicks status={tickOf(m.status)} /> {w.ticks[tickOf(m.status)]}</dd>
            <dt>{d.info.by}</dt>
            <dd>{by}</dd>
          </dl>
          <p className="wa-info-note">{tr(d.info.note)}</p>
        </div>
      ) : null}
    </Modal>
  );
}
