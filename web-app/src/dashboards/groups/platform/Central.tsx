'use client';

// platform.central: what the platform keeps once for every hotel - logins, guest and company profiles, GST records and lookups, and (Super Admin)
// possible duplicates. Read only for a Platform Admin; the Super Admin adds, changes and deletes. Masked values are shown with Reveal (audited).
import { useState, type ReactNode } from 'react';

import type { CentralDeleteInput } from '@shared/dashboards/central';

import {
  centralCopy as T,
  type CentralApi,
  type CentralCompanyDetail,
  type CentralCompanyRow,
  type CentralGstDetail,
  type CentralGstRow,
  type CentralGuestDetail,
  type CentralGuestRow,
  type CentralLoginDetail,
  type CentralLoginRow,
  type CentralLookupRow,
  type CentralMergeHistory,
  type CentralPage,
  type CentralTab,
  type RevealField,
} from '@shared/dashboards/central';
import { centralCopy as W } from '@shared/dashboards/central';
import { createCentralMock } from '@shared/dashboards/central.mock';
import type { DashResult } from '@shared/dashboards/common';
import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { platformCopy } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction, useDebounced } from '@/components/ui';
import { createHttpCentralApi } from '@/lib/api/adapters/central';
import { chooseApi } from '@/lib/api/mode';
import { Bi, Button, DetailCard, Dialog, EmptyState, Field, ListTabs, Modal, PageHead, Pager, SearchField, SegTabs, pagerView, type DetailFact, type TableView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { initials } from '../payrollCore/pms';
import { DuplicatesBody } from './Duplicates';
import { platformApi } from './api';
import { When } from './superParts';

import { tr, trf } from '@/lib/i18n/language';
const api: CentralApi = chooseApi(createHttpCentralApi, createCentralMock, { guard: false });

type TabId = CentralTab | 'duplicates';
type Area = 'logins' | 'profiles' | 'gst' | 'duplicates';
const AREA_OF: Record<TabId, Area> = { logins: 'logins', guests: 'profiles', companies: 'profiles', gst: 'gst', lookups: 'gst', duplicates: 'duplicates' };
const AREA_ICON: Record<Area, string> = { logins: 'person-lock', profiles: 'person-vcard', gst: 'receipt-cutoff', duplicates: 'intersect' };
const FIRST_OF: Record<Area, TabId> = { logins: 'logins', profiles: 'guests', gst: 'gst', duplicates: 'duplicates' };
const SUB_TABS: Partial<Record<Area, TabId[]>> = { profiles: ['guests', 'companies'], gst: ['gst', 'lookups'] };
const CP = platformCopy.centralPage;
const startTab = (v: string | undefined, isSuper: boolean): TabId => {
  const all: TabId[] = ['logins', 'guests', 'companies', 'gst', 'lookups', ...(isSuper ? (['duplicates'] as const) : [])];
  return all.includes(v as TabId) ? (v as TabId) : 'logins';
};

export function PlatformCentral({ user, params }: ScreenProps) {
  return <CentralBody isSuper={user.role === 'super_admin'} initial={params.tab} />;
}

/** The old "Possible duplicates" page address opens the Central page on its last tab. */
export function PlatformCentralDuplicates({ user }: ScreenProps) {
  return <CentralBody isSuper={user.role === 'super_admin'} initial="duplicates" />;
}

function CentralBody({ isSuper, initial }: { isSuper: boolean; initial: string | undefined }) {
  const [tab, setTab] = useState<TabId>(() => startTab(initial, isSuper));
  const area = AREA_OF[tab];
  const areas: Area[] = ['logins', 'profiles', 'gst', ...(isSuper ? (['duplicates'] as const) : [])];
  const subs = SUB_TABS[area];
  return (
    <>
      <PageHead className="reveal" sub={isSuper ? CP.subSuper : T.subtitle} />
      <SegTabs className="mb-3" label={CP.areasLabel} active={area} onChange={(id) => setTab(FIRST_OF[id as Area])} tabs={areas.map((id) => ({ id, label: CP.areas[id], icon: AREA_ICON[id] }))} />
      {subs ? <ListTabs className="mb-3" label={CP.areas[area]} active={tab} onChange={(id) => setTab(id as TabId)} tabs={subs.map((id) => ({ id, label: T.tabs[id] }))} /> : null}
      {area !== 'duplicates' ? (
        <div className="hm-queue pf-ontheway reveal">
          <div className="hm-q">
            <i className={`hm-dot ${isSuper && tab !== 'lookups' ? 'tone-warn' : 'tone-muted'}`} aria-hidden="true" />
            <div className="hm-q-text">
              <b>{tab === 'lookups' ? CP.lookupsTitle : isSuper ? CP.superTitle : CP.readTitle}</b>
              <small>{tab === 'lookups' ? W.write.lookupsReadOnly : isSuper ? CP.superNote : T.readOnly}</small>
            </div>
            <span />
          </div>
        </div>
      ) : null}
      {tab === 'logins' ? <ListTab<CentralLoginRow, CentralLoginDetail> key="logins" tab="logins" load={api.logins} open={api.login} card={loginCard} detail={LoginDetailView} title={(r) => r.username} write={isSuper ? loginWrite : undefined} /> : null}
      {tab === 'guests' ? <ListTab<CentralGuestRow, CentralGuestDetail> key="guests" tab="guests" load={api.guests} open={api.guest} card={guestCard} detail={GuestDetailView} title={(r) => r.name} write={isSuper ? guestWrite : undefined} /> : null}
      {tab === 'companies' ? <ListTab<CentralCompanyRow, CentralCompanyDetail> key="companies" tab="companies" load={api.companies} open={api.company} card={companyCard} detail={CompanyDetailView} title={(r) => r.name} write={isSuper ? companyWrite : undefined} /> : null}
      {tab === 'gst' ? <ListTab<CentralGstRow, CentralGstDetail> key="gst" tab="gst" load={api.gst} open={api.gstRecord} card={gstCard} detail={GstDetailView} title={(r) => r.gstin} write={isSuper ? gstWrite : undefined} /> : null}
      {tab === 'lookups' ? <ListTab<CentralLookupRow, CentralLookupRow> key="lookups" tab="lookups" load={api.lookups} open={api.lookup} card={lookupCard} detail={LookupDetailView} title={(r) => r.gstin} /> : null}
      {tab === 'duplicates' && isSuper ? <DuplicatesBody /> : null}
    </>
  );
}

/* ---------------------------------------------------------------- a list tab */

interface CardSpec {
  lead: ReactNode;
  facts: DetailFact[];
  warn?: boolean;
}

function ListTab<R extends { id: string }, D>({
  tab,
  load,
  open,
  card,
  detail: Detail,
  title,
  write,
}: {
  write?: WriteConfig<D>;
  tab: CentralTab;
  load: (q: { search?: string; deleted?: boolean; page?: number; pageSize?: number }) => Promise<DashResult<CentralPage<R>>>;
  open: (id: string) => Promise<DashResult<D>>;
  card: (r: R) => CardSpec;
  detail: (p: { data: D }) => ReactNode;
  title: (r: R) => string;
}) {
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [picked, setPicked] = useState<R | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [making, setMaking] = useState(false);
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((n) => n + 1);
  const { data, error, reload } = useLoaded(() => load({ search: search || undefined, deleted: showDeleted || undefined, page, pageSize }), [search, page, pageSize, showDeleted, version]);

  const view: TableView<R> | null = data
    ? {
        ...pagerView(data, { setPage }),
        setPerPage: (n: number) => {
          setPageSize(n);
          setPage(1);
        },
      }
    : null;

  return (
    <>
      <div className="pf-toolbar">
        <SearchField
          wrapClass="pay-toolbar"
          smart
          clear
          value={typed}
          placeholder={T.search[tab]}
          label={T.search[tab]}
          onChange={(v) => {
            setTyped(v);
            setPage(1);
          }}
        />
        {data ? <span className="pf-sec-note">{showDeleted ? CP.deletedTotal(data.total) : T.total(data.total)}</span> : null}
        {write ? (
          <div className="pf-toolbar-end">
            {write.canDelete ? (
              <Button variant="ghost" icon={showDeleted ? 'list' : 'trash'} onClick={() => { setShowDeleted((v) => !v); setPage(1); }}>
                {showDeleted ? W.write.showLive : W.write.showDeleted}
              </Button>
            ) : null}
            <Button icon="plus-lg" onClick={() => setMaking(true)}>
              {write.newLabel}
            </Button>
          </div>
        ) : null}
      </div>
      {!data || !view ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={8} />
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          {data.total === 0 ? (
            <div className="card reveal">
              {search ? (
                <EmptyState icon="search" title={T.noMatch.title} text={T.noMatch.body}>
                  <Button variant="outline" className="mt-3" onClick={() => setTyped('')}>
                    {tr("Clear search")}
                  </Button>
                </EmptyState>
              ) : (
                <EmptyState icon="database" title={T.empty.title} text={T.empty.body} />
              )}
            </div>
          ) : (
            <>
              <div className="reveal">
                {data.items.map((r) => {
                  const c = card(r);
                  return (
                    <DetailCard
                      key={r.id}
                      label={title(r)}
                      leadWidth="lg"
                      className="pf-hotel pf-record-card"
                      warn={c.warn}
                      lead={c.lead}
                      facts={c.facts}
                      meta={CP.fullRecordNote}
                      actions={
                        <Button variant="outline" size="sm" icon="eye" onClick={() => setPicked(r)} aria-label={trf("Open {0}", [title(r)])}>
                          {CP.openRecord}
                        </Button>
                      }
                    />
                  );
                })}
              </div>
              <div className="card sh-pager-card">
                <Pager server view={view} sizes={[10, 25, 50]} />
              </div>
            </>
          )}
        </>
      )}
      {picked ? <DetailModal<D> title={title(picked)} open={() => open(picked.id)} view={Detail} onClose={() => setPicked(null)} write={write} id={picked.id} onChanged={changed} /> : null}
      {making && write ? <FormModal<D> write={write} current={null} onClose={() => setMaking(false)} onDone={() => { setMaking(false); changed(); }} /> : null}
    </>
  );
}

