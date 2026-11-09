'use client';

// Settings > WhatsApp > Messages (MJ, 4 and 5 Nov 2026): the hotel's own WhatsApp messages. Start from a ready-made message (every message HMS sends, in four
// languages) or write one; the blanks carry plain names ("Guest name") and a sample, the phone on the right shows exactly what the guest will read. Send it to Meta
// for approval, see Meta's decision, change a rejected one, remove one. Only an approved message can start a chat after the 24 hours. Nothing here sends to a guest.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DashError, DashResult } from '@shared/dashboards/common';
import { whatsappCopy as w } from '@shared/dashboards/whatsapp';
import {
  STARTER_FAMILIES,
  STARTER_LANGUAGES,
  STARTER_LANGUAGE_NAMES,
  STARTER_LINK_LABELS,
  VARIABLE_LABELS,
  WHATSAPP_STARTERS,
  starterByKey,
  starterDraft,
  variableLabel,
  type StarterFamily,
  type StarterLanguage,
  type StarterMessage,
} from '@shared/dashboards/whatsappStarters';

import { Alert, Button, EmptyState, Field, IconButton, Modal, SegTabs, Select, Skeleton, StatusChip, Textarea, type ChipTone } from '@/dashboards/pallav/ui';

import { insertBlank, renumberBlanks, templateParts, type Blank } from '../conversations/templateText';

import styles from './WhatsAppTemplates.module.css';
import { whatsappTemplatesApi, type TemplateButton, type TemplateCategory, type TemplateInput, type TemplateStatus, type TemplateView } from './whatsappTemplatesApi';

const TONE: Record<TemplateStatus, ChipTone> = { draft: 'neutral', pending: 'warn', approved: 'ok', rejected: 'danger', paused: 'neutral' };
const LABEL: Record<TemplateStatus, string> = { draft: 'Draft', pending: w.template.status.pending, approved: w.template.status.approved, rejected: w.template.status.rejected, paused: w.template.status.paused };
const EMPTY: TemplateInput = { name: '', language: 'en', category: 'utility', body: '', variables: [], buttons: [], starterKey: null };
const LANGUAGES: [string, string][] = [['en', 'English'], ['hinglish', 'Hinglish (Hindi in English letters)'], ['hi', 'Hindi'], ['gu', 'Gujarati']];
const KIND: Record<TemplateCategory, string> = { utility: 'Service message', marketing: 'Offer', authentication: 'Sign-in code' };
const BODY_MAX = 1024;
const BODY_ID = 'wa-tpl-body';
/** The blanks a receptionist adds most, with a sample each (all invented). */
const QUICK_BLANKS: { name: string; example: string }[] = [
  { name: 'guest_name', example: 'Riya Mehta' },
  { name: 'hotel_name', example: 'Kesar Bagh Residency' },
  { name: 'room', example: '204' },
  { name: 'check_in', example: '12 Nov 2026' },
  { name: 'check_out', example: '14 Nov 2026' },
  { name: 'Amount', example: '₹8,260.00' },
  { name: 'Booking number', example: 'BK-2611-0042' },
  { name: 'Link', example: 'https://easyhotel.in/p/Q8D3' },
];

const errorOf = (e: DashError): string => (e.details?.fields ? Object.values(e.details.fields).join(' ') || e.message : e.message);
const langName = (code: string): string => LANGUAGES.find(([c]) => c === code)?.[1].replace(/ \(.*\)$/, '') ?? code;
const isStarterLang = (code: string): code is StarterLanguage => (STARTER_LANGUAGES as readonly string[]).includes(code);
const titleOf = (t: Pick<TemplateView, 'name' | 'starterKey'>): string => {
  const s = starterByKey(t.starterKey) ?? starterByKey(t.name.replace(/^h[0-9a-f]{8}_/, '').replace(/_hl$/, ''));
  if (s) return s.title;
  const plain = t.name.replace(/_/g, ' ').trim();
  return plain ? plain[0].toUpperCase() + plain.slice(1) : 'Message';
};
/** A typed plain name back to the field HMS fills by itself ("Guest name" -> guest_name), else kept as typed. */
const nameOfLabel = (typed: string): string => Object.entries(VARIABLE_LABELS).find(([, label]) => label.toLowerCase() === typed.trim().toLowerCase())?.[0] ?? typed;
const blanksOf = (input: TemplateInput): Blank[] => input.variables.map((v) => ({ index: v.index, name: v.name, example: v.example }));

