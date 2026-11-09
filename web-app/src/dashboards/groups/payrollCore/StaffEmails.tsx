'use client';

// Staff emails (hotel.payroll.staffEmails): send staff details to an approved address, then one card per email sent. Sending cards are polled.
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { formatDate, formatDateTime, formatTime } from '@shared/dashboards/format';
import { PDF_ROUTES, type DashError } from '@shared/dashboards/common';
import { STAFF_EMAIL_WATCH_MAX, type Employee, type EmailRecipient, type PayrollCompanyRow, type StaffEmail, type StaffEmailSummary } from '@shared/dashboards/payrollCore';
import { Bi, DateRangeField, DetailCard, DetailList, FilterBar, Pager, useTableView, FieldHint, RequiredMark, Select, Button, MayEdit, type DetailTone } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { useDebounced, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { payrollApi } from './api';
import { EmptyState, PayLayout, SearchField, initials } from './pms';
import { PayrollPage } from './shared';
import { PdfLink, StaleNote, Wait, fixed, istDay } from './load';
import { payToday } from '../payrollPay/api';

import { tr, trf } from '@/lib/i18n/language';
const POLL_MS = 4000;
const TODAY = payToday();
const STATE_LABEL: Record<string, string> = { sent: 'Sent', failed: 'Not sent', sending: 'Sending', stalled: 'Did not finish' };
const STATE_TONE: Record<string, DetailTone> = { sent: 'ok', failed: 'danger', sending: 'info', stalled: 'warn' };

/** hotel.payroll.staffEmails */
export function PayrollStaffEmails({ navigate, params }: ScreenProps) {
  return <PayrollPage navigate={navigate}>{(company) => <Body company={company} navigate={navigate} preselected={params.employee ? [params.employee] : []} />}</PayrollPage>;
}

function dayWord(iso: string): string {
  const date = istDay(iso);
  if (date === TODAY) return tr('Today');
  const y = new Date(`${TODAY}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (date === y.toISOString().slice(0, 10)) return tr('Yesterday');
  return formatDate(date);
}

function Body({ company, navigate, preselected }: { company: PayrollCompanyRow; navigate: ScreenProps['navigate']; preselected: string[] }) {
  const [status, setStatus] = useState<'' | 'sent' | 'sending' | 'failed'>('');
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed, 250);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [version, setVersion] = useState(0);
  const [items, setItems] = useState<StaffEmail[] | null>(null);
  const [summary, setSummary] = useState<StaffEmailSummary>({ total: 0, sent: 0, failed: 0, today: 0 });
  const [staff, setStaff] = useState<Employee[]>([]);
  const [recipients, setRecipients] = useState<EmailRecipient[] | null>(null);
  const [failed, setFailed] = useState<DashError | null>(null);
  const hasFilters = status !== '' || q !== '' || from !== '' || to !== '';

  useEffect(() => {
    let live = true;
    void payrollApi.listStaffEmails(company.id, { status: status || undefined, from: from || undefined, to: to || undefined, search: q, page: 1, pageSize: 500 }).then((res) => {
      if (!live) return;
      if (!res.ok) {
        setFailed(res.error);
        return;
      }
      setFailed(null);
      setItems(res.data.page.items);
      setSummary(res.data.summary);
    });
    return () => {
      live = false;
    };
  }, [company.id, status, from, to, q, version]);

  useEffect(() => {
    let live = true;
    void payrollApi.listEmployees(company.id, { pageSize: 1000 }).then((res) => live && res.ok && setStaff(res.data.items));
    void payrollApi.listRecipients(company.id).then((res) => live && res.ok && setRecipients(res.data));
    return () => {
      live = false;
    };
  }, [company.id]);

  const watching = (items ?? []).filter((e) => e.state === 'sending').slice(0, STAFF_EMAIL_WATCH_MAX).map((e) => e.id);
  const watchKey = watching.join(',');
  const poll = useEffectEvent(async () => {
    if (document.visibilityState !== 'visible') return;
    const res = await payrollApi.staffEmailFeed(company.id, { after: items?.[0]?.createdAt ?? '', watch: watching });
    if (!res.ok) return;
    setSummary(res.data.summary);
    setItems((prev) => {
      const byId = new Map(res.data.items.map((e) => [e.id, e]));
      const prevList = prev ?? [];
      const fresh = res.data.items.filter((e) => !prevList.some((p) => p.id === e.id));
      return [...fresh, ...prevList.map((e) => byId.get(e.id) ?? e)];
    });
  });
  useEffect(() => {
    if (!watchKey) return;
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [watchKey]);

  const all = useMemo(() => items ?? [], [items]);
  const view = useTableView(all, { perPage: 25 });

  const reset = () => {
    setStatus('');
    setTyped('');
    setFrom('');
    setTo('');
  };

  const sending = Math.max(0, summary.total - summary.sent - summary.failed);
  const tabs = [
    { id: '', label: tr('All'), icon: 'collection', count: summary.total },
    { id: 'sent', label: tr('Sent'), dot: 'settled' as const, count: summary.sent },
    ...(sending > 0 ? [{ id: 'sending', label: tr('Sending'), icon: 'arrow-repeat', count: sending }] : []),
    { id: 'failed', label: tr('Not sent'), dot: 'due' as const, count: summary.failed },
  ];

  const retry = () => setVersion((n) => n + 1);
  if (!items) return <Wait error={failed} onRetry={retry} />;

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Staff emails' }]}
      sub={trf('Send a staff record to an approved address. Every email sent from {0} stays here, with whether it went.', [company.name])}
      search={<SearchField bare value={typed} onChange={setTyped} placeholder={tr('Search staff, recipient, sender…')} label={tr('Search sent emails')} />}
    >
      <StaleNote error={failed} onRetry={retry} />
      <div className="ha-stack">
        <SendCard company={company} staff={staff} recipients={recipients} preselected={preselected} onSent={() => setVersion((n) => n + 1)} navigate={navigate} />

        {summary.total > 0 ? (
          <HomeStats
            stats={[
              { id: 'sent', label: tr('Sent'), value: summary.sent, format: (n) => String(Math.round(n)), note: trf('of {0} emails', [summary.total]) },
{ id: 'all', label: tr('All emails'), value: summary.total, format: (n) => String(Math.round(n)), note: tr('Ever sent') },
              { id: 'failed', label: tr('Not sent'), value: summary.failed, format: (n) => String(Math.round(n)), note: summary.failed > 0 ? tr('Open one for the reason') : tr('Every email went') },
              { id: 'today', label: tr('Today'), value: summary.today, format: (n) => String(Math.round(n)), note: formatDate(TODAY) },
            ]}
          />
        ) : null}

        {summary.total > 0 ? (
          <FilterBar
            tabs={tabs}
            active={status}
            onTab={(id) => setStatus(id as typeof status)}
            tabsLabel={tr('Emails by status')}
            summary={<>{tr('Showing')} <b>{all.length}</b> {tr('of')} {summary.total}</>}
            onReset={hasFilters ? reset : undefined}
          >
            <div className="bm-fbar-dates">
              <DateRangeField from={from} to={to} today={TODAY} onChange={(a, b) => { setFrom(a); setTo(b); }} />
            </div>
          </FilterBar>
        ) : null}

        {summary.total === 0 ? (
          <div className="card">
            <EmptyState icon="envelope-at" title={tr('Nothing sent yet')} text={tr('Choose staff above and send. Every email sent from here is kept on this page, with whether it went.')} />
          </div>
        ) : all.length === 0 ? (
          <div className="card">
            <EmptyState icon="search" title={tr('No matching emails')} text={tr('Try another tab, a wider date range, or another name.')}>
              <Button variant="outline" onClick={reset} className="mt-3">{tr('Clear filters')}</Button>
            </EmptyState>
          </div>
        ) : (
          <div>
            {view.rows.map((e) => (
              <EmailCard key={e.id} email={e} company={company} onResend={() => setVersion((n) => n + 1)} />
            ))}
            {view.pages > 1 ? <div className="card sh-pager-card"><Pager view={view} server /></div> : null}
          </div>
        )}
      </div>
    </PayLayout>
  );
}

function EmailCard({ email, company, onResend }: { email: StaffEmail; company: PayrollCompanyRow; onResend: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const state = email.state;
  const who = email.sentBy || tr('System');
  const bad = state === 'failed' || state === 'stalled';
  const label = tr(STATE_LABEL[state] ?? state);
  const dur = email.durationMs !== null ? (email.durationMs >= 1000 ? `${fixed(email.durationMs / 1000, 1)} s` : `${email.durationMs} ms`) : null;

  async function resend() {
    setBusy(true);
    const list = await payrollApi.listRecipients(company.id);
    const to = list.ok ? list.data.find((r) => r.email === email.recipientEmail) : undefined;
    const res = to ? await payrollApi.sendStaffEmails(company.id, [email.employeeId], to.id) : null;
    setBusy(false);
    if (res?.ok) {
      toast.show({ tone: 'success', text: res.data.message });
      onResend();
    } else toast.show({ tone: 'error', text: tr('That address is no longer on the Share recipients list. Choose another above.') });
  }

  return (
    <DetailCard
      label={trf('Email of {0} to {1}', [email.employeeName, email.recipientEmail])}
      warn={bad}
      lead={{ big: formatTime(email.createdAt), tag: dayWord(email.createdAt), title: formatDateTime(email.createdAt) }}
      facts={[
        { label: tr('Staff'), value: email.employeeName, sub: [email.employeeCode, email.designation].filter(Boolean).join(' · ') },
        { label: tr('Sent to'), value: email.recipientName || tr('Not on the list'), sub: email.recipientEmail },
        { label: tr('Sent by'), value: who },
      ]}
      amount={{ label: tr('Status'), value: <>{state === 'sending' ? <span className="spinner-border spinner-border-sm me-1" aria-hidden="true" /> : null}{label}</>, tone: STATE_TONE[state] }}
      sections={[
        {
          icon: 'envelope',
          title: tr('The email'),
          content: (
            <DetailList
              items={[
                { label: tr('Started'), value: formatDateTime(email.createdAt) },
                !!email.finishedAt && { label: tr('Finished'), value: formatDateTime(email.finishedAt ?? '') },
                !!dur && { label: tr('Took'), value: dur },
                !!email.subject && { label: tr('Subject'), value: email.subject },
                !!email.attachmentKb && { label: tr('Attachment'), value: `${email.employeeName}.pdf (${email.attachmentKb} KB)` },
              ]}
            />
          ),
        },
        {
          icon: bad ? 'exclamation-triangle' : 'check2-circle',
          title: tr('What happened'),
          tone: bad ? 'warn' : undefined,
          content:
            state === 'sending' ? (
              <p className="dc-none">{tr('Handing the email to the mail server…')}</p>
            ) : state === 'stalled' ? (
              <p className="dc-none">{tr('It started but never reported back, so it most likely did not go. Send it again to be sure.')}</p>
            ) : (
              <DetailList
                items={[
                  { label: tr('Result'), value: email.message || label },
                  !!email.error && { label: tr('Mail server said'), value: email.error },
                ]}
              />
            ),
        },
      ]}
      actions={
        <>
          <PdfLink className="btn btn-sm btn-outline-p" href={PDF_ROUTES.staffRecordSheet(company.id, email.employeeId)} doc={`Staff record of ${email.employeeName}`}>
            <Bi name="file-earmark-person" /> {tr('Staff record')}
          </PdfLink>
          {state !== 'sending' ? (
            <MayEdit module="payroll"><Button size="sm" variant={bad ? 'primary' : 'outline'} icon="arrow-clockwise" disabled={busy} onClick={() => void resend()}>{tr('Send again')}</Button></MayEdit>
          ) : null}
        </>
      }
    />
  );
}

function SendCard({ company, staff, recipients, preselected, onSent, navigate }: { company: PayrollCompanyRow; staff: Employee[]; recipients: EmailRecipient[] | null; preselected: string[]; onSent: () => void; navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>(preselected);
  const [recipient, setRecipient] = useState('');
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const term = find.trim().toLowerCase();
  const shown = staff.filter((e) => !term || `${e.name} ${e.employeeCode} ${e.designation} ${e.department}`.toLowerCase().includes(term));
  const chosen = recipient || recipients?.[0]?.id || '';
  const only = recipients && recipients.length === 1 ? recipients[0] : null;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function send() {
    setBusy(true);
    setError('');
    const res = await payrollApi.sendStaffEmails(company.id, picked, chosen);
    setBusy(false);
    if (res.ok) {
      toast.show({ tone: res.data.failed > 0 ? 'info' : 'success', text: res.data.message });
      setPicked([]);
      onSent();
    } else setError(Object.values(res.error.details?.fields ?? {})[0] ?? res.error.message ?? tr('The emails could not be sent. Try again.'));
  }

  return (
    <div className="card se-send" id="seSend">
      <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span>
          <Bi name="send" className="me-1" /> {tr('Send staff details')}
        </span>
        <span className="text-muted small">{tr('Each person\'s full staff record goes as a PDF.')}</span>
      </div>
      {recipients && recipients.length === 0 ? (
        <div className="card-body">
          <EmptyState icon="person-plus" title={tr('Nobody to send to yet')} text={tr('Staff details only go to addresses on the Share recipients list. Add the first address there.')}>
            <Button icon="person-plus" onClick={() => navigate('hotel.payroll.master')} className="mt-3">{tr('Add a recipient')}</Button>
          </EmptyState>
        </div>
      ) : (
        <form className="card-body" id="seForm" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <div className="row g-4">
            <div className="col-lg-8">
              <div className="se-pick-head">
                <span className="form-label mb-0">
                  {tr('1. Choose staff')}<RequiredMark />
                </span>
                <div className="search-field mb-0 se-pick-search">
                  <Bi name="search" />
                  <input type="search" className="form-control form-control-sm" placeholder={tr('Find by name, ID, designation…')} aria-label={tr('Find staff')} value={find} onChange={(e) => setFind(e.target.value)} />
                </div>
                <Button variant="outline" size="sm" onClick={() => setPicked((p) => [...new Set([...p, ...shown.map((x) => x.id)])])}>{tr('Select shown')}</Button>
                {picked.length > 0 ? <Button variant="ghost" size="sm" onClick={() => setPicked([])}>{tr('Clear')}</Button> : null}
              </div>
              <div className="se-pick" role="group" aria-label={tr('Staff to send')}>
                {staff.length === 0 ? <p className="text-muted small mb-0">{trf('No staff on {0}\'s payroll yet.', [company.name])}</p> : null}
                {shown.map((e) => (
                  <label key={e.id} className={`se-person ${e.isActive ? '' : 'is-inactive'}`}>
                    <input type="checkbox" checked={picked.includes(e.id)} onChange={() => toggle(e.id)} />
                    <span className="se-avatar">{initials(e.name)}</span>
                    <span className="se-person-text">
                      <span className="se-person-name">{e.name}</span>
                      <span className="se-person-meta">
                        {e.employeeCode}
                        {e.designation ? ` · ${e.designation}` : ''}
                      </span>
                    </span>
                    {!e.isActive ? <span className="se-tag">{tr('Inactive')}</span> : null}
                    <Bi name="check-circle-fill" className="se-tick" />
                  </label>
                ))}
                {staff.length > 0 && shown.length === 0 ? <p className="text-muted small mb-0 se-none-found">{tr('Nobody matches that search.')}</p> : null}
              </div>
            </div>
            <div className="col-lg-4">
              <label className="form-label" htmlFor="seRecipient">
                {tr('2. Send to')}<RequiredMark />
              </label>
              {only ? (
                <div className="se-only">
                  <b>{only.name}</b>
                  <small>{only.email}</small>
                </div>
              ) : (
                <Select id="seRecipient" className="form-select" required value={chosen} onChange={(e) => setRecipient(e.target.value)}>
                  {(recipients ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.email})
                    </option>
                  ))}
                </Select>
              )}
              <FieldHint>{tr('Only addresses approved in Payroll Master.')}</FieldHint>
              {error ? <div className="field-error" role="alert">{error}</div> : null}
              <Button icon="send" type="submit" disabled={picked.length === 0 || !chosen || busy} className="w-100 se-go mt-3">
                <span>{picked.length === 0 ? tr('Choose staff to send') : picked.length === 1 ? tr('Send 1 email') : trf('Send {0} emails', [picked.length])}</span>
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
