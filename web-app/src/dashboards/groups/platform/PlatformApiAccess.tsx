'use client';

// API access (Super Admin only; platform migration 0129; docs/plans/API-ACCESS-TOKENS-PLAN-2026-10-18.md): the switch for FULL access keys, making a key (shown once, with its
// warning), the list (expires in N days, red under 24 hours; last used and from where; calls today), revoking one, and revoking all. The server checks every choice again.
import { useState } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import { API_ACCESS_LIMITS, apiAccessCopy as C, type ApiKey, type ApiKeyCreate, type ApiKeyCreated, type ApiKeyLevel, type ApiKeyScope } from '@shared/dashboards/apiAccess';
import { createApiAccessMock } from '@shared/dashboards/apiAccess.mock';
import { setupCopy } from '@shared/dashboards/platform';

import { useAction } from '@/components/ui';
import { createHttpApiAccessApi } from '@/lib/api/adapters/apiAccess';
import { chooseApi } from '@/lib/api/mode';
import { apiKeyTestApi } from '@/lib/api/setupCentre';
import { Bi, Button, FieldError, FieldHint, PickGroup } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { SetupAsk, SetupTest, SetupWizard, type WizardStep } from './setupParts';

import { tr, trf } from '@/lib/i18n/language';
export const apiAccessApi = chooseApi(createHttpApiAccessApi, createApiAccessMock);
const api = apiAccessApi;
const L = API_ACCESS_LIMITS;
const hoursLabel = (h: number): string => (h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : `${h / 24} day${h === 24 ? '' : 's'}`);
const lines = (s: string): string[] => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

const IP = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-f:]+(\/\d{1,3})?$/i;
const ipsBad = (s: string): string | null => (lines(s).some((x) => !IP.test(x)) ? setupCopy.check.ips : null);
const rateBad = (v: string, r: { min: number; max: number }): string | null => (v !== '' && (Number(v) < r.min || Number(v) > r.max) ? setupCopy.check.rate(r.min, r.max) : null);

/**
 * API access in the Set-up centre, one question per step (MJ, 5 Nov 2026): the keys and Make a key, full access, then the new key's name, what it may do, what it reaches,
 * how long it works, the allowed addresses (and for a full or AI key why, its call rate and test mode), Make the key (shown once), and a Test at the end. `hotelId` starts a
 * new key on that hotel (a hotel's Integrations tab).
 */
