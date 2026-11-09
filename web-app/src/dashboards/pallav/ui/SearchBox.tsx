'use client';

// THE search box of every list page (decision 51, R11): one markup, one behaviour. `ListSearch` (the page-head box, taken from the Handover page), `SearchField` (the
// box with Pallav's Blade wrappers and the payroll slots) and the portals' `PtSearchBox` are all this component with different options, so a change here changes
// every list page. Typing goes straight to `onChange`; Escape or the clear cross empties the box (through `onClear` when the page needs to do more, e.g. go back
// to page 1). The hotel theme is Pallav's `.search-field` (icon, `form-control`, `.search-clear`); the portal theme is the portals' `.pt-input`.
import { Bi } from '../Bi';
import { TextAction } from './TextAction';

export interface SearchBoxProps {
  value: string;
  onChange: (q: string) => void;
  placeholder: string;
  /** The accessible name of the box. */
  label: string;
  /** What the box tells on hover; the default promises only "every word must match". */
  title?: string;
  /** Called instead of `onChange('')` when the person clears the box (Escape or the cross). */
  onClear?: () => void;
  /** `hotel` (default): Pallav's `.search-field`. `portal`: the Guest and Company portals' own input look. */
  theme?: 'hotel' | 'portal';
  /**
   * The wrapper Pallav's Blade puts around the field: `pay-toolbar`, `cb-search`, `log-search` ... Rendered as `<form role="search">` (or a plain `<div>` with
   * `wrapTag="div"`) holding `div.search-field`. Without it the old shape stays: `form.search-field.mb-0`, or with `bare` only `div.search-field` (payroll slots).
   */
  wrapClass?: string;
  wrapTag?: 'form' | 'div';
  bare?: boolean;
  /** `.search-field.smart` (room for the clear cross). */
  smart?: boolean;
  /** Extra classes on `div.search-field` (`mb-0`, `bm-fbar-search`, `se-pick-search`). */
  fieldClass?: string;
  clearLabel?: string;
}

export const SEARCH_WORDS_TITLE = 'Type one word or several: every word must match.';

export function SearchBox({ value, onChange, placeholder, label, title, onClear, theme = 'hotel', wrapClass, wrapTag = 'form', bare = false, smart = false, fieldClass = '', clearLabel = 'Clear search' }: SearchBoxProps) {
  const clear = () => (onClear ? onClear() : onChange(''));
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && value !== '') {
      e.preventDefault();
      e.stopPropagation();
      clear();
    }
  };

  if (theme === 'portal') {
    return (
      // the same parts as every other search (icon, field, clear), so one glass style and its motion serve all (MJ, 26 Oct 2026: "the search bar is not good")
      <div className="pt-form search-field mb-3" role="search">
        <Bi name="search" />
        <input className="pt-input" type="search" autoComplete="off" value={value} placeholder={placeholder} aria-label={label} title={title ?? SEARCH_WORDS_TITLE} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
        {value !== '' && <TextAction kind="clear" title={clearLabel} aria-label={clearLabel} onClick={clear} />}
      </div>
    );
  }

  const inner = (
    <>
      <Bi name="search" />
      <input type="search" className="form-control" autoComplete="off" value={value} placeholder={placeholder} aria-label={label} title={title ?? SEARCH_WORDS_TITLE} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
      {value !== '' && <TextAction kind="clear" title={clearLabel} aria-label={clearLabel} onClick={clear} />}
    </>
  );
  const cls = `search-field ${smart ? 'smart' : ''} ${fieldClass}`.replace(/\s+/g, ' ').trim();
  if (wrapClass) {
    const field = <div className={cls}>{inner}</div>;
    return wrapTag === 'div' ? (
      <div className={wrapClass}>{field}</div>
    ) : (
      <form className={wrapClass} role="search" onSubmit={(e) => e.preventDefault()}>
        {field}
      </form>
    );
  }
  if (bare) return <div className={cls}>{inner}</div>;
  return (
    <form className={`${cls} mb-0`} onSubmit={(e) => e.preventDefault()}>
      {inner}
    </form>
  );
}
