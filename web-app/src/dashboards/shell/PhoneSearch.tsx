'use client';

// Page search in the phone app bar (MJ, 18 Oct): a search icon at the left of the app bar on pages that have a search; tapping it opens a field over the bar (the
// title hides) that says "Search <page>". It does not search by itself: it types into the page's own search box (the ListSearch / search field in the page head),
// so each page keeps its own rules. The page's own box is hidden on phones while this one stands in for it. Esc, the arrow or the phone's Back closes it; what was typed stays.
import { useEffect, useMemo, useRef, useState } from 'react';

import { Bi } from '../pallav/Bi';

import { tr } from '@/lib/i18n/language';
const SOURCE = '#dash-content .page-head input[type="search"], #dash-content .page-head .search-field input, #dash-content .pay-toolbar input';
const MARK = 'data-phone-search-src';

/** Set when the search field steps back out of its own history entry; the shell's popstate handler can skip that step (no new page, no refetch). */
export const phoneSearchClosing = { at: 0 };
/** The shell asks: was this popstate only the search field closing (within the last half second)? */
export const isPhoneSearchClosing = (): boolean => Date.now() - phoneSearchClosing.at < 500;
/** The shell asks before it adds a page: is the current entry the search field's own (then the new page replaces it instead of stacking on top)? */
export const onPhoneSearchEntry = (): boolean => Boolean((window.history.state as { hmsPhoneSearch?: boolean } | null)?.hmsPhoneSearch);

/** A page of a portal that the app bar search can jump to (the guest and company portals: a page with no search box of its own still gets the icon). */
export interface PhonePage {
  id: string;
  label: string;
  icon: string;
}

/** Types into a React-controlled input the way a person would, so the page's own onChange runs. */
function typeInto(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function PhoneSearch({ title, pages, onGoPage }: { title: string; pages?: PhonePage[]; onGoPage?: (id: string) => void }) {
  const [source, setSource] = useState<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const field = useRef<HTMLInputElement>(null);

  // the page's own search box, now and whenever the page changes
  useEffect(() => {
    const root = document.getElementById('dash-content');
    if (!root) return undefined;
    const find = () => {
      const input = document.querySelector<HTMLInputElement>(SOURCE);
      setSource((old) => (old === input ? old : input));
    };
    find();
    const obs = new MutationObserver(find);
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  // mark the box's row so the stylesheet hides it on phones; follow what the page holds
  useEffect(() => {
    if (!source) return undefined;
    const row = source.closest('.pay-toolbar, .search-field') ?? source;
    row.setAttribute(MARK, '');
    const follow = () => setValue(source.value);
    source.addEventListener('input', follow);
    return () => {
      row.removeAttribute(MARK);
      source.removeEventListener('input', follow);
    };
  }, [source]);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  // The phone's (or browser's) Back closes the open field first: opening adds one history entry with the same address and the same page stack (the shell's own
  // Back handler then shows the same page) and Back takes it away. Closing by Esc or the arrow steps back out of that entry; only then (d3: under React's
  // StrictMode an effect cleanup would step back too early and close the field it had just opened).
  useEffect(() => {
    if (!open) return undefined;
    const onPop = () => setOpen(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open]);
  const openField = () => {
    window.history.pushState({ ...((window.history.state as object | null) ?? {}), hmsPhoneSearch: true }, '', window.location.pathname + window.location.search);
    setOpen(true);
  };
  // a tap on the top bar's title (PallavShell) opens the field too
  const canOpen = Boolean(source) || Boolean(pages && pages.length > 0 && onGoPage);
  useEffect(() => {
    if (!canOpen) return undefined;
    const onTitle = () => {
      if (open) return;
      setValue(source?.value ?? '');
      openField();
    };
    window.addEventListener('hms:phone-search', onTitle);
    return () => window.removeEventListener('hms:phone-search', onTitle);
  });
  const closeField = () => {
    setOpen(false);
    if ((window.history.state as { hmsPhoneSearch?: boolean } | null)?.hmsPhoneSearch) {
      // tells the shell's Back handler that this step only closed the search (phoneSearchClosing): the page stays as it is
      phoneSearchClosing.at = Date.now();
      window.history.back();
    }
  };
  // No search box on this page (a portal's Dashboard, Order, My profile): the bar finds the portal's own pages ("bills" -> Bills, Due bills) and opens the one tapped.
  const hits = useMemo(() => {
    const words = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!pages || words.length === 0) return [];
    return pages.filter((p) => words.every((w) => p.label.toLowerCase().includes(w))).slice(0, 8);
  }, [pages, value]);
  if (!source && !(pages && pages.length > 0 && onGoPage)) return null;
  const shown = open;
  const query = open ? value : (source?.value ?? '');
  const label = source ? `Search ${title}` : 'Search bills, payments or pages';
  return (
    <>
      {/* check-shared-ignore: the app bar's own round button, drawn like the shell's other top-bar buttons */}
      <button type="button" className={`theme-btn tb-search ${query ? 'has-query' : ''}`} aria-label={label} title={label} aria-expanded={open} onClick={() => {
          setValue(source?.value ?? '');
          openField();
        }}>
        <Bi name="search" />
      </button>
      {shown ? (
        <div className="tb-search-bar" role="search">
          {/* check-shared-ignore: closes the app bar search */}
          <button type="button" className="theme-btn" aria-label={tr("Close the search")} onClick={closeField}>
            <Bi name="arrow-left" />
          </button>
          <input
            ref={field}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label={label}
            placeholder={`${label}…`}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (source) typeInto(source, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeField();
              if (e.key === 'Enter') field.current?.blur();
            }}
          />
          {value ? (
            // check-shared-ignore: clears the app bar search
            <button
              type="button"
              className="theme-btn"
              aria-label={tr("Clear the search")}
              onClick={() => {
                setValue('');
                if (source) typeInto(source, '');
                field.current?.focus();
              }}
            >
              <Bi name="x-lg" />
            </button>
          ) : null}
        </div>
      ) : null}
      {shown && !source && hits.length > 0 ? (
        <ul className="tb-search-results" aria-label={tr("Matches")}>
          {hits.map((h) => (
            <li key={h.id}>
              {/* check-shared-ignore: a result row of the app bar search */}
              <button
                type="button"
                onClick={() => {
                  // the search's own history entry stays: the shell replaces it with the page we go to (onPhoneSearchEntry)
                  setOpen(false);
                  setValue('');
                  onGoPage?.(h.id);
                }}
              >
                <Bi name={h.icon} /> <span>{h.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
