'use client';
// hotel.web.content: the wording of the website's home page, one section at a time, with a live preview of that section beside it.
import { useState, type ReactNode } from 'react';

import { webContentSections, type WebContent, type WebContentField, type WebContentKey } from '@shared/dashboards/website';
import { useAction, useAsync, useToast } from '@/components/ui';
import { Bi, FieldError, FieldHint, FormSection, Loaded, RequiredMark, Button, Textarea, ListTabs } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { webApi } from './api';
import { RichText, WaNav, clean } from './parts';

import { tr, trf } from '@/lib/i18n/language';
type StrKey = Exclude<WebContentKey, 'enquirePoints'>;
const REMEMBER = 'websiteContentTab';
const sectionOf = (key: string) => webContentSections.find((s) => s.fields.some((f) => f.key === key))?.id;

function remembered(): string {
  try {
    const t = sessionStorage.getItem(REMEMBER);
    return t && webContentSections.some((s) => s.id === t) ? t : 'hero';
  } catch {
    return 'hero';
  }
}

export function WebsiteContentScreen({ navigate }: ScreenProps) {
  const { state, reload } = useAsync(() => webApi.getContent(), []);
  return (
    <>
      <div className="page-head reveal">
        <div><p className="pms-sub">{tr("The words on the website's home page. Pick a section, change the words and watch the preview; Save changes puts them live. Services, house rules and nearby places have their own pages.")}</p></div>      </div>

      <WaNav active="content" navigate={navigate} />

      <Loaded state={state} onRetry={reload} tiles={false}>
        {(content) => <Form initial={content} />}
      </Loaded>
    </>
  );
}

const html = (v: string) => ({ __html: clean(v) });

/** A short, faithful sketch of how the section reads on the website, in the page's own order. */
function Preview({ id, v, points }: { id: string; v: WebContent; points: string[] }) {
  const body: Record<string, ReactNode> = {
    hero: (
      <div className="wct-hero">
        <h3>{v.heroTitleLine1}<em>{v.heroTitleEmphasis}</em></h3>
        <div className="wct-rich" dangerouslySetInnerHTML={html(v.heroLead)} />
        <span className="wct-btn">{tr('Check availability')}</span>
      </div>
    ),
    check: (
      <>
        <b className="wct-title">{v.quickCheckTitle}</b>
        <div className="wct-fake"><span>{tr('Check-in')}</span><span>{tr('Check-out')}</span><span className="wct-btn">{tr('Check')}</span></div>
        <ul className="wct-msgs">
          <li>{v.qcMsgPickDates}</li>
          <li className="is-ok">{v.qcMsgAvailable}</li>
          <li className="is-bad">{v.qcMsgUnavailable}</li>
          <li className="is-bad">{v.qcMsgError}</li>
        </ul>
      </>
    ),
    about: (
      <>
        <small className="wct-kicker">{v.aboutKicker}</small>
        <h3>{v.aboutHeading}</h3>
        {[v.aboutP1, v.aboutP2, v.aboutP3].filter((p) => p.trim()).map((p, i) => <div key={i} className="wct-rich" dangerouslySetInnerHTML={html(p)} />)}
      </>
    ),
    enquire: (
      <>
        <h3>{v.enquireHeading}</h3>
        <div className="wct-rich" dangerouslySetInnerHTML={html(v.enquireLead)} />
        {points.length ? <ul className="wct-points">{points.map((p, i) => <li key={i}><Bi name="check2" /> {p}</li>)}</ul> : null}
        <span className="wct-link">{tr('I agree to the Terms & Conditions')}</span>
      </>
    ),
    messages: (
      <ul className="wct-msgs">
        {[v.fmMsgName, v.fmMsgPhone, v.fmMsgEmail, v.fmMsgCheckin, v.fmMsgCheckout, v.fmMsgRoom, v.fmMsgAdults, v.fmMsgChildren, v.fmMsgMessage, v.fmMsgTerms].map((m, i) => <li key={i} className="is-bad">{m}</li>)}
        <li className="is-ok">{v.fmMsgSuccess.replace('{{reference}}', 'ENQ-1024')}</li>
      </ul>
    ),
    policies: <div className="wct-rich wct-note" dangerouslySetInnerHTML={html(v.policiesFooterNote.replace('{{gm_phone}}', '<a>+91 98250 00000</a>'))} />,
    footer: <div className="wct-foot"><b>{tr('The hotel logo')}</b><div className="wct-rich" dangerouslySetInnerHTML={html(v.footerTagline)} /></div>,
  };
  return (
    <aside className="card wct-prev" aria-label={tr('Preview')}>
      <div className="wct-prev-head"><Bi name="eye" /> {tr('Preview')}<small>{tr('Updates as you type')}</small></div>
      <div className="wct-page">{body[id]}</div>
    </aside>
  );
}