export function useApiKeySteps({ go, hotelId: forHotel }: { go: (step: string) => void; hotelId?: string }): WizardStep[] {
  const [version, setVersion] = useState(0);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const { data, error, reload } = useLoaded(() => api.view(), [version]);
  const hotels = useLoaded(() => platformApi.listHotels({ pageSize: 500 }), []);
  const refresh = () => setVersion((n) => n + 1);
  const [name, setName] = useState('');
  const [level, setLevel] = useState<ApiKeyLevel>('read');
  const [scope, setScope] = useState<ApiKeyScope>(forHotel ? 'hotel' : 'platform');
  const [hotelId, setHotelId] = useState(forHotel ?? '');
  const [hours, setHours] = useState<number>(L.defaultReadExpiryHours);
  const [ips, setIps] = useState('');
  const [reason, setReason] = useState('');
  const [rate, setRate] = useState(String(L.fullCallsPerMinute.default));
  const [testMode, setTestMode] = useState(true);
  const [testModeOffReason, setTestModeOffReason] = useState('');
  const [confirmFull, setConfirmFull] = useState(false);
  const [pasted, setPasted] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const A = setupCopy.api;
  const S = A.steps;
  const isFull = level === 'full';
  const isAi = level === 'ai';
  const strong = isFull || isAi;
  const limit = isAi ? L.aiCallsPerMinute : L.fullCallsPerMinute;
  const err = (k: string) => errors[k] ?? null;
  const next = (id: string) => ({ label: setupCopy.continue, icon: 'arrow-right', onClick: () => go(id) });
  const wait = !data ? <Wait error={error} onRetry={reload} tiles={false} rows={3} /> : null;

  const pickLevel = (l: ApiKeyLevel) => {
    setLevel(l);
    setHours(l === 'full' ? L.defaultFullExpiryHours : L.defaultReadExpiryHours);
    if (l === 'ai') {
      setScope('all');
      setRate(String(L.aiCallsPerMinute.default));
    } else if (l === 'full') setRate(String(L.fullCallsPerMinute.default));
  };
  const create = () => {
    const input: ApiKeyCreate = {
      name: name.trim(), level, scope: isAi ? 'all' : scope, hotelId: !isAi && scope === 'hotel' ? hotelId.trim() : null, expiresInHours: isAi ? L.aiExpiryHours : hours, ipAllow: lines(ips),
      ...(isFull ? { reason, confirmFull, testMode, testModeOffReason: testMode ? null : testModeOffReason, callsPerMinute: Number(rate) } : {}),
      ...(isAi ? { reason, confirmFull, callsPerMinute: Number(rate) } : {}),
    };
    void run(() => api.create(input), {
      onFields: setErrors,
      onOk: (c) => {
        setCreated(c);
        setName('');
        setReason('');
        setConfirmFull(false);
        setErrors({});
        refresh();
        go('test');
      },
    });
  };

  const steps: (WizardStep | null)[] = [
    {
      id: 'keys',
      title: S.keys.title,
      hints: S.keys.hints,
      content:
        wait ?? (
          <div className="pf-setup-stack">
            <StaleNote error={error} onRetry={reload} />
            <p className="small text-muted mb-0">
              <Bi name="info-circle" /> {C.staging}
            </p>
            {created ? <ShownOnce created={created} onDone={() => setCreated(null)} /> : null}
            <div>
              <Button icon="plus-circle" disabled={data!.activeCount >= data!.maxActive} onClick={() => go(data!.fullAccess.enabled ? 'name' : 'full')}>
                {A.makeKey}
              </Button>
              {data!.activeCount >= data!.maxActive ? <FieldHint>{trf('At most {0} keys can be active. Revoke one first.', [L.maxActive])}</FieldHint> : null}
            </div>
            <KeyList keys={data!.keys} activeCount={data!.activeCount} maxActive={data!.maxActive} onChanged={refresh} />
          </div>
        ),
    },
    { id: 'full', title: S.full.title, hints: S.full.hints, content: wait ?? <FullAccessSwitch fullAccess={data!.fullAccess} onSaved={refresh} onNext={() => go('name')} /> },
    {
      id: 'name',
      title: S.name.title,
      hints: S.name.hints,
      done: name.trim() !== '',
      content: (
        <SetupAsk id="ak-name" label={tr('Name')} check={err('name')} go={{ ...next('level'), disabled: name.trim() === '' }}>
          <input id="ak-name" className="form-control" placeholder={tr('Claude testing')} value={name} maxLength={L.nameMax} onChange={(e) => setName(e.target.value)} />
        </SetupAsk>
      ),
    },
    {
      id: 'level',
      title: S.level.title,
      content: (
        <div className="pf-setup-stack">
          <PickGroup<ApiKeyLevel>
            label={S.level.title}
            value={level}
            onChange={pickLevel}
            choices={(['read', 'ai', 'full'] as const).filter((l) => l !== 'full' || data?.fullAccess.enabled).map((l) => ({ value: l, icon: l === 'read' ? 'eye' : l === 'ai' ? 'robot' : 'unlock', title: C.levels[l], text: C.levelHelp[l] }))}
          />
          <div>
            <Button icon="arrow-right" onClick={() => go(isAi ? 'ips' : 'reach')}>
              {setupCopy.continue}
            </Button>
          </div>
        </div>
      ),
    },
    isAi
      ? null
      : {
          id: 'reach',
          title: S.reach.title,
          content: (
            <SetupAsk id="ak-scope" label={tr('Reaches')} hint={C.scopeHelp} check={err('hotelId') ?? (scope === 'hotel' && hotelId === '' ? tr('Choose the hotel') : null)} go={next('expiry')}>
              <select id="ak-scope" className="form-select" value={scope} onChange={(e) => setScope(e.target.value as ApiKeyScope)}>
                {(['platform', 'hotel', 'all'] as const).map((s) => (
                  <option key={s} value={s}>
                    {C.scopes[s]}
                  </option>
                ))}
              </select>
              {scope === 'hotel' ? (
                <select aria-label={tr('Hotel')} className={`form-select${err('hotelId') ? ' is-invalid' : ''}`} value={hotelId} onChange={(e) => setHotelId(e.target.value)}>
                  <option value="">{tr('Choose the hotel')}</option>
                  {(hotels.data?.items ?? []).map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </SetupAsk>
          ),
        },
    isAi
      ? null
      : {
          id: 'expiry',
          title: S.expiry.title,
          hints: S.expiry.hints,
          content: (
            <SetupAsk id="ak-expiry" label={tr('Expires after')} check={err('expiresInHours')} go={next('ips')}>
              <select id="ak-expiry" className="form-select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {(isFull ? L.fullExpiryHours : L.readExpiryHours).map((h) => (
                  <option key={h} value={h}>
                    {hoursLabel(h)}
                  </option>
                ))}
              </select>
            </SetupAsk>
          ),
        },
    {
      id: 'ips',
      title: S.ips.title,
      hints: S.ips.hints,
      content: (
        <SetupAsk id="ak-ips" label={`${tr('Allowed IP addresses')} ${isFull ? tr('(required)') : tr('(recommended)')}`} hint={C.ipHelp} check={err('ipAllow') ?? ipsBad(ips)} go={{ ...next(strong ? 'why' : 'make'), disabled: isFull && lines(ips).length === 0 }}>
          <textarea id="ak-ips" className="form-control font-monospace" rows={3} placeholder="203.0.113.7" value={ips} onChange={(e) => setIps(e.target.value)} />
        </SetupAsk>
      ),
    },
    strong
      ? {
          id: 'why',
          title: S.why.title,
          hints: S.why.hints,
          content: (
            <SetupAsk id="ak-reason" label={isAi ? tr('Who is this AI key for?') : tr('Why is a full access key needed?')} check={err('reason') ?? (reason !== '' && reason.trim().length < L.reasonMin ? setupCopy.check.reason(L.reasonMin) : null)} go={{ ...next('rate'), disabled: reason.trim().length < L.reasonMin }}>
              <input id="ak-reason" className="form-control" value={reason} maxLength={L.reasonMax} onChange={(e) => setReason(e.target.value)} />
            </SetupAsk>
          ),
        }
      : null,
    strong
      ? {
          id: 'rate',
          title: S.rate.title,
          content: (
            <SetupAsk id="ak-rate" label={tr('Calls a minute')} hint={`${limit.min} to ${limit.max}.`} check={err('callsPerMinute') ?? rateBad(rate, limit)} go={{ ...next(isFull ? 'testMode' : 'make'), disabled: rate === '' }}>
              <input id="ak-rate" className="form-control" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} />
            </SetupAsk>
          ),
        }
      : null,
    isFull
      ? {
          id: 'testMode',
          title: S.testMode.title,
          content: (
            <div className="pf-setup-stack">
              <label className="st-toggle">
                <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
                <span className="st-switch" aria-hidden="true" />
                <span className="st-toggle-text">
                  <strong>{C.testMode}</strong>
                  <small>{C.testModeHelp}</small>
                </span>
              </label>
              <SetupAsk id="ak-test-off" label={C.testModeOffReason} check={err('testModeOffReason')} go={{ ...next('make'), disabled: !testMode && testModeOffReason.trim().length < L.reasonMin }}>
                <input id="ak-test-off" className="form-control" disabled={testMode} value={testModeOffReason} maxLength={L.reasonMax} onChange={(e) => setTestModeOffReason(e.target.value)} />
              </SetupAsk>
            </div>
          ),
        }
      : null,
    {
      id: 'make',
      title: S.make.title,
      hints: S.make.hints,
      done: created !== null,
      content: (
        <div className="pf-setup-stack">
          <p className="mb-0">
            <b>{name.trim() || '—'}</b> · {C.levels[level]} · {isAi ? C.scopes.all : scope === 'hotel' ? (hotels.data?.items.find((h) => h.id === hotelId)?.name ?? tr('One hotel')) : C.scopes[scope]} · {isAi ? C.neverExpires : hoursLabel(hours)}
          </p>
          {strong ? (
            <label className="st-toggle">
              <input type="checkbox" checked={confirmFull} onChange={(e) => setConfirmFull(e.target.checked)} />
              <span className="st-switch" aria-hidden="true" />
              <span className="st-toggle-text">
                <strong>{isAi ? tr('I understand this key can read ALL data of the console and of every hotel (only secrets are blocked), and never expires.') : C.confirmFull}</strong>
              </span>
            </label>
          ) : null}
          {Object.values(errors).length ? <FieldError>{Object.values(errors)[0]}</FieldError> : null}
          <div>
            <Button icon="key" busy={busy} disabled={name.trim() === '' || (strong && !confirmFull) || (scope === 'hotel' && !isAi && hotelId === '') || ipsBad(ips) !== null} onClick={create}>
              {A.makeIt}
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: 'test',
      title: S.test.title,
      hints: S.test.hints,
      content: (
        <div className="pf-setup-stack">
          {created ? (
            <ShownOnce created={created} onDone={() => setCreated(null)} />
          ) : (
            <SetupAsk id="ak-test-key" label={A.pasteKey} hint={A.pasteHint}>
              <input id="ak-test-key" className="form-control pf-mono" type="password" autoComplete="off" spellCheck={false} value={pasted} onChange={(e) => setPasted(e.target.value.trim())} />
            </SetupAsk>
          )}
          <SetupTest
            label={A.testKey}
            disabled={!created && pasted === ''}
            run={async () => {
              const r = await apiKeyTestApi.test(created?.key ?? pasted);
              return r.ok ? { ok: r.data.ok, text: r.data.message } : { ok: false, text: r.error.message };
            }}
          />
        </div>
      ),
    },
  ];
  return steps.filter((s): s is WizardStep => s !== null);
}

