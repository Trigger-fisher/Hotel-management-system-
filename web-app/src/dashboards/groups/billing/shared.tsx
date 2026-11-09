'use client';
// What Bills and Advances share in code: the list's filters (tab, search, payment, company, month, page) and keeping the last loaded list on screen.
import { useRef, useState } from 'react';

import type { ListQuery } from '@shared/dashboards/common';

import { usePageSize } from '@/components/ui';

export interface ListFilters {
  tab: string;
  searchText: string;
  mode: string;
  companyId: string;
  month: string;
  page: number;
  query: ListQuery & { mode?: string; companyId?: string; month?: string };
  setTab: (t: string) => void;
  setSearch: (s: string) => void;
  setMode: (m: string) => void;
  setCompany: (c: string) => void;
  setMonth: (m: string) => void;
  setPage: (p: number) => void;
  reset: () => void;
  active: boolean;
}

export const PAGE_SIZE = 10;

/** Tabs, search (debounced), the three "narrow down" choices and the page. */
export function useListFilters(initialSearch = ''): ListFilters {
  const [tab, setTabState] = useState('all');
  const [searchText, setSearchText] = useState(initialSearch);
  const [search, setSearchValue] = useState(initialSearch);
  const [mode, setModeState] = useState('');
  const [companyId, setCompanyState] = useState('');
  const [month, setMonthState] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = usePageSize(PAGE_SIZE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSearch = (s: string) => {
    setSearchText(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSearchValue(s);
      setPage(1);
    }, 250);
  };
  const reset = () => {
    if (timer.current) clearTimeout(timer.current);
    setTabState('all');
    setSearchText('');
    setSearchValue('');
    setModeState('');
    setCompanyState('');
    setMonthState('');
    setPage(1);
  };
  const withPage1 = (fn: (v: string) => void) => (v: string) => {
    fn(v);
    setPage(1);
  };

  return {
    tab, searchText, mode, companyId, month, page,
    query: { tab, search, mode: mode || undefined, companyId: companyId || undefined, month: month || undefined, page, pageSize },
    setTab: withPage1(setTabState),
    setSearch,
    setMode: withPage1(setModeState),
    setCompany: withPage1(setCompanyState),
    setMonth: withPage1(setMonthState),
    setPage,
    reset,
    active: tab !== 'all' || !!searchText || !!mode || !!companyId || !!month,
  };
}

/** Keeps the last loaded value so filters stay on screen while the list reloads. */
export function useLast<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value);
  if (value !== null && value !== last) setLast(value);
  return value ?? last;
}