/** A ready-made message in a language as the form's input; a link button keeps its place with an empty link until the hotel gives its own. */
function inputOf(s: StarterMessage, lang: StarterLanguage, links: Partial<Record<string, string>> = {}): TemplateInput {
  const d = starterDraft(s, lang);
  const buttons: TemplateButton[] = s.buttons.map((b) => (b.kind === 'url' ? { kind: 'url', text: b.text[lang], url: (b.link && links[b.link]) || '' } : { kind: 'quick_reply', text: b.text[lang] }));
  return { name: d.name, language: lang, category: d.category, body: d.body, variables: d.variables, buttons, starterKey: s.key };
}

/** What the guest's phone shows: the hotel's chat, the message with the samples in the blanks, its buttons. */
function PhonePreview({ input }: { input: TemplateInput }) {
  const sorted = [...input.variables].sort((a, b) => a.index - b.index);
  const values = sorted.map((v) => v.example);
  const labels = sorted.map((v) => variableLabel(v.name));
  const hotel = input.variables.find((v) => v.name === 'hotel_name')?.example || 'Your hotel';
  const parts = templateParts(input.body.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, '{{$1}}'), values, labels);
  return (
    <div className={styles.phone} aria-label="What the guest sees">
      <div className={styles.screen}>
        <div className={styles.head}>
          <span className={styles.avatar} aria-hidden="true">{hotel.trim()[0]?.toUpperCase() ?? 'H'}</span>
          <div style={{ minWidth: 0 }}>
            <div className={styles.headName}>{hotel}</div>
            <div className={styles.headSub}>Business account</div>
          </div>
        </div>
        <div className={styles.chat}>
          {input.body.trim() === '' ? (
            <div className={`${styles.bubble} ${styles.placeholder}`}>Your message shows here as you write it.</div>
          ) : (
            <div className={styles.bubble}>
              {parts.map((p, i) => (p.kind === 'plain' ? <span key={i}>{p.text}</span> : <span key={i} className={p.kind === 'filled' ? styles.filled : styles.missing}>{p.text}</span>))}
              <span className={styles.time}>3:05 pm</span>
            </div>
          )}
          {input.buttons.map((b, i) => (
            <div key={i} className={styles.btn}>
              <i className={`bi bi-${b.kind === 'url' ? 'box-arrow-up-right' : 'reply'}`} aria-hidden="true" />
              {b.text || 'Button'}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.count}>{`${input.body.length} of ${BODY_MAX} characters`}</div>
    </div>
  );
}

export function WhatsAppTemplates() {
  const [items, setItems] = useState<TemplateView[] | null>(null);
  const [note, setNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<{ id: string | null; input: TemplateInput } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [family, setFamily] = useState<StarterFamily>('booking');
  const cursorAt = useRef<number | null>(null);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let on = true;
    void whatsappTemplatesApi.list().then((r) => {
      if (!on) return;
      if (r.ok) setItems(r.data);
      else setNote({ tone: 'danger', text: errorOf(r.error) });
    });
    return () => {
      on = false;
    };
  }, [attempt]);
  const load = useCallback(async (): Promise<void> => setAttempt((n) => n + 1), []);

  const act = async (key: string, run: () => Promise<DashResult<unknown>>, done: string): Promise<void> => {
    setBusy(key);
    const r = await run();
    setBusy(null);
    if (r.ok) {
      setNote({ tone: 'success', text: done });
      await load();
    } else setNote({ tone: 'danger', text: errorOf(r.error) });
  };

  const open = (id: string | null, input: TemplateInput): void => {
    setFormError(null);
    setForm({ id, input });
  };
  const set = (patch: Partial<TemplateInput>): void => setForm((f) => (f ? { ...f, input: { ...f.input, ...patch } } : f));

  const save = async (): Promise<void> => {
    if (!form) return;
    setFormError(null);
    const numbered = renumberBlanks(form.input.body, blanksOf(form.input));
    const input: TemplateInput = { ...form.input, body: numbered.body, variables: numbered.blanks };
    setBusy('save');
    const r = form.id ? await whatsappTemplatesApi.update(form.id, input) : await whatsappTemplatesApi.create(input);
    setBusy(null);
    if (!r.ok) return setFormError(errorOf(r.error));
    setForm(null);
    setNote({ tone: 'success', text: form.id ? 'The message is saved.' : 'The message is saved as a draft. Send it to Meta when it is ready.' });
    await load();
  };

  /** A new language for a ready-made message brings its words in that language, as long as the hotel has not changed them. */
  const changeLanguage = (lang: string): void => {
    if (!form) return;
    const s = starterByKey(form.input.starterKey);
    const prev = form.input.language;
    if (s && isStarterLang(lang) && isStarterLang(prev) && form.input.body === s.body[prev]) {
      const next = inputOf(s, lang);
      set({ language: lang, body: next.body, buttons: form.input.buttons.map((b, i) => ({ ...b, text: s.buttons[i] && b.text === s.buttons[i].text[prev] ? s.buttons[i].text[lang] : b.text })) });
    } else set({ language: lang });
  };

  const addBlank = (name: string, example: string): void => {
    if (!form) return;
    const at = cursorAt.current ?? form.input.body.length;
    const r = insertBlank(form.input.body, at, blanksOf(form.input), name, example);
    set({ body: r.body, variables: r.blanks });
    cursorAt.current = r.cursor;
    requestAnimationFrame(() => {
      const el = document.getElementById(BODY_ID);
      if (!(el instanceof HTMLTextAreaElement)) return;
      el.focus();
      el.setSelectionRange(r.cursor, r.cursor);
    });
  };
  const setBlank = (index: number, patch: Partial<Blank>): void => {
    if (!form) return;
    const all = renumberBlanks(form.input.body, blanksOf(form.input)).blanks;
    set({ variables: all.map((b) => (b.index === index ? { ...b, ...patch } : b)) });
  };
  const setButton = (i: number, b: TemplateButton | null): void => {
    if (!form) return;
    set({ buttons: b ? form.input.buttons.map((x, j) => (j === i ? b : x)) : form.input.buttons.filter((_x, j) => j !== i) });
  };

  const have = (key: string, lang: string): boolean => (items ?? []).some((t) => (t.starterKey === key || t.name === key) && t.language === lang);
  const starters = WHATSAPP_STARTERS.filter((s) => s.family === family);
  const blanks = form ? renumberBlanks(form.input.body, blanksOf(form.input)).blanks : [];
  const starter = form ? starterByKey(form.input.starterKey) : null;

  return (
    <div data-testid="wa-templates">
      {note ? (
        <Alert tone={note.tone} className="mb-2" action={<Button size="sm" variant="ghost" onClick={() => setNote(null)}>Dismiss</Button>}>
          {note.text}
        </Alert>
      ) : null}

      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Your messages</h3>
        <Button size="sm" variant="outline" icon="pencil-square" onClick={() => open(null, EMPTY)}>
          Write your own
        </Button>
      </div>
      {!items ? (
        <Skeleton rows={2} />
      ) : items.length === 0 ? (
        <EmptyState icon="patch-check" title={w.template.none} />
      ) : (
        items.map((t) => (
          <div key={t.id} className="cv-tpl-row">
            <div className="cv-tpl-row-main">
              <div className="cv-tpl-row-name">
                {titleOf(t)} <span className="cv-note-hint">· {KIND[t.category]} · {langName(t.language)}</span>
              </div>
              <div className="cv-tpl-row-text" style={{ whiteSpace: 'pre-line' }}>{t.body}</div>
              {t.buttons.length > 0 ? (
                <div className={styles.buttonsLine}>
                  {t.buttons.map((b, i) => (
                    <span key={i} className={styles.buttonChip}>
                      <i className={`bi bi-${b.kind === 'url' ? 'box-arrow-up-right' : 'reply'}`} aria-hidden="true" /> {b.text}
                    </span>
                  ))}
                </div>
              ) : null}
              {t.statusReason ? <div className="cv-note-hint">{t.statusReason}</div> : null}
              <div className="d-flex flex-wrap gap-2 mt-1">
                {t.editable ? (
                  <Button size="sm" variant="outline" icon="pencil" onClick={() => open(t.id, { name: t.name, language: t.language, category: t.category, body: t.body, variables: t.variables, buttons: t.buttons, starterKey: t.starterKey })}>
                    Edit
                  </Button>
                ) : null}
                {t.editable ? (
                  <Button size="sm" icon="send" busy={busy === `s-${t.id}`} onClick={() => void act(`s-${t.id}`, () => whatsappTemplatesApi.submit(t.id), 'Sent to Meta. It will show "Waiting for Meta" until Meta decides.')}>
                    Send to Meta
                  </Button>
                ) : null}
                {t.status === 'pending' ? (
                  <Button size="sm" variant="outline" icon="arrow-repeat" busy={busy === `c-${t.id}`} onClick={() => void act(`c-${t.id}`, () => whatsappTemplatesApi.check(t.id), "Meta's answer is read.")}>
                    Check Meta&rsquo;s answer
                  </Button>
                ) : null}
                <Button size="sm" variant="danger" icon="trash" busy={busy === `d-${t.id}`} onClick={() => void act(`d-${t.id}`, () => whatsappTemplatesApi.remove(t.id), 'The message is removed.')}>
                  Remove
                </Button>
              </div>
            </div>
            <StatusChip tone={TONE[t.status]}>{LABEL[t.status]}</StatusChip>
          </div>
        ))
      )}

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>Ready-made messages</h3>
          <span className="cv-note-hint">Pick one, check the words, save it and send it to Meta.</span>
        </div>
        <SegTabs tabs={STARTER_FAMILIES.map((f) => ({ id: f.id, label: f.title }))} active={family} onChange={(id) => setFamily(id as StarterFamily)} label="Kind of message" className="mb-2" />
        <div className={styles.starters}>
          {starters.map((s) => {
            const next = STARTER_LANGUAGES.find((l) => !have(s.key, l)) ?? 'en';
            return (
              <div key={s.key} className={styles.starter}>
                <div className={styles.starterTitle}>
                  {s.title} {s.category === 'marketing' ? <StatusChip tone="warn">Offer</StatusChip> : null}
                </div>
                <div className={styles.starterWhen}>{s.when}</div>
                <div className={styles.starterText}>{s.body.en.replace(/\{\{(\d{1,2})\}\}/g, (_m, n: string) => `[${variableLabel(s.variables[Number(n) - 1]?.name ?? '')}]`)}</div>
                <div className={styles.starterFoot}>
                  <div className={styles.langs} aria-label="Languages you have">
                    {STARTER_LANGUAGES.map((l) => (
                      <span key={l} className={`${styles.lang} ${have(s.key, l) ? styles.langOn : ''}`.trim()} title={have(s.key, l) ? 'You have this language' : 'Not added yet'}>
                        {STARTER_LANGUAGE_NAMES[l]}
                      </span>
                    ))}
                  </div>
                  <Button size="sm" icon="plus-circle" onClick={() => open(null, inputOf(s, next))}>
                    Use this
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Change the message' : starter ? starter.title : 'Write a message'}
        size="xl"
        staticBackdrop
        onSubmit={() => void save()}
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            <Button type="submit" busy={busy === 'save'}>Save</Button>
          </>
        }
      >
        {form ? (
          <div className={styles.layout}>
            <div className="row g-2">
              {formError ? <Alert tone="danger" className="mb-2">{formError}</Alert> : null}
              <Field label="Name" col="col-md-5" required>
                <input className="form-control" value={form.input.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="booking confirmed" />
              </Field>
              <Field label="Language" col="col-md-3">
                <Select value={form.input.language} onChange={(e) => changeLanguage(e.target.value)}>
                  {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Kind" col="col-md-4">
                <Select value={form.input.category} onChange={(e) => set({ category: e.target.value as TemplateCategory })}>
                  <option value="utility">Service message (booking, stay, bill)</option>
                  <option value="marketing">Offer (must say how to stop offers)</option>
                  <option value="authentication">Sign-in code</option>
                </Select>
              </Field>
              <Field label="Message" col="col-12" required>
                <Textarea id={BODY_ID} rows={8} value={form.input.body} maxLength={BODY_MAX} onChange={(e) => set({ body: e.target.value })} onSelect={(e) => (cursorAt.current = e.currentTarget.selectionStart)} placeholder="Hello [Guest name], your booking is confirmed." />
                <div className="fs-hint">Tap a field to put it where the cursor is. Start and end the message with words, not a field.</div>
                <div className={styles.blankChips}>
                  {QUICK_BLANKS.map((b) => (
                    <Button key={b.name} size="sm" variant="outline" icon="plus" onClick={() => addBlank(b.name, b.example)}>
                      {variableLabel(b.name)}
                    </Button>
                  ))}
                </div>
                {form.input.category === 'marketing' && !/\bSTOP\b/.test(form.input.body) ? <div className="fs-hint mt-1">End an offer with: Reply STOP to stop offers.</div> : null}
              </Field>

              {blanks.length > 0 ? (
                <div className="col-12">
                  <div className="form-label mb-1">Fields in the message</div>
                  <div className="d-grid gap-2">
                    {blanks.map((b) => (
                      <div key={b.index} className={styles.blankRow}>
                        <span className={styles.blankNo} title={`Shown to Meta as {{${b.index}}}`}>{b.index}</span>
                        <Field label="What goes here" col="">
                          <input className="form-control" value={VARIABLE_LABELS[b.name] ?? b.name} maxLength={40} onChange={(e) => setBlank(b.index, { name: nameOfLabel(e.target.value) })} placeholder="Guest name" />
                        </Field>
                        <Field label="Sample for Meta" col="" required>
                          <input className="form-control" value={b.example} maxLength={60} onChange={(e) => setBlank(b.index, { example: e.target.value })} placeholder="Riya Mehta" />
                        </Field>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="col-12">
                <div className="form-label mb-1">Buttons <span className="wz-optional">optional</span></div>
                <div className="d-grid gap-2">
                  {form.input.buttons.map((b, i) => {
                    const link = starter?.buttons[i]?.link;
                    return (
                      <div key={i} className={styles.buttonRow}>
                        <Field label="Button" col="">
                          <Select value={b.kind} onChange={(e) => setButton(i, e.target.value === 'url' ? { kind: 'url', text: b.text, url: '' } : { kind: 'quick_reply', text: b.text })}>
                            <option value="url">Opens a link</option>
                            <option value="quick_reply">Quick answer</option>
                          </Select>
                        </Field>
                        <Field label="Words on the button" col="">
                          <input className="form-control" value={b.text} maxLength={25} onChange={(e) => setButton(i, { ...b, text: e.target.value })} />
                        </Field>
                        {b.kind === 'url' ? (
                          <Field label={link ? STARTER_LINK_LABELS[link].label : 'Link (same for every guest)'} col="" required>
                            <input className="form-control" value={b.url} maxLength={2000} inputMode="url" onChange={(e) => setButton(i, { ...b, url: e.target.value })} placeholder="https://" />
                            {link ? <div className="fs-hint">{STARTER_LINK_LABELS[link].hint}</div> : null}
                          </Field>
                        ) : (
                          <div />
                        )}
                        <IconButton icon="x-lg" label="Remove this button" onClick={() => setButton(i, null)} />
                      </div>
                    );
                  })}
                </div>
                {form.input.buttons.length < 3 ? (
                  <Button size="sm" variant="ghost" icon="plus" className="mt-1" onClick={() => set({ buttons: [...form.input.buttons, { kind: 'quick_reply', text: '' }] })}>
                    Add a button
                  </Button>
                ) : null}
              </div>
            </div>
            <PhonePreview input={{ ...form.input, variables: blanks }} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
