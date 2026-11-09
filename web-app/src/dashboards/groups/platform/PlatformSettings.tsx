'use client';

// platform.settings (Super Admin only): defaults for new hotels (roles, GST %, time zone, invitation validity read only) and Sign-in security
// (PlatformSecurity.tsx). Mail and API access moved to the Set-up centre (MJ, 5 Nov 2026); their old tabs open the matching wizard step.
import { useEffect, useState } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import { PLATFORM_TIME_ZONES, platformCopy, setupCopy, type PlatformSettings, type PlatformSettingsInput } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction } from '@/components/ui';
import { Bi, Button, FieldError, FieldHint, PageHead, PmsSelect } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { SuperOnlyCard, actAs } from './PlatformStaff';
import { SecurityCard } from './PlatformSecurity';
import d from './desktop.module.css';

const T = platformCopy.platformSettings;
type Section = 'hotels' | 'mail' | 'security';
type Tab = Exclude<Section, 'mail'>;
const SECTIONS: { key: Tab; icon: string }[] = [
  { key: 'hotels', icon: 'building-gear' },
  { key: 'security', icon: 'shield-lock' },
];
/** Old tabs whose set-up moved to the Set-up centre: the wizard and step each one opens. */
const MOVED: Record<string, { service: string; step: string }> = {
  mail: { service: 'mail', step: 'service' },
  senders: { service: 'mail', step: 'senders' },
  files: { service: 'mail', step: 'files' },
  bounces: { service: 'mail', step: 'safety' },
  api: { service: 'api', step: 'keys' },
};

export function PlatformSettingsScreen(props: ScreenProps) {
  if (props.user.role !== 'super_admin') return <SuperOnlyCard />;
  return <SettingsBody {...props} />;
}

