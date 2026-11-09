'use client';

// Small pieces the Master Data screens share.
import { type MasterList } from '@shared/dashboards/admin';

import { trf } from '@/lib/i18n/language';
/** The words of a search box, as master-search.js: every word must be found in any order. */
export const wordsOf = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);
export const matchesWords = (text: string, words: string[]): boolean => words.every((w) => text.toLowerCase().includes(w));
export const iconOf = (icon: string | null): string => (icon ?? 'bi-list-ul').replace(/^bi-/, '');

/** The sections of a group (Receiver Names, Miscellaneous): `.msec` tabs that open the sibling list. */
export function Sections({ list, onPick }: { list: MasterList; onPick: (setKey: string) => void }) {
  if (list.sections.length === 0) return null;
  return (
    <span className="msec" role="tablist" aria-label={trf("{0} lists", [list.placement?.groupName ?? list.set.name])}>
      {list.sections.map((tab) => (
        <a key={tab.key} href="#" className={`msec-tab ${tab.active ? 'active' : ''}`} role="tab" aria-selected={tab.active} onClick={(e) => { e.preventDefault(); onPick(tab.setKey); }}>
          {tab.name}
        </a>
      ))}
    </span>
  );
}

