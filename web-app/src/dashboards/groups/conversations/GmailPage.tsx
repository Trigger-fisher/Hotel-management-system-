'use client';

// The hotel mailbox and My mailbox (the mail-preview design, MJ, 5 Nov 2026), kept plain for the desk: folders Inbox / Sent / Done and a search, the filters
// Unassigned / Mine, a dense list whose rows open in place with the last words and Reply / Assign / Mark done, the thread (newest at the bottom, earlier mail
// folded, a quiet "Sent automatically" mark on what HMS sent by itself, the guest card with the booking and the pay link), and reply and compose with quick
// replies, templates in three languages, the bill PDF and the address the mail leaves from. Automatic mails are set once by the Hotel Admin under Settings >
// Messages: nothing about them is switched here. On a phone the list is native (swipe a row for Assign and Done), the thread fills the screen with a reply bar,
// and compose and reply open as a sheet. My mailbox (scope "personal") is the same page with Link to booking and Forward to desk.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react';

import {
  mailboxPageCopy as mb,
  conversationsCopy as c,
  CONV_CC_MAX,
  CONV_REPLY_MAX,
  labelsFor,
  type ComposeEmailInput,
  type ConvBulkAction,
  type ConvScope,
  type ConvTab,
  type ConversationRow,
  type ConversationThread,
  type ConvPerson,
  type EmailEntry,
  type EmailReplyInput,
  type QuickReply,
} from '@shared/dashboards/conversations';
import type { DashError } from '@shared/dashboards/common';
import { userMayOpen } from '@shared/dashboards/features';
import { formatDate, formatDateTime, formatINR } from '@shared/dashboards/format';

import { errorText, fieldErrors, useDebounced, useMedia, useToast } from '@/components/ui';
import { Alert, Bi, Button, Dropdown, EmptyState, IconButton, ListSearch, ListTabs, LoadError, Modal, PageSkeleton, Skeleton, StatusChip, Textarea, type ChipTone } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';

import { CcChipsInput } from './AddressChips';
import { conversationsApi, convApiFor, setConvActor } from './api';
import { useChannelList, useChannelThread } from './chanHooks';
import { cachedBodies, onceValue, readOnce, storeBodies } from './convCache';
import { dropPending, newTempId, runPending, stagePending, usePending, withPending } from './outbox';
import { AttachButton, FileChips, useComposeFiles } from './ComposeFiles';
import { EmailMessage, type CachedBody } from './EmailMessage';
import { InboxKpis, useInboxKpis } from './InboxKpis';
import { replyAllRecipients, threadParticipants } from './emailThread';
import { LinkGuestDialog } from './LinkGuestDialog';
import { initialsOf, nowMs, whenLabel } from './listKeys';
import { BulkBar, FromField, LabelChips, LabelMenu, labelTone, receivedOn, ShortcutsDialog, SnoozeMenu, StarButton, useUndoSend } from './MailParts';
import { MAIL_FOLDERS, mailKey, mailQuery, passesLocal, SERVER_FOLDER, withoutChip, type MailFolder } from './mailQuery';

import { tr } from '@/lib/i18n/language';
const PAGE = 25;
const PHONE = '(max-width: 768px)';
const SWIPE_W = 144;

type Folder = MailFolder;
type Filter = '' | 'unassigned' | 'mine';
type Lang = 'en' | 'hi' | 'gu';
type Api = ReturnType<typeof convApiFor>;
type ToggleProps = { 'aria-expanded': boolean; 'aria-haspopup': 'menu'; onClick: () => void };
/** The Assign menu of a row or a thread: Assign to me, the team, Unassigned. */
type AssignMenu = (id: string, current: ConvPerson | null, button: (p: ToggleProps) => ReactNode) => ReactNode;

/** The folder, label, filter and search are remembered between the list and a thread (module memory, never storage). */
const memory = { folder: 'inbox' as Folder, label: null as string | null, filter: '' as Filter, search: '', page: 1, address: null as string | null };
const NO_OWN: readonly string[] = [];
const FOLDER_ICON: Record<Folder, string> = { inbox: 'inbox', starred: 'star', snoozed: 'clock', sent: 'send', drafts: 'file-earmark', done: 'check2' };

/** Open while the guest wrote last, Waiting on guest once the hotel answered, Done when closed. */
const statusOf = (r: Pick<ConversationRow, 'status' | 'waiting' | 'lastDirection'>): { label: string; tone: ChipTone } =>
  r.status === 'done' ? { label: mb.status.done, tone: 'ok' } : r.waiting || r.lastDirection === 'in' ? { label: mb.status.open, tone: 'neutral' } : { label: mb.status.waiting, tone: 'warn' };

const threadsWord = (n: number) => (n === 1 ? mb.thread : mb.threads.replace('{n}', String(n)));
const reSubject = (s: string) => (!s.trim() ? '' : /^re:/i.test(s.trim()) ? s.trim() : `${c.reply.re} ${s.trim()}`);

