'use client';

// The WhatsApp page of every console (hotel and platform scope; MJ, 5 Nov 2026: "the original WhatsApp theme"), drawn like WhatsApp Web inside HMS's frame: the
// figures on top, the chat list on the left (search, filter chips, rows with ticks, time and the green unread count), the chat on the right (header with
// search in chat, guest card and menu; the wallpaper; bubbles with tails, time and ticks; the composer pill). The number is the hotel's one shared desk
// (MJ, 5 Nov 2026): every chat belongs to the whole team, never assigned or closed. The desk's own work stays: the guest card with the booking and the pay
// link, quick replies, templates, the 24-hour window (outside it only a template goes), pin, labels, contact info and notes.
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type { RazorpayBusiness } from '@shared/dashboards/admin';
import { billBalance, billingCopy } from '@shared/dashboards/billing';
import { channelPageCopy as cp, conversationsCopy as c, whatsappSetupCopy as ws, labelsFor, type ConversationRow, type ConversationThread, type ConvMessage, type ConvPerson, type ConvTab, type QuickReply } from '@shared/dashboards/conversations';
import { userMayEdit } from '@shared/dashboards/features';
import { formatDate, formatDateTime, formatINR } from '@shared/dashboards/format';
import { whatsappCopy as w, type WhatsAppMessage, type WhatsAppTemplate } from '@shared/dashboards/whatsapp';

import { errorText, useDebounced, useToast } from '@/components/ui';
import { Bi, Button, Dropdown, EmptyState, IconButton, LoadError, SegTabs, Skeleton, Textarea } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { adminApi, useAdminActor } from '../admin/api';
import { billingApi } from '../billing/api';

import { convApiFor, setConvActor } from './api';
import { useChannelList, useChannelThread } from './chanHooks';
import { onceValue, readOnce, setOnce } from './convCache';
import { newTempId, runPending, sendNow, usePending, withPending, dropPending } from './outbox';
import { ContactPanel } from './ContactPanel';
import { ConnectionPill } from './ConnectionPill';
import { whatsappConnection } from './connection';
import { InboxKpis, useInboxKpis } from './InboxKpis';
import { initialsOf, listKeyStep, nowMs, whenLabel } from './listKeys';
import { TemplatePicker, type TemplateDefaults } from './TemplatePicker';
import { FilesPanel, MessageInfo, StarredPanel } from './WaPanels';
import { chatHits, dayLabel, DESK_FILTERS, readDraft, startsRun, writeDraft } from './waDesk';
import { tickOf, WaTicks, WhatsAppAutoLine, WhatsAppBubble } from './WhatsAppBubble';

import { tr, trf } from '@/lib/i18n/language';

type DeskFilter = (typeof DESK_FILTERS)[number];
const EMOJIS = ['🙏', '😊', '👍', '✅', '🎉', '❤️', '🛎️', '🏨'] as const;
const LINK_DAYS = 3;
const memory = { filter: 'all' as DeskFilter, search: '', side: null as boolean | null };
/** The guest card beside the chat opens by itself only where the chat keeps room for it; the guest card button shows or hides it after that. */
const WIDE_ENOUGH = '(min-width: 1600px)';
const d = w.desk;

type Api = ReturnType<typeof convApiFor>;
type Scope = 'hotel' | 'platform';
type InfoView = 'contact' | 'files' | 'starred';
interface BillRef {
  billId: string;
  billNo: string;
  billTotal?: number;
  room?: string;
}

/** The bill the conversation is linked to (the server leaves it out without the Bills right). */
function billOf(thread: ConversationThread): BillRef | null {
  for (const l of thread.links) {
    const x = l.detail;
    if (x?.billId && x.billNo) return { billId: x.billId, billNo: x.billNo, ...(x.billTotal !== undefined ? { billTotal: x.billTotal } : {}), ...(x.room ? { room: x.room } : {}) };
  }
  return null;
}

