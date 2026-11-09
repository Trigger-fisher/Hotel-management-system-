'use client';
// Website enquiries (hotel.web.enquiries): every request from the website, one card each, newest first; Confirm on a pending card.
// hotel.web.enquiry (params.id) shows the same list with that enquiry opened: Pallav has no page of its own for one.
import { useEffect, useRef, useState } from 'react';

import {
  adultsOf, decisionText, displayPhone, guestsLabel, nightsBetween, validateEnquiry, type WebEnquiry, type WebEnquiryInput, type WebEnquiryStats, type WebEnquiryStatus, type WebRoom,
} from '@shared/dashboards/website';
import type { DashResult, Page } from '@shared/dashboards/common';
import { errorText, useAsync, useToast } from '@/components/ui';
import { Bi, DetailCard, DetailList, DetailNone, Dialog, Dropdown, EmptyState, FieldError, FilterBar, LoadError, Modal, PageSkeleton, Pager, PmsDate, RequiredMark, SearchField, pagerView, Button, Select, Textarea } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import type { ScreenProps } from '../../types';
import { webApi } from './api';
import { Linked, WaNav, count, dM, dmy, dMY, plural, time12 } from './parts';

import { tr, trf } from '@/lib/i18n/language';
type Tab = 'all' | WebEnquiryStatus;
const TABS: [Tab, string][] = [['all', 'All'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['declined', 'Cancelled']];
const LABEL: Record<WebEnquiryStatus, string> = { pending: 'Pending', confirmed: 'Confirmed', declined: 'Cancelled' };
const isTab = (v: string | undefined): v is Tab => TABS.some(([t]) => t === v);
const EMPTY_STATS: WebEnquiryStats = { all: 0, pending: 0, confirmed: 0, declined: 0 };

interface Form { name: string; phone: string; email: string; guests: string; roomId: string; checkIn: string; checkOut: string; message: string }

export function WebsiteEnquiries({ params, navigate }: ScreenProps) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(isTab(params.tab) ? params.tab : 'all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(10);
  const [version, setVersion] = useState(0);
  const { state, reload } = useAsync(() => webApi.listEnquiries({ tab, search: q, page, pageSize: per }), [tab, q, page, per, version], { keep: true });
  // The last answer stays on screen while the next page or filter loads, so the list does not blink.
  const [last, setLast] = useState<{ page: Page<WebEnquiry>; stats: WebEnquiryStats } | null>(null);
  if (state.status === 'ready' && state.data !== last) setLast(state.data);
  const data = state.status === 'ready' ? state.data : last;
  const [rooms, setRooms] = useState<WebRoom[]>([]);
  const [edit, setEdit] = useState<WebEnquiry | null>(null);
  const [decline, setDecline] = useState<WebEnquiry | null>(null);
  const [confirm, setConfirm] = useState<WebEnquiry | null>(null);
  const [del, setDel] = useState<WebEnquiry | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openId = params.id;

  useEffect(() => {
    let live = true;
    void webApi.listRooms().then((res) => {
      if (live && res.ok) setRooms(res.data);
    });
    return () => {
      live = false;
    };
  }, []);

  // The enquiry opened from elsewhere may be on another page or tab: look it up and show it alone.
  useEffect(() => {
    if (!openId) return;
    let live = true;
    void webApi.getEnquiry(openId).then((res) => {
      if (live && res.ok) {
        setSearch(res.data.reference);
        setQ(res.data.reference);
      }
    });
    return () => {
      live = false;
    };
  }, [openId]);

  const stats = data?.stats ?? EMPTY_STATS;
  const total = data?.page.total ?? 0;
  const onSearch = (v: string) => {
    setSearch(v);
    if (timer.current) clearTimeout(timer.current);
    if (v === '') {
      // Clear (the x or Escape) acts at once, as Pallav's link back to the unfiltered list does.
      setQ('');
      setPage(1);
      if (openId) navigate('hotel.web.enquiries', tab === 'all' ? {} : { tab });
      return;
    }
    timer.current = setTimeout(() => {
      setQ(v.trim());
      setPage(1);
    }, 250);
  };
  const reset = () => {
    setSearch('');
    setQ('');
    setTab('all');
    setPage(1);
  };
  const refresh = () => setVersion((n) => n + 1);

  async function act<T>(call: () => Promise<DashResult<T>>, text: string | ((d: T) => string)) {
    setBusy(true);
    const res = await call();
    setBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: typeof text === 'string' ? text : text(res.data) });
      refresh();
      return true;
    }
    toast.show({ tone: 'error', text: errorText(res.error) });
    return false;
  }

  const rows = data?.page.items ?? [];
  const pv = data ? { ...pagerView(data.page, { setPage }), setPerPage: (n: number) => { setPer(n); setPage(1); } } : null;

  return (
    <>
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">{tr("Every enquiry from the website. Confirm one and it becomes a booking; cancel it and the room is free again.")}</p>
        </div>
        <div className="sh-head-actions">
          <SearchField wrapClass="pay-toolbar" clear value={search} onChange={onSearch} placeholder={tr("Search name, phone, email, reference…")} label={tr("Search enquiries")} />
        </div>
      </div>

      <WaNav active="enquiries" navigate={navigate} />

      {!data ? (
        state.status === 'error' ? <LoadError error={state.error} onRetry={reload} /> : <PageSkeleton />
      ) : (
      <div className="ha-stack">
      <HomeStats
        stats={[
          { id: 'pending', label: tr('To answer'), value: stats.pending, format: (n) => String(Math.round(n)), note: stats.pending ? tr('Waiting for a decision') : tr('Nothing waiting') },
          { id: 'confirmed', label: tr('Confirmed'), value: stats.confirmed, format: (n) => String(Math.round(n)), note: tr('Became bookings') },
          { id: 'declined', label: tr('Cancelled'), value: stats.declined, format: (n) => String(Math.round(n)), note: tr('Not going ahead') },
          { id: 'all', label: tr('All enquiries'), value: stats.all, format: (n) => String(Math.round(n)), note: tr('On record') },
        ]}
      />

      <FilterBar
        tabsLabel="Status"
        tabs={TABS.map(([id, label]) => ({ id, label, count: stats[id] }))}
        active={tab}
        onTab={(id) => {
          if (isTab(id)) {
            setTab(id);
            setPage(1);
          }
        }}
        summary={
          <>
            {q !== '' ? tr('Showing ') : tr('All ')}
            <b>{count(total)}</b> {total === 1 ? tr('enquiry') : tr('enquiries')}
          </>
        }
        onReset={q !== '' || tab !== 'all' ? reset : undefined}
      />

      {state.status === 'error' ? (
        <LoadError error={state.error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <div className="card reveal">
          <EmptyState icon="inbox" title={q !== '' ? trf('Nothing matches "{0}"', [q]) : tab === 'pending' ? tr('Nothing to answer') : tr('No enquiries yet')} text={q !== '' ? tr('Try a name, mobile or reference.') : tr('Enquiries sent from the website appear here as they arrive.')} />
        </div>
      ) : (
        <div>
          {rows.map((e) => {
            const nights = nightsBetween(e.checkIn, e.checkOut);
            const guests = guestsLabel(adultsOf(e), e.children);
            return (
              <DetailCard
                key={e.id}
                className="we-card"
                label={trf('Enquiry {0} from {1}', [e.reference, e.name])}
                defaultOpen={e.id === openId}
                warn={e.status === 'pending'}
                lead={{ big: dM(e.createdAt), tag: time12(e.createdAt), title: `${dMY(e.createdAt)}, ${time12(e.createdAt)}` }}
                facts={[
                  { label: tr('Guest'), value: e.name, sub: e.phone ? displayPhone(e.phone) : e.email },
                  { label: tr('Check-in'), value: dM(e.checkIn), title: `${dMY(e.checkIn)} - ${dMY(e.checkOut)}`, sub: nights ? `${nights} ${plural(nights, 'night')}` : undefined },
                  { label: tr('Room'), value: e.roomName ?? tr('Not sure yet'), sub: guests || undefined },
                ]}
                amount={{
                  label: tr('Status'),
                  value: LABEL[e.status],
                  tone: e.status === 'confirmed' ? 'ok' : e.status === 'declined' ? 'muted' : 'warn',
                  extra: e.status === 'pending' ? <Button size="sm" icon="check2-circle" onClick={(ev) => { ev.preventDefault(); setConfirm(e); }}>{tr('Confirm')}</Button> : undefined,
                }}
                sections={[
                  {
                    icon: 'person',
                    title: tr('Guest'),
                    content: (
                      <DetailList
                        items={[
                          { label: tr('Reference'), value: e.reference },
                          { label: tr('Name'), value: e.name },
                          { label: tr('Mobile'), value: e.phone ? <a href={`tel:${e.phone}`}>{displayPhone(e.phone)}</a> : '-' },
                          { label: tr('Email'), value: e.email ? <a href={`mailto:${e.email}`}>{e.email}</a> : '-' },
                          { label: tr('Guests'), value: guests || '-' },
                          { label: tr('Check-in'), value: dmy(e.checkIn) },
                          { label: tr('Check-out'), value: dmy(e.checkOut) },
                          { label: tr('Sent'), value: `${dMY(e.createdAt)}, ${time12(e.createdAt)}` },
                        ]}
                      />
                    ),
                  },
                  {
                    icon: 'chat-left-text',
                    title: tr('What they said'),
                    content: (
                      <>
                        {e.message ? <p className="ha-note">{e.message}</p> : <DetailNone>{tr('No message.')}</DetailNone>}
                        {e.decidedAt ? (
                          <p className="ha-note-sub">
                            {e.status === 'confirmed' ? tr('Confirmed') : tr('Cancelled')} {dMY(e.decidedAt)}, {time12(e.decidedAt)}
                            {e.decidedByName ? ` · ${e.decidedByName}` : ''}
                            {e.decisionNote ? <><br />{tr('Reason:')} {e.decisionNote}</> : null}
                          </p>
                        ) : null}
                      </>
                    ),
                  },
                ]}
                actions={
                  <>
                    {e.phone ? <a className="btn btn-sm btn-outline-p" href={`tel:${e.phone}`}><Bi name="telephone" className="me-1" />{tr('Call')}</a> : null}
                    <Button variant="outline" size="sm" icon="pencil-square" onClick={() => setEdit(e)}>{tr('Edit')}</Button>
                    <Dropdown align="end" button={(pp) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [e.reference])} {...pp}>{tr('More')}</Button>}>
                      {e.status !== 'declined' ? <a href="#" className="dropdown-item text-danger" onClick={(ev) => { ev.preventDefault(); setDecline(e); }}><Bi name="x-circle" className="me-2" />{e.status === 'confirmed' ? tr('Cancel booking') : tr('Cancel enquiry')}</a> : null}
                      <a href="#" className="dropdown-item text-danger" onClick={(ev) => { ev.preventDefault(); setDel(e); }}><Bi name="trash" className="me-2" />{tr('Delete enquiry')}</a>
                    </Dropdown>
                  </>
                }
              />
            );
          })}
          {pv ? <div className="card sh-pager-card"><Pager server view={pv} /></div> : null}
        </div>
      )}
      </div>
      )}
      {edit ? <EditModal key={edit.id} enquiry={edit} rooms={rooms} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} /> : null}
      {decline ? <DeclineModal key={decline.id} enquiry={decline} onClose={() => setDecline(null)} onDone={() => { setDecline(null); refresh(); }} /> : null}
      <Dialog
        open={confirm !== null}
        tone="primary"
        title={trf("Confirm {0}?", [confirm?.reference ?? ''])}
        message={`This holds ${confirm?.roomName ?? 'the room'} for these dates and tells the team.`}
        confirmLabel="Confirm"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const e = confirm;
          if (e) void act(() => webApi.confirmEnquiry(e.id), decisionText).then(() => setConfirm(null));
        }}
      />
      <Dialog
        open={del !== null}
        tone="danger"
        title={trf("Delete {0}?", [del?.reference ?? ''])}
        message={tr('This enquiry is removed for good.')}
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setDel(null)}
        onConfirm={() => {
          const e = del;
          if (e) void act(() => webApi.deleteEnquiry(e.id), 'Deleted.').then(() => setDel(null));
        }}
      />
    </>
  );
}

