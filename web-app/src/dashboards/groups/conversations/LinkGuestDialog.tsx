'use client';

// "Link guest" (decision 66, A14): ties a conversation to a stay, a booking, a guest record or a company (the platform's: an account or a hotel). Only the
// kinds the person may open are offered (the server says which in `access.canLink`), and the search asks the server for those kinds only.
import { useEffect, useState } from 'react';

import { conversationsCopy as c, type ConversationsApi, type ConversationThread, type ConvLinkKind, type LinkCandidate } from '@shared/dashboards/conversations';

import { errorText, useDebounced } from '@/components/ui';
import { Alert, Button, EmptyState, ListSearch, ListTabs, Modal, Skeleton } from '@/dashboards/pallav/ui';

export function LinkGuestDialog({
  open,
  platform = false,
  thread,
  api,
  onClose,
  onLinked,
}: {
  open: boolean;
  /** The platform hub: accounts and hotels, in its own words. */
  platform?: boolean;
  thread: ConversationThread;
  api: Pick<ConversationsApi, 'listLinkCandidates' | 'setLink'>;
  onClose: () => void;
  onLinked: (t: ConversationThread) => void;
}) {
  const kinds = thread.access.canLink;
  const [kind, setKind] = useState<'all' | ConvLinkKind>('all');
  const [search, setSearch] = useState(() => (thread.contact.name && !/^\+?[0-9 ]+$/.test(thread.contact.name) ? thread.contact.name : ''));
  const q = useDebounced(search, 250);
  const [result, setResult] = useState<{ key: string; items: LinkCandidate[] } | { key: string; error: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${kind}|${q}`;

  useEffect(() => {
    if (!open || kinds.length === 0) return undefined;
    let live = true;
    void api.listLinkCandidates(q, kind === 'all' ? undefined : kind).then((r) => {
      if (!live) return;
      setResult(r.ok ? { key, items: r.data } : { key, error: errorText(r.error) });
    });
    return () => {
      live = false;
    };
  }, [open, kinds.length, api, q, kind, key]);

  const link = async (cand: LinkCandidate) => {
    setBusy(cand.id);
    setError(null);
    const r = await api.setLink(thread.id, { kind: cand.kind, targetId: cand.id });
    setBusy(null);
    if (r.ok) {
      onLinked(r.data);
      onClose();
    } else setError(errorText(r.error));
  };

  const current = result && result.key === key ? result : null;
  return (
    <Modal open={open} onClose={onClose} title={c.contact.linkTitle} size="lg">
      {kinds.length > 1 ? (
        <ListTabs
          look="pills"
          label={c.contact.linkTitle}
          active={kind}
          onChange={(k) => setKind(k as 'all' | ConvLinkKind)}
          tabs={[{ id: 'all', label: c.tabs.all }, ...kinds.map((k) => ({ id: k, label: c.contact.linkKinds[k] }))]}
        />
      ) : null}
      <div className="mt-2">
        <ListSearch value={search} onChange={setSearch} onClear={() => setSearch('')} placeholder={platform ? c.contact.linkSearchPlatform : c.contact.linkSearch} wrapClass="pay-toolbar" />
      </div>
      {error ? <Alert tone="danger" className="mt-2">{error}</Alert> : null}
      {kinds.length === 0 ? (
        <Alert tone="neutral" className="mt-2">
          {c.readOnly.viewOnly}
        </Alert>
      ) : !current ? (
        <div className="mt-3">
          <Skeleton lines={3} />
        </div>
      ) : 'error' in current ? (
        <Alert tone="danger" className="mt-2">
          {current.error}
        </Alert>
      ) : current.items.length === 0 ? (
        <EmptyState icon="search" title={c.contact.linkNone} />
      ) : (
        <div className="cv-cands" role="list">
          {current.items.map((cand) => (
            <div key={`${cand.kind}:${cand.id}`} className="cv-cand" role="listitem">
              <div className="cv-cand-main">
                <div className="cv-cand-label">{cand.label}</div>
                <div className="cv-cand-detail">
                  {c.contact.linkKinds[cand.kind]}
                  {cand.detail ? ` · ${cand.detail}` : ''}
                </div>
              </div>
              <Button size="sm" variant="outline" icon="link-45deg" busy={busy === cand.id} aria-label={`${c.contact.link} ${cand.label}`} onClick={() => void link(cand)}>
                {c.contact.link}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