/** The API access wizard (the Set-up centre, and a hotel's Integrations tab with `hotelId`). */
export function ApiKeysWizard({ step, onStep, onClose, hotelId }: { step: string; onStep: (s: string) => void; onClose: () => void; hotelId?: string }) {
  const steps = useApiKeySteps({ go: onStep, ...(hotelId ? { hotelId } : {}) });
  return <SetupWizard title={setupCopy.api.title} steps={steps} step={step || 'keys'} onStep={onStep} onClose={onClose} />;
}

function ShownOnce({ created, onDone }: { created: ApiKeyCreated; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const full = created.apiKey.level === 'full';
  return (
    <div className={`alert ${full ? 'alert-danger' : 'alert-warning'} mb-3`} role="alert">
      <strong>{C.shownOnce}</strong>
      <div className="d-flex flex-wrap gap-2 align-items-center my-2">
        <input className="form-control font-monospace" readOnly value={created.key} aria-label={created.apiKey.name} onFocus={(e) => e.currentTarget.select()} style={{ maxWidth: 560 }} />
        <Button
          variant="outline"
          icon={copied ? 'check2' : 'clipboard'}
          onClick={() => {
            void navigator.clipboard?.writeText(created.key).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? tr("Copied") : tr("Copy")}
        </Button>
      </div>
      <div className="small">{full ? C.shownOnceWarningFull : created.apiKey.level === 'ai' ? C.shownOnceWarningAi : C.shownOnceWarning}</div>
      <div className="mt-2">
        <Button variant="outline" size="sm" onClick={onDone}>
          {tr("I have copied it")}
        </Button>
      </div>
    </div>
  );
}

function FullAccessSwitch({ fullAccess, onSaved, onNext }: { fullAccess: { enabled: boolean; changedAt: string | null; changedByName: string | null; reason: string | null }; onSaved: () => void; onNext: () => void }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const next = !fullAccess.enabled;
  const short = reason !== '' && reason.trim().length < L.reasonMin ? setupCopy.check.reason(L.reasonMin) : null;
  const save = () =>
    void run(() => api.setFullAccess({ enabled: next, reason, confirm }), {
      success: next ? 'Full access keys are allowed.' : 'Full access keys are switched off.',
      onFields: setErrors,
      onOk: () => {
        setReason('');
        setConfirm(false);
        onSaved();
      },
    });
  return (
    <div className="pf-setup-stack">
      <p className="mb-0">
        <span className={`badge ${fullAccess.enabled ? 'text-bg-danger' : 'text-bg-secondary'}`}>{fullAccess.enabled ? tr("On") : tr("Off")}</span>{' '}
        {fullAccess.changedAt ? (
          <span className="small text-muted">
            {fullAccess.changedByName ?? tr("Someone")}, {formatDateTime(fullAccess.changedAt)}
            {fullAccess.reason ? `: ${fullAccess.reason}` : ''}
          </span>
        ) : null}
      </p>
      <SetupAsk id="ak-full-reason" label={next ? tr('Why turn full access keys on?') : tr('Why turn full access keys off?')} hint={C.fullAccessHelp} check={errors.reason ?? errors.confirm ?? short}>
        <input id="ak-full-reason" className="form-control" value={reason} maxLength={L.reasonMax} disabled={busy} onChange={(e) => setReason(e.target.value)} />
      </SetupAsk>
      {next ? (
        <label className="st-toggle">
          <input type="checkbox" checked={confirm} disabled={busy} onChange={(e) => setConfirm(e.target.checked)} />
          <span className="st-switch" aria-hidden="true" />
          <span className="st-toggle-text">
            <strong>{C.confirmFull}</strong>
          </span>
        </label>
      ) : null}
      <div className="d-flex flex-wrap gap-2">
        <Button variant={next ? 'danger' : 'outline'} busy={busy} onClick={save} disabled={reason.trim().length < L.reasonMin || (next && !confirm)}>
          {next ? tr("Allow full access keys") : tr("Switch off full access keys")}
        </Button>
        <Button variant="outline" icon="arrow-right" onClick={onNext}>
          {setupCopy.continue}
        </Button>
      </div>
    </div>
  );
}

function KeyList({ keys, activeCount, maxActive, onChanged }: { keys: ApiKey[]; activeCount: number; maxActive: number; onChanged: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const revoke = (k: ApiKey) => {
    if (!window.confirm(`Revoke "${k.name}"? It stops working at once.`)) return;
    void run(() => api.revoke(k.id), { success: `"${k.name}" is revoked.`, onOk: onChanged });
  };
  const revokeAll = () => {
    if (!window.confirm(C.revokeAllConfirm)) return;
    void run(() => api.revokeAll(reason), { success: (d) => `${d.revoked} key${d.revoked === 1 ? '' : 's'} revoked.`, onOk: () => { setReason(''); onChanged(); } });
  };
  return (
    <div className="st-field wide">
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-2 gap-2">
        <span className="form-label mb-0">{trf("Keys ({0} of {1} active)", [activeCount, maxActive])}</span>
        {activeCount > 0 ? (
          <span className="d-flex gap-2">
            <input className="form-control form-control-sm" style={{ maxWidth: 220 }} placeholder={tr("Why revoke all?")} aria-label={tr("Why revoke all?")} value={reason} maxLength={L.reasonMax} onChange={(e) => setReason(e.target.value)} />
            <Button variant="danger" size="sm" icon="x-octagon" disabled={busy || reason.trim().length < L.reasonMin} onClick={revokeAll}>
              {C.revokeAll}
            </Button>
          </span>
        ) : null}
      </div>
      {keys.length === 0 ? (
        <p className="small text-muted">{tr("No keys yet.")}</p>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm align-middle">
            <thead>
              <tr>
                <th>{tr("Name")}</th>
                <th>{tr("Level")}</th>
                <th>{tr("Reaches")}</th>
                <th>{tr("Expires")}</th>
                <th>{tr("Last used")}</th>
                <th>{tr("Calls today")}</th>
                <th aria-label={tr("Actions")} />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={k.status === 'active' ? '' : 'text-muted'}>
                  <td>
                    {k.name}
                    <span className="d-block small font-monospace text-muted">{k.prefix}…</span>
                  </td>
                  <td>
                    <span className={`badge ${k.level === 'full' ? 'text-bg-danger' : k.level === 'ai' ? 'text-bg-warning' : 'text-bg-secondary'}`}>{C.levels[k.level]}</span>
                    {k.level === 'full' && k.testMode ? <span className="d-block small">{C.testMode}</span> : null}
                  </td>
                  <td className="small">
                    {k.scope === 'hotel' ? k.hotelName ?? tr("One hotel") : C.scopes[k.scope]}
                    {k.ipAllow.length > 0 ? <span className="d-block text-muted">{k.ipAllow.join(', ')}</span> : null}
                  </td>
                  <td className={`small ${k.status === 'active' && k.expiresInHours < 24 ? 'text-danger fw-semibold' : ''}`}>
                    {k.status === 'active' ? (k.level === 'ai' ? C.neverExpires : C.expiresIn(Math.max(1, k.expiresInHours))) : k.status === 'revoked' ? tr("Revoked") : tr("Expired")}
                  </td>
                  <td className="small">
                    {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : tr("Never")}
                    {k.lastIp ? <span className="d-block text-muted">{k.lastIp}</span> : null}
                  </td>
                  <td className="small">{k.callsToday}</td>
                  <td>
                    {k.status === 'active' ? (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => revoke(k)}>
                        {tr("Revoke")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