function DetailModal<D>({ title, open, view: View, onClose, write, id, onChanged }: { title: string; open: () => Promise<DashResult<D>>; view: (p: { data: D }) => ReactNode; onClose: () => void; write?: WriteConfig<D>; id: string; onChanged: () => void }) {
  const [version, setVersion] = useState(0);
  const { data, error, reload } = useLoaded(open, [version]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { busy, run } = useAction();
  const after = () => {
    setVersion((n) => n + 1);
    onChanged();
  };
  const isDeleted = data !== null && write?.deletedOf(data) === true;
  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={title}
        size="lg"
        footer={
          write && data ? (
            <div className="d-flex flex-wrap gap-2 w-100">
              {isDeleted ? (
                write.restore ? (
                  <Button variant="outline" icon="arrow-counterclockwise" busy={busy} onClick={() => void run(() => write.restore!(id), { success: W.write.restored, onOk: after })}>
                    {W.write.restore}
                  </Button>
                ) : null
              ) : (
                <>
                  {write.fields.edit.length > 0 ? <Button variant="outline" icon="pencil" onClick={() => setEditing(true)}>{W.write.edit}</Button> : null}
                  {write.refresh ? (
                    <Button variant="outline" icon="arrow-clockwise" busy={busy} onClick={() => void run(() => write.refresh!(id), { success: W.write.refreshed, onOk: after })}>
                      {W.write.refresh}
                    </Button>
                  ) : null}
                  {write.after?.(data, id, after)}
                  <Button variant="danger" icon="trash" className="ms-auto" onClick={() => setDeleting(true)}>{write.deleteLabel}</Button>
                </>
              )}
            </div>
          ) : undefined
        }
      >
        {data ? <View data={data} /> : <Wait error={error} onRetry={reload} tiles={false} rows={5} />}
      </Modal>
      {editing && write && data ? <FormModal<D> write={write} current={data} id={id} onClose={() => setEditing(false)} onDone={() => { setEditing(false); after(); }} /> : null}
      {deleting && write && data ? <DeleteModal write={write} name={write.nameOf(data)} id={id} onClose={() => setDeleting(false)} onDone={() => { setDeleting(false); onChanged(); onClose(); }} /> : null}
    </>
  );
}

