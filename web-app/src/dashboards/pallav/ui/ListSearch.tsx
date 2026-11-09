'use client';

// THE page-head list search (decision 51), taken from the Handover page (cashbook/_search.blade.php): a search box in the page head, first among the page's
// tools and left of its main button, with a clear cross while there is text. The page keeps what is typed, waits 250 ms (useDebounced), goes back to page 1 and asks its
// list route for `search`; while it loads the old rows stay. The hint on the box promises only what the page supports: plain words everywhere ("several words must all match");
// the cash books (Revenue, Expenses) also take "exact phrase", -leave out, >5000, <500 and 500-2000, and say so with `operators`.
// It is `SearchBox` (SearchBox.tsx) with the page-head defaults; `SearchField` and the portals' `PtSearchBox` are the same box with other options.
import { SEARCH_WORDS_TITLE, SearchBox } from './SearchBox';

export interface ListSearchProps {
  value: string;
  onChange: (v: string) => void;
  /** What the page searches, e.g. "Search handovers"; the box adds the dots. */
  placeholder: string;
  onClear?: () => void;
  /** Only the cash books understand "phrase", -not, >, < and ranges. */
  operators?: boolean;
  /** `portal` is the Guest and Company portals' look (their own input, no icon). */
  theme?: 'hotel' | 'portal';
  /** Another wrapper than the page head's `pay-toolbar` (`cb-search`, `log-search`), and the roomy `.smart` field. */
  wrapClass?: string;
  smart?: boolean;
  /** The accessible name; default "Search the list". */
  label?: string;
  title?: string;
}

const OPERATORS = 'Tips: several words must all match, "exact phrase", -leave out, >5000, <500, 500-2000';

export function ListSearch({ value, onChange, placeholder, onClear, operators = false, theme = 'hotel', wrapClass = 'pay-toolbar', smart = false, label = 'Search the list', title }: ListSearchProps) {
  const text = /(…|\.\.\.)$/.test(placeholder) ? placeholder : `${placeholder}…`;
  return (
    <SearchBox
      theme={theme}
      value={value}
      onChange={onChange}
      onClear={onClear}
      placeholder={text}
      label={label}
      title={title ?? (operators ? OPERATORS : SEARCH_WORDS_TITLE)}
      wrapClass={wrapClass}
      smart={smart}
    />
  );
}
