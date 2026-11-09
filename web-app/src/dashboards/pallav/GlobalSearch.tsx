'use client';

// The search of the top bar: one field that finds screens (from the role's own menu, no request), then bills, advances, companies, customers,
// staff, reservations and guests (from the server, after 2 characters (the dev mock also takes one digit), and a 150 ms pause). `/` and Ctrl+K open it; arrows, Enter and Esc work it.
// It looks like Pallav's own list search (`.search-field` + the `.pms-predict` panel of pms-live.js) and does not move or fade anything.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import {
  SEARCH_DEBOUNCE_MS, searchCopy, searchKinds, searchScreens, searchable, type SearchApi, type SearchHit, type SearchScreen,
} from '@shared/dashboards/search';
import { apiMode } from '@/lib/api/mode';
import { Bi } from './Bi';

import { tr, trf } from '@/lib/i18n/language';
/** One digit alone ("7") is searched only by the dev mock: the real server answers empty under 2 characters and counts the request. */
const enough = (q: string) => searchable(q, apiMode() === 'mock');

export interface GlobalSearchProps {
  screens: SearchScreen[];
  api: SearchApi;
  /** Where a server hit opens. */
  target: (hit: SearchHit) => { viewId: string; params: Record<string, string> };
  onOpen: (viewId: string, params: Record<string, string>) => void;
  /** Keys of the recent list in this browser (one per person). */
  storageKey: string;
  /** Key of the "last opened" times of screens (see `noteVisit`); screens opened lately come first. */
  usedKey?: string;
}

/** Remembers when a screen was opened, so the search can put the ones in use first. */
export function noteVisit(key: string, viewId: string): void {
  try {
    const map = readUsed(key);
    map[viewId] = Date.now();
    const keep = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 60);
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* private window */
  }
}

