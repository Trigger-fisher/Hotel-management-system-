'use client';

// hotel.co.marketing - Campaigns: the one place for messages to the hotel's customers, with a channel switch (Email, WhatsApp) for those who may open WhatsApp.
// Email: the figures, the list of campaigns (a draft can be edited, tested and sent; a sent one shows how its mails went), and the compose card.
import { useState } from 'react';
import { formatDateTime } from '@shared/dashboards/format';
import { CAMPAIGN_BODY_MAX, CAMPAIGN_SUBJECT_MAX, blankCampaign, campaignAudienceOf, campaignAudiences, campaignText, companiesCopy } from '@shared/dashboards/companies';
import type { Campaign, CampaignEstimate, CampaignInput, CampaignStatus, MarketingOverview } from '@shared/dashboards/companies';
import { Bi, Button, DetailCard, Dialog, Dropdown, EmptyState, FieldHint, FilterBar, RequiredMark, SegTabs, StatusChip, Textarea } from '@/dashboards/pallav/ui';
import { WhatsAppCampaigns } from '../admin/WhatsAppCampaigns';
import { HomeStats } from '../overview/HomeJobs';
import type { ChipTone } from '@/dashboards/pallav/ui/StatusChip';
import { errorText, useSubmit, useToast } from '@/components/ui';
import { userMayEdit, userMayOpen } from '@shared/dashboards/features';
import type { ScreenProps } from '../../types';
import { api, useActor } from './api';
import { Page } from './pageParts';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';

import { tr, trf } from '@/lib/i18n/language';
const t = companiesCopy.marketing;
const STATUS_ICON: Record<CampaignStatus, string> = { draft: 'pencil', sending: 'send', paused: 'pause-circle', sent: 'send-check', cancelled: 'x-circle' };
const STATUS_TONE: Record<CampaignStatus, ChipTone> = { draft: 'neutral', sending: 'warn', paused: 'neutral', sent: 'ok', cancelled: 'danger' };
type Tab = 'all' | 'draft' | 'sending' | 'sent';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'sending', label: 'Sending' },
  { id: 'sent', label: 'Sent' },
];
const tabOf = (s: CampaignStatus): Exclude<Tab, 'all'> => (s === 'draft' ? 'draft' : s === 'sending' || s === 'paused' ? 'sending' : 'sent');

type Channel = 'email' | 'whatsapp';