function SettingsBody({ user, params, navigate }: ScreenProps) {
  const moved = params?.tab ? MOVED[params.tab] : undefined;
  useEffect(() => {
    if (moved) navigate('platform.setup', moved);
  }, [moved, navigate]);
  const [section, setSection] = useState<Tab>(() => SECTIONS.find((s) => s.key === params?.tab)?.key ?? 'hotels');
  const [version, setVersion] = useState(0);
  const { data, error, reload } = useLoaded(() => platformApi.getPlatformSettings(), [version]);
  const current = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];

  return (
    <>
      <PageHead className="reveal" sub={T.subtitle}>
        <Button variant="outline" icon="plug" onClick={() => navigate('platform.setup')}>
          {setupCopy.title}
        </Button>
      </PageHead>
      {!data ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={5} />
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          <div className="st-layout reveal">
            <nav className="st-tabs" aria-label={T.sectionsLabel}>
              {SECTIONS.map((s) => (
                <a
                  key={s.key}
                  href="#"
                  className={`st-tab ${s.key === section ? 'active' : ''}`}
                  aria-current={s.key === section ? 'page' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    setSection(s.key);
                  }}
                >
                  <Bi name={s.icon} />
                  <span>{T.sections[s.key]}</span>
                </a>
              ))}
            </nav>
            {section === 'security' ? (
              <SecurityCard user={user} />
            ) : (
              <SectionCard key={`${section}:${data.updatedAt ?? ''}`} section={section} icon={current.icon} data={data} user={user} onSaved={() => setVersion((n) => n + 1)} />
            )}
          </div>
        </>
      )}
    </>
  );
}
function SectionCard({ section, icon, data, user, onSaved }: { section: Tab; icon: string; data: PlatformSettings; user: ScreenProps['user']; onSaved: () => void }) {
  const [roles, setRoles] = useState<string[]>(() => data.newHotelRoles.filter((r) => r.enabled).map((r) => r.key));
  const [gst, setGst] = useState(String(data.defaultGstPercent));
  const [timeZone, setTimeZone] = useState(data.defaultTimeZone);
  const { busy, run } = useAction();
  const label = T.sections[section];

  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = () => {
    const input: PlatformSettingsInput = { roleKeys: roles, defaultGstPercent: gst.trim() === '' ? Number.NaN : Number(gst), defaultTimeZone: timeZone };
    actAs(user);
    void run(() => platformApi.updatePlatformSettings(input), { success: T.saved(label), onFields: (f) => setErrors(f), onOk: onSaved });
  };
  const err = (k: string) => <FieldError>{errors[k]}</FieldError>;
  const clear = (k: string) => {
    if (errors[k]) setErrors((p) => ({ ...p, [k]: '' }));
  };

  return (
    <form
      className={`st-card ${d.stickySave}`}
      autoComplete="off"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="st-head">
        <div className="st-icon">
          <Bi name={icon} />
        </div>
        <div>
          <h2 className="st-title">{label}</h2>
          <p className="st-about">{T.about[section]}</p>
        </div>
      </div>

      {section === 'hotels' ? (
        <div className="st-grid">
          <fieldset className="st-field wide" disabled={busy}>
            <legend className="form-label">{T.fields.roles}</legend>
            {data.newHotelRoles.map((r) => (
              <label key={r.key} className="st-toggle mb-2" htmlFor={`ps-role-${r.key}`}>
                <input
                  type="checkbox"
                  id={`ps-role-${r.key}`}
                  checked={r.locked || roles.includes(r.key)}
                  disabled={r.locked}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setRoles((p) => (on ? [...p, r.key] : p.filter((k) => k !== r.key)));
                    clear('roleKeys');
                  }}
                />
                <span className="st-switch" aria-hidden="true" />
                <span className="st-toggle-text">
                  <strong>
                    {r.label}
                    {r.locked ? (
                      <span className="text-muted small ms-2">
                        <Bi name="lock-fill" /> {T.alwaysCreated}
                      </span>
                    ) : null}
                  </strong>
                  <small>{r.description}</small>
                </span>
              </label>
            ))}
            <FieldHint>{T.hints.roles}</FieldHint>
            {err('roleKeys')}
          </fieldset>
          <div className="st-field">
            <label className="form-label" htmlFor="ps-gst">
              {T.fields.gst}
            </label>
            <input
              id="ps-gst"
              className={`form-control${errors.defaultGstPercent ? ' is-invalid' : ''}`}
              inputMode="decimal"
              maxLength={5}
              value={gst}
              disabled={busy}
              aria-invalid={errors.defaultGstPercent ? true : undefined}
              onChange={(e) => {
                setGst(e.target.value);
                clear('defaultGstPercent');
              }}
            />
            <FieldHint>{T.hints.gst}</FieldHint>
            {err('defaultGstPercent')}
          </div>
          <div className="st-field">
            <label className="form-label" htmlFor="ps-tz">
              {T.fields.timeZone}
            </label>
            <PmsSelect
              id="ps-tz"
              value={timeZone}
              disabled={busy}
              onChange={(e) => {
                setTimeZone(e.target.value);
                clear('defaultTimeZone');
              }}
            >
              {PLATFORM_TIME_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </PmsSelect>
            {err('defaultTimeZone')}
          </div>
          <div className="st-field">
            <label className="form-label" htmlFor="ps-inv">
              {T.fields.inviteHours}
            </label>
            <input id="ps-inv" className="form-control" value={T.hours(data.invitationValidHours)} readOnly aria-readonly="true" />
            <FieldHint>
              <Bi name="lock" /> {T.hints.inviteHours}
            </FieldHint>
          </div>
        </div>
      ) : null}

      <div className="st-foot">
        <span className="text-muted small me-auto">{data.updatedAt && data.updatedBy ? T.lastChanged(data.updatedBy, formatDateTime(data.updatedAt)) : T.neverChanged}</span>
        <Button type="submit" icon="check2" disabled={busy}>
          {busy ? T.saving : T.save(label)}
        </Button>
      </div>
    </form>
  );
}
