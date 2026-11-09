'use client';

// The account fields shared by "Add staff member" and the Details tab: name, phone, email, username, role.
import type { ReactNode } from 'react';
import type { AdminRole } from '@shared/dashboards/admin';
import { Bi } from '@/dashboards/pallav/ui';
import { Fld } from '../payrollCore/pms';
import { allowedCount, roleAccent, roleIcon } from './accessLook';

import { tr } from '@/lib/i18n/language';
export interface UserDraft { name: string; username: string; email: string; mobile: string; roleId: string }

export function UserFields({
  value: v,
  roles,
  errors,
  onChange,
  idPrefix,
  goToRoles,
  emailRequired = false,
  usernameNote,
}: {
  value: UserDraft;
  roles: AdminRole[];
  errors: Record<string, string>;
  onChange: (next: UserDraft) => void;
  idPrefix: string;
  goToRoles?: () => void;
  /** New accounts: the sign-in password is emailed, so the email is needed. */
  emailRequired?: boolean;
  /** A line under the username (free / taken) instead of the plain hint. */
  usernameNote?: ReactNode;
}) {
  const set = (k: keyof UserDraft, x: string) => onChange({ ...v, [k]: x });
  return (
    <div className="row g-3">
      <Fld md={6} id={`${idPrefix}name`} label={tr("Full name")} required error={errors.name}>
        <input id={`${idPrefix}name`} className="form-control" value={v.name} maxLength={100} autoComplete="off" onChange={(e) => set('name', e.target.value)} />
      </Fld>
      <div className="col-md-6">
        <label className="form-label" htmlFor={`${idPrefix}phone`}>
          {tr("Mobile")} <span className="wz-optional">{tr("optional")}</span>
        </label>
        <input id={`${idPrefix}phone`} className="form-control" value={v.mobile} maxLength={20} inputMode="tel" autoComplete="off" onChange={(e) => set('mobile', e.target.value)} />
        <div className="form-text">{tr("For the team to reach them; not used to sign in.")}</div>
        {errors.mobile ? <div className="invalid-feedback d-block" role="alert">{errors.mobile}</div> : null}
      </div>
      <div className="col-md-6">
        <label className="form-label" htmlFor={`${idPrefix}email`}>
          {tr("Email")} {emailRequired ? <span className="req">*</span> : <span className="wz-optional">{tr("optional")}</span>}
        </label>
        <input type="email" id={`${idPrefix}email`} className="form-control" value={v.email} maxLength={254} autoComplete="off" inputMode="email" onChange={(e) => set('email', e.target.value)} />
        <div className="form-text">{emailRequired ? tr("Their first password is sent here.") : tr("Where a new password is sent.")}</div>
        {errors.email ? <div className="invalid-feedback d-block" role="alert">{errors.email}</div> : null}
      </div>
      <Fld md={6} id={`${idPrefix}username`} label={tr("Username")} required hint={usernameNote ? undefined : "Used to sign in. Letters, numbers, dots and underscores."} error={errors.username}>
        <div className="input-icon">
          <Bi name="at" />
          <input id={`${idPrefix}username`} className="form-control" value={v.username} minLength={3} maxLength={50} autoCapitalize="none" spellCheck={false} autoComplete="off" title={tr("Letters, numbers, dots and underscores")} onChange={(e) => set('username', e.target.value)} />
        </div>
        {usernameNote && !errors.username ? <div className="form-text">{usernameNote}</div> : null}
      </Fld>

      <div className="col-12">
        <label className="form-label">
          {tr("Role")}<span className="req">*</span>
        </label>
        <div className="role-options">
          {roles.map((r) => (
            <label key={r.id} className="role-option" style={{ ['--role' as string]: roleAccent(r) }}>
              <input type="radio" name={`${idPrefix}role`} value={r.id} checked={v.roleId === r.id} onChange={() => set('roleId', r.id)} />
              <span className="ro-body">
                <span className="ro-head">
                  <Bi name={roleIcon(r)} />
                  {r.name}
                </span>
                <span className="ro-desc">{r.description || tr("No description yet.")}</span>
                <span className="ro-count">{allowedCount(r.levels)} {tr("things allowed")}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.roleId ? <div className="field-error">{errors.roleId}</div> : null}
        {goToRoles ? (
          <div className="form-text">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                goToRoles();
              }}
            >
              <Bi name="diagram-3" /> {tr("See what each role may do")}
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
