'use client';

// What the Website screens share: Pallav's date formats (d/m/Y, d M Y, h:i A), the drag-into-order behaviour of
// website-admin.js, a picture stand-in until real uploads exist, and the small rich-text box of the Content page.
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';

import type { DashResult } from '@shared/dashboards/common';
import { formatDate, formatTime } from '@shared/dashboards/format';
import { WEB_ICON_MAX_BYTES, WEB_PHOTO_MAX_BYTES, WEBSITE_URL, websiteCopy, type WebDirection, type WebFileInput } from '@shared/dashboards/website';
import { useToast } from '@/components/ui';
import { apiMode } from '@/lib/api/mode';
import { FIT_MAX_BYTES, fitImage, isFitError } from '@/lib/image/fitImage';
import { useLabelLink, Button } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';

import { tr, trf } from '@/lib/i18n/language';
/** A picked file as the API takes it, or the friendly sentence why it cannot be used. */
type PickedFile = { ok: true; file: WebFileInput } | { ok: false; error: string };

const megabytes = (bytes: number): string => String(Math.round((bytes / 1_048_576) * 10) / 10);

/**
 * Reads a picked file for the server (FileReader -> base64). The picture is first made to fit (fitImage: drawn smaller and saved as JPG,
 * or PNG when it is see-through, until it is under 3 MB for photos and under the 2 MB icon / logo limit); a picture that still does not
 * fit, or is not a picture, is refused here with a plain sentence and never sent. The server still checks the real type and size.
 * The mock keeps only the name, so it sends no bytes.
 */
export async function readPicked(original: File, kind: 'photo' | 'icon'): Promise<PickedFile> {
  const L = websiteCopy.lists;
  const limit = Math.min(FIT_MAX_BYTES, kind === 'photo' ? WEB_PHOTO_MAX_BYTES : WEB_ICON_MAX_BYTES);
  let file: File;
  try {
    file = (await fitImage(original, { maxBytes: limit })).file;
  } catch (e) {
    if (isFitError(e) && e.code === 'TOO_LARGE') {
      return { ok: false, error: e.shrinkable ? L.imageStillTooBig(original.name, megabytes(limit)) : L.imageCannotShrink(original.name, megabytes(limit)) };
    }
    return { ok: false, error: L.imageNotPicture(original.name) };
  }
  if (apiMode() === 'mock') return { ok: true, file: { fileName: file.name, dataBase64: '' } };
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve({ ok: false, error: L.fileUnreadable(file.name) });
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const comma = text.indexOf(',');
      resolve(comma < 0 ? { ok: false, error: L.fileUnreadable(file.name) } : { ok: true, file: { fileName: file.name, dataBase64: text.slice(comma + 1) } });
    };
    reader.readAsDataURL(file);
  });
}

const IST = 'Asia/Kolkata';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plain = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Year, month (1-12) and day of a plain date or of a timestamp (shown in IST). */
function ymd(v: string): [string, number, string] {
  if (plain(v)) return [v.slice(0, 4), Number(v.slice(5, 7)), v.slice(8, 10)];
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(v));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return [get('year'), Number(get('month')), get('day')];
}

