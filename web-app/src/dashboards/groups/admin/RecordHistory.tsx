'use client';

// "History" on a record (MJ's plan, N9): who changed this bill, advance, company, reservation, stay or employee and when, from the System Log (and the
// Payroll Log for staff). Folded by default; the lines are read when the person opens it, through systemApi (the real /system/log/record or the mock).
// Shown inside a record's own card; a list whose rows have no card (Staff) opens the same lines in a small modal (`RecordHistoryModal`).
import { useState, type ReactNode } from 'react';
import { formatDateTime } from '@shared/dashboards/format';
import { recordHistoryCopy as c, type RecordHistory as History } from '@shared/dashboards/adminSystem';
import { useAsync } from '@/components/ui';
import { Bi, Button, Modal, Skeleton } from '@/dashboards/pallav/ui';
import { systemApi } from './systemApi';

const ICON: Record<string, string> = { created: 'plus-circle', updated: 'pencil', deleted: 'trash', restored: 'arrow-counterclockwise', emailed: 'envelope', settled: 'check2-circle', refunded: 'arrow-return-left' };

export function RecordHistory({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="rh" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="rh-sum">
        <Bi name="clock-history" /> {c.title}
        <small>{c.hint}</small>
      </summary>
      {open ? <Lines id={id} /> : null}
    </details>
  );
}

/** The same lines in a small modal, for a row of a table (Staff): the title is the record's name, the eyebrow "History". */
export function RecordHistoryModal({ id, title, hint = c.hint, onClose }: { id: string; title: ReactNode; hint?: string; onClose: () => void }) {
  return (
    <Modal open size="md" className="rh-modal" eyebrow={c.title} title={title} onClose={onClose} footer={<Button variant="ghost" onClick={onClose}>{c.close}</Button>}>
      <p className="rh-hint">{hint}</p>
      <Lines id={id} />
    </Modal>
  );
}

function Lines({ id }: { id: string }) {
  const { state } = useAsync(() => systemApi.recordHistory(id), [id]);
  const h: History | null = state.status === 'ready' ? state.data : null;
  if (state.status === 'loading' && !h) return <Skeleton rows={2} />;
  if (!h) return <p className="rh-empty">{c.empty}</p>;
  if (h.items.length === 0) return <p className="rh-empty">{c.empty}</p>;
  return (
    <ol className="rh-list">
      {h.items.map((i) => (
        <li key={i.id} className={i.status === 'failed' ? 'failed' : undefined}>
          <span className="rh-dot" aria-hidden="true">
            <Bi name={ICON[i.action] ?? 'dot'} />
          </span>
          <div>
            <div className="rh-when">
              <b>{c.by(i.userName)}</b> · {formatDateTime(i.at)}
              {i.status === 'failed' ? <span className="rh-failed">{c.failed}</span> : null}
            </div>
            <div className="rh-text">{i.summary}</div>
            {i.details ? (
              <dl className="rh-details">
                {Object.entries(i.details).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </li>
      ))}
      {h.more ? <li className="rh-more">{c.more}</li> : null}
    </ol>
  );
}