function Form({ initial }: { initial: WebContent }) {
  const [saved, setSaved] = useState<WebContent>(initial);
  const [v, setV] = useState<WebContent>(initial);
  const [points, setPoints] = useState(initial.enquirePoints.join('\n'));
  const [tab, setTab] = useState(remembered);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reset, setReset] = useState(0);
  const { busy, run } = useAction();
  const toast = useToast();
  const pointList = points.split('\n').map((p) => p.trim()).filter(Boolean);
  const changedKeys = webContentSections.flatMap((s) => s.fields).filter((f) => (f.key === 'enquirePoints' ? pointList.join('\n') !== saved.enquirePoints.join('\n') : v[f.key] !== saved[f.key])).map((f) => f.key);
  const section = webContentSections.find((s) => s.id === tab) ?? webContentSections[0];

  const show = (id: string) => {
    setTab(id);
    try {
      sessionStorage.setItem(REMEMBER, id);
    } catch {
      /* storage may be off */
    }
  };
  const set = (k: StrKey, x: string) => {
    setV((p) => ({ ...p, [k]: x }));
    if (errors[k]) setErrors((p) => ({ ...p, [k]: '' }));
  };
  const discard = () => {
    const was = { v, points };
    setV(saved);
    setPoints(saved.enquirePoints.join('\n'));
    setErrors({});
    setReset((n) => n + 1);
    toast.show({
      tone: 'success',
      text: tr('Changes discarded.'),
      action: { label: 'Undo', onClick: () => { setV(was.v); setPoints(was.points); setReset((n) => n + 1); } },
    });
  };

  function save() {
    const next: WebContent = { ...v, enquirePoints: points.split('\n') };
    void run(() => webApi.updateContent(next), {
      success: 'Saved. The website follows straight away.',
      onFields: (f) => {
        setErrors(f);
        const bad = Object.keys(f).filter((k) => f[k]);
        const first = webContentSections.find((s) => bad.some((k) => sectionOf(k) === s.id));
        if (!first) return;
        if (first.id !== tab) show(first.id);
        const field = bad.find((k) => sectionOf(k) === first.id);
        if (field) setTimeout(() => document.getElementById(`c_${field}`)?.focus(), 60);
      },
      onOk: (d) => {
        setSaved(d);
        setV(d);
        setPoints(d.enquirePoints.join('\n'));
      },
    });
  }

  const field = (fd: WebContentField) => {
    const id = `c_${fd.key}`;
    const label = tr(fd.label);
    const hint = fd.hint ? <FieldHint>{tr(fd.hint)}</FieldHint> : null;
    const mark = fd.required ? <RequiredMark /> : <> <span className="wz-optional">{tr('optional')}</span></>;
    if (fd.kind === 'list') {
      return (
        <div className="mb-3" key={fd.key}>
          <label className="form-label" htmlFor={id}>{label}{mark}</label>
          <Textarea id={id} className="form-control" rows={5} value={points} onChange={(e) => setPoints(e.target.value)} />
          {hint}
        </div>
      );
    }
    const key = fd.key as StrKey;
    if (fd.kind === 'text') {
      return (
        <div className="mb-3 wa-rich" key={`${fd.key}-${reset}`}>
          <label className="form-label" id={`${id}_lab`} htmlFor={id}>{label}{mark}</label>
          <RichText id={id} invalid={!!errors[key]} value={v[key]} onChange={(x) => set(key, x)} label={label} />
          <FieldError>{errors[key]}</FieldError>
          {hint}
        </div>
      );
    }
    return (
      <div className="mb-3" key={fd.key}>
        <label className="form-label" htmlFor={id}>{label}{mark}</label>
        <input id={id} className="form-control" maxLength={fd.max} required={fd.required} value={v[key]} onChange={(e) => set(key, e.target.value)} aria-invalid={errors[key] ? true : undefined} />
        <FieldError>{errors[key]}</FieldError>
        {hint}
      </div>
    );
  };

  if (!section) return null;
  return (
    <form
      className="reveal ha-stack"
      id="contentForm"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <ListTabs
        id="contentTabs"
        label={tr('Section')}
        active={tab}
        onChange={show}
        tabs={webContentSections.map((s) => {
          const n = s.fields.filter((f) => changedKeys.includes(f.key)).length;
          return { id: s.id, label: tr(s.label), count: n || undefined, title: n ? trf('{0} not saved yet', [n]) : undefined };
        })}
      />

      <div className="wct-grid">
        <div className="card p-3 p-md-4">
          <FormSection icon="card-text" title={tr(section.title)} hint={tr(section.hint)}>
            {section.fields.map(field)}
          </FormSection>
        </div>
        <Preview id={section.id} v={v} points={pointList} />
      </div>

      <div className={`wct-save${changedKeys.length ? ' is-dirty' : ''}`} role="status">
        <span>{changedKeys.length ? trf('{0} not saved yet', [changedKeys.length === 1 ? tr('1 change') : trf('{0} changes', [changedKeys.length])]) : tr('Everything is saved')}</span>
        {changedKeys.length ? <Button variant="ghost" disabled={busy} onClick={discard}>{tr('Discard')}</Button> : null}
        <Button icon="check2" type="submit" disabled={busy || changedKeys.length === 0}>{busy ? tr('Saving…') : tr('Save changes')}</Button>
      </div>
    </form>
  );
}