/** 06 Oct 2026 */
export const dmy = (v: string | null | undefined): string => (v ? formatDate(v) : '-');
/** 06 Oct 2026 */
export const dMY = (v: string): string => {
  const [y, m, d] = ymd(v);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
/** 06 Oct */
export const dM = (v: string): string => {
  const [, m, d] = ymd(v);
  return `${d} ${MONTHS[m - 1]}`;
};
/** Mon */
export const dayShort = (v: string): string => new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
/** 9:30 am */
export const time12 = (iso: string): string => formatTime(iso);

/** "06 Oct 2026" or "06 Oct - 08 Oct 2026". */
export const rangeText = (b: { start: string; end: string }): string => (b.start === b.end ? dMY(b.start) : `${dM(b.start)} - ${dMY(b.end)}`);

export const plural = (n: number, word: string): string => (n === 1 ? word : `${word}s`);

/** PHP number_format($n): 1234 -> "1,234". */
export const count = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* ------------------------------------------------------------------ section tabs */

export type WaTab = 'overview' | 'enquiries' | 'rooms' | 'rates' | 'calendar' | 'gallery' | 'content' | 'services' | 'policies' | 'nearby' | 'settings';

const WA_TABS: [WaTab, string, string, string][] = [
  ['overview', 'hotel.web.overview', 'Overview', 'globe2'],
  ['enquiries', 'hotel.web.enquiries', 'Enquiries', 'inbox'],
  ['rooms', 'hotel.web.rooms', 'Rooms', 'door-open'],
  ['rates', 'hotel.web.rates', 'Rates', 'tag'],
  ['calendar', 'hotel.web.calendar', 'Calendar', 'calendar'],
  ['gallery', 'hotel.web.gallery', 'Gallery', 'image'],
  ['content', 'hotel.web.content', 'Content', 'card-text'],
  ['services', 'hotel.web.services', 'Services', 'stars'],
  ['policies', 'hotel.web.policies', 'House rules', 'journal-check'],
  ['nearby', 'hotel.web.nearby', 'Nearby', 'geo-alt'],
  ['settings', 'hotel.web.settings', 'Settings', 'gear'],
];

/** The Website section's row of tabs and "View site". The second panel lists the same pages, so on a desktop with the panel open only "View site" shows (guest-glass.css, .wa-nav-site); on a phone or with the panel hidden the tabs come back. The tabs use the panel's names and symbols. */
export function WaNav({ active, navigate }: { active: WaTab; navigate: ScreenProps['navigate'] }) {
  return (
    <nav className="wa-nav wa-nav-site reveal" aria-label={tr("Website sections")}>
      {WA_TABS.map(([id, view, label, icon]) => (
        <a
          key={id}
          href="#"
          className={`wa-tab ${active === id ? 'active' : ''}`}
          aria-current={active === id ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate(view);
          }}
        >
          <i className={`bi bi-${icon}`} /> <span>{label}</span>
        </a>
      ))}
      <a href={WEBSITE_URL} className="wa-tab wa-live" target="_blank" rel="noopener" title={tr("Open the live website")}>
        <i className="bi bi-box-arrow-up-right" /> <span>{tr("View site")}</span>
      </a>
    </nav>
  );
}

/** Rupees as the form boxes show them, paise as the data keeps them. */
export const rupees = (paise: number): string => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));
export const paiseOf = (text: string): number | null => {
  const n = Number.parseFloat(text);
  return text.trim() === '' || Number.isNaN(n) ? null : Math.round(n * 100);
};

/* ------------------------------------------------------------------ pictures */

const TINTS = [265, 330, 28, 160, 205, 45];

/** A picture stand-in: Pallav shows the uploaded image here; until uploads exist it is a soft tint (the shade picks it). */
export function Shade({ shade, label, style, className = '' }: { shade: number; label?: string; style?: CSSProperties; className?: string }) {
  const h = TINTS[Math.abs(shade) % TINTS.length] ?? 265;
  return (
    <div
      className={className}
      role="img"
      aria-label={label || 'Photo'}
      // check-shared-ignore: a placeholder picture generated from a hue (data driven)
      style={{ background: `linear-gradient(135deg, hsl(${h} 55% 78%), hsl(${h} 45% 55%))`, ...style }}
    />
  );
}

/**
 * A photo: the real picture when the server sent its URL (an <img>, lazy like Pallav's), else the tinted stand-in (the mock has no files).
 * The URL is a same-origin route of the signed-in hotel (/api/v1/website/media/<file>), served with the session.
 */
