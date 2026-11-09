'use client';

// The bell in the top bar of the company portal: the number of unread notifications, and the newest five (a click opens the page; "Mark all as read" clears the badge). It reads
// the same store as the sidebar badge (groups/notifications/unread.ts), which the shell keeps fresh.
import { formatDateTime } from '@shared/dashboards/format';
import { notificationsPortalCopyByLanguage } from '@shared/dashboards/notificationsCopy.lang';
import { useCopy, tr } from '@/lib/i18n/language';
import { PORTAL_ALL_HOTELS } from '@shared/dashboards/portalHotel';

import { useAction } from '@/components/ui';
import { Bi, Dropdown } from '@/dashboards/pallav/ui';
import { usePortalHotel } from '../groups/portal/HotelSwitch';
import { portalNotificationsApi } from '../groups/notifications/api';
import { adjustPortalUnread, refreshPortalUnread, usePortalUnread } from '../groups/notifications/unread';


export function PortalBell({ navigate }: { navigate: (viewId: string) => void }) {
  const T = useCopy(notificationsPortalCopyByLanguage);
  const { unread, latest, failed } = usePortalUnread();
  const showHotel = usePortalHotel() === PORTAL_ALL_HOTELS;
  const { run } = useAction();
  const label = T.unreadLabel(unread);
  const markAll = () => void run(() => portalNotificationsApi.markAllRead(), { onOk: () => { adjustPortalUnread(-unread); void refreshPortalUnread(); } });
  const open = (id: string, wasUnread: boolean) => {
    if (wasUnread) {
      adjustPortalUnread(-1);
      void portalNotificationsApi.markRead(id).then(() => refreshPortalUnread());
    }
    navigate('corporate.notifications');
  };
  return (
    <Dropdown
      align="end"
      offset={8}
      menuClassName="bell-menu"
      button={(p) => (
        <button /* check-shared-ignore: the top bar's own round button look (theme-btn), drawn like the hotel bell */ className="theme-btn tb-bell" type="button" title={label} aria-label={label} {...p}>
          <Bi name={unread ? 'bell-fill' : 'bell'} />
          {unread > 0 ? <span className="tb-bell-count">{unread > 9 ? '9+' : unread}</span> : null}
        </button>
      )}
    >
      <div className="bell-head">
        <strong>{T.bell.title}</strong>
        {unread > 0 ? (
          <a href="#" onClick={(e) => { e.preventDefault(); markAll(); }}>
            {T.bell.markAll}
          </a>
        ) : null}
      </div>
      {latest.length === 0 ? (
        <div className="bell-empty">
          <Bi name={failed ? 'wifi-off' : 'check2-circle'} /> {failed ? tr("Could not check for new ones.") : T.bell.empty}
        </div>
      ) : (
        latest.slice(0, 5).map((n) => (
          <a key={n.id} className={`dropdown-item bell-item nt-bell-item ${n.readAt === null ? 'unread' : ''} ${n.priority === 'important' ? 'warning' : 'info'}`} href="#" onClick={(e) => { e.preventDefault(); open(n.id, n.readAt === null); }}>
            <Bi name={n.priority === 'important' ? 'exclamation-circle-fill' : n.readAt === null ? 'circle-fill' : 'circle'} />
            <span>
              <strong>{n.title}</strong>
              <small>
                {showHotel ? `${n.hotelName} · ` : ''}
                {formatDateTime(n.createdAt)}
              </small>
            </span>
          </a>
        ))
      )}
      <a className="dropdown-item bell-item info" href="#" onClick={(e) => { e.preventDefault(); navigate('corporate.notifications'); }}>
        <Bi name="bell" />
        <span>
          {T.bell.all} →
        </span>
      </a>
    </Dropdown>
  );
}