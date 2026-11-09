'use client';
// Website Settings, first card (decision 55): a three-step set-up (address, Sign in link, switch on) over the form (GET and PUT /website/site).
// Only those addresses may call HMS, and the website's Sign in button must open the link shown here. The list is replaced on save.
import { useState } from 'react';

import { MAX_SITE_DOMAINS, validateSiteDomains, type WebSite } from '@shared/dashboards/website';
import { useAction, useAsync, useToast } from '@/components/ui';
import { Bi, Button, FieldError, FieldHint, Loaded } from '@/dashboards/pallav/ui';
import { webApi } from './api';

import { tr, trf } from '@/lib/i18n/language';
export function SiteAccessCard() {
  const { state, reload } = useAsync(() => webApi.getSite(), []);
  return (
    <Loaded state={state} onRetry={reload} tiles={false}>
      {(site) => <SiteForm site={site} />}
    </Loaded>
  );
}

function SiteForm({ site }: { site: WebSite }) {
  const toast = useToast();
  const { busy, run } = useAction();
  const [saved, setSaved] = useState<WebSite>(site);
  const [live, setLive] = useState(site.live);
  const [rows, setRows] = useState<string[]>(site.domains.length ? site.domains : ['']);
  const [error, setError] = useState<string | undefined>();

  const list = rows.map((d) => d.trim()).filter(Boolean);
  const changed = live !== saved.live || list.join('|') !== saved.domains.join('|');

  function save() {
    const found = validateSiteDomains(rows);
    setError(found.domains);
    if (found.domains) return;
    void run(() => webApi.saveSite({ live, domains: list }), {
      success: live ? tr('Saved. The website is on.') : tr('Saved. The website is off.'),
      onFields: (f) => setError(f.domains),
      onOk: (next) => {
        setSaved(next);
        setLive(next.live);
        setRows(next.domains.length ? next.domains : ['']);
      },
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(saved.signInUrl);
      toast.show({ tone: 'success', text: 'Link copied.' });
    } catch {
      toast.show({ tone: 'error', text: 'Could not copy. Select the link and copy it by hand.' });
    }
  }

  return (
    <form
      className="card p-3 p-md-4 mb-3 reveal"
      style={{ maxWidth: 960 }}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset disabled={busy} className="form-section">
        <div className="fs-head">
          <div className="fs-title"><Bi name="globe2" /> {tr("Website address and switch")}</div>
          <div className="fs-hint">{tr("The hotel's website is hosted on its own and reads its rooms, rates and photos from here. Turn it on when the website is ready.")}</div>
        </div>

        <ol className="pl-steps mb-3" aria-label={tr('Set up the website')}>
          {[
            { id: 'addr', title: tr('Add the website address'), done: saved.domains.length > 0, status: saved.domains.length ? saved.domains.join(', ') : tr('The address the hotel\'s website runs on, such as www.thehotel.in.'), act: saved.domains.length ? null : { label: tr('Add the address'), run: () => document.getElementById('site_domain_0')?.focus() } },
            { id: 'link', title: tr('Put the Sign in link on the website'), done: false, status: tr('Give this link to whoever builds the website, for its Sign in button.'), act: { label: tr('Copy the link'), run: () => void copy() } },
            { id: 'live', title: tr('Turn the website on'), done: saved.live, status: saved.live ? tr('On: the addresses above can read the hotel.') : tr('Off: nobody outside can read the hotel yet.'), act: saved.live || !saved.domains.length ? null : { label: tr('Turn it on'), run: () => setLive(true) } },
          ].map((s, i) => (
            <li key={s.id} className={s.done ? 'is-done' : 'is-todo'}>
              <span className="pl-step-mark" aria-hidden="true">{s.done ? <Bi name="check-lg" /> : i + 1}</span>
              <span className="pl-step-text"><b>{s.title}</b><small>{s.status}</small></span>
              {s.act ? <Button size="sm" variant={s.id === 'link' ? 'outline' : undefined} onClick={s.act.run}>{s.act.label}</Button> : null}
            </li>
          ))}
        </ol>
        <div className="form-check form-switch mb-3">
          <input className="form-check-input" type="checkbox" role="switch" id="site_live" checked={live} onChange={(e) => setLive(e.target.checked)} />
          <label className="form-check-label" htmlFor="site_live"><strong>{tr("Website live")}</strong></label>
          <FieldHint>{tr("Off: nobody can read the hotel from outside EasyHotelSolutions. On: only the addresses below can.")}</FieldHint>
        </div>

        <label className="form-label" htmlFor="site_domain_0">{tr("Website addresses (up to")} {MAX_SITE_DOMAINS})</label>
        {rows.map((d, i) => (
          <div className="wa-recipient" key={i}>
            <input
              id={`site_domain_${i}`}
              className="form-control"
              maxLength={253}
              placeholder={tr("www.thehotel.in")}
              aria-label={trf("Website address {0}", [i + 1])}
              aria-invalid={error ? true : undefined}
              autoComplete="off"
              spellCheck={false}
              value={d}
              onChange={(e) => setRows((r) => r.map((x, n) => (n === i ? e.target.value : x)))}
            />
            <Button variant="outline" aria-label={trf("Remove address {0}", [i + 1])} onClick={() => setRows((r) => (r.length > 1 ? r.filter((_, n) => n !== i) : ['']))}>
              <Bi name="trash" />
            </Button>
          </div>
        ))}
        <FieldError>{error}</FieldError>
        <FieldHint>{tr("Only the address, like www.thehotel.in. Add the version without www too if the website answers on both.")}</FieldHint>
        {rows.length < MAX_SITE_DOMAINS ? (
          <Button variant="outline" size="sm" icon="plus-lg" onClick={() => setRows((r) => [...r, ''])}>{tr("Add an address")}</Button>
        ) : null}

        {live && list.length === 0 ? (
          <div className="alert alert-warning small mt-3 mb-0" role="note">{tr("The website is on but has no address yet, so no website can use it. Add the address above.")}</div>
        ) : null}

        <div className="mt-3">
          <label className="form-label" htmlFor="site_signin">{tr("Link for the website's Sign in button")}</label>
          <div className="d-flex gap-2 flex-wrap align-items-center">
            <input id="site_signin" className="form-control" style={{ flex: '1 1 320px' }} readOnly value={saved.signInUrl} onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" icon="clipboard" onClick={() => void copy()}>{tr("Copy")}</Button>
          </div>
          <FieldHint>{tr("Guests who press Sign in on the website land on EasyHotelSolutions with this hotel chosen for that visit only.")}</FieldHint>
        </div>
      </fieldset>

      <div className="d-flex justify-content-end mt-3">
        <Button icon="check2" type="submit" disabled={busy || !changed}>{busy ? tr("Saving…") : tr("Save")}</Button>
      </div>
    </form>
  );
}
