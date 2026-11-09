'use client';

// The template picker (decision 66; MJ's WhatsApp design of 5 Nov 2026): once 24 hours have passed since the guest last wrote, WhatsApp allows only a message
// Meta approved. The approved templates are listed by name; the preview shows the message as it will go, with the blanks HMS filled from the booking marked
// and the others typed in; an English / Hindi / Gujarati switch picks the approved version in that language where one exists. The combined inbox's reply
// box uses the same piece without the Cancel button.
import { Fragment, useId, useState } from 'react';

import { whatsappCopy as w, type WhatsAppTemplate } from '@shared/dashboards/whatsapp';

import { Alert, Button, SegTabs } from '@/dashboards/pallav/ui';

import { langOf, templateParts } from './templateText';

export { fillTemplate } from './templateText';
export type TemplateDefaults = Partial<Record<NonNullable<WhatsAppTemplate['variables'][number]['source']>, string>>;
export type TemplateLanguage = keyof typeof w.desk.languages;
const LANGUAGES: readonly TemplateLanguage[] = ['en', 'hi', 'gu'];

/** "Guest name", "Guest name and Room", "Guest name, Room and Check-in". */
const listOf = (names: string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${w.template.and} ${names[names.length - 1]}`);

const languageWord = (code: string): string => (w.desk.languages as Record<string, string>)[code] ?? code;
const plainName = (name: string): string => name.replace(/_/g, ' ');

export function TemplatePicker({
  templates,
  defaults,
  draftKept,
  disabled,
  busy,
  onSend,
  onCancel,
}: {
  templates: WhatsAppTemplate[];
  defaults: TemplateDefaults;
  /** The window closed while a draft was being typed: say the text is kept. */
  draftKept: boolean;
  disabled: boolean;
  busy: boolean;
  onSend: (templateId: string, variables: string[]) => void;
  /** Given, a quiet Cancel closes the picker (the desk's pop-over and the phone's sheet). */
  onCancel?: () => void;
}) {
  const id = useId();
  const approved = templates.filter((t) => t.status === 'approved');
  const names = [...new Set(approved.map((t) => t.name))];
  const valuesFor = (t: WhatsAppTemplate | undefined) => (t ? t.variables.map((v) => (v.source ? (defaults[v.source] ?? '') : '')) : []);
  const [name, setName] = useState(names[0] ?? '');
  const [lang, setLang] = useState(() => {
    const first = approved.find((t) => t.name === names[0]);
    return first ? langOf(first) : 'en';
  });
  const versions = approved.filter((t) => t.name === name);
  const tpl = versions.find((t) => langOf(t) === lang) ?? versions[0];
  const [edits, setEdits] = useState<{ id: string; values: string[] }>(() => ({ id: tpl?.id ?? '', values: valuesFor(tpl) }));
  // another version: its own blanks, filled again from the booking (adjusted while rendering, not in an effect)
  if (tpl && edits.id !== tpl.id) setEdits({ id: tpl.id, values: valuesFor(tpl) });
  const values = tpl && edits.id === tpl.id ? edits.values : valuesFor(tpl);
  const labels = tpl ? tpl.variables.map((v) => v.label) : [];
  const missing = tpl ? tpl.variables.filter((_, i) => !(values[i] ?? '').trim()).map((v) => v.label) : [];
  const filled = tpl ? tpl.variables.filter((v, i) => v.source && (values[i] ?? '').trim()).length : 0;

  if (!approved.length) return <Alert tone="neutral">{w.template.none}</Alert>;
  return (
    <div className="wa-tpl-body">
      {draftKept ? <Alert tone="warning">{w.window.draftKept}</Alert> : null}
      <div className="wa-tpl-grid">
        <ul className="wa-tpl-list" role="listbox" aria-label={w.template.pick}>
          {names.map((n) => {
            const vs = approved.filter((t) => t.name === n);
            const on = n === name;
            return (
              <li
                key={n}
                role="option"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                aria-disabled={disabled || undefined}
                className={`wa-tpl-item${on ? ' is-on' : ''}`}
                onClick={() => !disabled && setName(n)}
                onKeyDown={(e) => {
                  if (disabled) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setName(n);
                  }
                }}
              >
                <b>{plainName(n)}</b>
                <span>{w.template.category[vs[0].category]} · {vs.map((v) => languageWord(langOf(v))).join(' / ')}</span>
              </li>
            );
          })}
        </ul>
        <div className="wa-tpl-prev">
          <div className="wa-tpl-head">
            <span className="t-label">{w.template.preview}</span>
            <SegTabs
              className="wa-tpl-lang"
              label={w.desk.language}
              active={LANGUAGES.includes(lang as TemplateLanguage) ? lang : (tpl ? langOf(tpl) : 'en')}
              onChange={(l) => {
                if (versions.some((v) => langOf(v) === l)) setLang(l);
              }}
              tabs={LANGUAGES.map((l) => ({ id: l, label: w.desk.languages[l] }))}
            />
          </div>
          {tpl ? (
            <>
              <div className="wa-tpl-bubble" lang={langOf(tpl)}>
                {templateParts(tpl.text, values, labels).map((p, i) => (p.kind === 'plain' ? <Fragment key={i}>{p.text}</Fragment> : <var key={i} className={p.kind === 'missing' ? 'is-missing' : undefined}>{p.text}</var>))}
              </div>
              {LANGUAGES.some((l) => !versions.some((v) => langOf(v) === l)) ? (
                <div className="wa-tpl-meta">{LANGUAGES.filter((l) => !versions.some((v) => langOf(v) === l)).map((l) => w.desk.noLanguage.replace('{language}', w.desk.languages[l])).join(' · ')}</div>
              ) : null}
              {tpl.variables.some((v, i) => !v.source || !(values[i] ?? '').trim()) ? (
                <div className="wa-tpl-vars">
                  {tpl.variables.map((v, i) =>
                    v.source && (values[i] ?? '').trim() ? null : (
                      <div key={v.index}>
                        <label className="form-label" htmlFor={`${id}-v${v.index}`}>{v.label}</label>
                        <input
                          id={`${id}-v${v.index}`}
                          className="form-control form-control-sm"
                          value={values[i] ?? ''}
                          disabled={disabled}
                          required
                          aria-describedby={missing.length ? `${id}-missing` : undefined}
                          maxLength={1000}
                          onChange={(e) => setEdits((cur) => ({ id: tpl.id, values: (cur.id === tpl.id ? cur.values : values).map((x, j) => (j === i ? e.target.value : x)) }))}
                        />
                      </div>
                    ),
                  )}
                </div>
              ) : null}
              <div className="wa-tpl-meta">
                {filled ? w.desk.filledFrom.replace('{n}', String(filled)) : w.desk.filledNone} · {w.template.charge.replace('{category}', w.template.category[tpl.category])}
              </div>
            </>
          ) : null}
          <div className="wa-tpl-foot">
            {missing.length ? <span className="cv-reply-hint" id={`${id}-missing`}>{w.template.fillIn.replace('{fields}', listOf(missing))}</span> : null}
            <span className="cv-grow" />
            {onCancel ? <Button variant="ghost" size="sm" onClick={onCancel}>{w.desk.cancel}</Button> : null}
            <Button size="sm" icon="send" busy={busy} disabled={disabled || !tpl || values.some((x) => !x.trim())} onClick={() => tpl && onSend(tpl.id, values.map((x) => x.trim()))}>
              {w.template.send}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
