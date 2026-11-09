'use client';

// The browser alert for a notice that arrives while HMS is in a background tab (the Notification API, no service worker: decisions 6 and 23 keep HMS a web page,
// so nothing arrives while it is closed), and the switch on the Notices page that asks the browser to allow it. The pop-up itself is the top notch (shell/Notch.tsx).
import { useState } from 'react';

import type { PortalNotification } from '@shared/dashboards/notifications';
import { notificationsPortalCopyByLanguage } from '@shared/dashboards/notificationsCopy.lang';
import { useCopy } from '@/lib/i18n/language';

import { Bi } from '@/dashboards/pallav/ui';


/** The browser's own alert, only when the person allowed it and this tab is not the one on screen. */
export function browserAlert(n: PortalNotification): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  try {
    const alert = new Notification(n.title, { body: `${n.hotelName}${n.body ? ` · ${n.body.slice(0, 120)}` : ''}`, tag: `hms-notice-${n.id}` });
    alert.onclick = () => {
      window.focus();
      alert.close();
    };
  } catch {
    /* a browser that refuses: the pop-up in the page still shows */
  }
}

/** "Turn on desktop alerts" for the Notices page: asks the browser once, then says whether the alerts are on or blocked. */
export function DesktopAlertsSwitch() {
  const T = useCopy(notificationsPortalCopyByLanguage);
  // read once on the first client render (the switch is not drawn on the server: the Notices page renders in the browser)
  const [state, setState] = useState<NotificationPermission | 'unsupported'>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  if (state === 'unsupported') return null;
  if (state === 'granted')
    return (
      <span className="nt-desk on" title={T.desktop.hint}>
        <Bi name="check2" /> {T.desktop.on}
      </span>
    );
  if (state === 'denied')
    return (
      <span className="nt-desk" title={T.desktop.hint}>
        <Bi name="slash-circle" /> {T.desktop.blocked}
      </span>
    );
  return (
    // check-shared-ignore: a quiet text action beside the page head (asks the browser for alerts)
    <button type="button" className="nt-desk" title={T.desktop.hint} onClick={() => void Notification.requestPermission().then(setState)}>
      <Bi name="bell" /> {T.desktop.off}
    </button>
  );
}
