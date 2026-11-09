'use client';
// hotel.web.settings (Pallav: website/settings/edit.blade.php): how the hotel is reached, how it shows in search, who is told about
// enquiries. The website's mail account and Google keys are set up by the platform team in the Set-up centre (MJ, 5 Nov 2026); here only their status shows.
import { Fragment, useState, type ReactNode } from 'react';

import { validateSettings, type WebRecipient, type WebSettings, type WebSettingsInput } from '@shared/dashboards/website';
import { useAction, useAsync } from '@/components/ui';
import { Bi, EmptyState, FieldError, FieldHint, Loaded, RequiredMark, Button, Select, Textarea } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { webApi } from './api';
import { WaNav, readPicked } from './parts';
import { SiteAccessCard } from './SiteAccess';

import { tr } from '@/lib/i18n/language';
function toInput(s: WebSettings): WebSettingsInput {
  return {
    gmPhone: s.gmPhone, receptionPhone: s.receptionPhone, email: s.email,
    openedYear: s.openedYear, address: s.address, checkinTime: s.checkinTime, checkoutTime: s.checkoutTime,
    hotelMapUrl: '', metaTitle: s.metaTitle, metaDescription: s.metaDescription, metaKeywords: s.metaKeywords, gbpLink: s.gbpLink, facebookLink: s.facebookLink, instagramLink: s.instagramLink,
    recipients: s.recipients.length ? s.recipients.map((r) => ({ ...r })) : [{ name: '', email: '' }],
    smtpHost: s.smtpHost, smtpPort: s.smtpPort, smtpUsername: s.smtpUsername, newSmtpPassword: '', smtpFromEmail: s.smtpFromEmail, smtpFromName: s.smtpFromName,
    newGoogleMapsApiKey: '', googlePlaceId: s.googlePlaceId, googleMinReviewRating: s.googleMinReviewRating, gbpOauthClientId: s.gbpOauthClientId, newGbpOauthClientSecret: '',
    removeLogo: false, removeFavicon: false,
  };
}

export function WebsiteSettings({ navigate }: ScreenProps) {
  const [version, setVersion] = useState(0);
  const { state, reload } = useAsync(() => webApi.getSettings(), [version], { keep: true });
  return (
    <>
      <div className="page-head reveal">
        <div><p className="pms-sub">{tr("How the hotel is reached, how it shows in search and who is told about enquiries. The website's emails go out through the hotel's normal mail.")}</p></div>
      </div>

      <WaNav active="settings" navigate={navigate} />

      <SiteAccessCard />

      <Loaded state={state} onRetry={reload} tiles={false}>
        {(s) => <Body key={version} settings={s} onSaved={() => setVersion((n) => n + 1)} />}
      </Loaded>
    </>
  );
}

type TextKey = 'gmPhone' | 'receptionPhone' | 'email' | 'address' | 'checkinTime' | 'checkoutTime' | 'metaTitle' | 'metaKeywords' | 'gbpLink' | 'facebookLink' | 'instagramLink'
  | 'googlePlaceId' | 'smtpHost' | 'smtpUsername' | 'smtpFromEmail' | 'smtpFromName' | 'gbpOauthClientId' | 'hotelMapUrl' | 'newSmtpPassword' | 'newGoogleMapsApiKey' | 'newGbpOauthClientSecret';

