'use client';

// Console > Conversations > Settings > WhatsApp rules (plan part 6 and 15): one switch or number for every restriction, in tabs for the shared number, the platform number and the hotels' own
// numbers, a page per hotel that shows each switch with the value it inherits and an override, the numbers (routing time, daily cap ...) and the kill switches. Meta's own rules are shown greyed
// with the reason and cannot be changed. A risky change (marketing on, consent off, the cap removed, balanced routing, WhatsApp switched on, a hotel paused) first answers with what could go
// wrong; the screen shows it and sends the same change again with the confirmation. Every change is audited on the server, who and old and new value. Same page for Super Admin and Platform Admin.
import { useCallback, useEffect, useState } from 'react';

import type { DashError } from '@shared/dashboards/common';
import type { WhatsAppHotelRow } from '@shared/dashboards/whatsapp';

import { Alert, Button, Dialog, FormSection, LoadError, SegTabs, Skeleton, StatusChip } from '@/dashboards/pallav/ui';

import { WhatsAppMove } from './WhatsAppMove';
import { whatsappAdminApi, whatsappAdminAvailable, type WaHotelRulesView, type WaProfileView, type WaRulesView } from './whatsappAdminApi';

type Value = boolean | number | null;
type Pending = { title: string; message: string; run: () => Promise<void> };

const errorOf = (e: DashError): string => (e.details?.fields ? Object.values(e.details.fields).join(' ') || e.message : e.message);
const isConfirm = (e: DashError): boolean => e.code === 'CONFLICT' && e.message.startsWith('Please confirm');