export function GmailPage({ scope, home = 'platform', own: ownIn = NO_OWN, user, params, navigate }: ScreenProps & { scope: ConvScope; /** Which dashboard My mailbox is open in (scope personal only): decides its page ids. */ home?: 'platform' | 'hotel' | 'group'; /** My mailbox: the person's own addresses, the main one first (the From choice and the address switch). */ own?: readonly string[] }) {
  const api = convApiFor(scope);
  const toast = useToast();
  const phone = useMedia(PHONE);
  const personal = scope === 'personal';
  // a person's own box in a hotel: stays, the desk and the hotel's settings exist there, never in the platform's or a group's
  const hotelBox = personal && home === 'hotel';
  // one Email page per console (MJ, 5 Nov 2026): the person's own mailbox is its "mine" box
  const threadViewId = personal ? `${home}.emailThread` : `${scope}.emailThread`;
  const listViewId = personal ? `${home}.email` : `${scope}.email`;
  const boxParam: Record<string, string> = { box: personal ? 'mine' : 'shared' };
  const openId = params.id ?? null;

  const [folder, setFolderState] = useState<Folder>(memory.folder);
  const [label, setLabelState] = useState<string | null>(memory.label);
  const [filter, setFilterState] = useState<Filter>(memory.filter);
  const [search, setSearchState] = useState(memory.search);
  const [page, setPageState] = useState(memory.page);
  const own = personal ? ownIn : NO_OWN;
  const [addressState, setAddressState] = useState<string | null>(memory.address);
  const address = addressState && own.includes(addressState) ? addressState : null;
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [keysOpen, setKeysOpen] = useState(false);
  const searchBox = useRef<HTMLDivElement>(null);
  const [compose, setCompose] = useState<{ to: string; subject: string; text: string } | null>(null);
  // the team, the quick replies and the desk's address are read once per tab (convCache.ts)
  const [staff, setStaff] = useState<ConvPerson[]>(() => onceValue<ConvPerson[]>(api, 'staff') ?? []);
  const [quick, setQuick] = useState<QuickReply[]>(() => onceValue<QuickReply[]>(api, 'quick') ?? []);
  const [deskAddress, setDeskAddress] = useState<string | null>(() => onceValue<string | null>(conversationsApi, 'deskAddress'));
  const q = useDebounced(search, 250);

  useEffect(() => {
    setConvActor(scope, user, false);
  }, [scope, user]);
  useEffect(() => {
    let live = true;
    void readOnce(api, 'staff', () => api.listStaff()).then((r) => live && r.ok && setStaff(r.data));
    void readOnce(api, 'quick', () => api.listQuickReplies()).then((r) => live && r.ok && setQuick(r.data));
    // My mailbox in a hotel: Forward to desk goes to the hotel mailbox's own address
    if (personal && home === 'hotel' && userMayOpen('hotel.email'))
      void readOnce(conversationsApi, 'deskAddress', async () => {
        const r = await conversationsApi.getSummary();
        return r.ok ? { ok: true as const, data: r.data.mailbox.address ?? r.data.mailbox.receivingAddress ?? null } : r;
      }).then((r) => live && r.ok && setDeskAddress(r.data));
    return () => {
      live = false;
    };
  }, [api, personal, home]);

  // Gmail's extras (star, labels, snooze, bulk) show only where this inbox's API carries them (the platform's own inbox does not)
  const gmail = Boolean(api.setStarred && api.bulk);
  const labels = useMemo(() => (api.setLabels ? labelsFor(scope) : []), [api, scope]);
  const mq = useMemo(() => mailQuery(q, folder, labels), [q, folder, labels]);
  // the hotel's server reads `folder`; the group's and the personal one read `tab` (lib/api/adapters/conversations.ts), so both go
  const query = useMemo(
    () => ({ search: mq.words, channel: 'email' as const, folder: mq.folder, tab: (folder === 'done' ? 'done' : mq.folder === 'unread' ? 'unread' : 'all') as ConvTab, ...(label ?? mq.label ? { label: (label ?? mq.label) as string } : {}), ...(address ? { address } : {}), page, size: PAGE }),
    [mq, folder, label, address, page],
  );
  const kpi = useInboxKpis('mail', `${scope}|${folder}|${label ?? ''}|${address ?? ''}`, query);
  const { data, error } = useChannelList(api, kpi.query, tick, personal ? 'personal' : 'main', scope);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const setFolder = (f: Folder) => {
    Object.assign(memory, { folder: f, label: null, page: 1 });
    setFolderState(f);
    setLabelState(null);
    setPageState(1);
    setPicked(new Set());
    if (openId) navigate(listViewId, boxParam);
  };
  const setLabel = (l: string | null) => {
    Object.assign(memory, { label: l, page: 1 });
    setLabelState(l);
    setPageState(1);
    setPicked(new Set());
    if (openId) navigate(listViewId, boxParam);
  };
  const setAddress = (a: string | null) => {
    Object.assign(memory, { address: a, page: 1 });
    setAddressState(a);
    setPageState(1);
    setPicked(new Set());
    if (openId) navigate(listViewId, boxParam);
  };
  const setFilter = (f: Filter) => {
    Object.assign(memory, { filter: f });
    setFilterState(f);
  };
  const setSearch = (s: string) => {
    Object.assign(memory, { search: s, page: 1 });
    setSearchState(s);
    setPageState(1);
  };
  const setPage = (n: number) => {
    Object.assign(memory, { page: n });
    setPageState(n);
  };

  const counts = data?.folderCounts ?? {};
  const listed = useMemo(() => kpi.only(data?.items ?? [], user.id), [data, kpi, user.id]);
  const rows = useMemo(() => listed.filter((r) => passesLocal(r, mq) && (filter === 'unassigned' ? !r.assignedTo : filter === 'mine' ? r.assignedTo?.id === user.id : true)), [listed, filter, user.id, mq]);
  const ticked = rows.filter((r) => picked.has(r.id));
  const tick1 = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const total = data?.total ?? 0;
  const fromAddress = data?.mailbox.address ?? data?.mailbox.receivingAddress ?? null;
  const hotelName = user.hotel?.name ?? '';
  const me: ConvPerson = { id: user.id, name: user.displayName };

  // the row actions call the thread's own API (assign, status) and refresh the list
  const assign = async (id: string, person: ConvPerson | null) => {
    const r = await api.setAssignee(id, person?.id ?? null);
    if (!r.ok) return toast.show({ tone: 'error', text: errorText(r.error) });
    refresh();
    toast.show({ tone: 'success', text: person ? mb.toasts.assigned.replace('{name}', person.name) : mb.toasts.unassigned });
  };
  const setDone = async (id: string, done: boolean) => {
    const r = await api.setStatus(id, done ? 'done' : 'open');
    if (!r.ok) return toast.show({ tone: 'error', text: errorText(r.error) });
    refresh();
    toast.show({ tone: 'success', text: done ? mb.toasts.done : mb.toasts.reopened, action: { label: mb.undo, onClick: () => void api.setStatus(id, done ? 'open' : 'done').then(refresh) } });
  };
  const star = async (r: ConversationRow) => {
    if (!api.setStarred) return;
    const res = await api.setStarred(r.id, !r.starred);
    if (!res.ok) return toast.show({ tone: 'error', text: errorText(res.error) });
    refresh();
  };
  // a bulk action says how many changed, with Undo for the ones that have an opposite
  const UNDO: Partial<Record<ConvBulkAction, ConvBulkAction>> = { done: 'reopen', reopen: 'done', read: 'unread', unread: 'read', star: 'unstar', unstar: 'star' };
  const runBulk = async (action: ConvBulkAction) => {
    if (!api.bulk || bulkBusy || ticked.length === 0) return;
    const ids = ticked.map((r) => r.id);
    setBulkBusy(true);
    const res = await api.bulk(ids, action);
    setBulkBusy(false);
    if (!res.ok) return toast.show({ tone: 'error', text: errorText(res.error) });
    setPicked(new Set());
    refresh();
    const back = UNDO[action];
    const said = (mb.bulkDone[action as keyof typeof mb.bulkDone] ?? '').replace('{n}', String(res.data.changed));
    toast.show({ tone: 'success', text: said, ...(back && api.bulk ? { action: { label: mb.undo, onClick: () => void api.bulk?.(ids, back).then(refresh) } } : {}) });
  };
  const openThread = (id: string, extra: Record<string, string> = {}) => navigate(threadViewId, { ...boxParam, id, ...extra });
  const forwardOf = (m: EmailEntry, text: string | null, to: string, line: string) =>
    setCompose({ to, subject: /^fwd?:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`, text: `\n\n---------- ${line} ----------\n${c.email.from}: ${m.from}\n${formatDateTime(m.at)}\n${c.email.subject}: ${m.subject}\n${m.to.length ? `${mb.compose.to}: ${m.to.join(', ')}\n` : ''}\n${text ?? m.preview}` });
  const forwardToDesk = (m: EmailEntry, text: string | null) => forwardOf(m, text, deskAddress ?? '', mb.compose.forwardLine);
  const forward = (m: EmailEntry, text: string | null) => forwardOf(m, text, '', mb.compose.forwardedLine);

  const assignMenu: AssignMenu = (id, current, button) => (
    <Dropdown align="end" button={button}>
      <a href="#" className={`dropdown-item${current?.id === me.id ? ' active' : ''}`} onClick={(e) => { e.preventDefault(); void assign(id, me); }}>{mb.actions.assignToMe}</a>
      {staff.filter((p) => p.id !== me.id).map((p) => (
        <a key={p.id} href="#" className={`dropdown-item${current?.id === p.id ? ' active' : ''}`} onClick={(e) => { e.preventDefault(); void assign(id, p); }}>{p.name}</a>
      ))}
      <div className="dropdown-divider" />
      <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); void assign(id, null); }}>{mb.unassigned}</a>
    </Dropdown>
  );

  const folders = MAIL_FOLDERS.filter((f) => gmail || f === 'inbox' || f === 'sent' || f === 'done');
  const folderTabs = folders.map((f) => ({ id: f, label: mb.folders[f], count: counts[SERVER_FOLDER[f]] || undefined }));
  const filterTabs = [{ id: 'unassigned', label: mb.filters.unassigned }, { id: 'mine', label: mb.filters.mine }];
  const emptyTitle = q.trim() ? mb.empty.search : filter === 'unassigned' ? mb.empty.unassigned : filter === 'mine' ? mb.empty.mine : mb.empty[folder];

  // Gmail's keys on the desktop list (mailQuery.ts mailKey); the thread takes its own
  const keyActs = useRef<(k: ReturnType<typeof mailKey>) => void>(() => undefined);
  const onListKey = (k: ReturnType<typeof mailKey>) => {
    if (!k) return;
    if (k === 'compose') return setCompose({ to: '', subject: '', text: '' });
    if (k === 'search') return searchBox.current?.querySelector('input')?.focus();
    if (k === 'help') return setKeysOpen(true);
    if (openId) return;
    const r = rows[Math.min(cursor, rows.length - 1)];
    if (k === 'down') return setCursor((i) => Math.min(rows.length - 1, i + 1));
    if (k === 'up') return setCursor((i) => Math.max(0, i - 1));
    if (!r) return;
    if (k === 'open') return openThread(r.id);
    if (k === 'select' && gmail) return tick1(r.id);
    if (k === 'star') return void star(r);
    if (k === 'done') return void setDone(r.id, r.status !== 'done');
    if (k === 'reply') return openThread(r.id, { reply: '1' });
  };
  useEffect(() => {
    keyActs.current = onListKey;
  });
  useEffect(() => {
    if (phone) return;
    const onKey = (e: KeyboardEvent) => {
      const k = mailKey(e);
      if (!k || document.querySelector('.modal.show')) return;
      e.preventDefault();
      keyActs.current(k);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phone]);
  useEffect(() => {
    if (phone || openId) return;
    document.querySelector<HTMLElement>(`.mb-list > [data-i="${cursor}"] > summary`)?.focus({ preventScroll: false });
  }, [cursor, phone, openId]);

  const list = !data && !error ? (
    <PageSkeleton tiles={false} rows={6} />
  ) : !data ? (
    <LoadError error={error!} onRetry={refresh} />
  ) : rows.length === 0 ? (
    <EmptyState icon="envelope-open" title={emptyTitle} text="" />
  ) : phone ? (
    <div className="mb-plist">
      {rows.map((r) => (
        <PhoneRow key={r.id} r={r} me={me} onOpen={() => openThread(r.id)} onDone={() => void setDone(r.id, r.status !== 'done')} onStar={gmail ? () => void star(r) : undefined} assignMenu={assignMenu} />
      ))}
      <p className="mb-hint mb-swipe-hint">{tr("Swipe left on a row for Assign and Done.")}</p>
    </div>
  ) : (
    <div className="mb-list">
      {rows.map((r, i) => (
        <MailRow
          key={r.id}
          i={i}
          r={r}
          me={me}
          linkable={hotelBox}
          picked={picked.has(r.id)}
          onPick={gmail ? () => tick1(r.id) : undefined}
          onStar={gmail ? () => void star(r) : undefined}
          onOpen={(extra) => openThread(r.id, extra)}
          onDone={() => void setDone(r.id, r.status !== 'done')}
          assignMenu={assignMenu}
        />
      ))}
    </div>
  );
  const bulkBar = gmail && ticked.length > 0 ? (
    <BulkBar n={ticked.length} allOnPage={ticked.length === rows.length} onAll={() => setPicked(new Set(rows.map((r) => r.id)))} onClear={() => setPicked(new Set())} onAct={(a) => void runBulk(a)} busy={bulkBusy} folderDone={folder === 'done'} />
  ) : null;
  const chips = mq.chips.length ? (
    <div className="ml-chips" aria-label={mb.search}>
      {mq.chips.map((ch) => (
        <span key={ch} className="ml-qchip">
          {ch}
          <IconButton icon="x" label={`${tr("Remove")} ${ch}`} onClick={() => setSearch(withoutChip(search, ch))} />
        </span>
      ))}
    </div>
  ) : null;
  const pager = total > PAGE ? (
    <div className="mb-pager">
      <Button variant="outline" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr("Newer")}</Button>
      <span>{(page - 1) * PAGE + 1}-{Math.min(total, page * PAGE)} {tr("of")} {total}</span>
      <Button variant="outline" size="sm" icon="chevron-right" disabled={page * PAGE >= total} onClick={() => setPage(page + 1)}>{tr("Older")}</Button>
    </div>
  ) : null;

  const thread = openId ? (
    <MailThread
      key={openId}
      api={api}
      scope={scope}
      id={openId}
      me={me}
      personal={personal}
      phone={phone}
      hotelName={hotelName}
      fromAddress={fromAddress}
      own={own}
      quick={quick}
      wantReply={params.reply === '1'}
      wantLink={params.link === '1'}
      navigate={navigate}
      onBack={() => navigate(listViewId, boxParam)}
      onChanged={refresh}
      onForwardDesk={hotelBox && deskAddress ? forwardToDesk : undefined}
      onForward={forward}
      labels={labels}
      onHelp={() => setKeysOpen(true)}
      assignMenu={assignMenu}
    />
  ) : null;

  const composeModal = compose ? (
    <ComposeMail api={api} fromAddress={fromAddress} own={own} init={compose} quick={quick} onClose={() => setCompose(null)} onSent={(id, draft) => {
      setCompose(null);
      refresh();
      toast.show({ tone: 'success', text: draft ? mb.toasts.saved : mb.toasts.newSent });
      if (!draft) openThread(id);
    }} />
  ) : null;

  if (phone) {
    return (
      <div className={`mb-page ibx-fit is-phone${openId ? ' has-thread' : ''}`}>
        <InboxKpis kpi={kpi} list={data} onPicked={() => setPage(1)} />
        {openId ? thread : (
          <>
            <div className="mb-phead">
              <h2 className="mb-title">{mb.title}</h2>
              <IconButton icon="pencil" label={mb.newMail} onClick={() => setCompose({ to: '', subject: '', text: '' })} />
            </div>
            <ListSearch value={search} onChange={setSearch} onClear={() => setSearch('')} placeholder={personal ? mb.searchMine : mb.search} label={mb.search} wrapClass="mb-search" />
            {chips}
            <div className="mb-pseg">
              <ListTabs look="pills" label={mb.title} active={folder} onChange={(id) => setFolder(id as Folder)} tabs={folderTabs} />
              <span className="mb-vsep" aria-hidden="true" />
              <ListTabs look="pills" label={tr("Filter")} active={filter} onChange={(id) => setFilter(filter === id ? '' : (id as Filter))} tabs={filterTabs} />
            </div>
            {labels.length ? (
              <div className="mb-pseg ml-plabels">
                <ListTabs look="pills" label={mb.labels} active={label ?? ''} onChange={(id) => setLabel(label === id ? null : id)} tabs={labels.map((l) => ({ id: l, label: tr(l) }))} />
              </div>
            ) : null}
            {own.length > 1 ? (
              <div className="mb-pseg ml-plabels">
                <ListTabs look="pills" label={mb.addresses} active={address ?? ''} onChange={(id) => setAddress(address === id ? null : id)} tabs={own.map((a) => ({ id: a, label: a, icon: 'at' }))} />
              </div>
            ) : null}
            {list}
            {pager}
          </>
        )}
        {composeModal}
      </div>
    );
  }

  return (
    <div className="mb-page ibx-fit">
      <div className="mb-head">
        <div className="mb-head-t">
          <h2 className="mb-title">{mb.title}</h2>
          {fromAddress ? <span className="mb-addr">{fromAddress}</span> : null}
        </div>
        <div className="mb-head-acts">
          <IconButton icon="keyboard" label={mb.shortcuts.open} onClick={() => setKeysOpen(true)} />
          <Button icon="pencil" onClick={() => setCompose({ to: '', subject: '', text: '' })}>{mb.newMail}</Button>
        </div>
      </div>
      <InboxKpis kpi={kpi} list={data} onPicked={() => { setPage(1); if (openId) navigate(listViewId, {}); }} />
      <div className="mb-frame">
        <aside className="mb-folders">
          <div className="mb-fold" role="tablist" aria-label={mb.title}>
            {folders.map((f) => (
              <button /* check-shared-ignore: the folder list of the mailbox (a tab with a count at its end; no kit piece draws this row) */ key={f} type="button" role="tab" aria-selected={folder === f && !label} className={`mb-fold-btn${folder === f && !label ? ' is-on' : ''}`} onClick={() => setFolder(f)}>
                <Bi name={FOLDER_ICON[f]} />
                <span>{mb.folders[f]}</span>
                {counts[SERVER_FOLDER[f]] ? <span className={`mb-n${f === 'inbox' ? ' is-hot' : ''}`}>{counts[SERVER_FOLDER[f]]}</span> : null}
              </button>
            ))}
          </div>
          {labels.length ? (
            <div className="mb-fold" role="tablist" aria-label={mb.labels}>
              <span className="mb-lbl">{mb.labels}</span>
              {labels.map((l) => (
                <button /* check-shared-ignore: the folder list of the mailbox (no kit piece draws this row) */ key={l} type="button" role="tab" aria-selected={label === l} className={`mb-fold-btn${label === l ? ' is-on' : ''}`} onClick={() => setLabel(label === l ? null : l)}>
                  <i className={`ml-ldot is-${labelTone(l)}`} aria-hidden="true" />
                  <span>{tr(l)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {own.length > 1 ? (
            <div className="mb-fold" role="tablist" aria-label={mb.addresses}>
              <span className="mb-lbl">{mb.addresses}</span>
              {own.map((a) => (
                <button /* check-shared-ignore: the folder list of the mailbox (no kit piece draws this row) */ key={a} type="button" role="tab" title={a} aria-selected={address === a} className={`mb-fold-btn${address === a ? ' is-on' : ''}`} onClick={() => setAddress(address === a ? null : a)}>
                  <Bi name="at" />
                  <span className="mb-addrname">{a}</span>
                </button>
              ))}
            </div>
          ) : null}
          {personal && home === 'hotel' && userMayOpen('hotel.email') ? (
            <div className="mb-fold">
              <span className="mb-lbl">{tr("Hotel")}</span>
              <button /* check-shared-ignore: the folder list of the mailbox (no kit piece draws this row) */ type="button" className="mb-fold-btn" onClick={() => navigate('hotel.email', { box: 'shared' })}>
                <Bi name="building" />
                <span>{mb.hotelFolder}</span>
              </button>
            </div>
          ) : null}
          {personal || scope === 'hotel' ? <p className="mb-hint">{hotelBox ? mb.mineHint : personal ? mb.mineHintOwn : mb.hotelHint}</p> : null}
        </aside>
        <div className="mb-main">
          {openId ? thread : (
            <>
              <div className="mb-tools" ref={searchBox} title={gmail ? mb.searchTips : undefined}>
                <ListSearch value={search} onChange={setSearch} onClear={() => setSearch('')} placeholder={personal ? mb.searchMine : mb.search} label={mb.search} wrapClass="mb-search" />
              </div>
              {chips}
              {bulkBar ?? (
                <div className="mb-filters">
                  {gmail && rows.length ? <input type="checkbox" className="form-check-input ml-check" aria-label={mb.selectPage} checked={false} onChange={() => setPicked(new Set(rows.map((r) => r.id)))} /> : null}
                  <ListTabs look="pills" label={tr("Filter")} active={filter} onChange={(id) => setFilter(filter === id ? '' : (id as Filter))} tabs={filterTabs} />
                  <span className="mb-count">{threadsWord(rows.length)}</span>
                </div>
              )}
              {list}
              {pager}
            </>
          )}
        </div>
      </div>
      {composeModal}
      {keysOpen ? <ShortcutsDialog onClose={() => setKeysOpen(false)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ one row of the desktop list: opens in place */

function MailRow({ i, r, me, linkable, picked, onPick, onStar, onOpen, onDone, assignMenu }: { i: number; r: ConversationRow; me: ConvPerson; linkable: boolean; picked: boolean; onPick?: () => void; onStar?: () => void; onOpen: (extra?: Record<string, string>) => void; onDone: () => void; assignMenu: AssignMenu }) {
  const st = statusOf(r);
  const preview = r.lastDirection === 'out' ? `${mb.you}: ${r.preview}` : r.preview;
  const who = r.participants?.length ? `${r.participants.join(', ')}${(r.messageCount ?? 0) > 1 ? ` (${r.messageCount})` : ''}` : r.name;
  return (
    <details className={`mb-row${r.unread > 0 ? ' is-unread' : ''}${picked ? ' is-picked' : ''}${onPick ? ' has-tools' : ''}`} data-i={i}>
      <summary>
        <i className="mb-dot" aria-hidden="true" />
        {onPick ? (
          <span className="ml-rowtools" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" className="form-check-input ml-check" aria-label={mb.select.replace('{name}', r.name)} checked={picked} onChange={onPick} onClick={(e) => e.stopPropagation()} />
            {onStar ? <StarButton on={Boolean(r.starred)} name={r.name} onToggle={onStar} /> : null}
          </span>
        ) : (
          <span className="mb-av" aria-hidden="true">{initialsOf(r.name)}</span>
        )}
        <span className="mb-row-main">
          <span className="mb-l1">
            <span className="mb-nm">{who}</span>
            {r.draft ? <span className="ml-draft">{mb.draftMark}</span> : null}
            <StatusChip tone={st.tone}>{st.label}</StatusChip>
            {r.unverified ? <span className="mb-warnmark" title={mb.threadView.notVerified}><Bi name="shield-exclamation" /></span> : null}
          </span>
          <span className="mb-l2">
            <LabelChips labels={r.labels} />
            <span className="mb-sj">{r.subject || c.email.noSubject}</span>
            <span aria-hidden="true">·</span>
            <span className="mb-pw">{preview}</span>
          </span>
        </span>
        <span className="mb-meta">
          {r.snoozedUntil ? <span className="ml-snoozed" title={mb.snooze.until.replace('{when}', formatDateTime(r.snoozedUntil))}><Bi name="clock" />{whenLabel(r.snoozedUntil, nowMs())}</span> : <time dateTime={r.lastAt}>{whenLabel(r.lastAt, nowMs())}</time>}
          <span className="mb-r2">
            {r.hasAttachments ? <span title={c.attachmentMark}><Bi name="paperclip" /></span> : null}
            {r.assignedTo ? <span className="mb-av is-xs" title={r.assignedTo.name}>{initialsOf(r.assignedTo.name)}</span> : <span className="mb-chip">{mb.unassigned}</span>}
          </span>
        </span>
      </summary>
      <div className="mb-more">
        <div className="mb-last">{preview}</div>
        <div className="mb-qa">
          <Button variant="outline" size="sm" icon="reply" onClick={() => onOpen({ reply: '1' })}>{mb.actions.reply}</Button>
          <Button variant="outline" size="sm" onClick={() => onOpen()}>{mb.actions.openThread}</Button>
          {linkable ? <Button variant="outline" size="sm" icon="link-45deg" onClick={() => onOpen({ link: '1' })}>{mb.actions.linkBooking}</Button> : null}
          {assignMenu(r.id, r.assignedTo, (p) => <Button variant="outline" size="sm" icon="person" {...p}>{r.assignedTo ? (r.assignedTo.id === me.id ? mb.filters.mine : r.assignedTo.name) : mb.actions.assign}</Button>)}
          <Button variant="outline" size="sm" icon={r.status === 'done' ? 'arrow-counterclockwise' : 'check2'} onClick={onDone}>{r.status === 'done' ? mb.actions.reopen : mb.actions.markDone}</Button>
        </div>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ one row of the phone list: swipe left for Assign and Done */

function PhoneRow({ r, me, onOpen, onDone, onStar, assignMenu }: { r: ConversationRow; me: ConvPerson; onOpen: () => void; onDone: () => void; onStar?: () => void; assignMenu: AssignMenu }) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; from: number } | null>(null);
  const st = statusOf(r);
  const onStart = (e: TouchEvent) => {
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, from: dx };
  };
  const onMove = (e: TouchEvent) => {
    if (!start.current) return;
    const mx = e.touches[0].clientX - start.current.x;
    const my = e.touches[0].clientY - start.current.y;
    if (Math.abs(my) > Math.abs(mx)) return;
    setDx(Math.max(-SWIPE_W, Math.min(0, start.current.from + mx)));
  };
  const onEnd = () => {
    start.current = null;
    setDx((v) => (v < -SWIPE_W / 2 ? -SWIPE_W : 0));
  };
  return (
    <div className={`mb-swipe${dx < 0 ? ' is-open' : ''}`}>
      <div className="mb-swipe-acts" aria-hidden={dx === 0}>
        {/* check-shared-ignore: the two tiles behind a swiped phone row (icon over word, full height; no kit equivalent) */}
        {assignMenu(r.id, r.assignedTo, (p) => <button type="button" className="mb-swipe-btn is-assign" tabIndex={dx === 0 ? -1 : 0} {...p}><Bi name="person" />{mb.actions.assign}</button>)}
        {/* check-shared-ignore: the two tiles behind a swiped phone row (icon over word, full height; no kit equivalent) */}
        <button type="button" className="mb-swipe-btn is-done" tabIndex={dx === 0 ? -1 : 0} onClick={() => { setDx(0); onDone(); }}><Bi name="check2" />{r.status === 'done' ? mb.actions.reopen : mb.folders.done}</button>
      </div>
      <div className="ml-pslide" style={{ transform: `translateX(${dx}px)` }}>
      <button
        /* check-shared-ignore: the phone row slides on a swipe to show Assign and Done (no kit equivalent) */
        type="button"
        className={`mb-prow${r.unread > 0 ? ' is-unread' : ''}${onStar ? ' has-star' : ''}`}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onTouchCancel={onEnd}
        onClick={() => (dx < 0 ? setDx(0) : onOpen())}
      >
        <span className="mb-av" aria-hidden="true">{initialsOf(r.name)}</span>
        <span className="mb-prow-main">
          <span className="mb-nm">{r.name}{r.draft ? <span className="ml-draft">{mb.draftMark}</span> : null}</span>
          <span className="mb-sj">{r.subject || c.email.noSubject}</span>
          <span className="mb-pw">{r.lastDirection === 'out' ? `${mb.you}: ${r.preview}` : r.preview}</span>
          {r.labels?.length ? <span className="ml-plchips"><LabelChips labels={r.labels} /></span> : null}
        </span>
        <span className="mb-meta">
          {r.snoozedUntil ? <span className="ml-snoozed"><Bi name="clock" />{whenLabel(r.snoozedUntil, nowMs())}</span> : <time dateTime={r.lastAt}>{whenLabel(r.lastAt, nowMs())}</time>}
          {r.assignedTo ? <span className="mb-av is-xs" title={r.assignedTo.name}>{r.assignedTo.id === me.id ? initialsOf(me.name) : initialsOf(r.assignedTo.name)}</span> : <StatusChip tone={st.tone}>{st.label}</StatusChip>}
        </span>
      </button>
      {onStar ? <StarButton on={Boolean(r.starred)} name={r.name} onToggle={onStar} /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the thread: messages, the guest card, the reply */

/** What a reply held back by Undo gives back to the editor. */
interface ReplyDraft {
  text: string;
  cc: string[];
  subject: string;
  mode: 'reply' | 'all';
}

function MailThread({ api, scope, id, me, personal, phone, hotelName, fromAddress, own, quick, wantReply, wantLink, navigate, onBack, onChanged, onForwardDesk, onForward, labels, onHelp, assignMenu }: {
  api: Api;
  scope: ConvScope;
  id: string;
  me: ConvPerson;
  personal: boolean;
  phone: boolean;
  hotelName: string;
  fromAddress: string | null;
  own: readonly string[];
  quick: QuickReply[];
  wantReply: boolean;
  wantLink: boolean;
  navigate: ScreenProps['navigate'];
  onBack: () => void;
  onChanged: () => void;
  onForwardDesk?: (m: EmailEntry, text: string | null) => void;
  onForward: (m: EmailEntry, text: string | null) => void;
  labels: readonly string[];
  onHelp: () => void;
  assignMenu: AssignMenu;
}) {
  const toast = useToast();
  const { thread, error, setThread, reload } = useChannelThread(api, id, onChanged, personal ? 'personal' : 'main', scope);
  const pending = usePending(api, id);
  const undo = useUndoSend();
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  // the emails already opened in this thread come back at once (convCache.ts)
  const [bodies, setBodies] = useState<Record<string, CachedBody>>(() => cachedBodies<CachedBody>(api, id));
  useEffect(() => storeBodies(api, id, bodies), [api, id, bodies]);
  const [showEarlier, setShowEarlier] = useState(false);
  const [replyMode, setReplyMode] = useState<'reply' | 'all'>('reply');
  const [replyOpen, setReplyOpenState] = useState(wantReply);
  const setReplyOpen = (on: boolean, mode: 'reply' | 'all' = 'reply') => {
    setReplyMode(mode);
    setReplyOpenState(on);
  };
  // Gmail's keys inside an open mail: r reply, a reply all, f forward, e done, s star, U unread, u back (the page handles c, / and ?)
  const threadKeys = useRef<(k: ReturnType<typeof mailKey>) => void>(() => undefined);
  useEffect(() => {
    threadKeys.current = (k) => {
      if (!thread || !thread.access.canEdit) return k === 'back' ? onBack() : undefined;
      const last = [...thread.messages].reverse().find((m): m is EmailEntry => m.kind === 'email');
      const done = (r: { ok: true; data: ConversationThread } | { ok: false; error: DashError }) => {
        if (!r.ok) return toast.show({ tone: 'error', text: errorText(r.error) });
        setThread(r.data);
        onChanged();
      };
      if (k === 'reply') setReplyOpen(true, 'reply');
      else if (k === 'replyAll') setReplyOpen(true, 'all');
      else if (k === 'forward' && last) onForward(last, bodies[last.id]?.body.text ?? null);
      else if (k === 'done') void api.setStatus(thread.id, thread.status === 'done' ? 'open' : 'done').then(done);
      else if (k === 'star' && api.setStarred) void api.setStarred(thread.id, !thread.starred).then(done);
      else if (k === 'unread') void api.markUnread(thread.id).then((r) => { if (r.ok) { onChanged(); onBack(); } });
      else if (k === 'back') onBack();
    };
  });
  useEffect(() => {
    if (phone) return;
    const onKey = (e: KeyboardEvent) => {
      const k = mailKey(e);
      if (!k || document.querySelector('.modal.show')) return;
      threadKeys.current(k);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phone]);
  const [linking, setLinking] = useState(wantLink);
  const [bill, setBill] = useState(false);
  // the newest unread mail from the guest keeps its "New" mark while the thread is open, although opening it marks the thread read
  const [freshId, setFreshId] = useState<string | null>(null);
  const onLoaded = useCallback((mid: string, b: CachedBody) => setBodies((all) => ({ ...all, [mid]: b })), []);

  if (error && !thread) return <LoadError error={error} onRetry={reload} />;
  if (!thread) return <div className="mb-thread"><Skeleton lines={6} /></div>;

  // the server's mail decides what a reply answers; a reply still going (outbox.ts) is drawn after it
  const sent = thread.messages.filter((m): m is EmailEntry => m.kind === 'email');
  const emails = withPending(sent, pending).filter((m): m is EmailEntry => m.kind === 'email');
  const failedIds = new Set(pending.filter((p) => p.error).map((p) => p.tempId));
  const lastEmail = sent[sent.length - 1];
  const lastIn = [...sent].reverse().find((m) => m.direction === 'in');
  if (freshId === null) setFreshId(thread.unread > 0 && lastIn ? lastIn.id : '');
  const subject = (emails[0]?.subject ?? '').replace(/^((re|fwd?):\s*)+/i, '') || c.email.noSubject;
  const readOnly = !thread.access.canEdit;
  const st = statusOf({ status: thread.status, waiting: lastEmail?.direction === 'in', lastDirection: lastEmail?.direction ?? 'in' });
  const shown = showEarlier || emails.length <= 4 ? emails : emails.slice(-3);
  const earlier = emails.length - shown.length;
  const people = threadParticipants(thread.messages, thread.contact.handles);
  const link = thread.links[0];
  const d = link?.detail;
  const canLink = thread.access.canEdit && thread.access.canLink.length > 0;
  const stayId = link?.kind === 'stay' ? link.id : null;
  const payLink = !personal && link && thread.access.canSeeBills && (stayId ? userMayOpen('hotel.fo.stay') : userMayOpen('hotel.billing.bills'));
  const billOk = thread.access.canSeeBills && Boolean(d?.billId) && thread.replyTo !== null && thread.contact.handles.some((h) => h.toLowerCase() === (thread.replyTo?.address ?? '').toLowerCase());

  const act = async (p: Promise<{ ok: true; data: ConversationThread } | { ok: false; error: DashError }>, said: string): Promise<boolean> => {
    const r = await p;
    if (!r.ok) {
      toast.show({ tone: 'error', text: errorText(r.error) });
      return false;
    }
    setThread(r.data);
    onChanged();
    toast.show({ tone: 'success', text: said });
    return true;
  };
  const toggleDone = () => void act(api.setStatus(thread.id, thread.status === 'done' ? 'open' : 'done'), thread.status === 'done' ? mb.toasts.reopened : mb.toasts.done);
  const sendPayLink = () => (stayId ? navigate('hotel.fo.stay', { id: stayId }) : navigate('hotel.billing.bills', {}));
  // the reply shows in the thread the moment Send is pressed, waiting while Undo is offered, then going; Undo takes it off and gives the words back to the editor
  const onSend = (input: EmailReplyInput, kept: ReplyDraft) => {
    const at = new Date().toISOString();
    const to = thread.replyTo?.address ?? '';
    const subject = input.subject ?? lastEmail?.subject ?? '';
    const from = input.from ?? fromAddress ?? '';
    const temp: EmailEntry = { kind: 'email', id: newTempId(), direction: 'out', status: 'pending', at, from, replyTo: null, to: to ? [to] : [], cc: input.cc ?? [], subject, preview: input.text.replace(/\s+/g, ' ').slice(0, 200), hasAttachments: Boolean(input.billId), sentBy: me, sentFrom: 'hms', verified: null };
    const body: CachedBody = { body: { id: temp.id, subject, from, to: temp.to, cc: temp.cc, at, html: null, text: input.text, remoteImages: 0, droppedInline: 0, hasQuoted: false, attachments: [] }, images: false };
    setBodies((all) => ({ ...all, [temp.id]: body }));
    stagePending(api, thread.id, temp, input);
    setReplyOpen(false);
    setBill(false);
    setDraft(null);
    undo.schedule(
      async () => {
        const r = await runPending(api, thread.id, temp.id);
        if (!r?.ok) return;
        setBodies((all) => ({ ...all, [r.data.id]: body }));
        onChanged();
        toast.show({ tone: 'success', text: mb.toasts.sent.replace('{name}', thread.contact.name) });
      },
      () => {
        dropPending(api, thread.id, temp.id);
        setDraft(kept);
        setReplyOpen(true, kept.mode);
      },
    );
  };
  const retrySend = (tempId: string) =>
    void runPending(api, thread.id, tempId).then((r) => {
      if (r?.ok) onChanged();
    });
  // Remove on a reply that did not go gives its words back to the editor, so nothing typed is lost
  const removeFailed = (tempId: string) => {
    const p = pending.find((x) => x.tempId === tempId);
    dropPending(api, thread.id, tempId);
    if (!p || p.input.channel !== 'email') return;
    const kept: ReplyDraft = { text: p.input.text, cc: [...(p.input.cc ?? [])], subject: p.input.subject ?? reSubject(lastEmail?.subject ?? ''), mode: 'reply' };
    setDraft(kept);
    setReplyOpen(true, kept.mode);
  };
  const forwardLast = () => lastEmail && onForward(lastEmail, bodies[lastEmail.id]?.body.text ?? null);
  const forwardDeskLast = () => lastEmail && onForwardDesk?.(lastEmail, bodies[lastEmail.id]?.body.text ?? null);
  const toggleStar = () => api.setStarred && void act(api.setStarred(thread.id, !thread.starred), thread.starred ? mb.unstar : mb.starred);
  const saveLabels = (next: string[]) => api.setLabels && void act(api.setLabels(thread.id, next), mb.labelMenu.saved);
  const snooze = (iso: string | null) => {
    if (!api.setSnoozed) return;
    void act(api.setSnoozed(thread.id, iso), iso ? mb.snooze.snoozed.replace('{when}', formatDateTime(iso)) : mb.snooze.back).then((ok) => ok && iso && onBack());
  };
  const gmail = Boolean(api.setStarred);

  const guestCard = (
    <div className="mb-guest">
      <div className="mb-guest-hd">
        <b>{thread.contact.name}</b>
        {lastIn?.verified === true ? <span className="mb-ver"><Bi name="shield-check" /> {mb.threadView.verified}</span> : lastIn?.verified === false ? <span className="mb-ver is-bad"><Bi name="shield-exclamation" /> {mb.threadView.notVerified}</span> : null}
      </div>
      <div className="mb-guest-sub">{thread.contact.handles.join(' · ')}</div>
      {link ? (
        <dl className="mb-kv">
          <dt>{mb.threadView.booking}</dt><dd>{link.label}</dd>
          {d?.room ? <><dt>{mb.threadView.room}</dt><dd>{d.room}</dd></> : null}
          {d?.checkIn || d?.checkOut ? <><dt>{mb.threadView.dates}</dt><dd>{[d.checkIn ? formatDate(d.checkIn) : '', d.checkOut ? formatDate(d.checkOut) : ''].filter(Boolean).join(' to ')}</dd></> : null}
          {d?.billNo ? <><dt className="is-tot">{mb.threadView.bill}</dt><dd className="is-tot t-num">{d.billTotal !== undefined ? `${d.billNo} · ${formatINR(d.billTotal)}` : d.billNo}</dd></> : null}
        </dl>
      ) : (
        <div className="mb-guest-none">
          <StatusChip tone="neutral">{mb.threadView.noBooking}</StatusChip>
          <span>{mb.threadView.noBookingBody}</span>
        </div>
      )}
      <div className="mb-guest-acts">
        {payLink ? <Button icon="currency-rupee" onClick={sendPayLink}>{mb.actions.payLink}</Button> : null}
        {billOk && !readOnly ? (
          <Button variant="outline" size="sm" icon={bill ? 'check2' : 'file-earmark-pdf'} aria-pressed={bill} onClick={() => { setBill((v) => !v); setReplyOpen(true); }}>{bill ? mb.actions.billAttached.replace('{no}', d?.billNo ?? '') : mb.actions.attachBillPdf}</Button>
        ) : null}
        {!link && canLink ? <Button variant="outline" size="sm" icon="link-45deg" onClick={() => setLinking(true)}>{mb.actions.linkBooking}</Button> : null}
        {link && canLink && personal ? <Button variant="outline" size="sm" icon="link-45deg" onClick={() => setLinking(true)}>{c.contact.change}</Button> : null}
        {onForwardDesk && lastEmail ? <Button variant="outline" size="sm" icon="forward" onClick={forwardDeskLast}>{mb.actions.forwardDesk}</Button> : null}
      </div>
      {!personal ? <p className="mb-hint mb-auto-line"><Bi name="gear" /> <span>{mb.threadView.automation}</span></p> : null}
    </div>
  );

  const messages = (
    <div className="mb-msgs">
      {earlier > 0 ? (
        <Button variant="ghost" size="sm" icon="chevron-expand" className="mb-earlier-btn" onClick={() => setShowEarlier(true)}>{mb.threadView.showEarlier} ({earlier})</Button>
      ) : null}
      {shown.map((m) => (
        <Fragment key={m.id}>
          <EmailMessage look="mail" convId={thread.id} m={m} api={api} autoOpen={m.id === lastEmail?.id || m.id.startsWith('tmp-')} cached={bodies[m.id]} onLoaded={onLoaded} hotelName={hotelName} fresh={m.id === freshId} />
          {failedIds.has(m.id) ? (
            <div className="mb-retry" role="alert">
              <span>{errorText(pending.find((p) => p.tempId === m.id)?.error ?? { code: 'SERVER_ERROR', message: 'SERVER_ERROR', traceId: 'client' })}</span>
              <Button variant="outline" size="sm" icon="arrow-clockwise" onClick={() => retrySend(m.id)}>{tr('Try again')}</Button>
              <Button variant="ghost" size="sm" onClick={() => removeFailed(m.id)}>{tr('Remove')}</Button>
            </div>
          ) : null}
        </Fragment>
      ))}
      {thread.access.readOnlyReason ? <Alert tone="neutral">{thread.access.readOnlyReason === 'visit' ? c.readOnly.visit : c.readOnly.viewOnly}</Alert> : null}
    </div>
  );

  const editor = (
    <ReplyEditor
      key={replyMode}
      thread={thread}
      lastEmail={lastEmail}
      quick={quick}
      fromAddress={fromAddress}
      own={own}
      bill={bill}
      onBill={billOk ? setBill : undefined}
      billNo={d?.billNo ?? ''}
      billId={d?.billId ?? ''}
      onPayLink={payLink ? sendPayLink : undefined}
      onSend={onSend}
      init={draft}
      busy={undo.pending}
      onCancel={() => setReplyOpen(false)}
      sheet={phone}
      mode={replyMode}
    />
  );
  const linkDialog = linking ? <LinkGuestDialog open thread={thread} api={api} onClose={() => setLinking(false)} onLinked={(t) => { setThread(t); onChanged(); }} /> : null;

  if (phone) {
    return (
      <div className="mb-pthread">
        <div className="mb-phead is-thread">
          <IconButton icon="arrow-left" label={mb.actions.back} onClick={onBack} />
          <div className="mb-pttl">
            <h2>{thread.contact.name}</h2>
            <span>{subject} · {thread.assignedTo ? thread.assignedTo.name : mb.unassigned.toLowerCase()}</span>
          </div>
          {gmail && !readOnly ? <StarButton on={Boolean(thread.starred)} name={thread.contact.name} onToggle={toggleStar} /> : null}
          {api.setSnoozed && !readOnly ? <SnoozeMenu until={thread.snoozedUntil} onSnooze={snooze} button={(p) => <IconButton icon="clock" label={mb.snooze.button} {...p} />} /> : null}
          <Dropdown align="end" button={(p) => <IconButton icon="three-dots" label={c.actions.more} {...p} />}>
            {!readOnly ? <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setReplyOpen(true, 'all'); }}>{mb.actions.replyAll}</a> : null}
            {lastEmail ? <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); forwardLast(); }}>{mb.actions.forward}</a> : null}
            <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); void act(api.setAssignee(thread.id, me.id), mb.toasts.assigned.replace('{name}', me.name)); }}>{mb.actions.assignToMe}</a>
            <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); toggleDone(); }}>{thread.status === 'done' ? mb.actions.reopen : mb.actions.markDone}</a>
            {canLink ? <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setLinking(true); }}>{link ? c.contact.change : mb.actions.linkBooking}</a> : null}
            {onForwardDesk && lastEmail ? <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); forwardDeskLast(); }}>{mb.actions.forwardDesk}</a> : null}
          </Dropdown>
        </div>
        <div className="mb-pscroll">
          {messages}
          {guestCard}
        </div>
        {readOnly ? null : (
          <div className="mb-cta">
            <button /* check-shared-ignore: the phone's reply line opens the reply sheet (a text line shaped like a field, no kit equivalent) */ type="button" className="mb-preply" onClick={() => setReplyOpen(true)}>
              <span>{mb.threadView.replyTo.replace('{name}', thread.contact.name)}</span>
              <span className="mb-preply-send" aria-hidden="true"><Bi name="send" /></span>
            </button>
          </div>
        )}
        {replyOpen && !readOnly ? (
          <Modal open onClose={() => setReplyOpen(false)} title={replyMode === 'all' ? mb.compose.replyAllTitle : mb.compose.replyTitle} className="mb-sheet" centered={false}>
            {editor}
          </Modal>
        ) : null}
        {linkDialog}
      </div>
    );
  }

  return (
    <div className="mb-thread">
      <div className="mb-thread-main">
        <div className="mb-thd">
          <div className="mb-thd-row">
            <IconButton icon="arrow-left" label={mb.actions.back} onClick={onBack} />
            {gmail && !readOnly ? <StarButton on={Boolean(thread.starred)} name={thread.contact.name} onToggle={toggleStar} /> : null}
            <h2 className="mb-subject">{subject}</h2>
            <span className="ml-tlabels"><LabelChips labels={thread.labels} /></span>
            <span className="mb-grow" />
            <StatusChip tone={st.tone}>{st.label}</StatusChip>
            {thread.assignedTo ? <span className="mb-av is-xs" title={thread.assignedTo.name}>{initialsOf(thread.assignedTo.name)}</span> : null}
            {readOnly ? null : assignMenu(thread.id, thread.assignedTo, (p) => <Button variant="outline" size="sm" icon="person" {...p}>{mb.actions.assign}</Button>)}
            {readOnly || !labels.length || !api.setLabels ? null : <LabelMenu labels={thread.labels ?? []} all={labels} onChange={saveLabels} button={(p) => <Button variant="outline" size="sm" icon="tag" {...p}>{mb.labelMenu.button}</Button>} />}
            {readOnly || !api.setSnoozed ? null : <SnoozeMenu until={thread.snoozedUntil} onSnooze={snooze} button={(p) => <Button variant="outline" size="sm" icon="clock" {...p}>{mb.snooze.button}</Button>} />}
            {readOnly ? null : <Button variant="outline" size="sm" icon={thread.status === 'done' ? 'arrow-counterclockwise' : 'check2'} onClick={toggleDone}>{thread.status === 'done' ? mb.actions.reopen : mb.actions.markDone}</Button>}
            <IconButton icon="keyboard" label={mb.shortcuts.open} onClick={onHelp} />
          </div>
          <div className="mb-ppl">
            {people.map((p) => (
              <span key={p.address}>{p.ccOnly ? `${mb.threadView.cc} ` : ''}<b>{p.name}</b> {p.name !== p.address ? p.address : ''}</span>
            ))}
            {fromAddress ? <span><b>{hotelName || mb.threadView.hotel}</b> {fromAddress}</span> : null}
          </div>
        </div>
        {messages}
        {readOnly ? null : replyOpen ? editor : (
          <div className="mb-replybar">
            <button /* check-shared-ignore: the reply line opens the editor in place (a text line shaped like a field, no kit equivalent) */ type="button" className="mb-replyline" onClick={() => setReplyOpen(true)}>{mb.threadView.replyTo.replace('{name}', thread.contact.name)}</button>
            <Button size="sm" icon="reply" onClick={() => setReplyOpen(true)}>{mb.actions.reply}</Button>
            <Button variant="outline" size="sm" icon="reply-all" onClick={() => setReplyOpen(true, 'all')}>{mb.actions.replyAll}</Button>
            {lastEmail ? <Button variant="outline" size="sm" icon="forward" onClick={forwardLast}>{mb.actions.forward}</Button> : null}
          </div>
        )}
      </div>
      <aside className="mb-side">{guestCard}</aside>
      {linkDialog}
    </div>
  );
}

/* ------------------------------------------------------------------ quick replies and the templates in three languages (reply and compose) */

function Helpers({ quick, onInsert }: { quick: QuickReply[]; onInsert: (text: string) => void }) {
  const [tplOpen, setTplOpen] = useState(false);
  const [lang, setLang] = useState<Lang>('en');
  const chips = quick.filter((q) => q.channel !== 'whatsapp');
  return (
    <div className="mb-helpers">
      <div className="mb-qrs">
        {chips.map((q) => (
          <Button key={q.id} variant="outline" size="sm" className="mb-qr" title={q.body} onClick={() => onInsert(q.body)}>{q.title}</Button>
        ))}
        <Button variant="outline" size="sm" className={`mb-qr${tplOpen ? ' is-on' : ''}`} icon="journal-text" aria-expanded={tplOpen} onClick={() => setTplOpen((v) => !v)}>{mb.compose.templates}</Button>
      </div>
      {tplOpen ? (
        <div className="mb-tplbox">
          <div className="mb-tplbox-hd">
            <span className="mb-lbl">{mb.compose.templates}</span>
            <ListTabs look="pills" label={tr("Language")} active={lang} onChange={(id) => setLang(id as Lang)} tabs={(['en', 'hi', 'gu'] as Lang[]).map((l) => ({ id: l, label: mb.compose.languages[l] }))} />
          </div>
          <div className="mb-tpl">
            {mb.templates.map((t) => (
              <button /* check-shared-ignore: a template card (title and hint) drops its text into the editor; no kit piece has two lines */ key={t.id} type="button" className="mb-tpl-btn" lang={lang} onClick={() => { onInsert(t.body[lang]); setTplOpen(false); }}>
                <b>{t.title}</b>
                <span>{t.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const append = (cur: string, more: string) => (cur.trim() ? `${cur.trimEnd()}\n\n${more}` : more);

/* ------------------------------------------------------------------ the reply editor: under the thread on a desktop, in a sheet on a phone */

function ReplyEditor({ thread, lastEmail, quick, fromAddress, own, bill, onBill, billNo, billId, onPayLink, onSend, init, busy, onCancel, sheet, mode = 'reply' }: {
  thread: ConversationThread;
  lastEmail: EmailEntry | undefined;
  quick: QuickReply[];
  fromAddress: string | null;
  own: readonly string[];
  bill: boolean;
  onBill?: (on: boolean) => void;
  billNo: string;
  billId: string;
  onPayLink?: () => void;
  /** Send pressed: the thread shows the reply at once and sends it after Undo (MailThread). */
  onSend: (input: EmailReplyInput, kept: ReplyDraft) => void;
  /** The words given back by Undo. */
  init: ReplyDraft | null;
  /** A reply of this thread is waiting for Undo. */
  busy: boolean;
  onCancel: () => void;
  sheet: boolean;
  /** Reply all starts with everyone of the last mail in Cc. */
  mode?: 'reply' | 'all';
}) {
  const target = thread.replyTo?.address ?? '';
  const people = threadParticipants(thread.messages, thread.contact.handles);
  const everyone = replyAllRecipients(lastEmail, target || null, thread.messages);
  const [cc, setCc] = useState<string[]>(() => init?.cc ?? (mode === 'all' ? everyone : []));
  const [showCc, setShowCc] = useState((init?.cc.length ?? 0) > 0 || (mode === 'all' && everyone.length > 0));
  const [subject, setSubject] = useState(() => init?.subject ?? reSubject(lastEmail?.subject ?? ''));
  const [text, setText] = useState(init?.text ?? '');
  const [from, setFrom] = useState(() => {
    const lastIn = [...thread.messages].reverse().find((m): m is EmailEntry => m.kind === 'email' && m.direction === 'in');
    return lastIn ? receivedOn(own, lastIn.to, lastIn.cc) : (own[0] ?? '');
  });
  const [fields, setFields] = useState<Record<string, string>>({});

  const send = () => {
    if (busy) return;
    if (!text.trim()) return setFields({ text: c.errors.textRequired });
    if (cc.length > CONV_CC_MAX) return setFields({ cc: c.errors.ccMany });
    setFields({});
    const input: EmailReplyInput = {
      channel: 'email' as const,
      text,
      ...(lastEmail ? { inReplyTo: lastEmail.id } : {}),
      ...(cc.length ? { cc } : {}),
      ...(subject.trim() ? { subject: subject.trim() } : {}),
      ...(bill && billId ? { billId } : {}),
      ...(own.length > 1 && from ? { from } : {}),
    };
    onSend(input, { text, cc, subject, mode });
  };

  return (
    <section className={`mb-editor${sheet ? ' is-sheet' : ''}`} aria-label={mode === 'all' ? mb.compose.replyAllTitle : mb.compose.replyTitle}>
      <FromField id={`mb-from-${thread.id}`} own={own} value={from} onChange={setFrom} invalid={Boolean(fields.from)} />
      {fields.from ? <div className="field-error">{fields.from}</div> : null}
      <div className="mb-fl">
        <label>{mb.compose.to}</label>
        <div className="mb-pill"><span className="mb-av is-xs" aria-hidden="true">{initialsOf(thread.contact.name)}</span>{thread.contact.name}{target ? ` · ${target}` : ''}</div>
        {!showCc ? <Button variant="ghost" size="sm" className="mb-link" onClick={() => { setShowCc(true); if (everyone.length) setCc(everyone); }}>{mb.compose.cc}</Button> : <span />}
      </div>
      {showCc ? (
        <div className="mb-fl">
          <label htmlFor={`mb-cc-${thread.id}`}>{mb.compose.cc}</label>
          <CcChipsInput id={`mb-cc-${thread.id}`} value={cc} onChange={setCc} people={people} target={target || null} max={CONV_CC_MAX} invalid={Boolean(fields.cc)} />
          <span />
        </div>
      ) : null}
      {fields.cc ? <div className="field-error">{fields.cc}</div> : null}
      <div className="mb-fl">
        <label htmlFor={`mb-sub-${thread.id}`}>{mb.compose.subject}</label>
        <input id={`mb-sub-${thread.id}`} className="mb-in" value={subject} maxLength={600} onChange={(e) => setSubject(e.target.value)} />
        <StatusChip tone="neutral">{mode === 'all' ? mb.compose.replyAllTitle : mb.compose.replyTitle}</StatusChip>
      </div>
      <Textarea className="mb-ed" aria-label={mb.compose.replyBody} placeholder={mb.compose.replyBody} autoFocus rows={sheet ? 5 : 7} value={text} maxLength={CONV_REPLY_MAX} invalid={Boolean(fields.text)} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
      {fields.text ? <div className="field-error">{fields.text}</div> : null}
      <Helpers quick={quick} onInsert={(t) => setText((cur) => append(cur, t))} />
      {fields._ ? <Alert tone="danger">{fields._}</Alert> : null}
      <div className="mb-ctools">
        {onBill ? <Button variant="outline" size="sm" icon={bill ? 'check2' : 'file-earmark-pdf'} aria-pressed={bill} onClick={() => onBill(!bill)}>{bill ? mb.actions.billAttached.replace('{no}', billNo) : mb.actions.attachBill}</Button> : null}
        {onPayLink ? <Button variant="outline" size="sm" icon="currency-rupee" onClick={onPayLink}>{mb.actions.payLink}</Button> : null}
        <span className="mb-grow" />
        {fromAddress && own.length < 2 ? <span className="mb-from">{mb.compose.from.replace('{address}', fromAddress)}</span> : null}
        <Button variant="ghost" size="sm" onClick={onCancel}>{mb.compose.cancel}</Button>
        <Button size="sm" icon="send" busy={busy} busyLabel={c.reply.sending} onClick={send}>{mb.compose.send}</Button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ New mail: a modal (a sheet on a phone) */

function ComposeMail({ api, fromAddress, own, init, quick, onClose, onSent }: { api: Api; fromAddress: string | null; own: readonly string[]; init: { to: string; subject: string; text: string }; quick: QuickReply[]; onClose: () => void; onSent: (id: string, draft: boolean) => void }) {
  const [to, setTo] = useState(init.to);
  const [from, setFrom] = useState(own[0] ?? '');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [more, setMore] = useState<'' | 'cc' | 'bcc'>('');
  const [subject, setSubject] = useState(init.subject);
  const [text, setText] = useState(init.text);
  const files = useComposeFiles(api);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const undo = useUndoSend();
  const split = (v: string) => v.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const submit = (draft: boolean) => {
    const sendNewEmail = api.sendNewEmail;
    if (!sendNewEmail || busy || undo.pending || files.uploading) return;
    if (!to.trim()) return setFields({ to: mb.compose.toRequired });
    if (!draft && !text.trim()) return setFields({ text: mb.compose.bodyRequired });
    setFields({});
    const input: ComposeEmailInput = { to: to.trim(), subject, text, draft, ...(split(cc).length ? { cc: split(cc) } : {}), ...(split(bcc).length ? { bcc: split(bcc) } : {}), ...(files.refs.length && !draft ? { attachments: files.refs } : {}), ...(own.length > 1 && from && !draft ? { from } : {}) };
    const go = async () => {
      setBusy(true);
      const r = await sendNewEmail(input);
      setBusy(false);
      if (!r.ok) return setFields({ ...fieldErrors(r.error), _: errorText(r.error) });
      onSent(r.data.id, draft);
    };
    // a draft is saved at once; a mail waits for Undo
    if (draft) void go();
    else undo.schedule(go);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={mb.compose.title}
      size="lg"
      className="mb-sheet mb-compose"
      footer={
        <div className="mb-ctools">
          <AttachButton files={files} label={mb.compose.attach} className="btn btn-outline-p btn-sm mb-attach" />
          <span className="mb-grow" />
          {fromAddress && own.length < 2 ? <span className="mb-from">{mb.compose.from.replace('{address}', fromAddress)}</span> : null}
          <Button variant="ghost" size="sm" disabled={busy || undo.pending} onClick={() => submit(true)}>{mb.compose.saveDraft}</Button>
          <Button size="sm" icon="send" busy={busy || undo.pending} disabled={files.uploading} onClick={() => submit(false)}>{mb.compose.send}</Button>
        </div>
      }
    >
      <FromField id="mb-from" own={own} value={from} onChange={setFrom} invalid={Boolean(fields.from)} />
      {fields.from ? <div className="field-error">{fields.from}</div> : null}
      <div className="mb-fl">
        <label htmlFor="mb-to">{mb.compose.to}</label>
        <input id="mb-to" className={`mb-in${fields.to ? ' is-invalid' : ''}`} type="email" inputMode="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} />
        <span className="mb-links">
          {more === '' ? <Button variant="ghost" size="sm" className="mb-link" onClick={() => setMore('cc')}>{mb.compose.cc}</Button> : null}
          {more !== 'bcc' ? <Button variant="ghost" size="sm" className="mb-link" onClick={() => setMore('bcc')}>{mb.compose.bcc}</Button> : null}
        </span>
      </div>
      {fields.to ? <div className="field-error">{fields.to}</div> : null}
      {more ? (
        <div className="mb-fl"><label htmlFor="mb-cc">{mb.compose.cc}</label><input id="mb-cc" className="mb-in" autoComplete="off" value={cc} onChange={(e) => setCc(e.target.value)} /><span /></div>
      ) : null}
      {fields.cc ? <div className="field-error">{fields.cc}</div> : null}
      {more === 'bcc' ? (
        <div className="mb-fl"><label htmlFor="mb-bcc">{mb.compose.bcc}</label><input id="mb-bcc" className="mb-in" autoComplete="off" value={bcc} onChange={(e) => setBcc(e.target.value)} /><span /></div>
      ) : null}
      <div className="mb-fl"><label htmlFor="mb-subject">{mb.compose.subject}</label><input id="mb-subject" className="mb-in" value={subject} maxLength={600} onChange={(e) => setSubject(e.target.value)} /><span /></div>
      {fields.subject ? <div className="field-error">{fields.subject}</div> : null}
      <Textarea className="mb-ed" aria-label={mb.compose.body} placeholder={mb.compose.body} rows={8} value={text} maxLength={CONV_REPLY_MAX} invalid={Boolean(fields.text)} onChange={(e) => setText(e.target.value)} />
      {fields.text ? <div className="field-error">{fields.text}</div> : null}
      {fields.attachments ? <div className="field-error">{fields.attachments}</div> : null}
      <FileChips files={files} removeLabel={tr("Remove")} />
      <Helpers quick={quick} onInsert={(t) => setText((cur) => append(cur, t))} />
      {fields._ ? <Alert tone="danger">{fields._}</Alert> : null}
    </Modal>
  );
}
