'use client';

// The help chat panel (MJ, 1 Nov 2026). The caller mounts it for a Hotel, Guest or Corporate user only (supportChatFor in @shared/dashboards/supportChat
// says which). The topics answer with a how-to; chat with a person is not connected, so that button says so. Opened from the top bar's Help, or Help in
// the avatar menu on a phone: no floating button over the page (MJ, 5 Nov 2026). The look lives in hms-overrides.css (.sc-).
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { supportChatCopy as copy, type ChatConfig } from '@shared/dashboards/supportChat';
import { Bi, IconButton } from '../pallav/ui';

/** Opens or closes the chat (the top bar's Help, the avatar menu's Help on a phone). */
export const OPEN_HELP_EVENT = 'hms:help';

interface Line {
  id: number;
  from: 'me' | 'assistant';
  text: string;
}

export function SupportChat({ chat }: { chat: ChatConfig }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();

  const add = (...next: Omit<Line, 'id'>[]) => setLines((all) => [...all, ...next.map((l, i) => ({ ...l, id: all.length + i }))]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener(OPEN_HELP_EVENT, toggle);
    return () => window.removeEventListener(OPEN_HELP_EVENT, toggle);
  }, []);
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines, open]);

  const ask = (text: string, answer: string) => add({ from: 'me', text }, { from: 'assistant', text: answer });
  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    ask(text, copy.unknown);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e);
  };

  return (
    <div className="sc-root" onKeyDown={(e) => { if (e.key === 'Escape' && open) setOpen(false); }}>
      {open ? (
        <section className="sc-panel" role="dialog" aria-modal="false" aria-labelledby={titleId}>
          <header className="sc-head">
            <div className="sc-head-avatar" aria-hidden="true">
              <Bi name="stars" />
              <span className="sc-dot" />
            </div>
            <div className="sc-head-who">
              <strong id={titleId}>{chat.title}</strong>
              <span>{chat.status}</span>
            </div>
            <IconButton icon="x-lg" label={copy.close} className="sc-close" onClick={() => setOpen(false)} />
          </header>

          <div className="sc-log" ref={logRef} role="log" aria-live="polite">
            <div className="sc-day">{copy.today}</div>
            <div className="sc-line is-support">
              <div className="sc-bubble">{chat.hello}</div>
            </div>
            {lines.map((l) => (
              <div key={l.id} className={`sc-line ${l.from === 'me' ? 'is-me' : 'is-support'}`}>
                <div className="sc-bubble">{l.text}</div>
              </div>
            ))}
            <div className="sc-topics">
              <p>{copy.pick}</p>
              {chat.topics.map((t) => (
                // check-shared-ignore: a pill-shaped topic chip of the chat panel, not a form button
                <button key={t.id} type="button" className="sc-chip" onClick={() => ask(t.label, t.answer)}>
                  {t.label}
                </button>
              ))}
              {/* check-shared-ignore: a pill-shaped chip of the chat panel, not a form button */}
              <button type="button" className="sc-chip is-person" onClick={() => add({ from: 'me', text: chat.person }, { from: 'assistant', text: chat.personNote })}>
                <Bi name="person" /> {chat.person}
              </button>
            </div>
          </div>

          <form className="sc-form" onSubmit={send}>
            <div className="sc-compose">
              {/* check-shared-ignore: the chat's own auto-growing message box */}
              <textarea ref={inputRef} className="sc-input" rows={1} value={draft} placeholder={copy.placeholder} aria-label={copy.placeholder} maxLength={1000} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
              {/* check-shared-ignore: the round send button of the chat panel */}
              <button type="submit" className="sc-send" aria-label={copy.send} disabled={!draft.trim()}>
                <Bi name="send-fill" />
              </button>
            </div>
            <small className="sc-hint">{copy.hint}</small>
          </form>
        </section>
      ) : null}
    </div>
  );
}