function readUsed(key: string | undefined): Record<string, number> {
  if (!key) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

interface Row {
  key: string;
  icon: string;
  label: string;
  meta: string;
  viewId: string;
  params: Record<string, string>;
}
interface Group {
  title: string;
  rows: Row[];
}

const RECENT_MAX = 20;

function readRecent(key: string): Row[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as Row[]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function typing(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/** Bold the part of the title the person typed. */
function mark(text: string, q: string): ReactNode {
  const words = q.trim().split(/\s+/).filter((w) => w.length >= 1);
  if (!words.length) return text;
  const at = words.map((w) => text.toLowerCase().indexOf(w.toLowerCase())).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const word = words.find((w) => text.toLowerCase().indexOf(w.toLowerCase()) === at);
  if (at === undefined || !word) return text;
  return (
    <>
      {text.slice(0, at)}
      <b>{text.slice(at, at + word.length)}</b>
      {text.slice(at + word.length)}
    </>
  );
}

export function GlobalSearch({ screens, api, target, onOpen, storageKey, usedKey }: GlobalSearchProps) {
  const [used, setUsed] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState('');
  const [recent, setRecent] = useState<Row[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const listId = useId();

  const show = () => {
    setUsed(readUsed(usedKey));
    setRecent(readRecent(storageKey));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQ('');
    setHits([]);
    setError(null);
    setAsked('');
    setActive(0);
    if (timer.current) clearTimeout(timer.current);
    button.current?.focus({ preventScroll: true });
  };

  // `/` and Ctrl+K / Cmd+K from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(document.activeElement);
      if (ctrlK || slash) {
        e.preventDefault();
        setUsed(readUsed(usedKey));
        setRecent(readRecent(storageKey));
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [storageKey, usedKey]);

  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);

  const ask = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    const text = value.trim();
    if (!enough(text)) {
      seq.current += 1;
      setHits([]);
      setBusy(false);
      setError(null);
      setAsked('');
      return;
    }
    setBusy(true);
    timer.current = setTimeout(() => {
      const mine = ++seq.current;
      void api.search(text).then((res) => {
        if (mine !== seq.current) return;
        setBusy(false);
        setAsked(text);
        if (res.ok) {
          setError(null);
          setHits(res.data.hits);
        } else {
          setHits([]);
          setError(res.error.code === 'RATE_LIMITED' ? searchCopy.tooMany : res.error.message && res.error.message !== res.error.code ? res.error.message : searchCopy.failed);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
  };

  const groups: Group[] = [];
  const typed = enough(q);
  if (typed) {
    const found = searchScreens(screens, q, 5, used);
    if (found.length) groups.push({ title: searchCopy.screens, rows: found.map((s) => ({ key: `screen:${s.id}`, icon: s.icon, label: s.label, meta: s.section, viewId: s.id, params: {} })) });
    for (const k of searchKinds) {
      // Records opened from the search before come first within their group.
      const seen = (h: SearchHit) => { const i = recent.findIndex((r) => r.key === `${h.kind}:${h.id}`); return i < 0 ? RECENT_MAX : i; };
      const mine = hits.filter((h) => h.kind === k.kind).sort((a, b) => seen(a) - seen(b));
      if (!mine.length) continue;
      groups.push({
        title: k.label,
        rows: mine.map((h) => {
          const t = target(h);
          return { key: `${h.kind}:${h.id}`, icon: k.icon, label: h.title, meta: h.subtitle, viewId: t.viewId, params: t.params };
        }),
      });
    }
  } else if (recent.length) {
    groups.push({ title: searchCopy.recent, rows: recent });
  }
  const rows = groups.flatMap((g) => g.rows);
  let counter = 0;
  const indexed = groups.map((g) => ({ title: g.title, rows: g.rows.map((r) => ({ r, index: counter++ })) }));
  const current = Math.min(active, Math.max(0, rows.length - 1));

  const pick = (row: Row) => {
    const next = [row, ...readRecent(storageKey).filter((r) => r.key !== row.key)].slice(0, RECENT_MAX);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* private window */
    }
    close();
    onOpen(row.viewId, row.params);
  };

  const forget = () => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* private window */
    }
    setRecent([]);
  };

  const total = rows.length;
  const settled = typed && !busy && !error && asked === q.trim();

  return (
    <>
      <button /* check-shared-ignore: the shell search trigger */ ref={button} type="button" className="gs-btn" aria-haspopup="dialog" aria-expanded={open} aria-label={`${searchCopy.button} (/)`} title={trf("{0} (/ or Ctrl+K)", [searchCopy.button])} onClick={show}>
        <Bi name="search" />
        <span className="gs-btn-text">{searchCopy.button}</span>
        <kbd>/</kbd>
      </button>
      {open && (
        <div className="gs-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="gs-panel" role="dialog" aria-modal="true" aria-label={searchCopy.button}>
            <div className={`search-field pms-live-field ${busy ? 'is-loading' : ''} ${rows.length ? 'pp-open' : ''}`}>
              <i className="bi bi-search" aria-hidden="true" />
              <input
                ref={input}
                type="search"
                className="form-control"
                role="combobox"
                aria-expanded={total > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={total ? `${listId}-${current}` : undefined}
                autoComplete="off"
                placeholder={searchCopy.placeholder}
                aria-label={searchCopy.button}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                  ask(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    close();
                  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (total) setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % total : (i - 1 + total) % total));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const row = rows[current];
                    if (row) pick(row);
                  }
                }}
              />
            </div>
            <div className="pms-predict gs-results" id={listId} role="listbox" aria-label={tr("Results")}>
              {groups.length === 0 && !error && (
                <div className="pp-empty">{typed ? (settled ? searchCopy.none(q.trim()) : '…') : searchCopy.hint}</div>
              )}
              {error && <div className="pp-empty">{error}</div>}
              {indexed.map((g) => (
                <div key={g.title}>
                  <div className="pp-head">
                    <span>{g.title}</span>
                    {g.title === searchCopy.recent && (
                      <button /* check-shared-ignore: the search panel's own clear-history link */ type="button" className="pp-clear" onClick={forget}>{searchCopy.clear}</button>
                    )}
                  </div>
                  {g.rows.map(({ r, index }) => (
                    <button key={r.key} id={`${listId}-${index}`} type="button" role="option" aria-selected={index === current} tabIndex={-1}
                      className={`pp-item ${index === current ? 'on' : ''}`} onMouseMove={() => setActive(index)} onClick={() => pick(r)}>
                      <i className={`bi bi-${g.title === searchCopy.recent ? 'clock-history' : r.icon} pp-ico`} aria-hidden="true" />
                      <span className="pp-text">
                        <span className="pp-label">{g.title === searchCopy.recent ? r.label : mark(r.label, q)}</span>
                        {r.meta && <span className="pp-meta">{r.meta}</span>}
                      </span>
                      <i className="bi bi-arrow-return-left pp-go" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ))}
              {busy && groups.length > 0 && <div className="pp-empty">…</div>}
              <div className="pp-foot">
                <span><kbd>↑</kbd><kbd>↓</kbd> {tr("move")}</span>
                <span><kbd>{tr("Enter")}</kbd> {tr("open")}</span>
                <span><kbd>{tr("Esc")}</kbd> {tr("close")}</span>
                <span className="visually-hidden" aria-live="polite">{settled ? `${total} results` : ''}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