export function WebsiteEnquiryDetail(props: ScreenProps) {
  return <WebsiteEnquiries {...props} />;
}

function EditModal({ enquiry: e, rooms, onClose, onSaved }: { enquiry: WebEnquiry; rooms: WebRoom[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Form>({ name: e.name, phone: e.phone, email: e.email ?? '', guests: String(e.guests), roomId: e.roomId ?? '', checkIn: e.checkIn, checkOut: e.checkOut, message: e.message });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (ev: { target: { value: string } }) => setF((p) => ({ ...p, [k]: ev.target.value }));

  async function save() {
    // Pallav's "Guests" is the total; the record keeps adults and children apart, so the children stay as they are.
    const total = Number.parseInt(f.guests, 10);
    const input: WebEnquiryInput = {
      name: f.name, phone: f.phone, email: f.email, roomId: f.roomId || null, checkIn: f.checkIn, checkOut: f.checkOut,
      guests: Number.isNaN(total) ? Number.NaN : Math.max(1, total - e.children), children: e.children, message: f.message,
    };
    const v = validateEnquiry(input);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    const res = await webApi.updateEnquiry(e.id, input);
    setBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: 'Saved. The website follows straight away.' });
      onSaved();
    } else {
      const fields = res.error.details?.fields;
      if (fields) setErrors(fields);
      else toast.show({ tone: 'error', text: errorText(res.error) });
    }
  }
  const err = (k: string) => <FieldError>{errors[k]}</FieldError>;

  return (
    <Modal
      open
      size="lg"
      className="pay-form-modal"
      staticBackdrop
      eyebrow="Guest Enquiries · Edit"
      title={trf("Edit {0}", [e.reference])}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr("Cancel")}</Button>
          <Button icon="check2" type="submit" disabled={busy}>{busy ? tr("Saving…") : tr("Save changes")}</Button>
        </>
      }
    >
      <div className="form-section">
        <div className="row g-3">
          <Linked className="col-md-6"><label className="form-label">{tr("Guest name")}<RequiredMark /></label><input className="form-control" maxLength={100} value={f.name} onChange={set('name')} />{err('name')}</Linked>
          <Linked className="col-md-6"><label className="form-label">{tr("Mobile")}<RequiredMark /></label><input className="form-control" maxLength={20} inputMode="tel" value={f.phone} onChange={set('phone')} />{err('phone')}</Linked>
          <Linked className="col-md-8"><label className="form-label">{tr("Email")}</label><input type="email" className="form-control" maxLength={150} value={f.email} onChange={set('email')} />{err('email')}</Linked>
          <Linked className="col-md-4"><label className="form-label">{tr("Guests")}<RequiredMark /></label><input type="number" className="form-control" min={1} max={30} value={f.guests} onChange={set('guests')} />{err('guests')}</Linked>
          <Linked className="col-md-4">
            <label className="form-label">{tr("Room")}</label>
            <Select className="form-select" value={f.roomId} onChange={set('roomId')}>
              <option value="">{tr("Not sure yet")}</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Linked>
          <Linked className="col-md-4"><label className="form-label">{tr("Check-in")}<RequiredMark /></label><PmsDate className="form-control" required value={f.checkIn} onChange={set('checkIn')} aria-label={tr("Check-in")} />{err('checkIn')}</Linked>
          <Linked className="col-md-4"><label className="form-label">{tr("Check-out")}<RequiredMark /></label><PmsDate className="form-control" required value={f.checkOut} min={f.checkIn || undefined} onChange={set('checkOut')} aria-label={tr("Check-out")} />{err('checkOut')}</Linked>
          <Linked className="col-12"><label className="form-label">{tr("Message")}<RequiredMark /></label><Textarea className="form-control" rows={3} maxLength={2000} value={f.message} onChange={set('message')} />{err('message')}</Linked>
        </div>
      </div>
    </Modal>
  );
}

