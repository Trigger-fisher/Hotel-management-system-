'use client';

// The row of four figures on top of the Email and WhatsApp pages (the shared KPI cards). A tap opens exactly those threads; a second tap clears it.
import { KpiCard } from '../overview/HomeJobs';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type { ConversationList, ConversationRow, ConvTab } from '@shared/dashboards/conversations';

import { useCountUp } from '../overview/HomeJobs';
import { CHAT_KPIS, inKpi, KPI_TEXT, kpiCounts, kpiTab, MAIL_KPIS, type InboxKind, type InboxKpi } from './inboxFigures';

import { tr } from '@/lib/i18n/language';

/** The figure picked on each page and the folder it was picked in (module memory: kept between the list and a thread, never stored). */
const memory: Record<InboxKind, { key: string; pick: InboxKpi | null }> = { mail: { key: '', pick: null }, chat: { key: '', pick: null } };
/** The chats last loaded (All), for "Reply window closing" while another list is shown. */
const seen: { openChats: readonly ConversationRow[] | null } = { openChats: null };

export interface InboxKpiState<Q> {
  kind: InboxKind;
  pick: InboxKpi | null;
  setPick: (k: InboxKpi | null) => void;
  /** The list query with the picked figure's tab (and Email folder) in place. */
  query: Q;
  /** The loaded rows that belong to the picked figure (all of them when none is picked). */
  only: (rows: readonly ConversationRow[], me: string) => ConversationRow[];
}

/** `resetKey` names the folder or filter the person is in: changing it clears the pick. */
export function useInboxKpis<Q extends { tab?: ConvTab; folder?: string }>(kind: InboxKind, resetKey: string, query: Q): InboxKpiState<Q> {
  const [state, setState] = useState(() => (memory[kind].key === resetKey ? memory[kind] : { key: resetKey, pick: null }));
  const pick = state.key === resetKey ? state.pick : null;
  const setPick = (k: InboxKpi | null) => {
    memory[kind] = { key: resetKey, pick: k };
    setState(memory[kind]);
  };
  const picked = useMemo(() => (pick ? ({ ...query, tab: kpiTab(pick), ...(kind === 'mail' ? { folder: pick } : {}) } as Q) : query), [pick, query, kind]);
  const only = (rows: readonly ConversationRow[], me: string) => (pick ? rows.filter((r) => inKpi(kind, pick, r, me)) : [...rows]);
  return { kind, pick, setPick, query: picked, only };
}

/** The figures already shown in this tab: a figure counts up the first time only, never again when the page or the box comes back. */
const shownOnce = new Set<string>();

function Figure({ id, value }: { id: string; value: number }) {
  const counted = useCountUp(value);
  const [first] = useState(() => !shownOnce.has(id));
  useEffect(() => {
    shownOnce.add(id);
  }, [id]);
  return <>{first ? Math.round(counted) : value}</>;
}

/** The page root (.ibx-fit) fills the screen under the top bar: its real top, and the padding and margins of the shell below it, go into --ibx-top and --ibx-bottom. */
function useFit(box: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = box.current?.closest<HTMLElement>('.ibx-fit');
    if (!el) return;
    const fit = () => {
      let below = 0;
      for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        below += (parseFloat(s.paddingBottom) || 0) + (parseFloat(s.marginBottom) || 0) + (parseFloat(s.borderBottomWidth) || 0);
      }
      el.style.setProperty('--ibx-top', `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`);
      el.style.setProperty('--ibx-bottom', `${Math.ceil(below)}px`);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(document.body);
    if (el.parentElement) watch.observe(el.parentElement);
    window.addEventListener('resize', fit);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [box]);
}

const ICON: Record<string, string> = { all: 'chat-dots', unread: 'envelope', waiting: 'hourglass-split', mine: 'person-check', unassigned: 'person-dash', closing: 'stopwatch' };

export function InboxKpis<Q extends { tab?: ConvTab }>({ kpi, list, onPicked }: { kpi: InboxKpiState<Q>; list: ConversationList | null | undefined; onPicked?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useFit(box);
  const fresh = kpi.kind === 'chat' && list && kpi.query.tab === 'all' ? list.items : null;
  useEffect(() => {
    if (fresh) seen.openChats = fresh;
  }, [fresh]);
  const counts = kpiCounts(kpi.kind, list?.counts, kpi.kind === 'chat' ? (fresh ?? seen.openChats) : null);
  const ids = kpi.kind === 'mail' ? MAIL_KPIS : CHAT_KPIS;
  const tap = (id: InboxKpi) => {
    kpi.setPick(kpi.pick === id ? null : id);
    onPicked?.();
  };
  return (
    <div ref={box} className={`kpi-grid ibx-kpis is-${kpi.kind}`} role="group" aria-label={tr('Figures')}>
      {ids.map((id) => {
        const t = KPI_TEXT[kpi.kind][id];
        const n = counts[id];
        const on = kpi.pick === id;
        return (
          <KpiCard
            key={id}
            label={t.label}
            value={n === null || n === undefined ? '-' : <Figure id={`${kpi.kind}.${id}`} value={n} />}
            note={t.note}
            tone={id === 'closing' ? (n ? 'due' : 'month') : undefined}
            icon={ICON[id]}
            num={n ?? 0}
            className={on ? 'is-on' : ''}
            pressed={on}
            onOpen={() => tap(id)}
          />
        );
      })}
    </div>
  );
}
