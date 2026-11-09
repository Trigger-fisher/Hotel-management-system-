'use client';

// hotel.co.customers - guests with a portal account (Pallav: customer/index.blade.php; the form page is CustomerForm.tsx).
import { useMemo, useState } from 'react';
import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { maskedId } from '@shared/dashboards/frontOffice';
import { companiesCopy } from '@shared/dashboards/companies';
import type { Customer, CustomerList } from '@shared/dashboards/companies';

import { Bi, Button, DetailCard, DetailList, Dialog, Dropdown, FilterBar, Pager, SearchField, useTableView } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { RecordHistory } from '../admin/RecordHistory';
import { errorText, useToast } from '@/components/ui';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { userMayEdit } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { EmptyState, initials } from '../payrollCore/pms';
import { api, isAdmin, useActor } from './api';
import { CustomerForm } from './CustomerForm';
import { Page } from './pageParts';
import { StaleNote, Wait, useLoaded, useMockPdf } from '../payrollCore/load';
import { limit, monthYear } from './screenKit';

import { tr, trf } from '@/lib/i18n/language';
type CustomerStats = CustomerList['stats'];

const t = companiesCopy.customers;
type Tab = 'all' | 'self' | 'staff' | 'off';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'self', label: 'Signed up themselves' },
  { id: 'staff', label: 'Added by staff' },
  { id: 'off', label: 'Portal off' },
];

/** The ID proof line: the type and the number the server sends (only its last 4 characters). "Show" asks the server for the whole number (an audited call) and keeps it on screen until hidden. */
function IdProofLine({ customer, canShow }: { customer: Customer; canShow: boolean }) {
  const toast = useToast();
  const [whole, setWhole] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function show() {
    setBusy(true);
    const res = await api.revealCustomerIdNumber(customer.id);
    setBusy(false);
    if (res.ok) setWhole(res.data.idProofNumber);
    else toast.show({ tone: 'error', text: errorText(res.error) });
  }
  const text = [customer.idProofType, whole ?? customer.idProofNumber].filter(Boolean).join(' \u00b7 ') || 'None';
  return (
    <>
      <span>{text}</span>
      {customer.idProofMasked && canShow ? (
        <button type="button" className="btn btn-link btn-sm py-0 ms-2" disabled={busy} onClick={whole === null ? show : () => setWhole(null)}>
          {whole === null ? (busy ? 'Opening\u2026' : 'Show') : 'Hide'}
        </button>
      ) : null}
    </>
  );
}

