'use client';

// platform.hotelMail (Super Admin only): the mail of every group and hotel - pause and resume, who sits under whom, each one's Google login - and,
// on its own tab, where replies coming in through Amazon SES arrive. Saved passwords are only a mask; the server never sends them back.
import { useMemo, useState } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import { MAIL_PAUSE_REASONS, platformCopy, type PlatformGroupMail, type PlatformHotelMail, type PlatformHotelMailInput, type PlatformMailPause, type PlatformMailPauseInput, type PlatformSmtpTestResult } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction } from '@/components/ui';
import { Bi, Button, Dialog, EmptyState, FieldError, FieldHint, ListTabs, PageHead, SearchField, SecretField, SegTabs, StatusChip, type ChipTone } from '@/dashboards/pallav/ui';
import { HomeStats, type HomeStat } from '../overview/HomeJobs';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { InboundMailCard } from './InboundMailCard';
import { SuperOnlyCard, actAs } from './PlatformStaff';
import d from './desktop.module.css';

import { tr } from '@/lib/i18n/language';
const T = platformCopy.hotelMail;
const M = platformCopy.hotelMailPage;

type Kind = 'hotel' | 'group';
type Filter = 'all' | 'running' | 'paused' | 'own';

/** One hotel or group as the editor holds it (the two answers of the server, made one shape). */
interface Owner {
  kind: Kind;
  id: string;
  name: string;
  ses: PlatformHotelMail['ses'];
  gmail: PlatformHotelMail['gmail'];
  fromName: string;
  replyTo: string;
  canStorePassword: boolean;
  /** Its automatic address through Amazon SES; null when the From address has no own domain. */
  address: string | null;
}
const ofHotel = (m: PlatformHotelMail): Owner => ({ kind: 'hotel', id: m.hotelId, name: m.hotelName, ses: m.ses, gmail: m.gmail, fromName: m.fromName, replyTo: m.replyTo, canStorePassword: m.canStorePassword, address: m.address ?? null });
const ofGroup = (m: PlatformGroupMail): Owner => ({ kind: 'group', id: m.groupId, name: m.groupName, ses: m.ses, gmail: m.gmail, fromName: m.fromName, replyTo: m.replyTo, canStorePassword: m.canStorePassword, address: m.address ?? null });

/** Where a login stands: not set, never tested, working, or failed its last test. */
function standing(set: boolean, test: PlatformSmtpTestResult | null): { tone: ChipTone; status: string } {
  if (!set) return { tone: 'neutral', status: T.notSet };
  if (!test) return { tone: 'warn', status: 'Not tested yet' };
  return test.ok ? { tone: 'ok', status: 'Working' } : { tone: 'danger', status: 'Last test failed' };
}

export function PlatformHotelMailScreen(props: ScreenProps) {
  if (props.user.role !== 'super_admin') return <SuperOnlyCard />;
  return <Body {...props} />;
}

/** A hotel or a group in the tree: which of its own accounts are set up, its own pause, and who it belongs to. */
interface Node {
  kind: Kind;
  id: string;
  name: string;
  sub: string;
  ses: boolean;
  gmail: boolean;
  pause: PlatformMailPause | null;
  parent: string | null;
  children: string[];
}
type Selected = { kind: Kind; id: string };
const keyOf = (n: { kind: Kind; id: string }) => `${n.kind}:${n.id}`;
const STANDALONE = 'standalone';

/** What stops this node: its own pause, else its group's pause that covers every hotel. null = running. */
function stopperOf(n: Node, all: Map<string, Node>): { node: Node; pause: PlatformMailPause } | null {
  if (n.pause) return { node: n, pause: n.pause };
  const g = n.parent && n.parent !== STANDALONE ? all.get(n.parent) : undefined;
  return g?.pause && g.pause.scope === 'all' ? { node: g, pause: g.pause } : null;
}

