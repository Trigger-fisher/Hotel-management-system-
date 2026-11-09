'use client';

// hotel.admin.users: link a guest or company PORTAL account to the guest or company record it belongs to (decision 47). Until it is linked, the person sees
// "Your account is not set up yet" in their portal. The candidates come from the hotel's own guests or companies (active ones only).
import { useState } from 'react';

import type { AdminUser } from '@shared/dashboards/admin';
import { Button, FieldError, Modal, Select } from '@/dashboards/pallav/ui';
import { useAsync, useSubmit } from '@/components/ui';
import { adminApi } from './api';

import { tr, trf } from '@/lib/i18n/language';
export function PortalLinkModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: (next: AdminUser) => void }) {
  const kind = user.portal?.kind ?? 'guest';
  const noun = kind === 'company' ? 'company' : 'guest';
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState('');
  const options = useAsync(() => adminApi.listPortalOptions(user.id, q), [user.id, q]);
  const { busy, errors, submit } = useSubmit(['recordId']);
  const items = options.state.status === 'ready' ? options.state.data : [];

  return (
    <Modal
      open
      size="md"
      className="pay-form-modal"
      staticBackdrop
      scrollable={false}
      onClose={onClose}
      eyebrow="Portal account"
      title={trf("Link @{0} to a {1}", [user.username, noun])}
      onSubmit={() => void submit(() => adminApi.linkPortal(user.id, { kind, recordId: picked }), onDone)}
      footer={
        <>
          <Button variant="ghost" icon="x-lg" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button type="submit" icon="link-45deg" disabled={busy || !picked}>
            {busy ? tr("Linking...") : tr("Link account")}
          </Button>
        </>
      }
    >
      <p className="text-muted small">
        {trf("Pick the {0} this account belongs to. After that, {1} sees their own {2} in the portal.", [noun, user.name, kind === 'company' ? 'company bills and payments' : 'stay, bills and orders'])}
      </p>
      <label className="form-label" htmlFor="pl-search">
        {tr("Search")}
      </label>
      <input id="pl-search" className="form-control mb-3" value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'company' ? 'Company name or city' : 'Guest name or mobile'} autoComplete="off" />
      <label className="form-label" htmlFor="pl-pick">
        {kind === 'company' ? tr("Company") : tr("Guest")}
      </label>
      <Select id="pl-pick" value={picked} onChange={(e) => setPicked(e.target.value)} invalid={Boolean(errors.recordId)}>
        <option value="">{items.length === 0 && options.state.status === 'ready' ? `No ${noun} found` : `Choose a ${noun}...`}</option>
        {items.map((o) => (
          <option key={o.id} value={o.id}>
            {o.detail ? `${o.name} · ${o.detail}` : o.name}
          </option>
        ))}
      </Select>
      {errors.recordId ? <FieldError>{errors.recordId}</FieldError> : null}
    </Modal>
  );
}