export function MarketingScreen(props: ScreenProps) {
  const { user, params } = props;
  const whatsapp = userMayOpen('hotel.whatsapp') && user.role !== 'super_admin' && user.role !== 'platform_admin';
  const [channel, setChannel] = useState<Channel>(whatsapp && params.channel === 'whatsapp' ? 'whatsapp' : 'email');
  if (!whatsapp) return <EmailCampaigns {...props} />;
  return (
    <>
      <SegTabs
        className="mb-3 hu-channel reveal"
        label="Campaign channel"
        tabs={[{ id: 'email', label: 'Email', icon: 'envelope' }, { id: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' }]}
        active={channel}
        onChange={(id) => setChannel(id as Channel)}
      />
      {channel === 'email' ? <EmailCampaigns {...props} /> : <WhatsAppCampaigns />}
    </>
  );
}

function EmailCampaigns({ user }: ScreenProps) {
  const hotelName = user.hotel?.name ?? 'Your hotel';
  useActor(user);
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const loaded = useLoaded(() => api.marketing(), [version]);
  const data: MarketingOverview | null = loaded.data ?? null;
  const [form, setForm] = useState<{ campaign: Campaign | null } | null>(null);
  const [sending, setSending] = useState<Campaign | null>(null);
  // the confirmation shows what sending takes (how many, left out, how long): read when the dialog opens, and sent back as the confirmed number
  const [estimate, setEstimate] = useState<CampaignEstimate | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [cancelling, setCancelling] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const reload = () => setVersion((n) => n + 1);
  const mayEdit = userMayEdit('companies');

  async function askSend(c: Campaign) {
    setSending(c);
    setEstimate(null);
    const res = await api.estimateCampaign(c.id);
    if (res.ok) setEstimate(res.data);
    else {
      setSending(null);
      toast.show({ tone: 'error', text: errorText(res.error) });
    }
  }
  async function confirmSend() {
    if (!sending || !estimate) return;
    setBusy(true);
    const res = await api.sendCampaign(sending.id, estimate.recipients);
    setBusy(false);
    if (res.ok) {
      setSending(null);
      toast.show({ tone: 'success', text: t.sent(res.data.recipients) });
      reload();
      return;
    }
    toast.show({ tone: 'error', text: errorText(res.error) });
    // the audience changed since the estimate: show the new number and let the person confirm again
    if (res.error.code === 'CONFLICT') {
      const again = await api.estimateCampaign(sending.id);
      if (again.ok) setEstimate(again.data);
      else setSending(null);
    } else setSending(null);
  }
  async function act(c: Campaign, what: 'pause' | 'resume' | 'cancel') {
    setBusy(true);
    const res = what === 'pause' ? await api.pauseCampaign(c.id) : what === 'resume' ? await api.resumeCampaign(c.id) : await api.cancelCampaign(c.id);
    setBusy(false);
    setCancelling(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: what === 'pause' ? t.paused : what === 'resume' ? t.resumed : t.cancelled });
      reload();
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }
  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    const res = await api.deleteCampaign(deleting.id);
    setBusy(false);
    setDeleting(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: t.deleted });
      reload();
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }
  async function test(c: Campaign) {
    if (!data?.myEmail) {
      toast.show({ tone: 'error', text: t.noMyEmail });
      return;
    }
    const res = await api.testCampaign(c.id);
    if (res.ok) toast.show({ tone: 'success', text: t.tested(res.data.to) });
    else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  if (!data) return <Wait error={loaded.error} onRetry={loaded.reload} />;
  if (form) {
    return (
      <CampaignForm
        campaign={form.campaign}
        data={data}
        hotelName={hotelName}
        onBack={() => setForm(null)}
        onSaved={() => {
          setForm(null);
          reload();
        }}
        onTest={test}
      />
    );
  }
  const sentOnes = data.campaigns.filter((c) => c.status !== 'draft');
  const delivered = sentOnes.reduce((n, c) => n + c.delivered, 0);
  const counts: Record<Tab, number> = { all: data.campaigns.length, draft: 0, sending: 0, sent: 0 };
  for (const c of data.campaigns) counts[tabOf(c.status)] += 1;
  const shown = tab === 'all' ? data.campaigns : data.campaigns.filter((c) => tabOf(c.status) === tab);
  return (
    <Page
      sub={t.subtitle}
      headActions={
        mayEdit ? (
          <div className="co-head-actions">
            <Button icon="envelope-plus" onClick={() => setForm({ campaign: null })}>
              {t.add}
            </Button>
          </div>
        ) : undefined
      }
      grid={false}
    >
      <HomeStats
        stats={[
          { id: 'sent', label: t.kpi.sent, value: sentOnes.length, format: (n) => String(Math.round(n)), note: sentOnes[0]?.sentAt ? trf("Last {0}", [formatDateTime(sentOnes[0].sentAt)]) : tr("None yet") },
          { id: 'mails', label: t.kpi.emails, value: delivered, format: (n) => String(Math.round(n)), note: `${sentOnes.reduce((n, c) => n + c.pending, 0)} ${t.pending}, ${sentOnes.reduce((n, c) => n + c.failed, 0)} ${t.failed}` },
          { id: 'reach', label: t.kpi.reach, value: data.audience.all, format: (n) => String(Math.round(n)), note: trf("{0} customers · {1} companies · {2} guests", [data.audience.customers, data.audience.companies, data.audience.guests]) },
          { id: 'opt', label: t.kpi.optOuts, value: data.optOuts, format: (n) => String(Math.round(n)), note: tr("Never written to again") },
        ]}
      />
      <StaleNote error={loaded.error} onRetry={loaded.reload} />
      {!data.mailReady || data.held ? (
        <div className="hm-q hu-oneline hu-after-stats">
          <i className="hm-dot tone-warn" aria-hidden="true" />
          <div className="hm-q-text">
            <b>{!data.mailReady ? t.mailNotReady : data.held ? t.heldNote(data.held) : ''}</b>
            {!data.mailReady && data.held ? <small>{t.heldNote(data.held)}</small> : null}
          </div>
        </div>
      ) : null}
      <FilterBar
        tabs={TABS.map((x) => ({ id: x.id, label: x.label, count: counts[x.id] }))}
        active={tab}
        onTab={(id) => setTab(id as Tab)}
        summary={<><b>{shown.length}</b> {shown.length === 1 ? tr("campaign") : tr("campaigns")}</>}
        onReset={tab !== 'all' ? () => setTab('all') : undefined}
      />
      {shown.length === 0 ? (
        <div className="card reveal">
          <EmptyState icon="envelope-paper" title={tab === 'all' ? t.empty.title : tr("No campaigns here")} text={t.empty.body}>
            {mayEdit && tab !== 'sent' ? (
              <Button icon="envelope-plus" className="mt-3" onClick={() => setForm({ campaign: null })}>
                {t.add}
              </Button>
            ) : null}
          </EmptyState>
        </div>
      ) : (
        <div className="hu-dc-list reveal">
          {shown.map((c) => {
            const aud = campaignAudienceOf(c.audience);
            const reach = data.audience[c.audience];
            const draft = c.status === 'draft';
            const pct = c.recipients > 0 ? Math.round((c.delivered / c.recipients) * 100) : 0;
            const more: { id: string; icon: string; label: string; danger?: boolean; run: () => void }[] = mayEdit
              ? [
                  { id: 'test', icon: 'envelope-at', label: t.sendTest, run: () => void test(c) },
                  ...(draft ? [{ id: 'edit', icon: 'pencil-square', label: t.edit, run: () => setForm({ campaign: c }) }] : []),
                  ...(c.status === 'sending' || c.status === 'paused' ? [{ id: 'cancel', icon: 'x-circle', label: t.cancelSend, danger: true, run: () => setCancelling(c) }] : []),
                  ...(draft ? [{ id: 'delete', icon: 'trash', label: t.delete, danger: true, run: () => setDeleting(c) }] : []),
                ]
              : [];
            return (
              <DetailCard
                key={c.id}
                className="hu-dc hu-camp"
                label={c.subject}
                warn={c.failed > 0}
                lead={
                  <>
                    <span className={`hu-avatar hu-camp-ic is-${c.status}`} aria-hidden="true"><Bi name={STATUS_ICON[c.status]} /></span>
                    <StatusChip tone={STATUS_TONE[c.status]}>{t.status[c.status]}</StatusChip>
                  </>
                }
                facts={[
                  { label: t.columns.campaign, value: c.subject, sub: `${!draft && c.sentAt ? `${t.status[c.status]} · ${formatDateTime(c.finishedAt ?? c.sentAt)}` : `${t.status.draft} · ${formatDateTime(c.createdAt)}`}${c.createdBy ? ` · ${c.createdBy}` : ''}`, wide: true },
                  { label: t.columns.audience, value: <><Bi name={aud.icon} /> {aud.label}</>, sub: draft ? t.recipients(reach) : undefined },
                  { label: t.columns.reached, value: draft ? null : <span className="hu-meter"><span className="hu-meter-bar"><span style={{ width: `${pct}%` }} /></span>{c.delivered} / {c.recipients}</span>, sub: !draft && (c.failed || c.pending) ? [c.failed ? `${c.failed} ${t.failed}` : '', c.pending ? `${c.pending} ${t.pending}` : ''].filter(Boolean).join(', ') : undefined, empty: tr("Not sent yet") },
                ]}
                sections={[
                  { icon: 'envelope-paper', title: t.preview, wide: true, content: <pre className="mk-body">{campaignText(c.body, t.sampleName, hotelName)}</pre> },
                ]}
                meta={`${aud.hint}${!draft ? ` · ${t.progress(c.queued, c.recipients)}` : ''}${!draft && c.leftOut ? ` · ${t.leftOut(c.leftOut)}` : ''}`}
                actions={
                  <span className="hu-order-acts">
                    {mayEdit && draft ? (
                      <Button size="sm" icon="send" disabled={!data.mailReady || reach === 0} onClick={() => void askSend(c)}>{reach === 0 ? t.nobody : t.sendTo(reach)}</Button>
                    ) : mayEdit && c.status === 'sending' ? (
                      <Button variant="outline" size="sm" icon="pause-circle" disabled={busy} onClick={() => void act(c, 'pause')}>{t.pause}</Button>
                    ) : mayEdit && c.status === 'paused' ? (
                      <Button size="sm" icon="play-circle" disabled={busy} onClick={() => void act(c, 'resume')}>{t.resume}</Button>
                    ) : null}
                    {more.length > 0 && (
                      <Dropdown align="end" button={(p) => <Button variant="outline" size="sm" icon="three-dots" aria-label={trf("More for {0}", [c.subject])} {...p}>{tr("More")}</Button>}>
                        {more.map((m) => (
                          <a key={m.id} href="#" className={`dropdown-item${m.danger ? ' text-danger' : ''}`} onClick={(e) => { e.preventDefault(); m.run(); }}><Bi name={m.icon} /> {m.label}</a>
                        ))}
                      </Dropdown>
                    )}
                  </span>
                }
              />
            );
          })}
        </div>
      )}
      <Dialog
        open={sending !== null}
        icon="send"
        title={estimate ? t.confirmTitle(estimate.recipients) : t.estimating}
        message={
          estimate
            ? [t.duration(estimate), estimate.leftOut ? t.leftOut(estimate.leftOut) + '.' : '', estimate.held && data.held ? t.heldNote(data.held) : '', t.confirmBody].filter(Boolean).join(' ')
            : t.estimating
        }
        confirmLabel={t.confirm}
        busy={busy || estimate === null}
        onConfirm={() => void confirmSend()}
        onCancel={() => setSending(null)}
      />
      <Dialog open={cancelling !== null} tone="danger" icon="x-circle" title={t.cancelTitle} message={t.cancelBody} confirmLabel={t.cancelConfirm} cancelLabel={t.cancelKeep} busy={busy} onConfirm={() => cancelling && void act(cancelling, 'cancel')} onCancel={() => setCancelling(null)} />
      <Dialog open={deleting !== null} tone="danger" title={t.deleteTitle} message={t.deleteBody} confirmLabel={t.delete} busy={busy} onConfirm={() => void confirmDelete()} onCancel={() => setDeleting(null)} />
    </Page>
  );
}
/** The compose card: subject, audience (with how many it reaches), the message, and a live preview as one person would read it. */
function CampaignForm({ campaign, data, hotelName, onBack, onSaved, onTest }: { campaign: Campaign | null; data: MarketingOverview; hotelName: string; onBack: () => void; onSaved: () => void; onTest: (c: Campaign) => Promise<void> }) {
  const toast = useToast();
  const [v, setV] = useState<CampaignInput>(() => (campaign ? { subject: campaign.subject, body: campaign.body, audience: campaign.audience } : blankCampaign()));
  const { busy, errors, submit } = useSubmit(['subject', 'body', 'audience']);
  const set = <K extends keyof CampaignInput>(k: K, val: CampaignInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const cls = (k: string, base = 'form-control') => `${base} ${errors[k] ? 'is-invalid' : ''}`;

  function save(then?: (c: Campaign) => void) {
    void submit(
      () => (campaign ? api.updateCampaign(campaign.id, v) : api.createCampaign(v)),
      (c) => {
        if (then) void then(c);
        else {
          toast.show({ tone: 'success', text: campaign ? t.saved : t.created });
          onSaved();
        }
      },
    );
  }

  return (
    <Page
      sub={campaign ? 'Change the draft, then send a test to yourself.' : 'Write it as a personal email. Short, warm, one clear offer.'}
      headActions={
        <a href="#" className="btn btn-outline-p" onClick={(e) => { e.preventDefault(); onBack(); }}>
          <Bi name="arrow-left" /> {tr("Back")}
        </a>
      }
    >
      <form className="st-card reveal" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="st-head">
          <div className="st-icon">
            <Bi name="envelope-paper" />
          </div>
          <div>
            <h2 className="st-title">{campaign ? t.formEdit : t.formNew}</h2>
            <p className="st-about">{t.audienceHint}</p>
          </div>
        </div>

        <div className="st-grid">
          <div className="st-field wide">
            <label className="form-label" htmlFor="mk_subject">
              {t.subject}
              <RequiredMark />
            </label>
            <input id="mk_subject" className={cls('subject')} maxLength={CAMPAIGN_SUBJECT_MAX} value={v.subject} onChange={(e) => set('subject', e.target.value)} />
            <FieldHint>{t.subjectHint}</FieldHint>
            {errors.subject ? <div className="invalid-feedback">{errors.subject}</div> : null}
          </div>
          <div className="st-field wide">
            <span className="form-label">
              {t.audience}
              <RequiredMark />
            </span>
            <div className="mk-audience" role="radiogroup" aria-label={t.audience}>
              {campaignAudiences.map((a) => (
                <label key={a.id} className={`mk-choice ${v.audience === a.id ? 'on' : ''}`}>
                  <input type="radio" name="mk_audience" value={a.id} checked={v.audience === a.id} onChange={() => set('audience', a.id)} />
                  <Bi name={a.icon} />
                  <span className="mk-choice-text">
                    <strong>{a.label}</strong>
                    <small>{a.hint}</small>
                  </span>
                  <b className="mk-count">{data.audience[a.id]}</b>
                </label>
              ))}
            </div>
            {errors.audience ? <div className="invalid-feedback d-block">{errors.audience}</div> : null}
          </div>
          <div className="st-field wide">
            <label className="form-label" htmlFor="mk_body">
              {t.message}
              <RequiredMark />
            </label>
            <Textarea id="mk_body" rows={9} className={cls('body')} maxLength={CAMPAIGN_BODY_MAX} value={v.body} onChange={(e) => set('body', e.target.value)} />
            <FieldHint>
              {t.messageHint} {v.body.length}/{CAMPAIGN_BODY_MAX}
            </FieldHint>
            {errors.body ? <div className="invalid-feedback">{errors.body}</div> : null}
          </div>
          <div className="st-field wide">
            <span className="form-label">{t.preview}</span>
            <div className="mk-preview">
              <div className="mk-preview-head">
                <span className="mk-preview-lab">{t.previewFor}</span> {t.sampleName}
                <span className="mk-preview-subject">{v.subject || tr("(no subject yet)")}</span>
              </div>
              <pre className="mk-body">{campaignText(v.body || '…', t.sampleName, hotelName)}</pre>
              <p className="mk-preview-foot">
                -- {t.unsubscribeLine} {tr("(a link made for each person)")}
              </p>
            </div>
          </div>
        </div>

        <div className="st-foot">
          <a href="#" className="btn btn-ghost me-auto" onClick={(e) => { e.preventDefault(); onBack(); }}>
            {tr("Cancel")}
          </a>
          <Button type="button" variant="outline" icon="envelope-at" disabled={busy || !data.myEmail} title={data.myEmail ? `To ${data.myEmail}` : t.noMyEmail} onClick={() => save((c) => onTest(c).then(onSaved))}>
            {t.sendTest}
          </Button>
          <Button type="submit" icon="check2" disabled={busy}>
            {t.saveDraft}
          </Button>
        </div>
      </form>
    </Page>
  );
}