function Body({ settings: s, onSaved }: { settings: WebSettings; onSaved: () => void }) {
  const [v, setV] = useState<WebSettingsInput>(() => toInput(s));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  // The picked logo / browser icon files; they are read (base64) when the form is saved.
  const [picked, setPicked] = useState<{ logo: File | null; favicon: File | null }>({ logo: null, favicon: null });
  const set = <K extends keyof WebSettingsInput>(k: K, x: WebSettingsInput[K]) => setV((p) => ({ ...p, [k]: x }));
  const text = (k: TextKey) => ({ value: v[k], onChange: (e: { target: { value: string } }) => set(k, e.target.value), 'aria-invalid': errors[k] ? true : undefined });
  const err = (k: string) => <FieldError>{errors[k]}</FieldError>;
  const setRecipient = (i: number, patch: Partial<WebRecipient>) => set('recipients', v.recipients.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const problems = Object.values(errors).filter(Boolean);

  async function save() {
    // Empty rows are dropped before saving; `kept` maps a saved row back to the row on screen, so an error names the right person.
    const kept = v.recipients.map((r, i) => (r.name.trim() || r.email.trim() ? i : -1)).filter((i) => i >= 0);
    const input: WebSettingsInput = { ...v, recipients: kept.map((i) => v.recipients[i] as WebRecipient) };
    const onScreen = (fields: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [k, msg] of Object.entries(fields)) {
        const m = /^recipient(\d+)$/.exec(k);
        if (!m) out[k] = msg;
        else {
          const row = kept[Number(m[1])] ?? Number(m[1]);
          out[`recipient${row}`] = `Person ${row + 1}: ${msg.charAt(0).toLowerCase()}${msg.slice(1)}`;
        }
      }
      return out;
    };
    const local = onScreen(validateSettings(input));
    // The picked files are read here (size checked before anything is sent).
    for (const field of ['logo', 'favicon'] as const) {
      const file = picked[field];
      if (!file) continue;
      const r = await readPicked(file, 'icon');
      if (r.ok) input[field] = r.file;
      else local[field] = r.error;
    }
    setErrors(local);
    if (Object.keys(local).length) return;
    void run(() => webApi.updateSettings(input), { success: 'Saved. The website follows straight away.', onFields: (f) => setErrors(onScreen(f)), onOk: onSaved });
  }

  const fileBox = (field: 'logo' | 'favicon', label: string, has: boolean, url: string | null | undefined, remove: 'removeLogo' | 'removeFavicon'): ReactNode => (
    <div className="col-md-6" key={field}>
      <label className="form-label" htmlFor={`s_${field}`}>{label}</label>
      {has ? (
        <div className="d-flex align-items-center gap-3 mb-2">
          {/* Pallav shows the saved picture here; the mock keeps no file, so its icon stands in. */}
          <span className="wa-icon-tile" style={{ width: 56, height: 56 }}>
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element -- a stored user upload behind the session, not a static asset
              <img src={url} alt="" style={{ maxWidth: 48, maxHeight: 48, objectFit: 'contain' }} />
            ) : (
              <Bi name="image" />
            )}
          </span>
          <label className="form-check small mb-0"><input type="checkbox" className="form-check-input" checked={Boolean(v[remove])} onChange={(e) => set(remove, e.target.checked)} /> <span className="form-check-label">{tr("Remove")}</span></label>
        </div>
      ) : null}
      <input id={`s_${field}`} type="file" className="form-control" accept=".jpg,.jpeg,.png,.webp,.gif,.svg,.ico" onChange={(e) => setPicked((p) => ({ ...p, [field]: e.target.files?.[0] ?? null }))} />
      {err(field)}
    </div>
  );
  // First use: nothing the guests see has been entered yet (the four required contact details are all empty).
  const firstUse = !s.gmPhone && !s.receptionPhone && !s.email && !s.address;
  const startHere = () => {
    const first = document.getElementById('s_gmPhone');
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    first?.focus({ preventScroll: true });
  };

  return (
    <>
      {firstUse ? (
        <div className="card reveal mb-3" style={{ maxWidth: 960 }}>
          <EmptyState icon="globe2" title={tr("Set up the hotel's website details")} text="These are the details the hotel's website and its enquiry emails show to guests. Start with the phone numbers, email and address, then choose who is told about enquiries.">
            <Button className="mt-3" icon="pencil-square" onClick={startHere}>{tr("Add contact details")}</Button>
          </EmptyState>
        </div>
      ) : null}
      {problems.length ? (
        <div className="alert alert-danger reveal" role="alert">{problems.map((p, i) => <div key={i}>{p}</div>)}</div>
      ) : null}

      <form
        className="reveal wst-form"
        style={{ maxWidth: 960 }}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>

          <div className="card p-3 p-md-4 mb-3">
            <div className="form-section">
              <div className="fs-head"><div className="fs-title"><Bi name="telephone" /> {tr("How guests reach the hotel")}</div><div className="fs-hint">{tr("Shown on every page of the website and in every email it sends.")}</div></div>
              <div className="row g-3">
                <div className="col-md-4"><label className="form-label" htmlFor="s_gmPhone">{tr("General manager phone")}<RequiredMark /></label><input id="s_gmPhone" className="form-control" maxLength={20} required {...text('gmPhone')} />{err('gmPhone')}</div>
                <div className="col-md-4"><label className="form-label" htmlFor="s_receptionPhone">{tr("Reception phone")}<RequiredMark /></label><input id="s_receptionPhone" className="form-control" maxLength={20} required {...text('receptionPhone')} />{err('receptionPhone')}</div>
                <div className="col-md-4"><label className="form-label" htmlFor="s_email">{tr("Email")}<RequiredMark /></label><input id="s_email" type="email" className="form-control" maxLength={150} required {...text('email')} />{err('email')}</div>
                <div className="col-md-4"><label className="form-label" htmlFor="s_openedYear">{tr("Opened in (year)")}<RequiredMark /></label><input type="number" className="form-control" min={1800} max={new Date().getFullYear() + 1} required value={Number.isNaN(v.openedYear) ? '' : v.openedYear} onChange={(e) => set('openedYear', Number.parseInt(e.target.value, 10))} />{err('openedYear')}</div>
                <div className="col-12"><label className="form-label" htmlFor="s_address">{tr("Address")}<RequiredMark /></label><input id="s_address" className="form-control" maxLength={255} required {...text('address')} />{err('address')}</div>
                <div className="col-md-6"><label className="form-label" htmlFor="s_checkinTime">{tr("Check-in time")}<RequiredMark /></label><input id="s_checkinTime" className="form-control" maxLength={20} required placeholder={tr("12:00 pm")} {...text('checkinTime')} />{err('checkinTime')}</div>
                <div className="col-md-6"><label className="form-label" htmlFor="s_checkoutTime">{tr("Check-out time")}<RequiredMark /></label><input id="s_checkoutTime" className="form-control" maxLength={20} required placeholder={tr("11:00 am")} {...text('checkoutTime')} />{err('checkoutTime')}</div>
              </div>
            </div>
          </div>

          <div className="card p-3 p-md-4 mb-3">
            <div className="form-section">
              <div className="fs-head"><div className="fs-title"><Bi name="geo-alt" /> {tr("The hotel on the map")}</div>
                <div className="fs-hint">{s.mapLat !== null ? `Pinned at ${s.mapLat}, ${s.mapLng}.` : tr("Not pinned yet: the map uses a rough point.")} {tr("Paste a new link only to move the pin.")}</div></div>
              <label className="form-label" htmlFor="s_hotelMapUrl">{tr("Hotel's Google Maps link")}</label>
              <input id="s_hotelMapUrl" type="url" className="form-control" maxLength={500} placeholder={tr("https://maps.app.goo.gl/...")} {...text('hotelMapUrl')} />
              {err('hotelMapUrl')}
              <FieldHint>{tr("Open the hotel on Google Maps, press Share and paste the link. It is also what nearby places measure their distance from.")}</FieldHint>
            </div>
          </div>

          <div className="card p-3 p-md-4 mb-3">
            <div className="form-section">
              <div className="fs-head"><div className="fs-title"><Bi name="search" /> {tr("Search engines and links")}</div><div className="fs-hint">{tr("Leave the search wording empty to use the website's own.")}</div></div>
              <div className="row g-3">
                <div className="col-12"><label className="form-label" htmlFor="s_metaTitle">{tr("Page title")}</label><input id="s_metaTitle" className="form-control" maxLength={255} {...text('metaTitle')} /></div>
                <div className="col-12"><label className="form-label" htmlFor="s_metaDescription">{tr("Description")}</label><Textarea id="s_metaDescription" className="form-control" rows={2} maxLength={2000} value={v.metaDescription} onChange={(e) => set('metaDescription', e.target.value)} /></div>
                <div className="col-12"><label className="form-label" htmlFor="s_metaKeywords">{tr("Keywords")}</label><input id="s_metaKeywords" className="form-control" maxLength={255} {...text('metaKeywords')} /></div>
                <div className="col-md-4"><label className="form-label" htmlFor="s_gbpLink">{tr("Google Business link")}</label><input type="url" className="form-control" maxLength={255} {...text('gbpLink')} />{err('gbpLink')}</div>
                <div className="col-md-4"><label className="form-label" htmlFor="s_facebookLink">{tr("Facebook")}</label><input type="url" className="form-control" maxLength={255} {...text('facebookLink')} />{err('facebookLink')}</div>
                <div className="col-md-4"><label className="form-label" htmlFor="s_instagramLink">{tr("Instagram")}</label><input type="url" className="form-control" maxLength={255} {...text('instagramLink')} />{err('instagramLink')}</div>
              </div>
            </div>
          </div>

          <div className="card p-3 p-md-4 mb-3">
            <div className="form-section">
              <div className="fs-head"><div className="fs-title"><Bi name="image" /> {tr("Logo and browser icon")}</div><div className="fs-hint">{tr("Without a logo the website shows its own monogram.")}</div></div>
              <div className="row g-3">
                {fileBox('logo', 'Logo', s.hasLogo, s.logoUrl, 'removeLogo')}
                {fileBox('favicon', 'Browser icon', s.hasFavicon, s.faviconUrl, 'removeFavicon')}
              </div>
            </div>
          </div>

          <div className="card p-3 p-md-4 mb-3">
            <div className="form-section">
              <div className="fs-head"><div className="fs-title"><Bi name="envelope" /> {tr("Who is told about enquiries")}</div><div className="fs-hint">{tr("Each person gets an email when an enquiry arrives, is confirmed or is cancelled, greeted by name.")}</div></div>
              <div>
                {v.recipients.map((r, i) => (
                  <Fragment key={i}>
                  <div className="wa-recipient">
                    <input className="form-control" maxLength={100} placeholder={tr("Name")} aria-label={tr("Name")} value={r.name} onChange={(e) => setRecipient(i, { name: e.target.value })} />
                    <input type="email" className="form-control" maxLength={150} placeholder={tr("email@example.com")} aria-label={tr("Email")} aria-invalid={errors[`recipient${i}`] ? true : undefined} title={errors[`recipient${i}`] || undefined} value={r.email} onChange={(e) => setRecipient(i, { email: e.target.value })} />
                    {/* The last row is emptied rather than removed, so there is always one to fill (website-admin.js). */}
                    <Button variant="danger" aria-label={tr("Remove")} onClick={() => set('recipients', v.recipients.length > 1 ? v.recipients.filter((_, n) => n !== i) : [{ name: '', email: '' }])}> <Bi name="trash" /></Button>
                  </div>
                  {err(`recipient${i}`)}
                  </Fragment>
                ))}
              </div>
              <Button variant="outline" size="sm" icon="plus-lg" onClick={() => set('recipients', [...v.recipients, { name: '', email: '' }])}>{tr("Add a person")}</Button>
            </div>
          </div>

          <div className="card p-3 p-md-4 mb-3">
            <div className="form-section">
              <div className="fs-head"><div className="fs-title"><Bi name="star" /> {tr("Google reviews")}</div>
                <div className="fs-hint">{s.googleStatus === 'connected' ? tr("Showing on the website. The platform team keeps this connected.") : tr("Not set up yet. The platform team connects Google reviews for your hotel.")}</div></div>
              <div className="row g-3">
                <div className="col-md-4"><label className="form-label" htmlFor="s_googleMinReviewRating">{tr("Lowest rating shown")}</label>
                  <Select id="s_googleMinReviewRating" className="form-select" value={v.googleMinReviewRating} onChange={(e) => set('googleMinReviewRating', Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} {n === 1 ? tr("star") : tr("stars")}</option>)}
                  </Select></div>
              </div>
            </div>
          </div>
        </fieldset>

        <div className="ha-sticky-foot ha-web-foot"><span className="text-muted small me-auto">{tr("The website shows changes as soon as they are saved.")}</span><Button icon="check2" type="submit" disabled={busy}>{busy ? tr("Saving…") : tr("Save website details")}</Button></div>
      </form>

    </>
  );
}