export function WhatsAppPage({ scope, user, params, navigate, back }: ScreenProps & { scope: Scope }) {
  const api = convApiFor(scope);
  const chatViewId = `${scope}.whatsappThread`;
  const listViewId = `${scope}.whatsapp`;
  const openId = params.id ?? null;

  const [filter, setFilterState] = useState<DeskFilter>(memory.filter);
  const [search, setSearchState] = useState(memory.search);
  const [tick, setTick] = useState(0);
  // the quick replies and the templates are read once per tab (convCache.ts)
  const [quick, setQuickState] = useState<QuickReply[]>(() => onceValue<QuickReply[]>(api, 'quick') ?? []);
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | null>(() => onceValue<WhatsAppTemplate[]>(api, 'templates'));
  const setQuick = useCallback((next: QuickReply[]) => {
    setOnce(api, 'quick', next);
    setQuickState(next);
  }, [api]);
  const q = useDebounced(search, 250);
  // the pay link is a Razorpay link of the hotel: the admin store needs to know who asks (the real server reads the session)
  useAdminActor(user);

  useEffect(() => {
    setConvActor(scope, user, false);
  }, [scope, user]);
  useEffect(() => {
    let live = true;
    void readOnce(api, 'quick', () => api.listQuickReplies()).then((r) => live && r.ok && setQuickState(r.data));
    void readOnce(api, 'templates', async () => {
      const r = await api.getWhatsAppSettings();
      return r.ok ? { ok: true as const, data: r.data.connected ? r.data.templates : [] } : r;
    }).then((r) => live && setTemplates(r.ok ? r.data : []));
    return () => {
      live = false;
    };
  }, [api]);

  const serverTab: ConvTab = filter;
  const query = useMemo(() => ({ search: q, channel: 'whatsapp' as const, tab: serverTab, page: 1, size: 100 }), [q, serverTab]);
  const kpi = useInboxKpis('chat', `${scope}|${filter}`, query);
  const { data, error } = useChannelList(api, kpi.query, tick, 'main', scope);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const rows = useMemo(() => kpi.only(data?.items ?? [], user.id).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))), [data, kpi, user.id]);
  const wa = whatsappConnection(data?.whatsapp);
  const connected = data?.whatsapp.connected ?? true;
  const unreadCount = data?.counts.unread ?? 0;

  const setFilter = (f: DeskFilter) => {
    memory.filter = f;
    setFilterState(f);
  };
  const setSearch = (s: string) => {
    memory.search = s;
    setSearchState(s);
  };
  const isAdmin = scope === 'hotel' ? user.role === 'hotel_admin' : user.role === 'super_admin';
  const openChat = (id: string) => navigate(chatViewId, { id });
  const emptyTitle = q.trim() ? cp.email.empty.search : filter === 'waiting' ? cp.email.empty.waiting : cp.whatsapp.empty[filter];

  return (
    <div className={`wa-page wa-theme ibx-fit${openId ? ' has-chat' : ''}`}>
      <InboxKpis kpi={kpi} list={data} />
      <aside className="wa-side" aria-label={cp.whatsapp.title}>
        <header className="wa-side-head">
          <h2>{cp.whatsapp.title}</h2>
          {data ? <ConnectionPill c={wa} /> : null}
          <span className="wa-grow" />
          <IconButton icon="arrow-clockwise" label={c.mailbox.checkNow} onClick={refresh} />
        </header>
        <div className="wa-search">
          <Bi name="search" />
          <input type="search" aria-label={d.search} placeholder={d.search} value={search} onChange={(e) => setSearch(e.target.value)} />
          {search ? <IconButton icon="x-lg" label={tr('Clear')} onClick={() => setSearch('')} /> : null}
        </div>
        <SegTabs
          className="wa-filters"
          label={cp.whatsapp.title}
          active={filter}
          onChange={(id) => setFilter(id as DeskFilter)}
          tabs={DESK_FILTERS.map((k) => ({ id: k, label: k === 'unread' && unreadCount > 0 ? `${d.filters[k]} ${unreadCount}` : d.filters[k] }))}
        />
        <div className="wa-list-wrap">
          {!data && !error ? (
            <Skeleton lines={8} />
          ) : !data ? (
            <LoadError error={error!} onRetry={refresh} />
          ) : !connected ? (
            <EmptyState icon="chat-dots" title={w.notConnected} text={user.role === 'super_admin' ? wa.message : scope === 'hotel' ? ws.hotel : ws.platform}>
              {scope === 'platform' && user.role === 'super_admin' ? <Button icon="gear" onClick={() => navigate('platform.setup', { step: 'whatsapp' })}>{ws.setUp}</Button> : null}
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState icon="chat-left-text" title={emptyTitle} text={!q.trim() ? wa.message : undefined} />
          ) : (
            <ChatList scope={scope} rows={rows} activeId={openId} onOpen={openChat} />
          )}
        </div>
      </aside>

      <section className="wa-chat-pane" aria-label={cp.whatsapp.title}>
        {openId ? (
          <Chat key={openId} api={api} scope={scope} id={openId} quick={quick} onQuick={setQuick} templates={templates} hotelName={user.hotel?.name ?? ''} me={{ id: user.id, name: user.displayName }} isAdmin={isAdmin} onBack={() => (back ? back() : navigate(listViewId, {}))} onChanged={refresh} />
        ) : (
          <div className="wa-empty">
            <span className="wa-empty-art" aria-hidden="true"><Bi name="chat-dots" /></span>
            <h3>{user.hotel?.name ?? cp.whatsapp.title}</h3>
            <p>{c.empty.thread}</p>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ the chat list: a listbox with one roving tab stop (listKeys.ts) */

function ChatList({ scope, rows, activeId, onOpen }: { scope: Scope; rows: ConversationRow[]; activeId: string | null; onOpen: (id: string) => void }) {
  const box = useRef<HTMLUListElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const stop = rows.find((r) => r.id === focusId)?.id ?? rows.find((r) => r.id === activeId)?.id ?? rows[0]?.id ?? null;
  const now = nowMs();
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const step = listKeyStep(rows.findIndex((r) => r.id === stop), rows.length, e.key);
    if (!step) return;
    e.preventDefault();
    const row = rows[step.active];
    if (!row) return;
    setFocusId(row.id);
    box.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(row.id)}"]`)?.focus();
    if (step.open) onOpen(row.id);
  };
  return (
    <ul className="wa-list" role="listbox" aria-label={cp.whatsapp.title} ref={box} onKeyDown={onKey}>
      {rows.map((r) => {
        const active = r.id === activeId;
        const ticks = r.lastDirection === 'out' && r.lastStatus && r.lastStatus !== 'received' ? tickOf(r.lastStatus) : null;
        const draft = active ? '' : readDraft(scope, r.id, now);
        return (
          <li
            key={r.id}
            data-id={r.id}
            role="option"
            aria-selected={active}
            aria-current={active ? 'true' : undefined}
            tabIndex={r.id === stop ? 0 : -1}
            className={`wa-row${active ? ' is-active' : ''}${r.unread > 0 ? ' is-unread' : ''}`}
            onFocus={() => setFocusId(r.id)}
            onClick={() => onOpen(r.id)}
          >
            <span className="wa-avatar" aria-hidden="true">{initialsOf(r.name)}</span>
            <span className="wa-row-main">
              <span className="wa-row-top">
                <span className="wa-row-name">{r.name}</span>
                <time dateTime={r.lastAt}>{whenLabel(r.lastAt, now)}</time>
              </span>
              <span className="wa-row-last">
                {draft ? (
                  <span className="wa-row-preview"><b className="wa-row-draft">{d.draft}:</b> {draft}</span>
                ) : (
                  <>
                    {ticks ? <WaTicks status={ticks} /> : null}
                    <span className="wa-row-preview">{r.preview}</span>
                  </>
                )}
                <span className="wa-row-marks">
                  {r.labels?.length ? <span className="wa-row-tag">{r.labels[0]}</span> : null}
                  {r.pinned ? <span className="wa-row-mark" title={d.pinned}><Bi name="pin-angle-fill" /><span className="visually-hidden">{d.pinned}</span></span> : null}
                  {r.unread > 0 ? <span className="wa-badge" aria-label={trf('{0} unread', [r.unread])}>{r.unread > 99 ? '99+' : r.unread}</span> : null}
                </span>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ the open chat */

function Chat({ api, scope, id, quick, onQuick, templates, hotelName, me, isAdmin, onBack, onChanged }: { api: Api; scope: Scope; id: string; quick: QuickReply[]; onQuick: (q: QuickReply[]) => void; templates: WhatsAppTemplate[] | null; hotelName: string; me: ConvPerson; isAdmin: boolean; onBack: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { thread, error, setThread, reload } = useChannelThread(api, id, onChanged, 'main', scope);
  const pending = usePending(api, id);
  const [info, setInfo] = useState<InfoView | null>(null);
  const [side, setSideState] = useState(() => memory.side ?? window.matchMedia(WIDE_ENOUGH).matches);
  const [replyTo, setReplyTo] = useState<WhatsAppMessage | null>(null);
  const [msgInfo, setMsgInfo] = useState<WhatsAppMessage | null>(null);
  const [paying, setPaying] = useState(false);
  const [finding, setFinding] = useState(false);
  const [find, setFind] = useState('');
  const [hitAt, setHitAt] = useState(-1);
  // the unread divider is fixed when the chat opens (reading it marks it read); the jump pill counts what came in below the screen
  const [unreadFrom, setUnreadFrom] = useState<{ id: string; n: number } | null | undefined>(undefined);
  const [away, setAway] = useState(false);
  const [seen, setSeen] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const awayRef = useRef(false);
  const placed = useRef(false);

  // the server's messages, then the ones still going (outbox.ts): a clock tick while they go, a mark and Try again when one failed
  const messages = useMemo(() => withPending(thread?.messages ?? [], pending).filter((m): m is WhatsAppMessage => m.kind === 'whatsapp'), [thread, pending]);
  const failed = useMemo(() => new Set(pending.filter((p) => p.error).map((p) => p.tempId)), [pending]);
  const count = messages.length;
  const findQ = useDebounced(find, 150);
  const hits = useMemo(() => (finding ? chatHits(messages, findQ) : []), [finding, messages, findQ]);
  const hit = hits.length ? hits[hitAt < 0 || hitAt >= hits.length ? hits.length - 1 : hitAt] : null;

  if (thread && unreadFrom === undefined) {
    const incoming = messages.filter((m) => m.direction === 'in');
    const first = thread.unread > 0 ? incoming[Math.max(0, incoming.length - thread.unread)] : undefined;
    setUnreadFrom(first ? { id: first.id, n: thread.unread } : null);
    setSeen(first ? count - thread.unread : count);
  }

  useEffect(() => {
    const el = box.current;
    if (!count || !el) return;
    if (!placed.current) {
      placed.current = true;
      const divider = el.querySelector<HTMLElement>('.wa-unread-div');
      if (divider) {
        el.scrollTop = Math.max(0, divider.offsetTop - 24);
        return;
      }
    } else if (awayRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [count, id]);
  useEffect(() => {
    if (hit) document.getElementById(`wa-m-${hit}`)?.scrollIntoView({ block: 'center' });
  }, [hit]);
  useEffect(() => {
    if (!info) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setInfo(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [info]);
  // a phone shows the chat full screen; the toast then comes from the top (hms-overrides.css reads this class), and the chat follows the keyboard
  useEffect(() => {
    document.body.classList.add('wa-thread-open');
    const page = document.querySelector<HTMLElement>('.wa-page');
    const vv = window.visualViewport;
    const fit = () => {
      if (page && vv) page.style.setProperty('--wa-vvh', `${Math.round(vv.height)}px`);
    };
    fit();
    vv?.addEventListener('resize', fit);
    return () => {
      document.body.classList.remove('wa-thread-open');
      vv?.removeEventListener('resize', fit);
      page?.style.removeProperty('--wa-vvh');
    };
  }, []);

  if (error && !thread) return <div className="wa-empty"><LoadError error={error} onRetry={reload} /></div>;
  if (!thread) return <div className="wa-empty"><Skeleton lines={6} /></div>;

  const readOnly = !thread.access.canEdit;
  const open = thread.window?.open ?? false;
  const bill = billOf(thread);
  const canBill = bill !== null && thread.access.canSeeBills && !readOnly;
  const canPay = canBill && userMayEdit('bills');
  const now = nowMs();
  const phone = thread.contact.handles[0] ?? '';
  const win = thread.window;
  const sub = [phone, open && win?.closesAt ? d.windowShort.replace('{time}', formatDateTime(win.closesAt)) : d.windowShortClosed].filter(Boolean).join(' · ');
  const labels = api.setLabels ? labelsFor(scope) : [];
  const fresh = Math.max(0, count - seen);

  const setSide = (on: boolean) => {
    memory.side = on;
    setSideState(on);
  };
  const act = async (p: Promise<{ ok: true; data: ConversationThread } | { ok: false; error: Parameters<typeof errorText>[0] }>, said?: string): Promise<boolean> => {
    const r = await p;
    if (r.ok) {
      setThread(r.data);
      onChanged();
      if (said) toast.show({ tone: 'success', text: said });
      return true;
    }
    toast.show({ tone: 'error', text: errorText(r.error) });
    return false;
  };
  const append = (m: ConvMessage) => {
    awayRef.current = false;
    setThread({ ...thread, messages: [...thread.messages, m] });
    onChanged();
  };
  const fileUrlOf = (m: WhatsAppMessage) => (m.media?.kept === 'yes' && scope === 'hotel' ? api.attachmentHref(thread.id, m.id, 0).replace(/\/attachments\/0$/, '/whatsapp-media') : null);
  const jumpTo = (mid: string) => {
    setInfo(null);
    const el = document.getElementById(`wa-m-${mid}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('is-flash');
    window.setTimeout(() => el.classList.remove('is-flash'), 1600);
  };
  const toBottom = () => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const far = el.scrollHeight - el.scrollTop - el.clientHeight > 160;
    awayRef.current = far;
    if (far !== away) setAway(far);
    if (!far && seen !== count) setSeen(count);
  };
  const closeFind = () => {
    setFinding(false);
    setFind('');
    setHitAt(-1);
  };
  const stepHit = (by: number) => {
    if (!hits.length) return;
    const at = hitAt < 0 || hitAt >= hits.length ? hits.length - 1 : hitAt;
    setHitAt((at + by + hits.length) % hits.length);
  };
  const copy = (m: WhatsAppMessage) => {
    const text = m.text ?? m.template?.text ?? '';
    void navigator.clipboard?.writeText(text).then(() => toast.show({ tone: 'success', text: d.copied }), () => toast.show({ tone: 'error', text: tr('Could not copy.') }));
  };
  const toggleLabel = (l: string) => {
    if (!api.setLabels) return;
    const has = (thread.labels ?? []).includes(l);
    void act(api.setLabels(thread.id, has ? (thread.labels ?? []).filter((x) => x !== l) : [...(thread.labels ?? []), l]));
  };
  const menuItem = (icon: string, label: string, run: () => void, className = '') => (
    <a href="#" className={`dropdown-item ${className}`.trim()} onClick={(e) => { e.preventDefault(); run(); }}>
      <Bi name={icon} /> {label}
    </a>
  );

  // Send pay link: the bill's balance when the bill can be read (else the total the conversation knows), a Razorpay link of the hotel, then the link as a message
  const sendPayLink = async () => {
    if (!bill || paying) return;
    setPaying(true);
    let amount = bill.billTotal ?? 0;
    let business: RazorpayBusiness = 'hotel';
    const read = await billingApi.getBill(bill.billId);
    if (read.ok) {
      amount = billBalance(read.data);
      business = read.data.balanceHotelPaise > 0 ? 'hotel' : 'food';
    }
    if (amount <= 0) {
      setPaying(false);
      toast.show({ tone: 'info', text: d.nothingOwed });
      return;
    }
    const what = `Bill ${bill.billNo}${bill.room ? ` · Room ${bill.room}` : ''}`;
    const phoneNo = thread.contact.handles.find((h) => !h.includes('@'));
    const made = await adminApi.createRazorpayLink({ business, amountPaise: amount, description: what, name: thread.contact.name, validDays: LINK_DAYS, sms: false, mail: false, ...(phoneNo ? { contact: phoneNo } : {}), billRef: bill.billNo });
    if (!made.ok) {
      setPaying(false);
      toast.show({ tone: 'error', text: errorText(made.error) });
      return;
    }
    const text = billingCopy.bills.quickPay.whatsappText(thread.contact.name, hotelName, what, formatINR(amount), made.data.link.url);
    const sent = await api.sendReply(thread.id, { channel: 'whatsapp', text });
    setPaying(false);
    if (sent.ok) {
      append(sent.data);
      toast.show({ tone: 'success', text: d.payLinkSent.replace('{amount}', formatINR(amount)) });
    } else toast.show({ tone: 'error', text: errorText(sent.error) });
  };

  return (
    <div className={`wa-chat${side ? '' : ' no-side'}`}>
      <div className="wa-chat-top">
        <header className="wa-chat-head">
          <IconButton icon="arrow-left" label={c.actions.back} className="wa-back" onClick={onBack} />
          <Button variant="ghost" className="wa-chat-who" title={d.contactInfo} onClick={() => setInfo('contact')}>
            <span className="wa-avatar" aria-hidden="true">{initialsOf(thread.contact.name)}</span>
            <span className="wa-chat-name">
              <strong>{thread.contact.name}</strong>
              <small>{sub}</small>
            </span>
          </Button>
          <span className="wa-grow" />
          <IconButton icon="search" label={d.searchChat} aria-pressed={finding} className={finding ? 'is-on' : undefined} onClick={() => (finding ? closeFind() : setFinding(true))} />
          <IconButton icon="person-vcard" label={d.guestCard} aria-pressed={side} className={`wa-guest-btn${side ? ' is-on' : ''}`} onClick={() => setSide(!side)} />
          <Dropdown align="end" button={(p) => <IconButton icon="three-dots-vertical" label={d.more} {...p} />}>
            {menuItem('person-lines-fill', d.contactInfo, () => setInfo('contact'))}
            {menuItem('images', d.files.title, () => setInfo('files'))}
            {api.setMessageStarred ? menuItem('star', cp.whatsapp.starredMessages, () => setInfo('starred')) : null}
            {readOnly ? null : (
              <>
                <div className="dropdown-divider" />
                {api.setPinned ? menuItem(thread.pinned ? 'pin-angle-fill' : 'pin-angle', thread.pinned ? d.unpin : d.pin, () => void act(api.setPinned!(thread.id, !thread.pinned))) : null}
                {menuItem('envelope', d.markUnread, () => void act(api.markUnread(thread.id)).then((ok) => ok && onBack()))}
                {labels.length ? (
                  <>
                    <h6 className="dropdown-header">{d.labels}</h6>
                    {labels.map((l) => <Fragment key={l}>{menuItem((thread.labels ?? []).includes(l) ? 'check-square-fill' : 'square', l, () => toggleLabel(l))}</Fragment>)}
                  </>
                ) : null}
              </>
            )}
          </Dropdown>
        </header>
        {finding ? (
          <div className="wa-find" role="search">
            <Bi name="search" />
            <input type="search" autoFocus aria-label={d.searchChat} placeholder={d.searchChat} value={find} onChange={(e) => { setFind(e.target.value); setHitAt(-1); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); stepHit(e.shiftKey ? 1 : -1); } else if (e.key === 'Escape') closeFind(); }} />
            <span className="wa-find-n" aria-live="polite">{findQ.trim().length < 2 ? '' : hits.length ? d.hits.replace('{n}', String((hitAt < 0 || hitAt >= hits.length ? hits.length - 1 : hitAt) + 1)).replace('{total}', String(hits.length)) : d.noHits}</span>
            <IconButton icon="chevron-up" label={d.prevHit} disabled={hits.length < 2} onClick={() => stepHit(-1)} />
            <IconButton icon="chevron-down" label={d.nextHit} disabled={hits.length < 2} onClick={() => stepHit(1)} />
            <IconButton icon="x-lg" label={d.closeSearch} onClick={closeFind} />
          </div>
        ) : null}
      </div>

      {side ? <GuestSide thread={thread} bill={bill} canPay={canPay && open} paying={paying} onPayLink={() => void sendPayLink()} onDetails={() => setInfo('contact')} /> : null}

      <div className="wa-messages" ref={box} onScroll={onScroll}>
        {thread.hasOlder ? <span className="wa-older">{c.actions.olderMessages}</span> : null}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || formatDate(prev.at) !== formatDate(m.at);
          const label = dayLabel(m.at, now);
          return (
            <Fragment key={m.id}>
              {newDay ? <div className="wa-day" role="separator"><span>{label === 'Today' || label === 'Yesterday' ? tr(label) : label}</span></div> : null}
              {unreadFrom && m.id === unreadFrom.id ? <div className="wa-unread-div" role="separator"><span>{unreadFrom.n} {tr('unread')} {unreadFrom.n === 1 ? tr('message') : tr('messages')}</span></div> : null}
              {m.sentFrom === 'auto' ? (
                <WhatsAppAutoLine m={m} />
              ) : m.id.startsWith('tmp-') ? (
                <WhatsAppBubble
                  m={failed.has(m.id) ? { ...m, failure: errorText(pending.find((p) => p.tempId === m.id)?.error ?? { code: 'SERVER_ERROR', message: 'SERVER_ERROR', traceId: 'client' }) } : m}
                  contactName={thread.contact.name}
                  first={startsRun(prev, m)}
                  onCopy={copy}
                  onRetry={failed.has(m.id) ? () => void runPending(api, thread.id, m.id).then((r) => r?.ok && onChanged()) : undefined}
                  onDiscard={failed.has(m.id) ? () => dropPending(api, thread.id, m.id) : undefined}
                />
              ) : (
                <WhatsAppBubble
                  m={m}
                  contactName={thread.contact.name}
                  fileUrl={fileUrlOf(m)}
                  first={startsRun(prev, m)}
                  find={finding && hits.includes(m.id) ? findQ : undefined}
                  onQuote={jumpTo}
                  onReply={!readOnly && open ? setReplyTo : undefined}
                  onCopy={copy}
                  onInfo={setMsgInfo}
                  onStar={!readOnly && api.setMessageStarred ? (x, on) => void act(api.setMessageStarred!(thread.id, x.id, on)) : undefined}
                  onReact={!readOnly && open && api.setReaction ? (x, emoji) => void act(api.setReaction!(thread.id, x.id, emoji)) : undefined}
                />
              )}
            </Fragment>
          );
        })}
      </div>
      {away ? (
        fresh > 0 ? (
          <Button variant="ghost" size="sm" icon="chevron-double-down" className="wa-jump has-n" onClick={toBottom}>{(fresh === 1 ? d.newMessages : d.newMessagesMany).replace('{n}', String(fresh))}</Button>
        ) : (
          <IconButton icon="chevron-double-down" className="wa-jump" label={tr('Jump to the latest message')} onClick={toBottom} />
        )
      ) : null}

      <Composer key={thread.id} api={api} scope={scope} thread={thread} templates={templates} hotelName={hotelName} replyTo={replyTo} onClearReply={() => setReplyTo(null)} quick={quick} readOnly={readOnly} me={me} bill={bill} canBill={canBill} canPay={canPay} paying={paying} onPayLink={() => void sendPayLink()} onSent={append} onQueued={() => { awayRef.current = false; }} onDone={onChanged} />

      <MessageInfo m={msgInfo} onClose={() => setMsgInfo(null)} />

      {info ? (
        <>
          <div className="cv-scrim" aria-hidden="true" onClick={() => setInfo(null)} />
          <aside className="cv-drawer wa-drawer" role="dialog" aria-modal="true" aria-label={info === 'files' ? d.files.title : info === 'starred' ? cp.whatsapp.starredMessages : d.contactInfo}>
            <div className="cv-drawer-head">
              {info !== 'contact' ? <IconButton icon="arrow-left" label={c.actions.back} onClick={() => setInfo('contact')} /> : null}
              <strong>{info === 'files' ? d.files.title : info === 'starred' ? cp.whatsapp.starredMessages : d.contactInfo}</strong>
              <span className="wa-grow" />
              <IconButton icon="x-lg" label={c.contact.close} autoFocus onClick={() => setInfo(null)} />
            </div>
            {info === 'files' ? (
              <FilesPanel messages={messages} fileUrlOf={fileUrlOf} onJump={jumpTo} />
            ) : info === 'starred' ? (
              <StarredPanel messages={messages} contactName={thread.contact.name} onJump={jumpTo} />
            ) : (
              <>
                <div className="wa-dr-who">
                  <span className="wa-avatar is-xl" aria-hidden="true">{initialsOf(thread.contact.name)}</span>
                  <strong>{thread.contact.name}</strong>
                  <small>{phone}</small>
                  {thread.labels?.length ? <span className="wa-dr-tags">{thread.labels.map((l) => <span key={l} className="wa-row-tag">{l}</span>)}</span> : null}
                </div>
                <div className="wa-dr-links">
                  <Button variant="ghost" className="wa-dr-row" onClick={() => setInfo('files')}>
                    <Bi name="images" />
                    <span>{d.files.title}</span>
                    <Bi name="chevron-right" />
                  </Button>
                  {api.setMessageStarred ? (
                    <Button variant="ghost" className="wa-dr-row" onClick={() => setInfo('starred')}>
                      <Bi name="star" />
                      <span>{cp.whatsapp.starredMessages}</span>
                      <Bi name="chevron-right" />
                    </Button>
                  ) : null}
                </div>
                <ContactPanel scope={scope} thread={thread} api={api} quickReplies={quick} isAdmin={isAdmin} onThread={(t) => { setThread(t); onChanged(); }} onQuickReplies={onQuick} />
              </>
            )}
          </aside>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ the thin guest card */

function GuestSide({ thread, bill, canPay, paying, onPayLink, onDetails }: { thread: ConversationThread; bill: BillRef | null; canPay: boolean; paying: boolean; onPayLink: () => void; onDetails: () => void }) {
  const link = thread.links[0];
  const x = link?.detail;
  const dates = x?.checkIn || x?.checkOut ? [x?.checkIn ? formatDate(x.checkIn) : '', x?.checkOut ? formatDate(x.checkOut) : ''].filter(Boolean).join(' to ') : '';
  const note = thread.notes[thread.notes.length - 1];
  return (
    <aside className="wa-guest" aria-label={d.guest.details}>
      <div className="wa-guest-who">
        <span className="wa-avatar is-lg" aria-hidden="true">{initialsOf(thread.contact.name)}</span>
        <span>
          <strong>{thread.contact.name}</strong>
          <small>{thread.contact.handles[0]}</small>
        </span>
      </div>
      <div className="wa-guest-more">
        {link ? (
          <dl className="wa-kv">
            <dt>{c.contact.linkKinds[link.kind]}</dt>
            <dd>{link.label}</dd>
            {x?.room ? <><dt>{d.guest.room}</dt><dd>{x.room}</dd></> : null}
            {dates ? <><dt>{d.guest.dates}</dt><dd>{dates}</dd></> : null}
            {x?.status ? <><dt>{d.guest.status}</dt><dd>{x.status.replace(/_/g, ' ')}</dd></> : null}
          </dl>
        ) : (
          <p className="wa-guest-none">{d.guest.notLinked}</p>
        )}
      </div>
      {bill && thread.access.canSeeBills ? (
        <div className="wa-bal">
          <span>
            <small>{d.guest.bill.replace('{no}', bill.billNo)}{bill.billTotal !== undefined ? ` · ${d.guest.billTotal}` : ''}</small>
            {bill.billTotal !== undefined ? <b className="t-num">{formatINR(bill.billTotal)}</b> : null}
          </span>
          {canPay ? <Button size="sm" className="wa-pay-btn" icon="link-45deg" busy={paying} busyLabel={d.makingLink} onClick={onPayLink}>{d.sendPayLink}</Button> : null}
        </div>
      ) : null}
      {note ? (
        <div className="wa-guest-more wa-guest-notes">
          <span className="t-label">{d.guest.notes}</span>
          <p>{note.text}</p>
        </div>
      ) : null}
      <Button variant="ghost" size="sm" icon="person-lines-fill" className="wa-guest-details" onClick={onDetails}>{c.contact.open}</Button>
    </aside>
  );
}

/* ------------------------------------------------------------------ the composer */

function Composer({ api, scope, thread, templates, hotelName, replyTo, onClearReply, quick, readOnly, me, bill, canBill, canPay, paying, onPayLink, onSent, onQueued, onDone }: { api: Api; scope: Scope; thread: ConversationThread; templates: WhatsAppTemplate[] | null; hotelName: string; replyTo: WhatsAppMessage | null; onClearReply: () => void; quick: QuickReply[]; readOnly: boolean; me: ConvPerson; bill: BillRef | null; canBill: boolean; canPay: boolean; paying: boolean; onPayLink: () => void; onSent: (m: ConvMessage) => void; /** A text went on screen (the chat follows it down). */ onQueued: () => void; /** The server took it (the list moves). */ onDone: () => void }) {
  const toast = useToast();
  const boxId = useId();
  const [text, setTextState] = useState(() => readDraft(scope, thread.id));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tpl, setTpl] = useState(false);
  const wa = thread.replyChannels.find((r) => r.channel === 'whatsapp');
  const win = thread.window;
  const open = win?.open ?? false;
  const name = thread.contact.name;
  const chatQuick = quick.filter((q) => q.channel !== 'email');

  const setText = (t: string) => {
    setTextState(t);
    writeDraft(scope, thread.id, t);
  };
  const focusBox = () => document.getElementById(boxId)?.focus();
  // a text goes as WhatsApp sends it: on screen at once with the clock, the box empty for the next one, the ticks moving as the server hears back (outbox.ts)
  const sendText = () => {
    const body = text.trim();
    if (!body || readOnly) return;
    const quoted = replyTo ? { id: replyTo.id, preview: (replyTo.text ?? replyTo.media?.caption ?? replyTo.media?.name ?? replyTo.template?.text ?? '').slice(0, 120) } : null;
    const temp: WhatsAppMessage = { kind: 'whatsapp', id: newTempId(), direction: 'out', status: 'pending', at: new Date().toISOString(), sentBy: me, sentFrom: 'hms', type: 'text', text: body, ...(quoted ? { replyTo: quoted } : {}) };
    setText('');
    setErr(null);
    onClearReply();
    onQueued();
    void sendNow(api, thread.id, temp, { channel: 'whatsapp', text: body, ...(quoted ? { replyToId: quoted.id } : {}) }).then((r) => {
      if (r?.ok) onDone();
    });
    focusBox();
  };
  const send = async (extra: Record<string, unknown> = {}, said: string = d.sent): Promise<boolean> => {
    if (busy || readOnly) return false;
    setBusy(true);
    setErr(null);
    const r = await api.sendReply(thread.id, { channel: 'whatsapp', ...(text.trim() ? { text: text.trim() } : {}), ...(replyTo ? { replyToId: replyTo.id } : {}), ...extra } as Parameters<typeof api.sendReply>[1]);
    setBusy(false);
    if (!r.ok) {
      setErr(errorText(r.error));
      return false;
    }
    if (!('text' in extra) || extra.text !== undefined) setText('');
    setTpl(false);
    onClearReply();
    onSent(r.data);
    toast.show({ tone: 'success', text: said });
    return true;
  };
  const file = (type: 'image' | 'document') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void send({ attachment: { type: type === 'image' && f.type.startsWith('video') ? 'video' : type, name: f.name, size: f.size, mime: f.type || undefined } });
  };

  if (readOnly) return <div className="wa-composer-note"><Bi name="lock" /> {thread.access.readOnlyReason === 'visit' ? c.readOnly.visit : c.readOnly.viewOnly}</div>;
  if (!wa?.available) return <div className="wa-composer-note">{wa?.reason ?? w.notConnected}</div>;

  const link = thread.links[0]?.detail;
  const defaults: TemplateDefaults = {
    hotel_name: hotelName,
    ...(name && !/^\+?[0-9 ]+$/.test(name) ? { guest_name: name } : {}),
    ...(link?.room ? { room: link.room } : {}),
    ...(link?.checkIn ? { check_in: formatDate(link.checkIn) } : {}),
    ...(link?.checkOut ? { check_out: formatDate(link.checkOut) } : {}),
  };
  const closedWhy = !win || !win.closesAt ? d.windowNever : d.windowClosed;

  return (
    <div className={`wa-composer-wrap${open ? '' : ' is-closed'}`}>
      {tpl ? (
        <>
          <div className="wa-scrim" aria-hidden="true" onClick={() => setTpl(false)} />
          <div className="wa-tpl" role="dialog" aria-label={d.templates}>
            {templates === null ? <Skeleton lines={3} /> : <TemplatePicker key={thread.id} templates={templates} defaults={defaults} draftKept={false} disabled={busy} busy={busy} onCancel={() => setTpl(false)} onSend={(templateId, variables) => void send({ templateId, variables, text: undefined })} />}
          </div>
        </>
      ) : null}
      {!open ? <div className="wa-closed-note" role="note"><Bi name="clock-history" /> <span>{closedWhy}</span></div> : null}
      {replyTo ? (
        <div className="wa-replying">
          <span className="wa-replying-q">
            <b>{replyTo.direction === 'out' ? (replyTo.sentBy?.name ?? w.name) : name}</b>
            <span>{replyTo.text ?? replyTo.media?.caption ?? replyTo.media?.name ?? replyTo.template?.text ?? ''}</span>
          </span>
          <IconButton icon="x-lg" label={w.cancelReply} onClick={onClearReply} />
        </div>
      ) : null}
      {err ? <div className="wa-composer-err" role="alert">{err}</div> : null}
      <div className="wa-composer">
        <div className="wa-pill">
          <Dropdown align="start" menuClassName="wa-emoji-menu" button={(p) => <IconButton icon="emoji-smile" label={d.emoji} disabled={!open || busy} {...p} />}>
            <div className="wa-emoji-row" role="group" aria-label={tr('Emoji')}>
              {EMOJIS.map((e) => <Button key={e} variant="ghost" size="sm" className="wa-react" onClick={() => { setText(`${text}${e}`); focusBox(); }}>{e}</Button>)}
            </div>
            {chatQuick.length ? (
              <>
                <h6 className="dropdown-header">{d.quickReplies}</h6>
                {chatQuick.map((q) => (
                  <a key={q.id} href="#" className="dropdown-item wa-quick-item" title={q.body} onClick={(e) => { e.preventDefault(); setText(q.body); focusBox(); }}>
                    <b>{q.title}</b>
                    <small>{q.body}</small>
                  </a>
                ))}
              </>
            ) : null}
          </Dropdown>
          <Textarea
            id={boxId}
            rows={1}
            className="wa-input"
            aria-label={c.reply.placeholder}
            placeholder={open ? d.writeTo.replace('{name}', name) : d.pickTemplate.replace('{name}', name)}
            disabled={!open || busy}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendText();
              }
            }}
          />
          <Dropdown align="end" button={(p) => <IconButton icon="paperclip" label={cp.whatsapp.attach} disabled={busy} {...p} />}>
            {open ? (
              <>
                <label className="dropdown-item cv-attach-item"><Bi name="image" /> {cp.whatsapp.attachMenu.photo}<input type="file" accept="image/*,video/*" hidden onChange={file('image')} /></label>
                <label className="dropdown-item cv-attach-item"><Bi name="file-earmark" /> {cp.whatsapp.attachMenu.document}<input type="file" hidden onChange={file('document')} /></label>
                {canBill && bill ? (
                  <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); void send({ billId: bill.billId, attachment: { type: 'document', name: `Bill ${bill.billNo}.pdf`, mime: 'application/pdf' }, text: undefined }, d.billSent.replace('{no}', bill.billNo)); }}>
                    <Bi name="file-earmark-pdf" /> {c.reply.attachBill} · {bill.billNo}
                  </a>
                ) : null}
              </>
            ) : null}
            <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setTpl(true); }}>
              <Bi name="layout-text-window" /> {d.template}
            </a>
            {canPay && open ? (
              <a href="#" className={`dropdown-item${paying ? ' disabled' : ''}`} aria-disabled={paying || undefined} onClick={(e) => { e.preventDefault(); if (!paying) onPayLink(); }}>
                <Bi name="link-45deg" /> {paying ? d.makingLink : d.sendPayLink}
              </a>
            ) : null}
          </Dropdown>
        </div>
        {open ? (
          <IconButton icon="send-fill" label={c.reply.send} title={d.replyingAs.replace('{name}', me.name)} className="wa-send" disabled={busy || !text.trim()} onClick={sendText} />
        ) : (
          <IconButton icon="layout-text-window" label={d.sendTemplate} className="wa-send is-tpl" aria-pressed={tpl} disabled={busy} onClick={() => setTpl((v) => !v)} />
        )}
      </div>
    </div>
  );
}

/** The same WhatsApp page for the hotel and for the platform (MJ, 5 Nov 2026: one page per channel). */
export const HotelWhatsApp = (p: ScreenProps) => <WhatsAppPage {...p} scope="hotel" />;
export const PlatformWhatsApp = (p: ScreenProps) => <WhatsAppPage {...p} scope="platform" />;