function Body({ user }: ScreenProps) {
  const [version, setVersion] = useState(0);
  const [sel, setSel] = useState<Selected | null>(null);
  const [typed, setTyped] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState<'out' | 'in'>('out');
  const hotels = useLoaded(() => {
    actAs(user);
    return platformApi.listHotelMail();
  }, [version]);
  const groups = useLoaded(() => {
    actAs(user);
    return platformApi.listGroupMail();
  }, [version]);

  const all = useMemo(() => {
    const map = new Map<string, Node>();
    const inGroup = new Map<string, string>();
    for (const g of groups.data ?? []) for (const h of g.hotelIds ?? []) inGroup.set(h, g.groupId);
    for (const g of groups.data ?? []) map.set(`group:${g.groupId}`, { kind: 'group', id: g.groupId, name: g.name, sub: T.inGroup(g.hotels), ses: g.ses, gmail: g.gmail, pause: g.pause ?? null, parent: null, children: (g.hotelIds ?? []).map((h) => `hotel:${h}`) });
    for (const h of hotels.data ?? []) map.set(`hotel:${h.hotelId}`, { kind: 'hotel', id: h.hotelId, name: h.name, sub: h.city ?? '', ses: h.ses, gmail: h.gmail, pause: h.pause ?? null, parent: inGroup.get(h.hotelId) ? `group:${inGroup.get(h.hotelId)}` : STANDALONE, children: [] });
    return map;
  }, [hotels.data, groups.data]);

  const groupNodes = [...all.values()].filter((n) => n.kind === 'group').sort((a, b) => a.name.localeCompare(b.name));
  const standalone = [...all.values()].filter((n) => n.kind === 'hotel' && n.parent === STANDALONE).sort((a, b) => a.name.localeCompare(b.name));
  const hotelsOf = (g: Node) => g.children.map((c) => all.get(c)).filter((x): x is Node => x !== undefined).sort((a, b) => a.name.localeCompare(b.name));

  const words = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const passes = (n: Node): boolean => {
    const state = stopperOf(n, all) ? 'paused' : 'running';
    return words.every((w) => `${n.name} ${n.sub}`.toLowerCase().includes(w)) && (filter === 'all' || filter === state || (filter === 'own' && (n.ses || n.gmail)));
  };
  const showGroup = (g: Node) => passes(g) || hotelsOf(g).some(passes);
  const searching = words.length > 0 || filter !== 'all';

  const loading = !hotels.data || !groups.data;
  const error = hotels.error ?? groups.error;
  const hotelCount = [...all.values()].filter((n) => n.kind === 'hotel').length;
  const paused = [...all.values()].filter((n) => n.kind === 'hotel' && stopperOf(n, all)).length;
  const own = [...all.values()].filter((n) => n.ses || n.gmail).length;
  const current = sel ? all.get(keyOf(sel)) ?? null : null;
  const reload = () => {
    hotels.reload();
    groups.reload();
  };
  const changed = () => setVersion((n) => n + 1);

  const row = (n: Node, level: 0 | 1) => {
    const stop = stopperOf(n, all);
    const isOpen = sel !== null && keyOf(sel) === keyOf(n);
    const kids = n.kind === 'group' ? hotelsOf(n).filter((h) => !searching || passes(h) || passes(n)) : [];
    const expanded = searching || !folded.has(keyOf(n));
    return (
      <li key={keyOf(n)} className={`hm2-item is-l${level}`}>
        <div className={`hm2-row${isOpen ? ' is-open' : ''}${stop ? ' is-off' : ''}`}>
          {n.kind === 'group' ? (
            <button type="button" className="hm2-caret" aria-expanded={expanded} aria-label={`${expanded ? 'Fold' : 'Unfold'} ${n.name}`} onClick={() => setFolded((s) => { const x = new Set(s); if (x.has(keyOf(n))) x.delete(keyOf(n)); else x.add(keyOf(n)); return x; })}>
              <Bi name={expanded ? 'chevron-down' : 'chevron-right'} />
            </button>
          ) : (
            <span className="hm2-caret is-none" />
          )}
          <button type="button" className="hm2-main" aria-current={isOpen ? 'true' : undefined} onClick={() => setSel({ kind: n.kind, id: n.id })}>
            <span className={`hm2-badge is-${n.kind}`} aria-hidden="true">{n.kind === 'group' ? 'G' : 'H'}</span>
            <span className="hm2-text">
              <b>{n.name}</b>
              <small>{stop && stop.node !== n ? `Stopped by ${stop.node.name}` : n.sub}</small>
            </span>
            <StatusChip tone={stop ? 'neutral' : 'ok'}>{stop ? tr("Paused") : tr("Running")}</StatusChip>
          </button>
        </div>
        {n.kind === 'group' && expanded && kids.length > 0 ? <ul className="hm2-sub">{kids.map((h) => row(h, 1))}</ul> : null}
      </li>
    );
  };

  const shownGroups = groupNodes.filter(showGroup);
  const shownStandalone = standalone.filter(passes);
  const count = (n: number) => String(Math.round(n));
  const stats: HomeStat[] = [
    { id: 'hotels', label: M.figures.hotels, value: hotelCount, format: count, note: M.figureNotes.hotels(groupNodes.length) },
    { id: 'running', label: M.figures.running, value: hotelCount - paused, format: count, note: M.figureNotes.running },
    { id: 'paused', label: M.figures.paused, value: paused, format: count, note: paused ? M.figureNotes.paused : M.figureNotes.nonePaused },
    { id: 'own', label: M.figures.own, value: own, format: count, note: M.figureNotes.own },
  ];
  const nodes = [...all.values()];
  const filterCount: Record<Filter, number> = {
    all: nodes.length,
    running: nodes.filter((n) => !stopperOf(n, all)).length,
    paused: nodes.filter((n) => stopperOf(n, all)).length,
    own: nodes.filter((n) => n.ses || n.gmail).length,
  };

  return (
    <>
      <PageHead className="reveal" sub={view === 'out' ? M.subOut : M.subIn}>
        {view === 'out' ? <SearchField wrapClass="pay-toolbar" smart clear value={typed} placeholder={T.searchPlaceholder} label={T.searchPlaceholder} onChange={setTyped} /> : null}
      </PageHead>
      <SegTabs
        className="mb-3"
        label={M.viewsLabel}
        active={view}
        onChange={(v) => setView(v === 'in' ? 'in' : 'out')}
        tabs={[
          { id: 'out', label: M.views.out, icon: 'send' },
          { id: 'in', label: M.views.in, icon: 'inbox' },
        ]}
      />
      {view === 'in' ? (
        <InboundMailCard user={user} />
      ) : loading ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={4} />
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          <HomeStats stats={stats} />
          <div className="hm2 reveal pf-mail">
            <section className="hm2-tree" aria-label={tr("Groups and hotels")}>
              <ListTabs
                look="pills"
                className="pf-mail-filters"
                label={M.filtersLabel}
                active={filter}
                onChange={(f) => setFilter(f === 'running' || f === 'paused' || f === 'own' ? f : 'all')}
                tabs={(['all', 'running', 'paused', 'own'] as const).map((f) => ({ id: f, label: M.filters[f], count: filterCount[f] }))}
              />
              {shownGroups.length === 0 && shownStandalone.length === 0 ? (
                <EmptyState icon="envelope-at" title={all.size === 0 ? T.noHotels : T.empty} text="" />
              ) : (
                <ul className="hm2-list">
                  {shownGroups.map((g) => row(g, 0))}
                  {shownStandalone.length > 0 ? (
                    <li className="hm2-item is-l0">
                      <p className="hm2-folder"><Bi name="building" /> {tr("Hotels without a group")}</p>
                      <ul className="hm2-sub">{shownStandalone.map((h) => row(h, 1))}</ul>
                    </li>
                  ) : null}
                </ul>
              )}
            </section>
            <section className="hm2-detail" aria-live="polite">
              {current ? (
                <Detail key={keyOf(current)} node={current} all={all} user={user} onOpen={(n) => setSel({ kind: n.kind, id: n.id })} onChanged={changed} />
              ) : (
                <div className="hm2-empty">
                  <EmptyState icon="envelope-at" title={tr("Pick a group or a hotel")} text="Its mail service, who it sits under and its Google login open here." />
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

/** One group or hotel: where it sits, whether its mail runs (with the pause and resume), then its accounts. */
function Detail({ node, all, user, onOpen, onChanged }: { node: Node; all: Map<string, Node>; user: ScreenProps['user']; onOpen: (n: Node) => void; onChanged: () => void }) {
  const stop = stopperOf(node, all);
  const parent = node.parent && node.parent !== STANDALONE ? all.get(node.parent) : undefined;
  const below = node.kind === 'group' ? node.children.length : 0;
  return (
    <>
      <div className="hm2-head">
        <p className="hm2-crumbs">
          <span>{tr("All mail")}</span>
          {parent ? <span>{parent.name}</span> : node.kind === 'hotel' ? <span>{tr("Hotels without a group")}</span> : null}
          <span>{node.name}</span>
        </p>
        <div className="hm2-title">
          <h2>{node.name}</h2>
          <StatusChip tone={stop ? 'neutral' : 'ok'}>{stop ? tr("Paused") : tr("Running")}</StatusChip>
        </div>
        <PauseBar node={node} stop={stop} below={below} user={user} onOpen={onOpen} onChanged={onChanged} />
      </div>
      <MailOwnerEditor key={keyOf(node)} kind={node.kind} id={node.id} user={user} onChanged={onChanged} />
    </>
  );
}

/** The service switch: Pause (with a reason, and for a group whether its hotels stop too) or Resume. */
function PauseBar({ node, stop, below, user, onOpen, onChanged }: { node: Node; stop: { node: Node; pause: PlatformMailPause } | null; below: number; user: ScreenProps['user']; onOpen: (n: Node) => void; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState(MAIL_PAUSE_REASONS[0]);
  const [other, setOther] = useState('');
  const [scope, setScope] = useState<'all' | 'one'>('all');
  const [problem, setProblem] = useState('');
  const { busy, run } = useAction();
  const send = (input: PlatformMailPauseInput, done: string) => {
    actAs(user);
    void run(async () => {
      const r = await (node.kind === 'group' ? platformApi.setGroupMailPause(node.id, input) : platformApi.setHotelMailPause(node.id, input));
      return r.ok ? { ...r, data: null } : r;
    }, {
      success: done,
      onFields: (f) => setProblem(Object.values(f)[0] ?? ''),
      onOk: () => {
        setAsking(false);
        setProblem('');
        onChanged();
      },
    });
  };
  const text = reason === 'Other' ? other.trim() : reason;

  if (stop && stop.node !== node) {
    return (
      <div className="hm2-svc is-off" role="status">
        <div>
          <b>{tr("Stopped by")} {stop.node.name}</b>
          <span>{stop.pause.by} {tr("paused it on")} {formatDateTime(stop.pause.at)}{tr(". Reason:")} {stop.pause.reason}{tr(". Resume")} {stop.node.name} {tr("to send again.")}</span>
        </div>
        <Button variant="outline" onClick={() => onOpen(stop.node)}>{tr("Open")} {stop.node.name}</Button>
      </div>
    );
  }
  if (stop) {
    return (
      <div className="hm2-svc is-off" role="status">
        <div>
          <b>{tr("Mail is paused")}</b>
          <span>{stop.pause.by} {tr("paused it on")} {formatDateTime(stop.pause.at)}{tr(". Reason:")} {stop.pause.reason}.{node.kind === 'group' ? (stop.pause.scope === 'all' ? ` Its ${below} hotels are stopped too.` : tr(" Its hotels keep sending through the platform.")) : ''} {tr("Mail already queued waits and goes out within ten minutes of resuming.")}</span>
          {problem ? <FieldError>{problem}</FieldError> : null}
        </div>
        <Button icon="play-fill" disabled={busy} onClick={() => send({ paused: false }, `Mail resumed for ${node.name}.`)}>{busy ? tr("Resuming") : tr("Resume mail")}</Button>
      </div>
    );
  }
  return (
    <>
      <div className="hm2-svc" role="status">
        <div>
          <b>{tr("Mail service is on")}</b>
          <span>{node.kind === 'group' ? `Pausing it can also stop its ${below} hotels.` : tr("Its mail goes out as normal.")}</span>
        </div>
        <Button variant="outline" icon="pause-fill" disabled={asking} onClick={() => setAsking(true)}>{tr("Pause mail")}</Button>
      </div>
      {asking ? (
        <form
          className="hm2-ask"
          onSubmit={(e) => {
            e.preventDefault();
            send({ paused: true, reason: text, ...(node.kind === 'group' ? { scope } : {}) }, `Mail paused for ${node.name}.`);
          }}
        >
          <h3>{tr("Pause mail for")} {node.name}</h3>
          {node.kind === 'group' && below > 0 ? (
            <fieldset>
              <legend>{tr("What to stop")}</legend>
              <label><input type="radio" name="hm2-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> {tr("This group and its")} {below} {tr("hotels")}</label>
              <label><input type="radio" name="hm2-scope" checked={scope === 'one'} onChange={() => setScope('one')} /> {tr("Only this group: its hotels keep sending through the platform")}</label>
            </fieldset>
          ) : null}
          <label className="form-label" htmlFor="hm2-reason">{tr("Reason (kept in the history)")}</label>
          <select id="hm2-reason" className="form-select" value={reason} disabled={busy} onChange={(e) => { setReason(e.target.value); setProblem(''); }}>
            {MAIL_PAUSE_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          {reason === 'Other' ? <input className="form-control mt-2" aria-label={tr("Write the reason")} maxLength={200} placeholder={tr("Write the reason")} value={other} disabled={busy} onChange={(e) => { setOther(e.target.value); setProblem(''); }} /> : null}
          {problem ? <FieldError>{problem}</FieldError> : null}
          <FieldHint>{tr("Mail already sent is not recalled. Mail queued while paused waits and goes out after you resume. Guests are not told.")}</FieldHint>
          <div className="d-flex gap-2 flex-wrap mt-2">
            <Button type="submit" variant="dangerSolid" icon="pause-fill" disabled={busy || text.length < 3}>{busy ? tr("Pausing") : tr("Pause mail")}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setAsking(false); setProblem(''); }}>{tr("Cancel")}</Button>
          </div>
        </form>
      ) : null}
    </>
  );
}

/** One hotel's or group's own mail account (the Integrations tab of its page uses it too). */
export function MailOwnerEditor({ kind, id, user, onChanged }: { kind: Kind; id: string; user: ScreenProps['user']; onChanged: () => void }) {
  const [saved, setSaved] = useState<Owner | null>(null);
  const { data, error, reload } = useLoaded(async () => {
    actAs(user);
    if (kind === 'group') {
      const r = await platformApi.getGroupMail(id);
      return r.ok ? { ...r, data: ofGroup(r.data) } : r;
    }
    const r = await platformApi.getHotelMail(id);
    return r.ok ? { ...r, data: ofHotel(r.data) } : r;
  }, [kind, id]);
  const current = saved ?? data;
  if (!current) return <Wait error={error} onRetry={reload} tiles={false} rows={4} />;
  // the form restarts from the saved facts after every save (typed passwords are dropped)
  const stamp = JSON.stringify([current.gmail.user, current.gmail.passwordSet, current.fromName, current.replyTo]);
  return <Form key={stamp} data={current} user={user} onSaved={(m) => { setSaved(m); onChanged(); }} />;
}

function Form({ data, user, onSaved }: { data: Owner; user: ScreenProps['user']; onSaved: (m: Owner) => void }) {
  const [gmailUser, setGmailUser] = useState(data.gmail.user);
  const [gmailPassword, setGmailPassword] = useState('');
  const [fromName, setFromName] = useState(data.fromName);
  const [replyTo, setReplyTo] = useState(data.replyTo);
  const [testTo, setTestTo] = useState('');
  const [gmailTest, setGmailTest] = useState<PlatformSmtpTestResult | null>(data.gmail.lastTest);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<'gmail' | null>(null);
  const { busy, run } = useAction();
  const tester = useAction();
  const isGroup = data.kind === 'group';
  const noun = isGroup ? 'group' : 'hotel';

  const err = (k: string) => (errors[k] ? <FieldError>{errors[k]}</FieldError> : null);
  const clear = (...ks: string[]) => setErrors((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !ks.includes(k))));
  // Amazon SES is set up in its own admin panel; here it only shows in the order below
  const sesSet = data.ses.from !== '' || data.ses.user !== '';
  const gmailSet = data.gmail.user !== '';
  const gm = standing(gmailSet && data.gmail.passwordSet, gmailTest);

  const call = (input: PlatformHotelMailInput) => (isGroup ? platformApi.saveGroupMail(data.id, input).then((r) => (r.ok ? { ...r, data: ofGroup(r.data) } : r)) : platformApi.saveHotelMail(data.id, input).then((r) => (r.ok ? { ...r, data: ofHotel(r.data) } : r)));

  const save = () => {
    const input: PlatformHotelMailInput = {};
    const g: NonNullable<PlatformHotelMailInput['gmail']> = {};
    if (gmailUser.trim().toLowerCase() !== data.gmail.user) g.user = gmailUser;
    if (gmailPassword !== '') g.password = gmailPassword;
    if (Object.keys(g).length > 0) input.gmail = !gmailSet ? { user: gmailUser, ...(gmailPassword !== '' ? { password: gmailPassword } : {}) } : g;
    if (fromName.trim() !== data.fromName) input.fromName = fromName;
    if (replyTo.trim().toLowerCase() !== data.replyTo) input.replyTo = replyTo;
    // nothing typed on a part that was never set: nothing to save for it
    if (!gmailSet && gmailUser.trim() === '' && gmailPassword === '') delete input.gmail;
    if (Object.keys(input).length === 0) return;
    actAs(user);
    void run(() => call(input), { success: T.saved(data.name), onFields: (f) => setErrors(f), onOk: onSaved });
  };
  const remove = () => {
    actAs(user);
    void run(() => call({ gmail: { clear: true } }), {
      success: T.removed('Google', data.name),
      onFields: (f) => setErrors(f),
      onOk: (m) => { setRemoving(null); onSaved(m); },
    });
  };
  const test = () => {
    actAs(user);
    void tester.run(() => (isGroup ? platformApi.testGroupMail(data.id, 'gmail', testTo) : platformApi.testHotelMail(data.id, 'gmail', testTo)), {
      onFields: (f) => setErrors(f),
      onOk: (r) => setGmailTest(r),
    });
  };
  const result = (r: PlatformSmtpTestResult | null) =>
    r ? (
      <>
        <span className={r.ok ? 'text-success' : 'text-danger'}>
          <Bi name={r.ok ? 'check-circle-fill' : 'x-circle-fill'} /> {r.message}
        </span>{' '}
        <span className="text-muted">{T.test.last}: {formatDateTime(r.at)}</span>
        {!r.ok && r.hint ? (
          <span className="d-block text-muted mt-1">
            <Bi name="lightbulb" /> {r.hint}
          </span>
        ) : null}
      </>
    ) : (
      <span className="text-muted">{tr("Not tested yet.")}</span>
    );

  // the order this owner's mail takes, as it is saved now
  const own = [sesSet ? `The ${noun}'s Amazon SES` : null, gmailSet ? `The ${noun}'s Google` : null].filter((x): x is string => x !== null);
  const steps = [...own, ...(isGroup ? [] : ["Its group's Amazon SES, then Google (when the hotel is in a group that has them)"]), "The platform's Amazon SES", "The platform's Google backup"];

  return (
    <form
      className={`st-card ${d.stickySave}`}
      autoComplete="off"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="st-head">
        <div className="st-icon">
          <Bi name={isGroup ? 'diagram-3' : 'envelope-at'} />
        </div>
        <div>
          <h2 className="st-title">
            {data.name} <StatusChip tone={isGroup ? 'warn' : 'neutral'}>{T.kindWord[data.kind]}</StatusChip>
          </h2>
          <p className="st-about">{isGroup ? tr("How the mail of this group's hotels is sent when a hotel has none of its own") : T.howTitle}</p>
          <ol className="hm-order">
            {steps.map((x, i) => (
              <li key={x}>
                <span className="ms-step">{i + 1}</span> {x}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="st-grid">
        <div className="st-field wide ms-part">
          <h3 className="ms-part-title">
            <span className="ms-step">1</span> {T.gmail.title} <StatusChip tone={gm.tone}>{gm.status}</StatusChip>
            {gmailSet ? (
              <Button type="button" variant="ghost" size="sm" className="ms-auto" disabled={busy} onClick={() => setRemoving('gmail')}>
                {T.remove}
              </Button>
            ) : null}
          </h3>
          <p className="st-about">{T.gmail.about}</p>
        </div>
        <div className="st-field">
          <label className="form-label" htmlFor="hm-gmail-user">
            {T.gmail.user}
          </label>
          <input id="hm-gmail-user" type="email" inputMode="email" className={`form-control${errors.gmailUser ? ' is-invalid' : ''}`} maxLength={254} autoComplete="off" autoCapitalize="off" placeholder={tr("name@gmail.com")} value={gmailUser} disabled={busy} onChange={(e) => { setGmailUser(e.target.value); clear('gmailUser', 'gmailPassword'); }} />
          {err('gmailUser')}
        </div>
        <div className="st-field">
          <label className="form-label" htmlFor="hm-gmail-password">
            {T.gmail.password}
          </label>
          <SecretField
            key={`gmail:${data.gmail.passwordSet}:${gmailUser.trim().toLowerCase() === data.gmail.user}`}
            id="hm-gmail-password"
            value={gmailPassword}
            onChange={(v) => { setGmailPassword(v); clear('gmailPassword'); }}
            isSet={data.gmail.passwordSet && gmailUser.trim().toLowerCase() === data.gmail.user}
            disabled={busy || !data.canStorePassword}
            invalid={Boolean(errors.gmailPassword)}
            noun="app password"
            placeholder={tr("16 letters")}
          />
          {data.gmail.passwordUnreadable ? (
            <p className="text-danger small mb-1" role="alert">
              <Bi name="exclamation-triangle-fill" /> {T.passwordUnreadable}
            </p>
          ) : null}
          {err('gmailPassword')}
        </div>

        <div className="st-field wide ms-part">
          <h3 className="ms-part-title">
            <span className="ms-step">2</span> {T.identity.title}
          </h3>
        </div>
        <div className="st-field">
          <label className="form-label" htmlFor="hm-from-name">
            {T.identity.fromName}
          </label>
          <input id="hm-from-name" className={`form-control${errors.fromName ? ' is-invalid' : ''}`} maxLength={100} autoComplete="off" placeholder={data.name} value={fromName} disabled={busy} onChange={(e) => { setFromName(e.target.value); clear('fromName'); }} />
          <FieldHint>{isGroup ? tr("Leave empty to use the group's name.") : T.identity.fromNameHint}</FieldHint>
          {err('fromName')}
        </div>
        <div className="st-field">
          <label className="form-label" htmlFor="hm-reply-to">
            {T.identity.replyTo}
          </label>
          <input id="hm-reply-to" type="email" inputMode="email" className={`form-control${errors.replyTo ? ' is-invalid' : ''}`} maxLength={254} autoComplete="off" value={replyTo} disabled={busy} onChange={(e) => { setReplyTo(e.target.value); clear('replyTo'); }} />
          <FieldHint>{T.identity.replyToHint}</FieldHint>
          {err('replyTo')}
        </div>

        <div className="st-field wide ms-part">
          <h3 className="ms-part-title">
            <span className="ms-step">3</span> {T.test.title}
          </h3>
          <p className="st-about">{tr("Save first: a test uses the saved logins.")}</p>
          <div className="d-flex gap-2 flex-wrap mt-2">
            <input
              id="hm-test-to"
              type="email"
              inputMode="email"
              className={`form-control pf-test-to${errors.to ? ' is-invalid' : ''}`}
              maxLength={254}
              placeholder={T.test.to}
              aria-label={T.test.to}
              value={testTo}
              disabled={tester.busy}
              aria-invalid={errors.to ? true : undefined}
              onChange={(e) => { setTestTo(e.target.value); clear('to'); }}
            />
            <Button type="button" icon="send" variant="secondary" disabled={tester.busy || busy || testTo.trim() === '' || !gmailSet} onClick={() => test()}>
              {tester.busy ? T.test.sending : tr("Test Google")}
            </Button>
          </div>
          {err('to')}
          <p className="small mt-2 mb-0" role="status" aria-live="polite">
            <strong>{tr("Google:")}</strong> {result(gmailTest)}
          </p>
        </div>
      </div>

      <div className="st-foot">
        <Button type="submit" icon="check2" disabled={busy}>
          {busy ? T.saving : T.save}
        </Button>
      </div>

      <Dialog
        open={removing !== null}
        title={T.remove}
        message={removing ? T.removeAsk('Google', data.name) : ''}
        confirmLabel={T.remove}
        tone="danger"
        icon="trash"
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => { if (removing) remove(); }}
      />
    </form>
  );
}