/* ---------------------------------------------------------------- columns */

const dash = <span className="text-muted">-</span>;
const when = (v: string | null): ReactNode => (v ? formatDateTime(v) : dash);

const K = CP.card;
const mergedPill = (mergedInto: string | null): ReactNode => (mergedInto ? <span className="pay-pill pay-hold ms-2">{T.merged}</span> : null);
const pill = (cls: string, icon: string, label: string) => (
  <span className={`pay-pill ${cls}`}>
    <Bi name={icon} />
    {label}
  </span>
);
const kindIcon = (icon: string) => (
  <span className="pf-kind" aria-hidden="true">
    <Bi name={icon} />
  </span>
);
const profilePill = (r: { mergedInto: string | null; deletedAt: string | null; hasLogin: boolean }) =>
  r.deletedAt ? pill('pay-failed', 'trash', CP.deletedPill) : r.mergedInto ? pill('pay-hold', 'intersect', CP.mergedPill) : r.hasLogin ? pill('pay-paid', 'person-check', CP.loginPill) : pill('pay-hold', 'person', CP.noLoginPill);

const loginCard = (r: CentralLoginRow): CardSpec => ({
  warn: r.locked,
  lead: (
    <>
      <span className="pf-kind pf-initials" aria-hidden="true">
        {initials(r.displayName || r.username)}
      </span>
      {r.closed ? pill('pay-hold', 'x-circle', CP.closedPill) : r.locked ? pill('pay-failed', 'lock-fill', CP.lockedPill) : pill(r.status === 'active' ? 'pay-paid' : 'pay-pending', r.status === 'active' ? 'check-circle' : 'hourglass-split', T.status[r.status])}
    </>
  ),
  facts: [
    { label: K.login, value: r.username, sub: r.displayName ?? undefined },
    { label: K.kind, value: T.role[r.roleType] },
    { label: K.hotels, value: r.hotels.length ? r.hotels.join(', ') : undefined, empty: K.noHotel, sub: r.hotels.length > 1 ? CP.hotelCount(r.hotels.length) : undefined },
    { label: K.lastSignIn, value: r.lastLoginAt ? <When iso={r.lastLoginAt} /> : T.neverSignedIn, tone: r.lastLoginAt ? undefined : 'muted' },
  ],
});

const guestCard = (r: CentralGuestRow): CardSpec => ({
  lead: (
    <>
      {kindIcon('person')}
      {profilePill(r)}
    </>
  ),
  facts: [
    { label: K.name, value: r.name, sub: r.city ?? undefined },
    { label: K.mobile, value: r.mobile ?? undefined, sub: r.email ?? undefined },
    { label: K.hotels, value: CP.hotelCount(r.hotelCount), tone: r.hotelCount ? undefined : 'muted' },
    { label: K.created, value: formatDate(r.createdAt) },
  ],
});

const companyCard = (r: CentralCompanyRow): CardSpec => ({
  lead: (
    <>
      {kindIcon('building')}
      {profilePill(r)}
    </>
  ),
  facts: [
    { label: K.name, value: r.name, sub: r.gstin ?? undefined },
    { label: K.contact, value: r.mainContactName ?? undefined, sub: r.mobile ?? r.email ?? undefined },
    { label: K.hotels, value: CP.hotelCount(r.hotelCount), tone: r.hotelCount ? undefined : 'muted' },
    { label: K.created, value: formatDate(r.createdAt) },
  ],
});

