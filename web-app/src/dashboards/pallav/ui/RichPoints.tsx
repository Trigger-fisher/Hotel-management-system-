'use client';

// Pallav's "notes" box (`.rt`, shift-handover.js): a small formatted list where each line is one point. Bold, italic, underline, strike, link,
// clear formatting, undo and redo. A point is kept as a little HTML; only the tags below survive, on the way in and on the way out.
import { useEffect, useRef } from 'react';

import { tr } from '@/lib/i18n/language';
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'A', 'BR']);

/** Keeps only simple formatting (and http, https, mailto links); every other tag is flattened to its text. Safe to put in the page. */
export function cleanPoint(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, '');
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node: Node): string => {
    if (node.nodeType === 3) return (node.textContent ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (node.nodeType !== 1) return '';
    const el = node as HTMLElement;
    const inner = [...el.childNodes].map(walk).join('');
    if (!ALLOWED.has(el.tagName)) return inner;
    if (el.tagName === 'BR') return '<br>';
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;
    }
    return `<${tag}>${inner}</${tag}>`;
  };
  return [...doc.body.childNodes].map(walk).join('').trim();
}

/** The text of a point, for the closed card's one-line preview. */
export function pointText(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, '');
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

/** A point as it reads inside the page (already cleaned). */
export function Point({ html }: { html: string }) {
  return <li dangerouslySetInnerHTML={{ __html: cleanPoint(html) }} />;
}

const tools: ({ cmd: string; title: string; icon: string } | 'sep')[] = [
  { cmd: 'bold', title: 'Bold (Ctrl+B)', icon: 'type-bold' },
  { cmd: 'italic', title: 'Italic (Ctrl+I)', icon: 'type-italic' },
  { cmd: 'underline', title: 'Underline (Ctrl+U)', icon: 'type-underline' },
  { cmd: 'strikeThrough', title: 'Strike through, e.g. a done point', icon: 'type-strikethrough' },
  'sep',
  { cmd: 'link', title: 'Link', icon: 'link-45deg' },
  { cmd: 'removeFormat', title: 'Clear formatting', icon: 'eraser' },
  'sep',
  { cmd: 'undo', title: 'Undo (Ctrl+Z)', icon: 'arrow-counterclockwise' },
  { cmd: 'redo', title: 'Redo (Ctrl+Y)', icon: 'arrow-clockwise' },
];

export function RichPoints({ points, onChange, label }: { points: string[]; onChange: (points: string[]) => void; label: string }) {
  const editor = useRef<HTMLDivElement>(null);

  // The saved points are put in once; after that the box is the source (typing must never be rewritten under the cursor).
  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    const items = points.length ? points : [''];
    el.innerHTML = `<ul>${items.map((p) => `<li>${cleanPoint(p) || '<br>'}</li>`).join('')}</ul>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const read = () => {
    const el = editor.current;
    if (!el) return;
    const out = [...el.querySelectorAll('li')].map((li) => cleanPoint(li.innerHTML)).filter((p) => pointText(p).trim() !== '');
    onChange(out);
  };

  const run = (cmd: string) => {
    editor.current?.focus();
    if (cmd === 'link') {
      const url = window.prompt('Link address (https://…)');
      if (url) document.execCommand('createLink', false, url);
    } else document.execCommand(cmd);
    read();
  };

  return (
    <div className="rt">
      <div className="rt-toolbar" role="toolbar" aria-label={tr("Formatting")}>
        {tools.map((t, i) =>
          t === 'sep' ? (
            <span key={i} className="rt-sep" />
          ) : (
            <button key={t.cmd} type="button" title={t.title} onMouseDown={(e) => e.preventDefault()} onClick={() => run(t.cmd)}>
              <i className={`bi bi-${t.icon}`} />
            </button>
          ),
        )}
      </div>
      <div ref={editor} className="rt-editor" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label} onInput={read} onBlur={read} />
    </div>
  );
}
