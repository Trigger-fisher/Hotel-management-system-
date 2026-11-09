'use client';

// One message as a chat bubble: the guest's on the left, the hotel's on the right (Pallav's graphite tint), a red edge when it was not delivered and a quiet
// look for a message HMS sent by itself. `quote` is the strip of the message it answers, `meta` the time and ticks under the text, `reactions` the
// emoji row below the bubble. The look lives in conversations.css.
//   <ChatBubble direction="out" meta={<>3:05 pm <MessageTicks status="read" /></>}>Your room is ready.</ChatBubble>
import type { ReactNode } from 'react';

export interface ChatBubbleProps {
  direction: 'in' | 'out';
  tone?: 'default' | 'failed' | 'auto';
  /** The message this one answers (a short strip at the top). */
  quote?: ReactNode;
  /** A line above the text: who sent it, "Sent from Phone", "Sent automatically". */
  by?: ReactNode;
  /** Time and ticks, under the text. */
  meta?: ReactNode;
  /** The reactions row under the bubble. */
  reactions?: ReactNode;
  /** A bubble that holds a picture or a video: no inner padding around it. */
  media?: boolean;
  /** The accessible name of the bubble (who and when). */
  label?: string;
  className?: string;
  /** The row's id, for a link or a search that scrolls to it. */
  id?: string;
  children: ReactNode;
}

export function ChatBubble({ direction, tone = 'default', quote, by, meta, reactions, media = false, label, className = '', id, children }: ChatBubbleProps) {
  return (
    <div id={id} className={`cv-bubble-row is-${direction} ${className}`.trim()} role="group" aria-label={label}>
      <div className={`cv-bubble is-${direction} tone-${tone}${media ? ' has-media' : ''}`}>
        {by ? <div className="cv-bubble-by">{by}</div> : null}
        {quote ? <div className="cv-bubble-quote">{quote}</div> : null}
        <div className="cv-bubble-body">{children}</div>
        {meta ? <div className="cv-bubble-meta">{meta}</div> : null}
      </div>
      {reactions ? <div className="cv-bubble-reactions">{reactions}</div> : null}
    </div>
  );
}