const gstCard = (r: CentralGstRow): CardSpec => ({
  warn: r.status === 'cancelled' || r.status === 'suspended',
  lead: (
    <>
      {kindIcon('receipt-cutoff')}
      {r.deletedAt ? pill('pay-failed', 'trash', CP.deletedPill) : pill(r.status === 'active' ? 'pay-paid' : r.status === 'cancelled' || r.status === 'suspended' ? 'pay-failed' : 'pay-hold', r.status === 'active' ? 'check-circle' : 'dash-circle', T.gstStatus[r.status])}
    </>
  ),
  facts: [
    { label: K.gstin, value: r.gstin, sub: r.state ?? undefined },
    { label: K.legalName, value: r.legalName ?? undefined, sub: r.tradeName ?? undefined },
    { label: K.fetched, value: formatDate(r.fetchedAt), sub: CP.dueAgain(formatDate(r.refreshAfter)) },
    { label: K.used, value: CP.timesUsed(r.timesUsed) },
  ],
});

const lookupCard = (r: CentralLookupRow): CardSpec => ({
  warn: r.outcome === 'failed',
  lead: (
    <>
      {kindIcon('search')}
      {pill(r.outcome === 'found' ? 'pay-paid' : r.outcome === 'failed' ? 'pay-failed' : 'pay-hold', r.outcome === 'found' ? 'check-circle' : r.outcome === 'failed' ? 'x-circle' : 'dash-circle', T.outcome[r.outcome])}
    </>
  ),
  facts: [
    { label: K.gstin, value: r.gstin, sub: r.errorCode ?? r.provider },
    { label: K.when, value: <When iso={r.createdAt} /> },
    { label: K.hotel, value: r.hotelName ?? undefined, sub: r.requestedBy ?? undefined },
    { label: K.took, value: r.tookMs === null ? undefined : `${r.tookMs} ms` },
  ],
});

function StatusPills({ row }: { row: CentralLoginRow }) {
  return (
    <>
      <span className={`pay-pill ${row.status === 'active' ? 'pay-paid' : 'pay-hold'}`}>{T.status[row.status]}</span>
      {row.locked ? <span className="pay-pill pay-failed ms-1"><Bi name="lock-fill" />{tr("Locked")}</span> : null}
      {row.closed ? <span className="pay-pill pay-hold ms-1">{tr("Closed")}</span> : null}
    </>
  );
}

/* ---------------------------------------------------------------- details */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dc-dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const text = (v: string | number | null | undefined): ReactNode => (v === null || v === undefined || v === '' ? dash : String(v));

/** A masked value and its Reveal button; once shown, the full value replaces the mask on this screen only. */
function Masked({ masked, kind, id, field, index }: { masked: string | null; kind: 'guest' | 'company'; id: string; field: RevealField; index?: number }) {
  const [value, setValue] = useState<string | null>(null);
  const { busy, run } = useAction();
  if (!masked) return dash;
  return (
    <span className="d-inline-flex flex-wrap align-items-center gap-2">
      <span>{value ?? masked}</span>
      {value === null ? (
        <Button variant="outline" size="sm" icon="eye" busy={busy} title={T.revealNote} aria-label={`${T.reveal} ${field}`} onClick={() => void run(() => api.reveal({ kind, id, field, index }), { onOk: (r) => setValue(r.value) })}>
          {T.reveal}
        </Button>
      ) : null}
    </span>
  );
}

function Hotels({ hotels }: { hotels: { hotelId: string; hotelName: string }[] }) {
  return hotels.length === 0 ? dash : <ul className="list-unstyled mb-0">{hotels.map((h) => <li key={h.hotelId}><Bi name="building" /> {h.hotelName}</li>)}</ul>;
}

function History({ h }: { h: CentralMergeHistory }) {
  if (!h.mergedInto && h.mergedFrom.length === 0) return <Row label={T.history}>{tr("No merges.")}</Row>;
  return (
    <Row label={T.history}>
      {h.mergedInto ? <div>{tr("Merged into")} <strong>{h.mergedInto.name}</strong> {tr("on")} {h.mergedAt ? formatDateTime(h.mergedAt) : '-'}{h.mergedByName ? ` by ${h.mergedByName}` : ''}.</div> : null}
      {h.mergedFrom.map((m) => <div key={m.id}>{m.name} {tr("was merged into this one on")} {formatDateTime(m.mergedAt)}.</div>)}
    </Row>
  );
}