export function CustomersScreen({ user }: ScreenProps) {
  useActor(user);
  const toast = useToast();
  const admin = isAdmin(user);
  const [version, setVersion] = useState(0);
  const list = useLoaded(() => api.listCustomers({ page: 1, pageSize: 1000 }), [version]);
  const rows: Customer[] | null = list.data?.page.items ?? null;
  const stats: CustomerStats = list.data?.stats ?? { total: 0, selfSignup: 0, withEmail: 0, addedThisMonth: 0 };
  const [form, setForm] = useState<{ customer: Customer | null } | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [resetting, setResetting] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const onPdf = useMockPdf();
  // Pallav (Customer::editableBy): an Admin, whoever added the customer, or anyone who may write when nobody added them
  // (signed up themselves); deleting is Admins only. Pallav compares user ids; CompanyProfile/Customer carry only the creator's
  // name (no createdById in ui-shared, shared with the real adapter), so the name is compared here. The server checks it again.
  const canEdit = (c: Customer) => admin || c.createdBy === null || c.createdBy === user.displayName;

  const everyone = useMemo(() => rows ?? [], [rows]);
  const all = useMemo(() => everyone.filter((c) => (tab === 'all' ? true : tab === 'self' ? c.source === 'self' : tab === 'staff' ? c.source !== 'self' : !c.isActive)), [everyone, tab]);
  const view = useTableView(all, {
    perPage: 25,
    match: (c, q) => [c.name, c.mobile, c.email, c.city, c.address, c.idProofType, c.idProofNumber, c.notes].join(' ').toLowerCase().includes(q),
  });

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    const res = await api.deleteCustomer(deleting.id);
    setBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: t.deleted(deleting.name) });
      setDeleting(null);
      setVersion((n) => n + 1);
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }
  async function confirmReset() {
    if (!resetting) return;
    setBusy(true);
    const res = await api.resetCustomerLogin(resetting.id);
    setBusy(false);
    if (res.ok) toast.show({ tone: res.data.emailed ? 'success' : 'info', text: res.data.message });
    else toast.show({ tone: 'error', text: errorText(res.error) });
    setResetting(null);
  }

  if (form) {
    return (
      <CustomerForm
        key={form.customer?.id ?? 'new'}
        customer={form.customer}
        onBack={() => setForm(null)}
        onSaved={() => {
          setForm(null);
          setVersion((n) => n + 1);
        }}
      />
    );
  }

  const month = monthYear();
  if (!rows) return <Wait error={list.error} onRetry={list.reload} />;
  const mayWrite = userMayEdit('companies');
  const counts: Record<Tab, number> = { all: everyone.length, self: everyone.filter((c) => c.source === 'self').length, staff: everyone.filter((c) => c.source !== 'self').length, off: everyone.filter((c) => !c.isActive).length };
  const shown = view.rows;
  const narrowed = tab !== 'all' || view.search !== '';
  return (
    <Page
      sub="Guests with a portal account: added here, or signed up by themselves."
      headActions={
        <div className="co-head-actions">
          <SearchField wrapClass="cb-search" smart clear value={view.search} onChange={view.setSearch} placeholder={tr("Search customers…")} label={tr("Search customers")} title={tr("Tips: several words must all match, \"exact phrase\"")} />
          {mayWrite && <Button icon="person-plus" onClick={() => setForm({ customer: null })}>
            {tr("Add customer")}
          </Button>}
        </div>
      }
      grid={false}
    >
      <HomeStats
        stats={[
          { id: 'all', label: 'Customers', value: stats.total, format: (n) => String(Math.round(n)), note: tr("On record") },
          { id: 'self', label: 'Signed up themselves', value: stats.selfSignup, format: (n) => String(Math.round(n)), note: trf("{0} added by staff", [stats.total - stats.selfSignup]) },
          { id: 'email', label: 'With an email', value: stats.withEmail, format: (n) => String(Math.round(n)), note: trf("{0} without", [stats.total - stats.withEmail]) },
          { id: 'month', label: 'Added this month', value: stats.addedThisMonth, format: (n) => String(Math.round(n)), note: month },
        ]}
      />
      <StaleNote error={list.error} onRetry={list.reload} />
      <FilterBar
        tabs={TABS.map((x) => ({ id: x.id, label: x.label, count: counts[x.id] }))}
        active={tab}
        onTab={(id) => setTab(id as Tab)}
        summary={<>{narrowed ? tr("Showing ") : tr("All ")}<b>{view.total}</b> {view.total === 1 ? tr("customer") : tr("customers")}</>}
        onReset={narrowed ? () => { setTab('all'); view.setSearch(''); } : undefined}
      />
      {view.total === 0 ? (
        <div className="card reveal">
          <EmptyState icon="people" title={view.search ? `No customers match "${view.search}"` : tab !== 'all' ? tr("No customers here") : 'No customers yet'} text="Add a guest, or let them make their own account on the portal sign-up page.">
            {view.search ? (
              <Button variant="outline" className="mt-3" onClick={() => view.setSearch('')}>
                {tr("Clear search")}
              </Button>
            ) : (
              mayWrite && tab === 'all' && <Button icon="person-plus" className="mt-3" onClick={() => setForm({ customer: null })}>
                {tr("Add customer")}
              </Button>
            )}
          </EmptyState>
        </div>
      ) : (
        <div className="hu-dc-list reveal">
          {shown.map((c) => {
            const editable = canEdit(c) && mayWrite;
            const removable = admin && mayWrite;
            return (
              <DetailCard className="hu-dc"
                key={c.id}
                label={c.name}
                lead={<span className="hu-avatar pf-initials" aria-hidden="true">{initials(c.name)}</span>}
                facts={[
                  { label: 'Customer', value: c.name, sub: c.source === 'self' ? tr("Signed up themselves") : tr("Added by staff") },
                  { label: 'Mobile', value: c.mobile },
                  { label: 'Email', value: c.email, text: true },
                  { label: 'Where', value: c.city || c.address ? limit([c.city, c.address].filter(Boolean).join(', '), 40) : '', text: true },
                ]}
                amount={{ label: 'Portal', value: c.isActive ? tr("Active") : tr("Off"), tone: c.isActive ? 'ok' : 'muted', sub: c.lastLoginAt ? trf("Last signed in {0}", [formatDate(c.lastLoginAt)]) : tr("Never signed in") }}
                sections={[
                  { icon: 'person-vcard', title: 'Contact', content: (
                    <DetailList items={[
                      { label: 'Mobile', value: c.mobile },
                      { label: 'Email', value: c.email || tr("None") },
                      { label: 'Address', value: [c.address, c.city].filter(Boolean).join(', ') || tr("None") },
                      { label: 'ID proof', value: <IdProofLine customer={c} canShow={editable && userMayEdit('companies')} /> },
                    ]} />
                  ) },
                  { icon: 'shield-lock', title: 'Portal account', content: (
                    <DetailList items={[
                      { label: 'Status', value: c.isActive ? tr("Active") : tr("Off") },
                      { label: 'Last sign-in', value: c.lastLoginAt ? formatDateTime(c.lastLoginAt) : tr("Never") },
                      { label: 'Added', value: `${formatDateTime(c.createdAt)}${c.createdBy ? ` · ${c.createdBy}` : ''}` },
                    ]} />
                  ) },
                  ...(c.notes ? [{ icon: 'chat-left-text', title: 'Notes', wide: true, content: <p className="hu-notes mt-0">{c.notes}</p> }] : []),
                ]}
                actions={
                  <span className="hu-order-acts">
                    {editable ? (
                      <Button size="sm" icon="pencil-square" onClick={() => setForm({ customer: c })}>{tr("Edit")}</Button>
                    ) : (
                      <a className="btn btn-sm btn-outline-p" href={PDF_ROUTES.customerProfile(c.id)} target="_blank" rel="noreferrer" onClick={onPdf(`Customer profile of ${c.name}`)}><Bi name="file-earmark-pdf" /> {tr("View PDF")}</a>
                    )}
                    {(editable || removable) && (
                      <Dropdown align="end" button={(p) => <Button variant="outline" size="sm" icon="three-dots" aria-label={trf("More for {0}", [c.name])} {...p}>{tr("More")}</Button>}>
                        {editable && <a className="dropdown-item" href={PDF_ROUTES.customerProfile(c.id)} target="_blank" rel="noreferrer" onClick={onPdf(`Customer profile of ${c.name}`)}><Bi name="file-earmark-pdf" /> {tr("View PDF")}</a>}
                        {editable && <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setResetting(c); }}><Bi name="key" /> {tr("Reset login")}</a>}
                        {removable && <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); setDeleting(c); }}><Bi name="trash" /> {tr("Delete")} <span className="hu-admin">{tr("Admin")}</span></a>}
                      </Dropdown>
                    )}
                  </span>
                }
              >
                <RecordHistory id={c.id} />
              </DetailCard>
            );
          })}
        </div>
      )}
      {view.total > 0 ? (
        <div className="card sh-pager-card">
          <Pager view={view} server />
        </div>
      ) : null}

      <Dialog open={deleting !== null} tone="danger" title={deleting ? `Delete ${deleting.name}?` : ''} message={t.deleteBody} confirmLabel="Delete" busy={busy} onConfirm={() => void confirmDelete()} onCancel={() => setDeleting(null)} />
      <Dialog open={resetting !== null} icon="key" title={resetting ? t.resetTitle(resetting.name) : ''} message={t.resetBody} confirmLabel="Reset login" busy={busy} onConfirm={() => void confirmReset()} onCancel={() => setResetting(null)} />
    </Page>
  );
}