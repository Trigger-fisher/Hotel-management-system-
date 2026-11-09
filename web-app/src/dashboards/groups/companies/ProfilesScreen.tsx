'use client';

// hotel.co.profiles - Company Profiles (Pallav: company/index.blade.php; the pop-up is CompanyForm.tsx). Each company is a shared DetailCard.
import { useMemo, useState } from 'react';
import { formatDateTime } from '@shared/dashboards/format';
import { companiesCopy, companyPlace, companyRates, formatPercent } from '@shared/dashboards/companies';
import type { CompanyProfile, CompanyStats } from '@shared/dashboards/companies';
import { Bi, Button, DetailCard, DetailList, DetailNone, Dialog, Pager, SearchField, useTableView, type DetailSection } from '@/dashboards/pallav/ui';
import { RecordHistory } from '../admin/RecordHistory';
import { errorText, useToast } from '@/components/ui';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { userMayEdit } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { EmptyState, initials } from '../payrollCore/pms';
import { HomeStats } from '../overview/HomeJobs';
import { api, isAdmin, useActor } from './api';
import { CompanyForm } from './CompanyForm';
import { Page } from './pageParts';
import { StaleNote, Wait, useLoaded, useMockPdf } from '../payrollCore/load';
import { limit, monthYear } from './screenKit';

import { tr } from '@/lib/i18n/language';
const t = companiesCopy.profiles;
const count = (n: number) => String(Math.round(n));

