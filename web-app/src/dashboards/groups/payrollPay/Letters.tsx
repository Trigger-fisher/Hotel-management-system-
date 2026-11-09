'use client';

// Joining and experience letters (hotel.payroll.joiningLetter, hotel.payroll.experienceLetter): one template per company, then a letter for anyone.
import { useEffect, useState } from 'react';
import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { PDF_ROUTES, type DashError } from '@shared/dashboards/common';
import { letterPlaceholders, letterSectionDefs, type LetterKind, type LetterTemplate, type LetterTemplateInput, type PayrollCompanyRef } from '@shared/dashboards/payrollPay';
import { Bi, Dropdown, FieldHint, FormSection, Select, Textarea, Button, MayEdit } from '@/dashboards/pallav/ui';
import { useDebounced, useSubmit, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { EmptyState, PayLayout } from '../payrollCore/pms';
import { payApi } from './api';
import { PayPage, failText } from './shared';
import { Wait, useMockPdf } from '../payrollCore/load';

import { tr, trf } from '@/lib/i18n/language';
const COPY = {
  joining: {
    title: 'Joining letter',
    sub: (c: string) => `One letter for ${c}, written once. Each person's name, role and joining date are filled in when you create it.`,
    who: 'Staff member',
    choose: 'Choose a staff member…',
    nobody: { icon: 'people', title: 'No active staff yet', text: 'Add a staff member first; their joining letter is then one tap away.', label: 'Add staff member', view: 'hotel.payroll.staff' },
    signatoryHint: 'The name, designation and signature come from the company details.',
    prefix: 'jl',
  },
  experience: {
    title: 'Experience letter',
    sub: (c: string) => `One letter for ${c}, written once. A relieved person's dates, role and time with you are filled in when you create it.`,
    who: 'Former staff member',
    choose: 'Choose a former staff member…',
    nobody: { icon: 'person-check', title: 'Nobody has been relieved yet', text: 'An experience letter is for someone whose exit is recorded as Relieved.', label: 'Go to resignations', view: 'hotel.payroll.resignations' },
    signatoryHint: 'The name, designation and signature come from the company details.',
    prefix: 'el',
  },
} as const;

const SECTION_LOOK: Record<string, { label: string; id: string; rows: number }> = {
  introduction: { label: 'Introduction', id: 'jl_intro', rows: 4 },
  responsibilities: { label: 'Roles and responsibilities', id: 'jl_roles', rows: 3 },
  terms: { label: 'Terms and conditions', id: 'jl_terms', rows: 4 },
  'joining:closing': { label: 'Closing message', id: 'jl_closing', rows: 3 },
  acceptance: { label: 'What the person signs', id: 'jl_acc_body', rows: 3 },
  body: { label: 'Body', id: 'el_body', rows: 5 },
  conduct: { label: 'Conduct and performance', id: 'el_conduct', rows: 3 },
  'experience:closing': { label: 'Closing message', id: 'el_closing', rows: 2 },
};

/** A letter to start from when the company has none yet: Save keeps it, every word can be changed first. */
function starter(kind: LetterKind, company: string): { subject: string; texts: Record<string, string>; accHead: string; accClose: string } {
  if (kind === 'joining') {
    return {
      subject: '',
      accHead: 'Acceptance',
      accClose: 'Please sign and return one copy of this letter.',
      texts: {
        introduction: `Dear {EMPLOYEE_NAME},\nWe are pleased to appoint you as {DESIGNATION} in the {DEPARTMENT} department of ${company}, from {JOINING_DATE}.`,
        responsibilities: '{RESPONSIBILITIES}',
        terms: '1. Your salary is paid every month.\n2. Either side may end this appointment with one month\'s notice.\n3. You will follow the rules of the workplace.',
        closing: `We welcome you to ${company}.`,
        acceptance: 'I, {EMPLOYEE_NAME}, accept this appointment on the terms above.',
      },
    };
  }
  return {
    subject: 'Experience certificate',
    accHead: '',
    accClose: '',
    texts: {
      body: `This is to certify that {EMPLOYEE_NAME} worked with ${company} as {DESIGNATION} in the {DEPARTMENT} department from {JOINING_DATE} to {LAST_WORKING_DATE}, a period of {DURATION}.`,
      conduct: 'We found {EMPLOYEE_NAME} sincere and hard working.',
      closing: 'We wish {EMPLOYEE_NAME} every success.',
    },
  };
}

/** hotel.payroll.joiningLetter */
export const JoiningLetter = (p: ScreenProps) => <Letters {...p} kind="joining" />;
/** hotel.payroll.experienceLetter */
export const ExperienceLetter = (p: ScreenProps) => <Letters {...p} kind="experience" />;

function Letters({ user, navigate, kind }: ScreenProps & { kind: LetterKind }) {
  return <PayPage role={user.role} navigate={navigate}>{(company) => <Body company={company} kind={kind} navigate={navigate} />}</PayPage>;
}

interface Pick {
  id: string;
  label: string;
  preview: string;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

function Body({ company, kind, navigate }: { company: PayrollCompanyRef; kind: LetterKind; navigate: ScreenProps['navigate'] }) {
  const c = COPY[kind];
  const toast = useToast();
  const [tpl, setTpl] = useState<LetterTemplate | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [chosen, setChosen] = useState('');
  const [find, setFind] = useState('');
  const typed = useDebounced(find.trim(), 250);
  const [anyStaff, setAnyStaff] = useState<boolean | null>(null);
  const [kept, setKept] = useState<Pick | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [subject, setSubject] = useState('');
  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [useCo, setUseCo] = useState(true);
  const [sigName, setSigName] = useState<string | null>(null);
  const [accHead, setAccHead] = useState('');
  const [sigClose, setSigClose] = useState('');
  const [accClose, setAccClose] = useState('');
  const [failed, setFailed] = useState<DashError | null>(null);
  const onPdf = useMockPdf();
  const defs = letterSectionDefs[kind];
  const [last, setLast] = useState<{ id: string; key: string } | null>(null);
  const { busy: saving, errors, submit } = useSubmit(['subject', 'signatoryName', 'signatoryDesignation']);

  useEffect(() => {
    let live = true;
    void payApi.getLetterTemplate(company.id, kind).then((res) => {
      if (!live) return;
      if (!res.ok) {
        setFailed(res.error);
        return;
      }
      setFailed(null);
      const t = res.data;
      const s = starter(kind, company.name);
      setTpl(t);
      setSubject(t ? t.subject : s.subject);
      setName(t?.signatoryName ?? '');
      setDesignation(t?.signatoryDesignation ?? '');
      setUseCo(t?.useCompanySignatory ?? true);
      setSigName(t?.signatureImageName ?? null);
      setAccHead(t ? (t.acceptanceHeading ?? '') : s.accHead);
      setSigClose(t?.signatoryClosingText || `For ${company.name}`);
      setAccClose(t ? (t.acceptanceClosingText ?? '') : s.accClose);
      setTexts(Object.fromEntries(defs.map((d) => [d.id, t ? (t.sections.find((x) => x.id === d.id)?.text ?? '') : (s.texts[d.id] ?? '')])));
    });
    return () => {
      live = false;
    };
  }, [company.id, company.name, kind, version, defs]);

  useEffect(() => {
    let live = true;
    if (kind === 'joining') {
      void payApi.lookupStaff(company.id, { q: typed, limit: 50, activeOnly: true }).then((res) => {
        if (!live || !res.ok) return;
        setPicks(res.data.map((e) => ({ id: e.id, label: `${e.name} (${e.code})`, preview: `${e.name} (${e.code}) · ${e.designation || tr('No designation')}` })));
        if (typed === '') setAnyStaff(res.data.length > 0);
      });
    } else {
      void payApi.listSeparations(company.id, { tab: 'relieved', page: 1, pageSize: 500 }).then(
        (res) =>
          live &&
          res.ok &&
          setPicks(
            res.data.page.items
              .filter((x) => !x.rejoinedOn)
              .map((x) => {
                const label = x.employeeCode ? `${x.employeeName} (${x.employeeCode})` : x.employeeName;
                return { id: x.id, label, preview: `${label} · ${x.designation || tr('No designation')} · ${x.joiningDate ? formatDate(x.joiningDate) : '?'} to ${formatDate(x.lastWorkingDate)}` };
              }),
          ),
      );
    }
    return () => {
      live = false;
    };
  }, [company.id, kind, typed]);

  if (tpl === undefined) return <Wait error={failed} onRetry={() => setVersion((n) => n + 1)} tiles={false} />;
  const pick = picks.find((p) => p.id === chosen) ?? (kept?.id === chosen ? kept : undefined);
  const href = chosen ? (kind === 'joining' ? PDF_ROUTES.joiningLetter(company.id, chosen) : PDF_ROUTES.experienceLetter(company.id, chosen)) : undefined;
  const nobody = kind === 'joining' ? anyStaff === false : picks.length === 0;

  const inputOf = (): LetterTemplateInput => ({
    subject,
    sections: defs.map((d) => ({ id: d.id, label: d.label, text: texts[d.id] ?? '' })),
    signatoryName: name,
    signatoryDesignation: designation,
    useCompanySignatory: useCo,
    signatureImageName: sigName,
    acceptanceHeading: accHead,
    signatoryClosingText: sigClose,
    ...(kind === 'joining' ? { acceptanceClosingText: accClose } : {}),
  });
  const save = () =>
    void submit(
      () => payApi.saveLetterTemplate(company.id, kind, inputOf()),
      () => {
        toast.show({ tone: 'success', text: tpl ? tr('Letter saved.') : tr('Letter saved. You can create one for anyone now.') });
        setVersion((n) => n + 1);
      },
    );
  async function toggle() {
    const res = await payApi.toggleLetterTemplate(company.id, kind);
    if (res.ok) {
      toast.show({ tone: 'success', text: res.data.isActive ? tr('The letter is in use.') : tr('The letter is off.') });
      setVersion((n) => n + 1);
    } else toast.show({ tone: 'error', text: failText(res.error) });
  }
  async function remove() {
    if (!tpl) return;
    const snapshot = tpl;
    const input = inputOf();
    const res = await payApi.deleteLetterTemplate(company.id, kind);
    if (!res.ok) {
      toast.show({ tone: 'error', text: failText(res.error) });
      return;
    }
    setVersion((n) => n + 1);
    toast.show({
      tone: 'success',
      text: trf('{0} deleted.', [tr(c.title)]),
      action: {
        label: 'Undo',
        onClick: () =>
          void payApi.saveLetterTemplate(company.id, kind, input).then(async (r) => {
            if (r.ok && !snapshot.isActive) await payApi.toggleLetterTemplate(company.id, kind);
            if (!r.ok) toast.show({ tone: 'error', text: failText(r.error) });
            setVersion((n) => n + 1);
          }),
      },
    });
  }

  const valueOf = (key: string) => (key === 'subject' ? subject : key === 'accHead' ? accHead : key === 'sigClose' ? sigClose : key === 'accClose' ? accClose : (texts[key] ?? ''));
  const setValue = (key: string, v: string) => {
    if (key === 'subject') setSubject(v);
    else if (key === 'accHead') setAccHead(v);
    else if (key === 'sigClose') setSigClose(v);
    else if (key === 'accClose') setAccClose(v);
    else setTexts((p) => ({ ...p, [key]: v }));
  };
  const insert = (token: string) => {
    const at = last;
    const el = at ? (document.getElementById(at.id) as Field | null) : null;
    if (!at || !el) {
      toast.show({ tone: 'info', text: tr('Tap into a box of the letter first, then pick what to fill in.') });
      return;
    }
    const value = valueOf(at.key);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    setValue(at.key, value.slice(0, start) + token + value.slice(end));
    window.setTimeout(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    }, 0);
  };
  const rte = (key: string) => ({
    value: valueOf(key),
    onFocus: (e: { currentTarget: Field }) => setLast({ id: e.currentTarget.id, key }),
    onChange: (e: { target: { value: string } }) => setValue(key, e.target.value),
  });
  const look = (id: string) => SECTION_LOOK[id] ?? SECTION_LOOK[`${kind}:${id}`] ?? { label: id, id: `${c.prefix}_${id}`, rows: 3 };
  const contentIds = defs.map((d) => d.id).filter((id) => id !== 'acceptance');
  const toLetter = () => document.getElementById(`${c.prefix}_letter`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const steps = [
    { id: 'write', title: tr('Write the letter'), done: !!tpl, status: tpl ? trf('Saved {0}', [formatDateTime(tpl.updatedAt)]) : tr('A starter letter is filled in below. Change any word, then Save letter.'), act: tpl ? null : { label: tr('Review it'), run: toLetter } },
    { id: 'on', title: tr('Turn it on'), done: !!tpl?.isActive, status: !tpl ? tr('It is on once saved.') : tpl.isActive ? tr('In use.') : kind === 'joining' ? tr('Off: the appointment letter is not emailed to new staff.') : tr('Off.'), act: tpl && !tpl.isActive ? { label: tr('Turn it on'), run: () => void toggle() } : null },
  ];
  const ready = !!tpl?.isActive;

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: c.title }]}
      sub={c.sub(company.name)}
    >
      <div className="ha-stack">
        {!ready ? (
          <ol className="pl-steps" aria-label={trf('Set up the {0}', [tr(c.title).toLowerCase()])}>
            {steps.map((s, i) => (
              <li key={s.id} className={s.done ? 'is-done' : tpl && s.id === 'on' ? 'is-warn' : 'is-todo'}>
                <span className="pl-step-mark" aria-hidden="true">{s.done ? <Bi name="check-lg" /> : i + 1}</span>
                <span className="pl-step-text"><b>{s.title}</b><small>{s.status}</small></span>
                {s.act ? <MayEdit module="payroll"><Button size="sm" onClick={s.act.run}>{s.act.label}</Button></MayEdit> : null}
              </li>
            ))}
          </ol>
        ) : null}

        {tpl ? (
          <div className="card">
            <div className="card-header">{tr('Create a letter')}</div>
            <div className="card-body">
              {nobody ? (
                <EmptyState icon={c.nobody.icon} title={tr(c.nobody.title)} text={tr(c.nobody.text)}>
                  <Button variant="outline" onClick={() => navigate(c.nobody.view)} className="mt-3">{tr(c.nobody.label)}</Button>
                </EmptyState>
              ) : (
                <div className="row g-3 align-items-end">
                  <div className="col-md-7">
                    <label className="form-label" htmlFor={`${c.prefix}_who`}>{tr(c.who)}</label>
                    {kind === 'joining' ? (
                      <input type="search" className="form-control mb-2" placeholder={tr('Type a name or ID to narrow the list…')} aria-label={tr('Find a staff member')} value={find} onChange={(e) => setFind(e.target.value)} />
                    ) : null}
                    <Select
                      className="form-select"
                      id={`${c.prefix}_who`}
                      value={chosen}
                      onChange={(e) => {
                        setChosen(e.target.value);
                        setKept(picks.find((p) => p.id === e.target.value) ?? null);
                      }}
                    >
                      <option value="">{tr(c.choose)}</option>
                      {(kept && !picks.some((p) => p.id === kept.id) ? [kept, ...picks] : picks).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-md-5">
                    <a
                      className={`btn btn-p w-100 lt-go ${href ? '' : 'disabled'}`}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      aria-disabled={!href}
                      onClick={href && pick ? onPdf(`${c.title} for ${pick.label}`) : undefined}
                    >
                      <Bi name="file-earmark-pdf" /> {tr('Create letter')}
                    </a>
                  </div>
                  {pick ? (
                    <div className="col-12">
                      <div className="field-readonly">
                        <Bi name="eye" />
                        <span>{pick.preview}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="card" id={`${c.prefix}_letter`}>
          <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
            <span>{tr('The letter')}</span>
            {tpl ? (
              <span className="d-flex align-items-center gap-2">
                <MayEdit module="payroll">
                  <span className="form-check form-switch mb-0 lt-switch">
                    <input className="form-check-input" type="checkbox" role="switch" id={`${c.prefix}_on`} checked={tpl.isActive} onChange={() => void toggle()} />
                    <label className="form-check-label" htmlFor={`${c.prefix}_on`}>{tpl.isActive ? tr('In use') : tr('Off')}</label>
                  </span>
                </MayEdit>
                <MayEdit module="payroll">
                  <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={tr('More for the letter')} {...p}>{tr('More')}</Button>}>
                    <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); void remove(); }}><Bi name="trash" className="me-2" />{tr('Delete letter')}</a>
                  </Dropdown>
                </MayEdit>
              </span>
            ) : null}
          </div>
          <form
            className="card-body"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="lt-fill">
              <span className="lt-fill-lab">{tr('Fill in for each person')}</span>
              <div className="d-flex flex-wrap gap-2">
                {letterPlaceholders[kind].map((ph) => (
                  <Button variant="outline" size="sm" key={ph} onClick={() => insert(ph)} className="placeholder-chip">{ph}</Button>
                ))}
              </div>
              <FieldHint>{tr('Tap one to put it where the cursor is. It is replaced by the person\'s own details in each letter.')}</FieldHint>
            </div>

            {kind === 'joining' ? (
              <FormSection icon="building" title={tr('Letterhead')} hint={tr('From the company details, printed on every letter.')}>
                <div className="field-readonly">
                  <Bi name="lock" />
                  <span>
                    {company.name} · {company.address}
                    {company.mobile ? ` · ${company.mobile}` : ''}
                    {company.email ? ` · ${company.email}` : ''}
                  </span>
                </div>
              </FormSection>
            ) : null}

            <FormSection icon="card-text" title={tr('What it says')}>
              <div className="row g-3">
                {kind === 'experience' ? (
                  <div className="col-12">
                    <label className="form-label" htmlFor="el_subject">{tr('Subject')}</label>
                    <input id="el_subject" className={`form-control rte ${errors.subject ? 'is-invalid' : ''}`} {...rte('subject')} />
                    {errors.subject ? <div className="field-error">{errors.subject}</div> : null}
                  </div>
                ) : null}
                {contentIds.map((id) => {
                  const l = look(id);
                  return (
                    <div key={id} className="col-12">
                      <label className="form-label" htmlFor={l.id}>{tr(l.label)}</label>
                      <Textarea id={l.id} className="form-control rte" rows={l.rows} {...rte(id)} />
                    </div>
                  );
                })}
              </div>
            </FormSection>

            <FormSection icon="pen" title={tr('Signed by')}>
              <div className="form-check form-switch mb-3">
                <input className="form-check-input" type="checkbox" role="switch" id={`${c.prefix}_useco`} checked={useCo} onChange={(e) => setUseCo(e.target.checked)} />
                <label className="form-check-label" htmlFor={`${c.prefix}_useco`}>{tr('The company\'s signatory')}</label>
                <FieldHint>{useCo ? tr(c.signatoryHint) : tr('Type who signs this letter instead.')}</FieldHint>
              </div>
              {!useCo ? (
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label" htmlFor={`${c.prefix}_auth_name`}>{tr('Name')}</label>
                    <input id={`${c.prefix}_auth_name`} className={`form-control ${errors.signatoryName ? 'is-invalid' : ''}`} value={name} onChange={(e) => setName(e.target.value)} />
                    {errors.signatoryName ? <div className="field-error">{errors.signatoryName}</div> : null}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" htmlFor={`${c.prefix}_auth_desig`}>{tr('Designation')}</label>
                    <input id={`${c.prefix}_auth_desig`} className={`form-control ${errors.signatoryDesignation ? 'is-invalid' : ''}`} value={designation} onChange={(e) => setDesignation(e.target.value)} />
                    {errors.signatoryDesignation ? <div className="field-error">{errors.signatoryDesignation}</div> : null}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" htmlFor={`${c.prefix}_auth_sig`}>{tr('Signature')}</label>
                    <input type="file" id={`${c.prefix}_auth_sig`} className="form-control" accept="image/png,image/jpeg,image/webp" onChange={(e) => setSigName(e.target.files?.[0]?.name ?? sigName)} />
                    <FieldHint>{sigName ? <><Bi name="paperclip" /> {sigName}</> : tr('PNG, JPG or WebP, up to 4 MB.')}</FieldHint>
                  </div>
                </div>
              ) : null}
              <div className="mt-3">
                <label className="form-label" htmlFor={`${c.prefix}_auth_close`}>{tr('Line above the signature')}</label>
                <Textarea id={`${c.prefix}_auth_close`} className="form-control rte" rows={2} {...rte('sigClose')} />
              </div>
            </FormSection>

            {kind === 'joining' ? (
              <FormSection icon="check2-square" title={tr('What the person signs')} hint={tr('The part the new staff member signs and returns.')}>
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" htmlFor="jl_acc_head">{tr('Heading')}</label>
                    <input id="jl_acc_head" className="form-control rte" {...rte('accHead')} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" htmlFor="jl_acc_body">{tr('Text')}</label>
                    <Textarea id="jl_acc_body" className="form-control rte" rows={3} {...rte('acceptance')} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" htmlFor="jl_acc_close">{tr('Line under it')}</label>
                    <Textarea id="jl_acc_close" className="form-control rte" rows={2} {...rte('accClose')} />
                  </div>
                </div>
              </FormSection>
            ) : null}

            <div className="lt-foot">
              <MayEdit module="payroll"><Button type="submit" icon="check-lg" disabled={saving}>{tr('Save letter')}</Button></MayEdit>
            </div>
          </form>
        </div>
      </div>
    </PayLayout>
  );
}