/** A switch (checkbox) or a number. */
function ValueInput({ type, value, disabled, onChange }: { type: 'boolean' | 'number'; value: Value; disabled: boolean; onChange: (v: Value) => void }) {
  if (type === 'boolean') return <input type="checkbox" className="form-check-input" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
  return <input type="number" className="form-control form-control-sm" style={{ width: 110 }} min={0} value={typeof value === 'number' ? value : ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
}

function Profile({ profile, onSaved, onAsk, onError }: { profile: WaProfileView; onSaved: (v: WaRulesView) => void; onAsk: (p: Pending) => void; onError: (m: string) => void }) {
  const [edits, setEdits] = useState<Record<string, Value>>({});
  const [busy, setBusy] = useState(false);
  const changed = Object.keys(edits).length > 0;
  const save = async (confirm?: boolean): Promise<void> => {
    setBusy(true);
    const r = await whatsappAdminApi.saveRules({ profiles: { [profile.id]: edits as Record<string, boolean | number | null> }, ...(confirm ? { confirm } : {}) });
    setBusy(false);
    if (r.ok) {
      setEdits({});
      onSaved(r.data);
    } else if (isConfirm(r.error)) onAsk({ title: 'Please confirm', message: r.error.message, run: () => save(true) });
    else onError(errorOf(r.error));
  };
  return (
    <>
      <div className="mb-2">
        {profile.rules.map((rule) => (
          <div key={rule.key} className="d-flex align-items-center justify-content-between gap-3 py-2" style={{ borderBottom: '1px solid var(--bs-border-color, #2a2a2a)', opacity: rule.locked ? 0.6 : 1, textAlign: 'left' }}>
            <div>
              {rule.label}
              {rule.locked ? <div className="fs-hint">Locked: {rule.lockedReason ?? "Meta's own rule"}</div> : null}
            </div>
            <ValueInput type={rule.type} value={rule.key in edits ? edits[rule.key] : rule.value} disabled={rule.locked || busy} onChange={(v) => setEdits((e) => ({ ...e, [rule.key]: v }))} />
          </div>
        ))}
      </div>
      <Button size="sm" icon="check2" busy={busy} disabled={!changed} onClick={() => void save()}>
        Save changes
      </Button>
    </>
  );
}

function HotelRules({ hotel, onError, onAsk }: { hotel: Pick<WhatsAppHotelRow, 'hotelId'>; onError: (m: string) => void; onAsk: (p: Pending) => void }) {
  const [view, setView] = useState<WaHotelRulesView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    void whatsappAdminApi.hotelRules(hotel.hotelId).then((r) => on && (r.ok ? setView(r.data) : onError(errorOf(r.error))));
    return () => {
      on = false;
    };
  }, [hotel.hotelId, onError]);

  const change = async (name: string, work: (confirm?: boolean) => ReturnType<typeof whatsappAdminApi.saveHotelRules>, confirm?: boolean): Promise<void> => {
    setBusy(name);
    const r = await work(confirm);
    setBusy(null);
    if (r.ok) setView(r.data);
    else if (isConfirm(r.error)) onAsk({ title: 'Please confirm', message: r.error.message, run: () => change(name, work, true) });
    else onError(errorOf(r.error));
  };

  if (!view) return <Skeleton rows={2} />;
  return (
    <>
      <WhatsAppMove hotelId={hotel.hotelId} />
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <StatusChip tone={view.hotelPaused ? 'danger' : 'ok'}>{view.hotelPaused ? 'WhatsApp paused for this hotel' : 'Not paused'}</StatusChip>
        <StatusChip>Uses the {view.profile === 'shared' ? 'shared number' : view.profile === 'platform' ? 'platform number' : "hotel's own number"} rules</StatusChip>
        <Button size="sm" variant={view.hotelPaused ? 'outline' : 'danger'} icon={view.hotelPaused ? 'play-circle' : 'pause-circle'} busy={busy === 'pause'} onClick={() => void change('pause', (c) => whatsappAdminApi.saveHotelRules(hotel.hotelId, { hotel_paused: view.hotelPaused ? null : true }, c))}>
          {view.hotelPaused ? 'Resume this hotel' : 'Pause this hotel'}
        </Button>
      </div>
      <table className="table table-sm align-middle" style={{ textAlign: 'left' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Switch</th>
            <th style={{ textAlign: 'left' }}>In use</th>
            <th style={{ textAlign: 'left' }}>Comes from</th>
            <th style={{ textAlign: 'left' }}>Override for this hotel</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {view.rules.map((r) => (
            <tr key={r.key} style={r.locked ? { opacity: 0.6 } : undefined}>
              <td style={{ textAlign: 'left' }}>
                {r.label}
                {r.locked ? <div className="fs-hint">Locked: {r.lockedReason ?? "Meta's own rule"}</div> : null}
              </td>
              <td>{typeof r.effective === 'boolean' ? (r.effective ? 'On' : 'Off') : r.effective === null ? 'No limit' : r.effective}</td>
              <td className="fs-hint">{r.source === 'hotel_override' ? 'This hotel' : r.source === 'line_profile' ? 'The number’s rules' : r.source === 'global_default' ? 'Global setting' : 'Built in'}</td>
              <td>
                <ValueInput type={r.type} value={r.override} disabled={r.locked || busy !== null} onChange={(v) => void change(r.key, (c) => whatsappAdminApi.saveHotelRules(hotel.hotelId, { [r.key]: v }, c))} />
              </td>
              <td>
                {r.override !== null ? (
                  <Button size="sm" variant="ghost" busy={busy === `reset-${r.key}`} onClick={() => void change(`reset-${r.key}`, (c) => whatsappAdminApi.resetHotelRule(hotel.hotelId, r.key, c))}>
                    Reset
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** One hotel's WhatsApp switches (the Integrations tab of the hotel's page). */
export function WhatsAppHotelRules({ hotelId }: { hotelId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const onError = useCallback((m: string) => setMessage(m), []);
  return (
    <>
      {message ? (
        <Alert tone="danger" className="mb-2" action={<Button size="sm" variant="ghost" onClick={() => setMessage(null)}>Dismiss</Button>}>
          {message}
        </Alert>
      ) : null}
      <HotelRules hotel={{ hotelId }} onError={onError} onAsk={setPending} />
      <Dialog
        open={pending !== null}
        title={pending?.title ?? ''}
        message={pending?.message}
        confirmLabel="Yes, do it"
        tone="warning"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) void p.run();
        }}
      />
    </>
  );
}

export function WhatsAppRules() {
  const [view, setView] = useState<WaRulesView | null>(null);
  const [error, setError] = useState<DashError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<string>('shared');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [numbers, setNumbers] = useState<Record<string, number | string>>({});
  const [busy, setBusy] = useState(false);
  const live = whatsappAdminAvailable();

  useEffect(() => {
    let on = true;
    void whatsappAdminApi.rules().then((r) => {
      if (!on) return;
      if (r.ok) setView(r.data);
      else setError(r.error);
    });
    return () => {
      on = false;
    };
  }, [attempt]);

  const onError = useCallback((m: string) => setMessage(m), []);
  const onAsk = useCallback((p: Pending) => setPending(p), []);

  if (error) return <LoadError error={error} onRetry={() => (setError(null), setAttempt((n) => n + 1))} />;
  if (!view) return <Skeleton rows={3} />;

  const killed = view.killSwitch.global.killed;
  const toggleGlobal = async (confirm?: boolean): Promise<void> => {
    setBusy(true);
    const r = await whatsappAdminApi.killSwitch({ scope: 'global' }, !killed ? true : false, confirm);
    // "on" of the kill switch means STOP; switching WhatsApp ON is the same call with on = false
    setBusy(false);
    if (r.ok) setAttempt((n) => n + 1);
    else if (isConfirm(r.error)) setPending({ title: 'Please confirm', message: r.error.message, run: () => toggleGlobal(true) });
    else setMessage(errorOf(r.error));
  };
  const saveNumbers = async (confirm?: boolean): Promise<void> => {
    setBusy(true);
    const r = await whatsappAdminApi.saveRules({ numbers, ...(confirm ? { confirm } : {}) });
    setBusy(false);
    if (r.ok) {
      setView(r.data);
      setNumbers({});
    } else if (isConfirm(r.error)) setPending({ title: 'Please confirm', message: r.error.message, run: () => saveNumbers(true) });
    else setMessage(errorOf(r.error));
  };
  const profile = view.profiles.find((p) => p.id === tab);

  return (
    <>
      {!live ? (
        <Alert tone="info" className="mb-2">
          Sample data for the preview: these switches are not real and nothing here is saved.
        </Alert>
      ) : null}
      <FormSection icon="power" title="WhatsApp on or off" hint="The master switch. While it is off nothing is sent and nothing received is processed (it waits).">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <StatusChip tone={killed ? 'danger' : 'ok'}>{killed ? 'WhatsApp is OFF' : 'WhatsApp is ON'}</StatusChip>
          <Button variant={killed ? 'primary' : 'danger'} icon={killed ? 'play-circle' : 'stop-circle'} busy={busy} onClick={() => void toggleGlobal()}>
            {killed ? 'Switch WhatsApp on' : 'Switch WhatsApp off'}
          </Button>
        </div>
      </FormSection>
      {message ? (
        <Alert tone="danger" className="mb-2" action={<Button size="sm" variant="ghost" onClick={() => setMessage(null)}>Dismiss</Button>}>
          {message}
        </Alert>
      ) : null}
      <FormSection icon="speedometer2" title="Limits and timing" hint="Routing time, the daily message cap and the other numbers. They apply from the next message.">
        <div className="row g-2">
          {view.numberFields.map((f) => (
            <div className="col-md-4" key={f.key}>
              <label className="form-label">{f.label}</label>
              {f.options ? (
                <select className="form-select form-select-sm" value={String(numbers[f.key] ?? f.value)} onChange={(e) => setNumbers((n) => ({ ...n, [f.key]: e.target.value }))}>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {f.optionLabels?.[o] ?? o}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="form-control form-control-sm" type="number" min={f.min} max={f.max} value={String(numbers[f.key] ?? f.value)} onChange={(e) => setNumbers((n) => ({ ...n, [f.key]: Number(e.target.value) }))} />
              )}
              {f.min !== undefined ? <div className="fs-hint">From {f.min} to {f.max}</div> : null}
            </div>
          ))}
        </div>
        <div className="mt-2">
          <Button size="sm" icon="check2" busy={busy} disabled={Object.keys(numbers).length === 0} onClick={() => void saveNumbers()}>
            Save limits
          </Button>
        </div>
      </FormSection>
      <FormSection icon="toggles" title="Rules for each kind of number" hint="Every restriction is a switch. Meta's own rules are locked and cannot be turned off.">
        <SegTabs label="Kind of number" tabs={view.profiles.map((p) => ({ id: p.id, label: p.label }))} active={tab} onChange={setTab} />
        <div className="mt-2">{profile ? <Profile key={profile.id} profile={profile} onSaved={setView} onAsk={onAsk} onError={onError} /> : null}</div>
        {view.lockedNotes.length ? (
          <ul className="fs-hint mt-2">
            {view.lockedNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
      </FormSection>
      <p className="fs-hint">One hotel’s switches are on that hotel’s page, Integrations tab.</p>
      <Dialog
        open={pending !== null}
        title={pending?.title ?? ''}
        message={pending?.message}
        confirmLabel="Yes, do it"
        tone="warning"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) void p.run();
        }}
      />
    </>
  );
}