export function ProfilesScreen({ user }: ScreenProps) {
  useActor(user);
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const list = useLoaded(() => api.listCompanies({ page: 1, pageSize: 1000 }), [version]);
  const rows: CompanyProfile[] | null = list.data?.page.items ?? null;
  const stats: CompanyStats = list.data?.stats ?? { total: 0, withGst: 0, contacts: 0, addedThisMonth: 0 };
  const [form, setForm] = useState<{ company: CompanyProfile | null } | null>(null);
  const [deleting, setDeleting] = useState<CompanyProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const admin = isAdmin(user);
  const onPdf = useMockPdf();
  // Pallav: an Admin, or whoever added the company, may change it; deleting is Admins only.
  // Pallav compares user ids; CompanyProfile/Customer carry only the creator's name (no createdById in ui-shared, shared with the real
  // adapter), so the name is compared here. The server checks it again on every save.
  const canEdit = (c: CompanyProfile) => admin || c.createdBy === user.displayName;

  const all = useMemo(() => rows ?? [], [rows]);
  const view = useTableView(all, {
    perPage: 25,
    match: (c, q) => [c.name, c.gstNumber, c.email, c.mobile, c.phone, c.address, c.pincode, c.country, c.instruction, ...c.contacts.flatMap((p) => [p.name, p.email, p.mobile, p.role])].join(' ').toLowerCase().includes(q),
  });

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    const res = await api.deleteCompany(deleting.id);
    setBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: t.deleted(deleting.name) });
      setDeleting(null);
      setForm(null);
      setVersion((n) => n + 1);
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  const addButton = (
    userMayEdit('companies') && <Button icon="building-add" onClick={() => setForm({ company: null })}>
      {tr("Add company")}
    </Button>
  );
  const month = monthYear();

  if (!rows) return <Wait error={list.error} onRetry={list.reload} />;

  return (
    <Page
      sub="The companies you bill, with their tax details and the people to contact."
      headActions={
        <div className="co-head-actions">
          <SearchField wrapClass="cb-search" smart clear value={view.search} onChange={view.setSearch} placeholder={tr("Search companies…")} label={tr("Search companies")} title={tr("Tips: several words must all match, \"exact phrase\"")} />
          {addButton}
        </div>
      }
    >
      <HomeStats
        stats={[
          { id: 'total', label: 'Companies', value: stats.total, format: count, note: 'On record' },
          { id: 'gst', label: 'With a GST number', value: stats.withGst, format: count, note: `${stats.total - stats.withGst} without` },
          { id: 'people', label: 'People on file', value: stats.contacts, format: count, note: 'Across all companies' },
          { id: 'added', label: 'Added this month', value: stats.addedThisMonth, format: count, note: month },
        ]}
      />
      <StaleNote error={list.error} onRetry={list.reload} />
      {rows && view.total === 0 ? (
        <div className="card reveal">
          <EmptyState icon="buildings" title={view.search ? `No companies match "${view.search}"` : 'No companies added yet'} text="Add a company to keep its GST number, billing rates and contacts in one place.">
            {view.search ? (
              <Button variant="outline" className="mt-3" onClick={() => view.setSearch('')}>
                {tr("Clear search")}
              </Button>
            ) : (
              userMayEdit('companies') && <Button icon="building-add" className="mt-3" onClick={() => setForm({ company: null })}>
                {tr("Add company")}
              </Button>
            )}
          </EmptyState>
        </div>
      ) : (
        <div className="sh-day reveal">
          {view.rows.map((c) => {
            const people = c.contacts;
            const rates = companyRates(c);
            const place = companyPlace(c);
            const reach = [c.email, c.mobile, c.phone].filter(Boolean).join(' · ');
            const sections: DetailSection[] = [
              {
                icon: 'telephone', title: tr("How to reach them"),
                content: <DetailList items={[{ label: tr("Email"), value: c.email || '-' }, { label: tr("Mobile"), value: c.mobile || '-' }, { label: tr("Landline"), value: c.phone || '-' }]} />,
              },
              {
                icon: 'geo-alt', title: tr("Where they are"),
                content: (
                  <DetailList items={[
                    { label: tr("Address"), value: c.address || '-' },
                    { label: tr("Country"), value: c.country || '-' },
                    { label: tr("Pincode"), value: c.pincode || '-' },
                    { label: tr("Nationality"), value: c.nationality || '-' },
                  ]} />
                ),
              },
              {
                icon: 'percent', title: tr("Rates on their bills"), count: rates.length,
                content: rates.length ? (
                  <div className="co-rate-chips">
                    {rates.map((r) => (
                      <span key={r.label} className="cb-chip">
                        {r.label} {formatPercent(r.value)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <DetailNone>{tr("No rates set.")}</DetailNone>
                ),
              },
              {
                icon: 'people', title: tr("People to contact"), count: people.length,
                content: people.length ? (
                  <ul className="sh-points">
                    {people.map((p, i) => (
                      <li key={i}>
                        <strong>{p.name || p.email}</strong>
                        {p.role ? <span className="co-role">{p.role}</span> : null}
                        {p.email || p.mobile ? <div className="co-sub">{[p.email, p.mobile].filter(Boolean).join(' · ')}</div> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <DetailNone>{tr("Nobody on file.")}</DetailNone>
                ),
              },
            ];
            if (c.instruction) {
              sections.push({ icon: 'chat-left-text', title: tr("Instruction"), tone: 'warn', wide: true, content: <ul className="sh-points warn"><li>{c.instruction}</li></ul> });
            }
            return (
              <DetailCard className="hu-dc"
                key={c.id}
                label={`${tr("Company")} ${c.name}`}
                warn={!!c.instruction}
                lead={
                  <span className="co-avatar" aria-hidden="true">
                    {initials(c.name)}
                  </span>
                }
                facts={[
                  { label: tr("Company"), value: c.name, sub: c.gstNumber ? `GST ${c.gstNumber}` : tr("No GST number") },
                  { label: tr("Where"), value: place ? limit(place, 70) : null, title: place, text: true, wide: true, empty: tr("Not given") },
                  { label: tr("Contact"), value: reach ? limit(reach, 70) : null, title: reach, text: true, wide: true, empty: tr("Not given") },
                  { label: tr("People"), count: people.length, value: people.length ? limit(people[0]?.name || people[0]?.email || '', 40) : null, text: true },
                ]}
                amount={{ label: tr("Rates"), value: rates.length ? `${rates.length} ${rates.length === 1 ? 'rate' : 'rates'}` : tr("None"), tone: rates.length ? undefined : 'muted' }}
                sections={sections}
                meta={<>{tr("Added")} {formatDateTime(c.createdAt)}</>}
                actions={
                  <>
                    <a className="btn btn-sm btn-outline-p" href={PDF_ROUTES.companyProfile(c.id)} target="_blank" rel="noreferrer" title={tr("Open the PDF")} onClick={onPdf(`Company profile of ${c.name}`)}>
                      <Bi name="file-earmark-pdf" /> {tr("View")}
                    </a>
                    {canEdit(c) && userMayEdit('companies') ? (
                      <Button variant="outline" size="sm" icon="pencil-square" onClick={() => setForm({ company: c })}>
                        {tr("Edit")}
                      </Button>
                    ) : null}
                    {admin && userMayEdit('companies') ? (
                      <Button variant="danger" size="sm" icon="trash" onClick={() => setDeleting(c)}>
                        {tr("Delete")}
                      </Button>
                    ) : null}
                  </>
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

      {form ? (
        <CompanyForm
          key={form.company?.id ?? 'new'}
          company={form.company}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setVersion((n) => n + 1);
          }}
          onDelete={admin && form.company ? () => setDeleting(form.company) : undefined}
          onOpenExisting={(id) => {
            // "Already in your hotel": the company's own form opens in place of this one
            const existing = rows.find((r) => r.id === id);
            if (existing) setForm({ company: existing });
          }}
        />
      ) : null}
      <Dialog open={deleting !== null} tone="danger" title={deleting ? t.deleteTitle(deleting.name) : ''} message="This company profile will be removed and cannot be restored." confirmLabel="Delete" busy={busy} onConfirm={() => void confirmDelete()} onCancel={() => setDeleting(null)} />
    </Page>
  );
}
