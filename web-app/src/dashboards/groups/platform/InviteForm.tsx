'use client';

// Invite: a Platform / Super Admin invites an individual hotel or a group (its future Group Hotel Admin); a Group Hotel Admin invites a hotel into
// its own group. One screen: the type cards, then name, contact and email. Mock mode only shows the link.
import { useState } from 'react';
import { blankInvitation, inviteLink, platformCopy, type PlatformInvitationInput, type PlatformInvitationSent, type PlatformInviterRole } from '@shared/dashboards/platform';
import { errorText, useOnline, useToast } from '@/components/ui';
import { Alert, Bi, Button, FieldError, FieldHint, FormSection, Modal, PickGroup } from '@/dashboards/pallav/ui';
import { apiMode } from '@/lib/api/mode';
import { Fld } from '../payrollCore/pms';
import { platformApi } from './api';

const I = platformCopy.invite;
const PI = platformCopy.invitationsPage;
const F = platformCopy.inviteFlow;
const E = platformCopy.errors;

/** Field id of each error key, in form order (the first refused field gets the focus). */
const FIELD_IDS: [string, string][] = [
  ['hotelName', 'inv_name'],
  ['contactName', 'inv_contact'],
  ['email', 'inv_email'],
];
function focusFirst(errors: Record<string, string>) {
  const hit = FIELD_IDS.find(([k]) => errors[k]);
  if (hit) requestAnimationFrame(() => document.getElementById(hit[1])?.focus());
}

/** The two types a Platform / Super Admin may send. */
type InviteType = 'individual' | 'group';
const TYPE_ICON: Record<InviteType, string> = { individual: 'building', group: 'diagram-3' };

/** Dev helpers (link note, copy link, test tokens): mock API AND a dev or local-demo build (the gate of docs/UI.md section 7). */
export function devLinksShown(): boolean {
  return apiMode() === 'mock' && (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_HMS_LOCAL_DEMO === '1');
}

/** The onboarding link on this site (dev only): the mock's own base address is not a real site. */
export function devInviteLink(token: string): string {
  return inviteLink(token, typeof window === 'undefined' ? undefined : window.location.origin);
}

/** "Copy link (dev)": a small outline button that copies the onboarding link; the link itself is shown beside it as code. */
export function DevCopyLink({ token, showLink = false }: { token: string; showLink?: boolean }) {
  const toast = useToast();
  if (!devLinksShown()) return null;
  const link = devInviteLink(token);
  const copy = () => {
    const done = () => toast.show({ tone: 'info', text: F.devCopied });
    const failed = () => toast.show({ tone: 'error', text: F.devCopyFailed });
    try {
      if (!navigator.clipboard) failed();
      else void navigator.clipboard.writeText(link).then(done, failed);
    } catch {
      failed();
    }
  };
  return (
    <span className="d-inline-flex flex-wrap align-items-center gap-2">
      <Button variant="ghost" size="sm" icon="clipboard" title={link} onClick={copy}>
        {F.devCopy}
      </Button>
      {showLink ? <code className="small text-break">{link}</code> : null}
    </span>
  );
}

/**
 * The Invite pop-up. `actor` is who sends it (their name goes on the invitation and the audit entry). `onSent` runs after a send that
 * worked (the list reloads); the pop-up stays open on its success view until closed or "Invite another".
 */
