'use client';

// The bell in the top bar of the hotel dashboards (plan H10): what needs someone's attention now, read from GET overview/attention every two minutes (and on
// F5, like every other screen), shown as a count on the bell and a list that opens the right page. Only what the person may act on comes back.
import { useEffect, useState } from 'react';
import { attentionForRole, overviewCopy, type AttentionFeed } from '@shared/dashboards/overview';
import { formatTime } from '@shared/dashboards/format';
import { useAsync } from '@/components/ui';
import { Bi, Dropdown } from '@/dashboards/pallav/ui';
import { overviewApi } from '../groups/overview/api';

const EVERY_MS = 120_000;

export function AttentionBell({ navigate, role }: { navigate: (viewId: string) => void; role: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), EVERY_MS);
    return () => clearInterval(t);
  }, []);
  const { state } = useAsync(() => overviewApi.getAttention(), [tick], { keep: true });
  const feed: AttentionFeed | null = state.status === 'ready' ? state.data : null;
  const items = attentionForRole(feed?.items ?? [], role);
  const warnings = items.filter((i) => i.tone === 'warning').length;
  const c = overviewCopy.bell;
  const label = c.label(items.length);
  return (
    <Dropdown
      align="end"
      offset={8}
      menuClassName="bell-menu"
      button={(p) => (
        <button /* check-shared-ignore: the top bar's own round button look (theme-btn), drawn the way PallavShell draws its theme and force buttons */ className={`theme-btn tb-bell${warnings ? ' warn' : ''}`} type="button" title={label} aria-label={label} {...p}>
          <Bi name={items.length ? 'bell-fill' : 'bell'} />
          {items.length > 0 ? <span className="tb-bell-count">{items.length > 9 ? '9+' : items.length}</span> : null}
        </button>
      )}
    >
      <div className="bell-head">
        <strong>{c.title}</strong>
        {feed ? <span className="text-muted">{c.checked(formatTime(feed.at))}</span> : null}
      </div>
      {items.length === 0 ? (
        <div className="bell-empty">
          <Bi name="check2-circle" /> {c.allClear}
        </div>
      ) : (
        items.map((i) => (
          <a
            key={i.id}
            className={`dropdown-item bell-item ${i.tone}`}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate(i.viewId);
            }}
          >
            <Bi name={i.tone === 'warning' ? 'exclamation-circle-fill' : 'info-circle'} />
            <span>
              {i.text}
              <small>{i.action} →</small>
            </span>
          </a>
        ))
      )}
    </Dropdown>
  );
}