function DeclineModal({ enquiry: e, onClose, onDone }: { enquiry: WebEnquiry; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!reason.trim()) return setError('Give a reason.');
    setBusy(true);
    const res = await webApi.declineEnquiry(e.id, reason);
    setBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: decisionText(res.data) });
      onDone();
    } else setError(res.error.details?.fields?.reason ?? errorText(res.error));
  }
  const booking = e.status === 'confirmed';
  return (
    <Modal
      open
      className="pay-form-modal"
      staticBackdrop
      scrollable={false}
      eyebrow="Guest Enquiries · Cancel"
      title={`${booking ? 'Cancel booking' : 'Cancel enquiry'} ${e.reference}`}
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr("Keep it")}</Button>
          <Button icon="x-circle" type="submit" disabled={busy}>{busy ? tr("Cancelling…") : tr("Cancel it")}</Button>
        </>
      }
    >
      <Linked><label className="form-label">{tr("Reason")}<RequiredMark /></label>
      <Textarea className="form-control" rows={3} maxLength={255} placeholder={tr("Why is this not going ahead?")} value={reason} onChange={(ev) => setReason(ev.target.value)} /></Linked>
      <FieldError>{error}</FieldError>
      <p className="text-muted small mt-2 mb-0">{tr("The room is free again for those dates, and the team is told with this reason.")}</p>
    </Modal>
  );
}