export function Picture({ url, shade, label, style, className = '' }: { url?: string | null; shade: number; label?: string; style?: CSSProperties; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- a stored user upload behind the session, not a static asset
  if (url) return <img className={className} src={url} alt={label || 'Photo'} loading="lazy" decoding="async" style={{ objectFit: 'cover', ...style }} />;
  return <Shade shade={shade} label={label} style={style} className={className} />;
}

/* ------------------------------------------------------------------ drag into order */

type MoveCall = (id: string, dir: WebDirection) => Promise<DashResult<unknown>>;

/**
 * website-admin.js "Dragging a list into order": only a drag that starts on the handle moves a card, the card follows
 * the pointer through the list, and on drop the new order is saved. The mock saves a step at a time, so the drop is turned
 * into the steps that make it.
 */
export function useReorder<T extends { id: string }>(items: T[], move: MoveCall, onDone: () => void) {
  const toast = useToast();
  const [order, setOrder] = useState<string[] | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const live = useRef<string[] | null>(null);

  const ids = items.map((i) => i.id);
  const shown = order && order.length === ids.length && order.every((x) => ids.includes(x)) ? order : ids;
  const ordered = shown.map((id) => items.find((i) => i.id === id)).filter((x): x is T => Boolean(x));

  async function commit(id: string) {
    const final = live.current;
    live.current = null;
    setDrag(null);
    setArmed(null);
    if (!final) return setOrder(null);
    const delta = final.indexOf(id) - ids.indexOf(id);
    let ok = true;
    for (let n = 0; n < Math.abs(delta) && ok; n++) {
      const res = await move(id, delta < 0 ? 'up' : 'down');
      ok = res.ok;
    }
    toast.show(ok ? { tone: 'success', text: 'Order saved. The website now follows it.' } : { tone: 'error', text: 'The order could not be saved.' });
    setOrder(null);
    onDone();
  }

  const handleProps = (id: string) => ({
    onMouseDown: () => setArmed(id),
    onMouseUp: () => setArmed(null),
  });

  const cardProps = (id: string) => ({
    'data-id': id,
    draggable: armed === id,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      if (armed !== id) return e.preventDefault();
      setDrag(id);
      live.current = shown;
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', id);
      } catch {
        /* some browsers refuse */
      }
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      const cur = live.current;
      if (!drag || !cur || drag === id) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const after = e.clientY - rect.top > rect.height / 2 || (e.clientX - rect.left > rect.width / 2 && rect.height < 120);
      const rest = cur.filter((x) => x !== drag);
      const at = rest.indexOf(id) + (after ? 1 : 0);
      const next = [...rest.slice(0, at), drag, ...rest.slice(at)];
      if (next.join() !== cur.join()) {
        live.current = next;
        setOrder(next);
      }
    },
    onDragEnd: () => void commit(id),
  });

  const dragClass = (id: string) => (drag === id ? ' wa-dragging' : '');
  return { ordered, handleProps, cardProps, dragClass };
}

/** The grip on a draggable card. */
export function Handle({ props }: { props: ReturnType<ReturnType<typeof useReorder>['handleProps']> }) {
  return (
    <span className="wa-handle" title={tr("Drag to reorder")} aria-label={tr("Drag to reorder")} {...props}>
      <i className="bi bi-grip-vertical" aria-hidden="true" />
    </span>
  );
}

/* ------------------------------------------------------------------ rich text */

/** Keeps what the box may hold to Pallav's toolbar: bold, italic, bullets and links. */
export function clean(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (a.name === 'href' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

const BAR: CSSProperties = { display: 'flex', gap: 4, padding: 6, border: '1px solid var(--line)', borderRadius: '10px 10px 0 0', background: 'var(--surface-2, var(--surface))' };
const AREA: CSSProperties = { minHeight: 90, padding: '10px 12px', border: '1px solid var(--line)', borderTop: 0, borderRadius: '0 0 10px 10px', background: 'var(--surface)', color: 'var(--ink)', fontSize: 14, outline: 'none' };

/** Content page's rich-text box (Pallav uses Quill: bold, italic, bullet list, link, clean). */
export function RichText({ value, onChange, label, id, invalid }: { value: string; onChange: (html: string) => void; label: string; id?: string; invalid?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = clean(value);
    // Set once: the box owns its content while it is being typed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };
  const emit = () => {
    const html = ref.current?.innerHTML ?? '';
    onChange(html === '<br>' || html === '<p><br></p>' ? '' : html);
  };
  const tools: [string, string, string][] = [
    ['type-bold', 'Bold', 'bold'], ['type-italic', 'Italic', 'italic'], ['list-ul', 'Bullet list', 'insertUnorderedList'], ['link-45deg', 'Link', 'link'], ['eraser', 'Clear formatting', 'removeFormat'],
  ];
  const press = (cmd: string) => {
    if (cmd !== 'link') return run(cmd);
    const url = window.prompt('Link address (https://...)');
    if (url && /^(https?:|mailto:|tel:)/i.test(url.trim())) run('createLink', url.trim());
  };
  return (
    <div className="rte">
      <div style={BAR} role="toolbar" aria-label={trf("{0} formatting", [label])}>
        {tools.map(([icon, title, cmd]) => (
          <Button variant="ghost" size="sm" key={cmd} title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={() => press(cmd)}> <i className={`bi bi-${icon}`} aria-hidden="true" /></Button>
        ))}
      </div>
      <div ref={ref} className="ql-editor" style={AREA} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" id={id} aria-labelledby={id ? `${id}_lab` : undefined} aria-label={id ? undefined : label} aria-invalid={invalid ? true : undefined} onInput={emit} />
    </div>
  );
}

/** A field box whose label is linked to its control (the shared label-link hook), for hand-made form rows. */
export function Linked({ className, children }: { className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useLabelLink(box, undefined);
  return <div className={className} ref={box}>{children}</div>;
}
