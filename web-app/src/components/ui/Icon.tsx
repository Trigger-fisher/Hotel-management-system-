// Dashboard icons: Hotel Pallav's Bootstrap Icons 1.11.3 glyphs (ui-shared/icons/bootstrap.ts, filled, 16 viewBox).
// The older 24-box line set below only answers names that have no Bootstrap glyph.
// Covers every icon name in ui-shared/dashboards/nav.ts plus the names listed in the S03 brief.
import type { ReactNode } from 'react';
import { BOOTSTRAP_ICON_VIEWBOX, bootstrapIconFor } from '@shared/icons/bootstrap';

const paths = {
  // ---- nav.ts ----
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v10a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9" />
      <path d="M9.5 20.5v-6h5v6" />
    </>
  ),
  bed: (
    <>
      <path d="M3 18.5V6" />
      <path d="M3 14h18v4.5" />
      <path d="M21 14v-2.5a3 3 0 0 0-3-3h-7V14" />
      <circle cx="7" cy="11" r="2" />
    </>
  ),
  utensils: (
    <>
      <path d="M6 3v7a2 2 0 0 0 2 2v9" />
      <path d="M10 3v7a2 2 0 0 1-2 2" />
      <path d="M8 3v5" />
      <path d="M17.5 21V3c-2 1.2-3 3.5-3 6.5V14h3" />
    </>
  ),
  receipt: (
    <>
      <path d="M5.5 3.5h13v17l-2.2-1.4-2.1 1.4-2.2-1.4-2.2 1.4-2.1-1.4-2.2 1.4Z" />
      <path d="M9 8h6" />
      <path d="M9 11.5h6" />
      <path d="M9 15h3.5" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4v4h4" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.75 20a7.25 7.25 0 0 1 14.5 0" />
    </>
  ),
  wallet: (
    <>
      <path d="M19 7.5V6a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 6v12A1.5 1.5 0 0 0 5 19.5h14a1.5 1.5 0 0 0 1.5-1.5V9A1.5 1.5 0 0 0 19 7.5H5" />
      <path d="M16.5 13.5h.1" />
    </>
  ),
  book: (
    <>
      <path d="M4.5 19V5a1.5 1.5 0 0 1 1.5-1.5h12.5v14H6a1.5 1.5 0 0 0-1.5 1.5Z" />
      <path d="M4.5 19A1.5 1.5 0 0 0 6 20.5h12.5v-3" />
      <path d="M9 8h5.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.25" />
      <path d="M3 19.5a6 6 0 0 1 12 0" />
      <path d="M15.5 5.5a3.25 3.25 0 0 1 0 6" />
      <path d="M17.5 14a6 6 0 0 1 3.5 5.5" />
    </>
  ),
  building: (
    <>
      <path d="M4.5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 15.5 5v15.5" />
      <path d="M15.5 9.5H18a1.5 1.5 0 0 1 1.5 1.5v9.5" />
      <path d="M3 20.5h18" />
      <path d="M8 7.5h1M11 7.5h1M8 11h1M11 11h1M8 14.5h1M11 14.5h1" />
    </>
  ),
  chart: (
    <>
      <path d="M3.5 3.5v17h17" />
      <path d="M8 16.5v-4" />
      <path d="M12 16.5V8" />
      <path d="M16 16.5v-6" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4M16 3v4" />
    </>
  ),
  login: (
    <>
      <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14" />
      <path d="M10 8l4 4-4 4" />
      <path d="M14 12H4.5" />
    </>
  ),
  door: (
    <>
      <path d="M5.5 20.5V4.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v16" />
      <path d="M3.5 20.5h17" />
      <path d="M14.5 12.5v.1" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M12 4.5v15" />
      <path d="m6 13.5 6 6 6-6" />
    </>
  ),
  arrowUp: (
    <>
      <path d="M12 19.5v-15" />
      <path d="m6 10.5 6-6 6 6" />
    </>
  ),
  swap: (
    <>
      <path d="M4 8h14" />
      <path d="m14.5 4.5 3.5 3.5-3.5 3.5" />
      <path d="M20 16H6" />
      <path d="m9.5 12.5-3.5 3.5 3.5 3.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3.5" y="7" width="17" height="13" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M3.5 12.5h17" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5Z" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13.5 6 5.5a1.5 1.5 0 0 1 1.4-1h9.2a1.5 1.5 0 0 1 1.4 1l2.5 8" />
      <path d="M3.5 13.5V18A1.5 1.5 0 0 0 5 19.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5H15a3 3 0 0 1-6 0Z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z" />
      <path d="m8.8 12.2 2.3 2.3 4.2-4.3" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.5 6.5h.1M4.5 12h.1M4.5 17.5h.1" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1h-.2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h3" />
    </>
  ),
  activity: <path d="M3 12h4l3-7.5 4 15 3-7.5h4" />,
  tag: (
    <>
      <path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1a1 1 0 0 1 .7.3l7.4 7.4a1.5 1.5 0 0 1 0 2.1l-7.2 7.2a1.5 1.5 0 0 1-2.1 0l-7.6-7.6a.9.9 0 0 1-.3-.3Z" />
      <path d="M8 8h.1" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4.5L19 9.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20Z" />
      <path d="m14 8.5 3 3" />
    </>
  ),
  file: (
    <>
      <path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M9 12.5h6M9 16h4" />
    </>
  ),
  gift: (
    <>
      <rect x="3.5" y="8" width="17" height="4" rx="1" />
      <path d="M5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7" />
      <path d="M12 8v12.5" />
      <path d="M12 8c-1-3-5.5-4-5.5-1.5S10 8 12 8Zm0 0c1-3 5.5-4 5.5-1.5S14 8 12 8Z" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10" />
      <path d="M15 8l4 4-4 4" />
      <path d="M19 12H9.5" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="m20.5 16-4.5-4.5-9 8" />
    </>
  ),
  // ---- brief extras ----
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5l.8-12" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.4-4.4" />
    </>
  ),
  filter: <path d="M4 5h16l-6.2 7.4v5.3l-3.6 1.8v-7.1Z" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronUp: <path d="m6 14.5 6-6 6 6" />,
  more: (
    <>
      <path d="M5.5 12h.1M12 12h.1M18.5 12h.1" strokeWidth={2.5} />
    </>
  ),
  moreVertical: <path d="M12 5.5v.1M12 12v.1M12 18.5v.1" strokeWidth={2.5} />,
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8.5V3.5h10v5" />
      <rect x="3.5" y="8.5" width="17" height="8" rx="2" />
      <path d="M7 14h10v6.5H7Z" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 0 1-14.3 4.9" />
      <path d="M4 12a8 8 0 0 1 14.3-4.9" />
      <path d="M18.5 3.5v3.8h-3.8" />
      <path d="M5.5 20.5v-3.8h3.8" />
    </>
  ),
  phone: (
    <path d="M5 3.5h3.2l1.6 4.2-2.1 1.4a10.5 10.5 0 0 0 7.2 7.2l1.4-2.1 4.2 1.6V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5Z" />
  ),
  mapPin: (
    <>
      <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.2 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17v.1" />
    </>
  ),
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.4v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6v.1" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8 12.5 2.7 2.7L16.5 9.5" />
    </>
  ),
  star: (
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z" />
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2" />
    </>
  ),
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  // ---- shell and common extras ----
  arrowRight: (
    <>
      <path d="M4.5 12h15" />
      <path d="m13.5 6 6 6-6 6" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M19.5 12h-15" />
      <path d="m10.5 6-6 6 6 6" />
    </>
  ),
  panelLeft: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  wifiOff: (
    <>
      <path d="m3.5 3.5 17 17" />
      <path d="M8.5 16a5 5 0 0 1 7 0" />
      <path d="M5 12.5a10 10 0 0 1 5-2.6M14 10a10 10 0 0 1 5 2.5" />
      <path d="M2 9a14.5 14.5 0 0 1 5-3M11 5a14.5 14.5 0 0 1 11 4" />
      <path d="M12 19.5v.1" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 5v8A1.5 1.5 0 0 0 6 14.5h.5" />
    </>
  ),
  send: (
    <>
      <path d="M20.5 3.5 10 14" />
      <path d="m20.5 3.5-6.5 17-4-6.5-6.5-4Z" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.9 12.1 8.6-8.6" />
      <path d="m16.5 6.5 2.5 2.5" />
      <path d="m14 9 2 2" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  rupee: (
    <>
      <path d="M6.5 4.5h11M6.5 9h11" />
      <path d="M9 4.5h1.5a4.5 4.5 0 0 1 0 9H6.5l8 6.5" />
    </>
  ),
  percent: (
    <>
      <path d="M18.5 5.5 5.5 18.5" />
      <circle cx="7" cy="7" r="2.25" />
      <circle cx="17" cy="17" r="2.25" />
    </>
  ),
  save: (
    <>
      <path d="M5 3.5h11l3.5 3.5v12A1.5 1.5 0 0 1 18 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z" />
      <path d="M8 3.5v5h7v-5" />
      <path d="M7.5 20.5v-6h9v6" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.4 5.6a9.6 9.6 0 0 1 1.6-.1c6 0 9.5 6.5 9.5 6.5a16.6 16.6 0 0 1-2.4 3.2" />
      <path d="M6.7 6.7C4.1 8.4 2.5 12 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 5.3-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3.5 3.5 17 17" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="8" />,
  linkOff: (
    <>
      <path d="M9.5 14.5 8 16a3.5 3.5 0 0 1-5-5l2.5-2.5" />
      <path d="M14.5 9.5 16 8a3.5 3.5 0 0 1 5 5l-2.5 2.5" />
      <path d="m3.5 3.5 17 17" />
    </>
  ),
  sparkle: <path d="M12 3.5c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7Z" />,
} satisfies Record<string, ReactNode>;

type KitIconName = keyof typeof paths;

/** Names used by the sign-in screens (Material style) map onto this one set. */
const aliases = {
  check_circle: 'checkCircle',
  error: 'alertCircle',
  warning: 'alert',
  schedule: 'clock',
  link_off: 'linkOff',
  radio_button_unchecked: 'circle',
  content_copy: 'copy',
  chevron_left: 'chevronLeft',
  chevron_down: 'chevronDown',
  wifi_off: 'wifiOff',
  person: 'user',
  eye_off: 'eyeOff',
  arrow_right: 'arrowRight',
} as const satisfies Record<string, KitIconName>;

export type IconName = KitIconName | keyof typeof aliases;

/** Every icon name this set draws (for docs and checks). */
export const iconNames = Object.keys(paths) as IconName[];

function resolve(name: string): KitIconName | null {
  if (Object.prototype.hasOwnProperty.call(paths, name)) return name as KitIconName;
  if (Object.prototype.hasOwnProperty.call(aliases, name)) return aliases[name as keyof typeof aliases];
  return null;
}

export function hasIcon(name: string): name is IconName {
  return resolve(name) !== null;
}

export interface IconProps {
  /** Icon name (nav.ts names plus the kit list). Unknown names draw a neutral dot so nothing breaks. */
  name: string;
  /** px, default 20 (spec: 16 / 18 / 20). */
  size?: number;
  /** CSS colour; default currentColor. */
  color?: string;
  className?: string;
  /** Line weight; default 1.75 (only control marks such as a tick use more). */
  strokeWidth?: number;
}

/** Decorative line icon (aria-hidden). Give the parent control its accessible name. */
export function Icon({ name, size = 20, color, className, strokeWidth = 1.75 }: IconProps) {
  const glyph = bootstrapIconFor(name);
  if (glyph) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${BOOTSTRAP_ICON_VIEWBOX} ${BOOTSTRAP_ICON_VIEWBOX}`}
        fill={color ?? 'currentColor'}
        aria-hidden="true"
        focusable="false"
        className={className}
        style={{ flexShrink: 0 }}
      >
        {glyph.map((g, i) => (
          <path key={i} d={g.d} fillRule={g.evenodd ? 'evenodd' : undefined} />
        ))}
      </svg>
    );
  }
  const key = resolve(name);
  const body = key ? paths[key] : <circle cx="12" cy="12" r="3" />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ flexShrink: 0 }}
    >
      {body}
    </svg>
  );
}
