'use client';

// An opened email's HTML (already sanitised by the server, decision 66) on a sheet of paper: a sandboxed frame that never runs a script (no
// `allow-scripts`; same origin only so its height can be measured), with its own Content-Security-Policy, a light paper in day and night alike, and links
// opening in a new tab. A wide newsletter (600 px tables) scrolls inside the paper, never the page. Quoted history (the server wraps it in
// `data-hms-quote`) stays folded behind "Show quoted text", a button outside the frame; the height is measured again on every load, at most 70% of the screen.
//   <MailFrame html={body.html} title={body.subject} hasQuoted={body.hasQuoted} />
import { useState } from 'react';

import { conversationsCopy } from '@shared/dashboards/conversations';

import { Button } from './Button';

const CSP = "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data: https:; base-uri 'none'; form-action 'none'";
// The paper's own look: fixed light colours (an email is written for a white page), readable type, pictures and tables kept inside the width where they allow it.
const PAPER_CSS =
  'html,body{margin:0;background:#ffffff;color:#1f2937}' +
  "body{padding:14px 16px;font:14px/1.55 Inter,system-ui,'Segoe UI',Roboto,sans-serif;overflow-wrap:anywhere;overflow-x:auto}" +
  'img{max-width:100%;height:auto}a{color:#3A3A42}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #E6E6EA;color:#4b5563}' +
  'pre{white-space:pre-wrap}p{margin:0 0 10px}';

function documentFor(html: string, showQuoted: boolean): string {
  const fold = showQuoted ? '' : '[data-hms-quote]{display:none !important}';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${PAPER_CSS}${fold}</style></head><body>${html}</body></html>`;
}

export interface MailFrameProps {
  /** The server's sanitised HTML. */
  html: string;
  /** The frame's accessible name (the subject). */
  title: string;
  /** The email holds quoted history: show the toggle. */
  hasQuoted?: boolean;
  className?: string;
}

export function MailFrame({ html, title, hasQuoted = false, className = '' }: MailFrameProps) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [height, setHeight] = useState(160);

  const measure = (frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument;
    if (!doc) return;
    const max = Math.round(window.innerHeight * 0.7);
    const fit = () => setHeight(Math.max(80, Math.min(max, doc.documentElement.scrollHeight + 2)));
    fit();
    // pictures change the height once they arrive
    for (const img of Array.from(doc.images)) if (!img.complete) img.addEventListener('load', fit, { once: true });
  };

  return (
    <div className={`cv-mail ${className}`.trim()}>
      <div className="cv-mail-paper">
        <iframe
          className="cv-mail-frame"
          title={title}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          srcDoc={documentFor(html, showQuoted)}
          style={{ height }}
          onLoad={(e) => measure(e.currentTarget)}
        />
      </div>
      {hasQuoted ? (
        <Button variant="ghost" size="sm" icon={showQuoted ? 'chevron-up' : 'three-dots'} className="cv-quote-toggle" aria-expanded={showQuoted} onClick={() => setShowQuoted((v) => !v)}>
          {showQuoted ? conversationsCopy.email.hideQuoted : conversationsCopy.email.showQuoted}
        </Button>
      ) : null}
    </div>
  );
}