export function PlatformInviteForm({
  open,
  actor,
  onClose,
  onSent,
  initialType,
  group,
  initial,
}: {
  open: boolean;
  /** What the app already knows (a demo request): the form opens filled in. */
  initial?: { type?: InviteType; hotelName?: string; contactName?: string; email?: string };
  actor: { name: string; role: PlatformInviterRole };
  onClose: () => void;
  onSent: (sent: PlatformInvitationSent) => void;
  /** Set: the type is fixed in advance (e.g. Groups page = 'group'): the form opens on the details step and "Invite another" returns there. */
  initialType?: InviteType;
  /** Set for a Group Hotel Admin: the invitation is always a hotel INTO this group (type member_hotel); the group is shown locked and there is no type step. */
  group?: { id: string; name: string };
}) {
  const online = useOnline();
  const fixedType: InviteType | 'member_hotel' | undefined = group ? 'member_hotel' : initialType;
  const [type, setType] = useState<InviteType | 'member_hotel' | ''>(fixedType ?? initial?.type ?? 'individual');
  const [v, setV] = useState<PlatformInvitationInput>(() => ({ ...blankInvitation(), hotelName: initial?.hotelName ?? '', contactName: initial?.contactName ?? '', email: initial?.email ?? '' }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<PlatformInvitationSent | null>(null);

  const restart = () => {
    setType(fixedType ?? 'individual');
    setV(blankInvitation());
    setErrors({});
    setFailure(null);
    setSent(null);
    requestAnimationFrame(() => document.getElementById('inv_name')?.focus());
  };
  const close = () => {
    if (busy) return;
    restart();
    onClose();
  };

  const set = (k: 'hotelName' | 'contactName' | 'email', val: string) => {
    setV((p) => ({ ...p, [k]: val }));
    if (errors[k]) setErrors((p) => Object.fromEntries(Object.entries(p).filter(([x]) => x !== k)));
  };

  /** Required fields first (the server checks everything again, including the email format and duplicates). */
  const localCheck = (): Record<string, string> => {
    const f: Record<string, string> = {};
    if (!v.hotelName.trim()) f.hotelName = type === 'group' ? E.required.groupName : E.required.hotelName;
    if (!v.contactName.trim()) f.contactName = E.required.contactName;
    if (!v.email.trim()) f.email = E.required.email;
    return f;
  };

  const send = async () => {
    if (busy) return;
    if (!type) {
      setErrors({ type: F.typeFirst });
      return;
    }
    const f = localCheck();
    setErrors(f);
    if (Object.keys(f).length) {
      focusFirst(f);
      return;
    }
    setFailure(null);
    setBusy(true);
    try {
      platformApi.setActor({ name: actor.name, role: actor.role });
      const res = await platformApi.sendInvitation({ type, hotelName: v.hotelName.trim(), contactName: v.contactName.trim(), email: v.email.trim(), groupId: group ? group.id : null });
      if (res.ok) {
        setSent(res.data);
        onSent(res.data);
        return;
      }
      const fields = res.error.details?.fields;
      if (res.error.code === 'VALIDATION_FAILED' && fields) {
        setErrors(fields);
        focusFirst(fields);
        // groupId is never asked here: show it as a form message.
        if (fields.groupId) setFailure(fields.groupId);
        return;
      }
      setFailure(res.error.code === 'NETWORK_OFFLINE' ? I.offline : errorText(res.error));
    } finally {
      setBusy(false);
    }
  };

  const title = group ? I.titleMember(group.name) : initialType === 'group' ? I.titleGroup : initialType ? I.title : F.formTitle;

  // ------------------------------------------------------------------ success
  if (sent) {
    const inv = sent.invitation;
    return (
      <Modal
        open={open}
        onClose={close}
        title={I.sentTitle}
        staticBackdrop
        footer={
          <>
            <Button variant="ghost" icon="plus-lg" onClick={restart}>
              {I.sendAnotherAny}
            </Button>
            <Button onClick={close}>
              {F.close}
            </Button>
          </>
        }
      >
        <div className="empty-state py-3">
          <div className="es-icon">
            <Bi name="envelope-check" />
          </div>
          <div className="es-title">{I.sentTitle}</div>
          <div className="es-text">{I.sentBody(inv.hotelName, inv.email)}</div>
        </div>
        <p className="small text-muted mb-2">{F.sentNote}</p>
        <Alert tone="info" icon="info-circle" role="status" className="mb-0">
          <div>{sent.linkNote}</div>
          {devLinksShown() && sent.devToken ? (
            <>
              <FieldHint>{I.devLinkNote}</FieldHint>
              <div className="mt-1">
                <strong className="small">{I.devLinkLabel}</strong>
              </div>
              <DevCopyLink token={sent.devToken} showLink />
            </>
          ) : null}
        </Alert>
      </Modal>
    );
  }

  const cls = (k: string) => `form-control${errors[k] ? ' is-invalid' : ''}`;
  const isGroup = type === 'group';
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="lg"
      className="pay-form-modal"
      staticBackdrop
      onSubmit={() => void send()}
      footer={
        <>
          <Button variant="ghost" className="me-auto" onClick={close} disabled={busy}>
            {I.cancel}
          </Button>
          <Button type="submit" icon="send" disabled={busy || !online}>
            {busy ? I.sending : I.send}
          </Button>
        </>
      }
    >
      <p className="small text-muted">{I.subtitleAny}</p>
      {!online ? (
        <Alert tone="warning" icon="wifi-off" role="status">
          {I.offline}
        </Alert>
      ) : null}
      {failure ? (
        <Alert tone="danger" icon="x-octagon" role="alert">
          {failure}
        </Alert>
      ) : null}
      {fixedType ? null : (
        <FormSection icon="ui-radios" title={F.chooseType} hint={I.hints.platformNoGroup}>
          <PickGroup<InviteType>
            label={I.fields.type}
            value={type as InviteType}
            onChange={(t) => {
              setType(t);
              setErrors({});
            }}
            choices={(['individual', 'group'] as const).map((t) => ({ value: t, icon: TYPE_ICON[t], title: I.types[t].label, text: I.types[t].hint }))}
          />
          <FieldError>{errors.type}</FieldError>
        </FormSection>
      )}
      <FormSection icon={isGroup ? 'diagram-3' : 'building'} title={isGroup ? PI.groupDetails : PI.hotelDetails}>
        <fieldset disabled={busy}>
          <div className="row g-3">
            {group ? (
              <Fld md={12} id="inv_group" label={I.fields.group} hint={I.hints.groupFixed(group.name)}>
                <input id="inv_group" className="form-control" value={group.name} readOnly />
              </Fld>
            ) : null}
            <Fld md={12} id="inv_name" label={isGroup ? I.fields.groupName : I.fields.hotelName} required error={errors.hotelName}>
              <input id="inv_name" data-autofocus={fixedType ? true : undefined} className={cls('hotelName')} maxLength={100} autoComplete="off" value={v.hotelName} onChange={(e) => set('hotelName', e.target.value)} />
            </Fld>
            <Fld md={6} id="inv_contact" label={I.fields.contactName} required hint={isGroup ? I.hints.contactNameGroup : I.hints.contactName} error={errors.contactName}>
              <input id="inv_contact" className={cls('contactName')} maxLength={100} autoComplete="off" value={v.contactName} onChange={(e) => set('contactName', e.target.value)} />
            </Fld>
            <Fld md={6} id="inv_email" label={I.fields.email} required hint={I.hints.email} error={errors.email}>
              <input id="inv_email" type="email" inputMode="email" className={cls('email')} maxLength={254} autoComplete="off" spellCheck={false} value={v.email} onChange={(e) => set('email', e.target.value.trim())} />
            </Fld>
          </div>
        </fieldset>
      </FormSection>
    </Modal>
  );
}