function LoginDetailView({ data: d }: { data: CentralLoginDetail }) {
  return (
    <dl className="dc-dl pf-record">
      <Row label={tr("Username")}>{d.username}</Row>
      <Row label={tr("Name")}>{text(d.displayName)}</Row>
      <Row label={tr("Role")}>{T.role[d.roleType]}</Row>
      <Row label={tr("Status")}><StatusPills row={d} /></Row>
      <Row label={tr("Hotels")}>{d.hotelLinks.length === 0 ? dash : <ul className="list-unstyled mb-0">{d.hotelLinks.map((h) => <li key={h.hotelId}><Bi name="building" /> {h.hotelName} <span className="text-muted">({h.status})</span></li>)}</ul>}</Row>
      <Row label={tr("Last sign-in")}>{when(d.lastLoginAt)}</Row>
      <Row label={tr("Open sign-ins now")}>{d.activeSessions}</Row>
      <Row label={tr("Wrong passwords in a row")}>{d.failedAttempts}</Row>
      <Row label={tr("Lock level")}>{d.lockLevel}</Row>
      <Row label={tr("Locked until")}>{when(d.lockedUntil)}</Row>
      <Row label={tr("Blocked")}>{d.blockedKind ? `${d.blockedKind === 'admin' ? 'By an admin' : 'Automatically'} on ${d.blockedAt ? formatDateTime(d.blockedAt) : '-'}` : tr("No")}</Row>
      <Row label={tr("Must change password")}>{d.mustChangePassword ? tr("Yes") : tr("No")}</Row>
      <Row label={tr("Email code needed")}>{d.codeRequired ? tr("Yes") : tr("No")}</Row>
      <Row label={tr("Password changed")}>{when(d.passwordChangedAt)}</Row>
      <Row label={tr("Profile")}>{d.profile ? `${d.profile.kind === 'guest' ? 'Guest' : 'Company'} profile: ${d.profile.name}` : dash}</Row>
      <Row label={tr("Created")}>{formatDateTime(d.createdAt)}</Row>
    </dl>
  );
}

function GuestDetailView({ data: d }: { data: CentralGuestDetail }) {
  return (
    <dl className="dc-dl pf-record">
      <Row label={tr("Name")}>{d.name}{mergedPill(d.mergedInto)}</Row>
      <Row label={tr("Mobile")}><Masked masked={d.mobile} kind="guest" id={d.id} field="mobile" /></Row>
      <Row label={tr("Email")}><Masked masked={d.email} kind="guest" id={d.id} field="email" /></Row>
      <Row label={tr("Address")}>{text(d.address)}</Row>
      <Row label={tr("City")}>{text(d.city)}</Row>
      <Row label={tr("Hotels")}><Hotels hotels={d.hotels} /></Row>
      <Row label={tr("Login")}>{d.loginUsername ?? tr("No login")}</Row>
      <History h={d.history} />
      <Row label={tr("Created")}>{formatDateTime(d.createdAt)}</Row>
      <Row label={tr("Last changed")}>{formatDateTime(d.updatedAt)}</Row>
    </dl>
  );
}

