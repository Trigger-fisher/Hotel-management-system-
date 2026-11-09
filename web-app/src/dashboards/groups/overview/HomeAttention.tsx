'use client';

// The Today page's "Needs attention" queue: one row per item, one button that opens its page. Look: .hm-q* in public/pallav/hms-overrides.css.
import type { AttentionItem } from '@shared/dashboards/overview';
import { overviewCopy } from '@shared/dashboards/overview';
import { userMayOpen } from '@shared/dashboards/features';

import type { ScreenProps } from '../../types';
import { Button, EmptyState } from '@/dashboards/pallav/ui';
import { tr, trn } from '@/lib/i18n/language';

const c = overviewCopy.dashboard.home.attention;

/** `onRetryFeed` is set while the live attention feed failed: the dashboard's own items still show, never the all-clear. */
export function HomeAttention({ items, navigate, onRetryFeed }: { items: AttentionItem[]; navigate: ScreenProps['navigate']; onRetryFeed?: () => void }) {
  if (items.length === 0 && !onRetryFeed) {
    return (
      <div className="hm-empty">
        <EmptyState icon="check2-circle" title={c.emptyTitle} text={c.emptyBody} />
      </div>
    );
  }
  return (
    <div className="hm-queue">
      {items.map((a) => (
        <div key={a.id} className="hm-q">
          <i className={`hm-dot ${a.tone === 'warning' ? 'tone-warn' : 'tone-info'}`} aria-hidden="true" />
          <div className="hm-q-text">
            <b>{trn(a.text)}</b>
          </div>
          {userMayOpen(a.viewId) && (
            <Button variant="outline" size="sm" onClick={() => navigate(a.viewId)}>{trn(a.action)}</Button>
          )}
        </div>
      ))}
      {onRetryFeed && (
        <div className="hm-q" role="status">
          <i className="hm-dot tone-muted" aria-hidden="true" />
          <div className="hm-q-text">
            <b>{trn(c.feedFailed)}</b>
          </div>
          <Button variant="outline" size="sm" onClick={onRetryFeed}>{tr("Try again")}</Button>
        </div>
      )}
    </div>
  );
}