function CompanyDetailView({ data: d }: { data: CentralCompanyDetail }) {
  return (
    <dl className="dc-dl pf-record">
      <Row label={tr("Name")}>{d.name}{mergedPill(d.mergedInto)}</Row>
      <Row label={tr("GSTIN")}>{text(d.gstin)}</Row>
      <Row label={tr("Main contact")}>{text(d.mainContactName)}</Row>
      <Row label={tr("Mobile")}><Masked masked={d.mobile} kind="company" id={d.id} field="mobile" /></Row>
      <Row label={tr("Email")}><Masked masked={d.email} kind="company" id={d.id} field="email" /></Row>
      <Row label={tr("Landline")}><Masked masked={d.landline} kind="company" id={d.id} field="landline" /></Row>
      <Row label={tr("Address")}>{text(d.address)}</Row>
      <Row label={tr("Pincode")}>{text(d.pincode)}</Row>
      <Row label={tr("Country")}>{text(d.country)}</Row>
      <Row label={tr("Contact people")}>
        {d.contacts.length === 0 ? dash : (
          <ul className="list-unstyled mb-0">
            {d.contacts.map((c, i) => (
              <li key={i} className="mb-1">
                <strong>{c.name}</strong>{c.role ? ` (${c.role})` : ''}
                <div><Masked masked={c.mobile || null} kind="company" id={d.id} field="contactMobile" index={i} /></div>
                <div><Masked masked={c.email || null} kind="company" id={d.id} field="contactEmail" index={i} /></div>
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Row label={tr("Hotels")}><Hotels hotels={d.hotels} /></Row>
      <Row label={tr("Login")}>{d.loginUsername ?? tr("No login")}</Row>
      <History h={d.history} />
      <Row label={tr("Created")}>{formatDateTime(d.createdAt)}</Row>
      <Row label={tr("Last changed")}>{formatDateTime(d.updatedAt)}</Row>
    </dl>
  );
}

function GstDetailView({ data: d }: { data: CentralGstDetail }) {
  return (
    <>
      <dl className="dc-dl pf-record mb-3">
        <Row label={tr("GSTIN")}>{d.gstin}</Row>
        <Row label={tr("State code and PAN")}>{d.stateCode} / {d.pan}</Row>
        <Row label={tr("Legal name")}>{text(d.legalName)}</Row>
        <Row label={tr("Trade name")}>{text(d.tradeName)}</Row>
        <Row label={tr("Status")}>{T.gstStatus[d.status]}</Row>
        <Row label={tr("Taxpayer type")}>{text(d.taxpayerType)}</Row>
        <Row label={tr("Constitution")}>{text(d.constitution)}</Row>
        <Row label={tr("Registered on")}>{text(d.registeredOn)}</Row>
        <Row label={tr("Cancelled on")}>{text(d.cancelledOn)}</Row>
        <Row label={tr("Address")}>{text(d.address)}</Row>
        <Row label={tr("City")}>{text(d.city)}</Row>
        <Row label={tr("District")}>{text(d.district)}</Row>
        <Row label={tr("State")}>{text(d.state)}</Row>
        <Row label={tr("Pincode")}>{text(d.pincode)}</Row>
        <Row label={tr("Building number")}>{text(d.buildingNumber)}</Row>
        <Row label={tr("Building name")}>{text(d.buildingName)}</Row>
        <Row label={tr("Floor")}>{text(d.floor)}</Row>
        <Row label={tr("Street")}>{text(d.street)}</Row>
        <Row label={tr("Locality")}>{text(d.locality)}</Row>
        <Row label={tr("Landmark")}>{text(d.landmark)}</Row>
        <Row label={tr("Nature of business")}>{d.natureOfBusiness.length > 0 ? d.natureOfBusiness.join(', ') : dash}</Row>
        <Row label={tr("Blocked from filing")}>{text(d.blockStatus)}</Row>
        <Row label={tr("State jurisdiction")}>{text(d.stateJurisdiction)}</Row>
        <Row label={tr("Came from")}>{d.source}</Row>
        <Row label={tr("Fetched")}>{formatDateTime(d.fetchedAt)}</Row>
        <Row label={tr("Due again")}>{formatDateTime(d.refreshAfter)}</Row>
        <Row label={tr("Times used")}>{d.timesUsed}</Row>
        <Row label={tr("Last used")}>{when(d.lastUsedAt)}</Row>
        <Row label={tr("Saved")}>{formatDateTime(d.createdAt)}</Row>
        <Row label={tr("Last updated")}>{formatDateTime(d.updatedAt)}</Row>
      </dl>
      <div className="fw-semibold mb-1">{tr("The service's answer, as it came")}</div>
      <pre className="pf-raw">{d.raw ? JSON.stringify(d.raw, null, 2) : tr("Not kept.")}</pre>
    </>
  );
}

function LookupDetailView({ data: d }: { data: CentralLookupRow }) {
  return (
    <dl className="dc-dl pf-record">
      <Row label={tr("When")}>{formatDateTime(d.createdAt)}</Row>
      <Row label={tr("GSTIN")}>{d.gstin}</Row>
      <Row label={tr("Service")}>{d.provider}</Row>
      <Row label={tr("Outcome")}>{T.outcome[d.outcome]}</Row>
      <Row label={tr("Error code")}>{text(d.errorCode)}</Row>
      <Row label={tr("Time taken")}>{d.tookMs === null ? dash : `${d.tookMs} ms`}</Row>
      <Row label={tr("Hotel that asked")}>{text(d.hotelName)}</Row>
      <Row label={tr("Asked by")}>{text(d.requestedBy)}</Row>
    </dl>
  );
}

/* ---------------------------------------------------------------- the writes (Super Admin only) */

interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'email' | 'tel' | 'select';
  options?: { value: string; label: string }[];
  required?: boolean;
  /** A masked value (mobile, email, landline): left blank it stays; "Remove it" clears it. */
  sensitive?: boolean;
}

interface WriteConfig<D> {
  newLabel: string;
  deleteLabel: string;
  /** The tab has a deleted view (hidden records that can be restored). */
  canDelete: boolean;
  note: string;
  fields: { create: FieldDef[]; edit: FieldDef[] };
  create: (v: Record<string, unknown>) => Promise<DashResult<unknown>>;
  update?: (id: string, patch: Record<string, unknown>) => Promise<DashResult<unknown>>;
  del: (id: string, input: CentralDeleteInput) => Promise<DashResult<unknown>>;
  restore?: (id: string) => Promise<DashResult<unknown>>;
  refresh?: (id: string) => Promise<DashResult<unknown>>;
  /** What is typed to confirm a delete. */
  nameOf: (d: D) => string;
  deletedOf: (d: D) => boolean;
  initial: (d: D) => Record<string, string>;
  /** Extra buttons in the detail (a login: enable or disable, unlock, reset password). */
  after?: (d: D, id: string, reload: () => void) => ReactNode;
  /** Fields of the create form that depend on another (a hotel for a hotel login). */
  dynamic?: (values: Record<string, string>) => FieldDef[];
}

const strip = (v: Record<string, string>): Record<string, unknown> => Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim() !== ''));

function FormModal<D>({ write, current, id, onClose, onDone }: { write: WriteConfig<D>; current: D | null; id?: string; onClose: () => void; onDone: () => void }) {
  const editing = current !== null && id !== undefined;
  const base = editing ? write.initial(current) : {};
  const fields = editing ? write.fields.edit : write.fields.create;
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...base }));
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const hotels = useLoaded(() => (write.dynamic && !editing ? platformApi.listHotels({ page: 1, pageSize: 100 }) : Promise.resolve({ ok: true as const, data: null })), []);
  const all = [...fields, ...(write.dynamic && !editing ? write.dynamic(values) : [])];
  const hotelOptions = (hotels.data && 'items' in hotels.data ? hotels.data.items : []).map((h: { id: string; name: string }) => ({ value: h.id, label: h.name }));

  function submit() {
    setErrors({});
    let body: Record<string, unknown>;
    if (editing) {
      body = {};
      for (const f of all) {
        const now = (values[f.key] ?? '').trim();
        if (f.sensitive) {
          if (removed[f.key]) body[f.key] = null;
          else if (now !== '') body[f.key] = now;
        } else if (now !== (base[f.key] ?? '').trim()) body[f.key] = now === '' ? null : now;
      }
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
    } else body = strip(values);
    void run(() => (editing ? write.update!(id, body) : write.create(body)), {
      success: editing ? W.write.saved : W.write.created,
      onFields: (f) => setErrors(f),
      onOk: onDone,
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? W.write.edit : write.newLabel}
      size="md"
      staticBackdrop
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{W.write.cancel}</Button>
          <Button type="submit" icon="check-lg" busy={busy}>{W.write.save}</Button>
        </>
      }
    >
      <p className="small text-muted">{write.note}</p>
      <div className="row g-3">
        {all.map((f) => (
          <Field key={f.key} label={f.label} required={f.required && !editing} error={errors[f.key]}>
            {f.type === 'select' ? (
              <select className={`form-select${errors[f.key] ? ' is-invalid' : ''}`} value={values[f.key] ?? ''} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}>
                <option value="">{tr("Choose...")}</option>
                {(f.key === 'hotelId' ? hotelOptions : (f.options ?? [])).map((o: { value: string; label: string }) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <>
                <input
                  className={`form-control${errors[f.key] ? ' is-invalid' : ''}`}
                  type={f.type ?? 'text'}
                  value={values[f.key] ?? ''}
                  disabled={removed[f.key]}
                  placeholder={editing && f.sensitive ? W.write.keepBlank : undefined}
                  autoComplete="off"
                  onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                />
                {editing && f.sensitive ? (
                  <label className="small mt-1 d-flex gap-2 align-items-center">
                    <input type="checkbox" checked={Boolean(removed[f.key])} onChange={(e) => setRemoved((p) => ({ ...p, [f.key]: e.target.checked }))} /> {W.write.removeIt}
                  </label>
                ) : null}
              </>
            )}
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function DeleteModal<D>({ write, name, id, onClose, onDone }: { write: WriteConfig<D>; name: string; id: string; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const { busy, run } = useAction();
  const matches = typed.trim() === name.trim();
  return (
    <Modal
      open
      onClose={onClose}
      title={`${write.deleteLabel}: ${name}`}
      size="md"
      staticBackdrop
      onSubmit={() => {
        if (!matches) return setError(W.write.deleteHelp);
        void run(() => write.del(id, { confirmName: typed, ...(reason.trim() ? { reason: reason.trim() } : {}) }), { success: W.write.deleted, onFields: (f) => setError(Object.values(f)[0] ?? ''), onOk: onDone });
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{W.write.cancel}</Button>
          <Button type="submit" variant="danger" icon="trash" busy={busy} disabled={!matches}>{write.deleteLabel}</Button>
        </>
      }
    >
      <p className="small">{W.write.deleteHelp}</p>
      <p className="fw-semibold user-select-all">{name}</p>
      <Field label={tr("Name")} required error={error}>
        <input className={`form-control${error ? ' is-invalid' : ''}`} value={typed} autoComplete="off" aria-label={tr("Type the name to confirm")} onChange={(e) => { setTyped(e.target.value); setError(''); }} />
      </Field>
      <Field label={W.write.reason}>
        <textarea className="form-control" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

/** Enable or disable, unlock and reset password of a login: the Super Admin's existing account actions (each audited by the server; a reset mails the person, nothing is shown). */
function LoginActions({ d, reload }: { d: CentralLoginDetail; reload: () => void }) {
  const { busy, run } = useAction();
  const [ask, setAsk] = useState<'reset' | 'disable' | null>(null);
  if (d.closed) return null;
  const done = { onOk: () => { setAsk(null); reload(); } };
  return (
    <>
      {d.locked ? <Button variant="outline" icon="unlock" busy={busy} onClick={() => void run(() => platformApi.unlockUser(d.id), { ...done, success: 'Unlocked.' })}>{tr("Unlock")}</Button> : null}
      <Button variant="outline" icon="key" onClick={() => setAsk('reset')}>{tr("Reset password")}</Button>
      {d.status === 'disabled' ? (
        <Button variant="outline" icon="check-circle" busy={busy} onClick={() => void run(() => platformApi.enableUser(d.id), { ...done, success: 'Enabled.' })}>{tr("Enable")}</Button>
      ) : (
        <Button variant="outline" icon="slash-circle" onClick={() => setAsk('disable')}>{tr("Disable")}</Button>
      )}
      <Dialog
        open={ask !== null}
        tone={ask === 'disable' ? 'danger' : 'warning'}
        title={ask === 'reset' ? `Reset the password of ${d.username}?` : `Disable ${d.username}?`}
        message={ask === 'reset' ? 'A new temporary password is emailed to the person. It is not shown here.' : 'The person is signed out everywhere and cannot sign in until enabled.'}
        confirmLabel={ask === 'reset' ? 'Reset password' : 'Disable'}
        busy={busy}
        onCancel={() => setAsk(null)}
        onConfirm={() => void run(() => (ask === 'reset' ? platformApi.resetUserPassword(d.id) : platformApi.disableUser(d.id)) as Promise<DashResult<unknown>>, { ...done, success: ask === 'reset' ? 'A new password was emailed.' : 'Disabled.' })}
      />
    </>
  );
}

const ROLE_OPTIONS = [
  { value: 'platform_admin', label: 'Platform Admin' },
  { value: 'hotel_admin', label: 'Hotel Admin' },
  { value: 'hotel_user', label: 'Hotel User' },
];

const loginWrite: WriteConfig<CentralLoginDetail> = {
  newLabel: 'New login',
  deleteLabel: 'Delete login',
  canDelete: false,
  note: W.write.loginNote,
  fields: {
    create: [
      { key: 'username', label: 'Username', required: true },
      { key: 'displayName', label: 'Name', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'mobile', label: 'Mobile', type: 'tel', required: true },
      { key: 'roleType', label: 'Kind of login', type: 'select', options: ROLE_OPTIONS, required: true },
    ],
    edit: [
      { key: 'displayName', label: 'Name' },
      { key: 'email', label: 'Email', type: 'email', sensitive: true },
      { key: 'mobile', label: 'Mobile', type: 'tel', sensitive: true },
    ],
  },
  dynamic: (v) => (v.roleType === 'hotel_admin' || v.roleType === 'hotel_user' ? [{ key: 'hotelId', label: 'Hotel', type: 'select', required: true }] : []),
  create: (v) => api.createLogin(v as never),
  update: (id, p) => api.updateLogin(id, p as never),
  del: (id, i) => api.deleteLogin(id, i),
  nameOf: (d) => d.username,
  deletedOf: (d) => d.closed,
  initial: (d) => ({ displayName: d.displayName ?? '' }),
  after: (d, _id, reload) => <LoginActions d={d} reload={reload} />,
};

const guestWrite: WriteConfig<CentralGuestDetail> = {
  newLabel: 'New guest profile',
  deleteLabel: 'Delete profile',
  canDelete: true,
  note: W.write.profileNote,
  fields: {
    create: [
      { key: 'name', label: 'Name', required: true },
      { key: 'mobile', label: 'Mobile', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
    ],
    edit: [
      { key: 'name', label: 'Name' },
      { key: 'mobile', label: 'Mobile', type: 'tel', sensitive: true },
      { key: 'email', label: 'Email', type: 'email', sensitive: true },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
    ],
  },
  create: (v) => api.createGuest(v),
  update: (id, p) => api.updateGuest(id, p),
  del: (id, i) => api.deleteGuest(id, i),
  restore: (id) => api.restoreGuest(id),
  nameOf: (d) => d.name,
  deletedOf: (d) => d.deletedAt !== null,
  initial: (d) => ({ name: d.name, address: d.address ?? '', city: d.city ?? '' }),
};

const companyWrite: WriteConfig<CentralCompanyDetail> = {
  newLabel: 'New company profile',
  deleteLabel: 'Delete profile',
  canDelete: true,
  note: W.write.profileNote,
  fields: {
    create: [
      { key: 'name', label: 'Name', required: true },
      { key: 'gstin', label: 'GSTIN' },
      { key: 'mainContactName', label: 'Main contact' },
      { key: 'mobile', label: 'Mobile', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'landline', label: 'Landline', type: 'tel' },
      { key: 'address', label: 'Address' },
      { key: 'pincode', label: 'Pincode' },
      { key: 'country', label: 'Country' },
    ],
    edit: [
      { key: 'name', label: 'Name' },
      { key: 'gstin', label: 'GSTIN' },
      { key: 'mainContactName', label: 'Main contact' },
      { key: 'mobile', label: 'Mobile', type: 'tel', sensitive: true },
      { key: 'email', label: 'Email', type: 'email', sensitive: true },
      { key: 'landline', label: 'Landline', type: 'tel', sensitive: true },
      { key: 'address', label: 'Address' },
      { key: 'pincode', label: 'Pincode' },
      { key: 'country', label: 'Country' },
    ],
  },
  create: (v) => api.createCompany(v),
  update: (id, p) => api.updateCompany(id, p),
  del: (id, i) => api.deleteCompany(id, i),
  restore: (id) => api.restoreCompany(id),
  nameOf: (d) => d.name,
  deletedOf: (d) => d.deletedAt !== null,
  initial: (d) => ({ name: d.name, gstin: d.gstin ?? '', mainContactName: d.mainContactName ?? '', address: d.address ?? '', pincode: d.pincode ?? '', country: d.country ?? '' }),
};

const gstWrite: WriteConfig<CentralGstDetail> = {
  newLabel: 'Look up a GSTIN',
  deleteLabel: 'Delete record',
  canDelete: true,
  note: W.write.gstNote,
  fields: { create: [{ key: 'gstin', label: 'GSTIN', required: true }], edit: [] },
  create: (v) => api.createGst(String(v.gstin ?? '')),
  del: (id, i) => api.deleteGst(id, i),
  restore: (id) => api.restoreGst(id),
  refresh: (id) => api.refreshGst(id),
  nameOf: (d) => d.gstin,
  deletedOf: (d) => d.deletedAt !== null,
  initial: () => ({}),
};