// Loads Pallav's own stylesheets (web-app/public/pallav) while the dashboard is open, and removes them on sign-out,
// so the login screens keep their own styles. Pallav's order is kept: base sheets, the page's own sheets,
// then night mode (pms-dark.css has the last word), then our small overrides.
// The base sheets and the last sheets travel as two bundles (speed, 24 Oct 2026): pallav-base.css and pallav-last.css are the source files below concatenated
// in this order, same bytes, two requests instead of twenty-one. scripts/bundle-pallav-css.mjs writes them (`npm run pallav:css`) and tests/pallavBundle.test.ts
// fails when a source sheet changed without the bundles being written again. Run it after every edit of a sheet named in BASE_SOURCES or LAST_SOURCES, and bump VERSION.

export const VERSION = '85';
/** The base sheets, in Pallav's order: what pallav-base.css is made of. */
export const BASE_SOURCES: readonly string[] = [
  'bootstrap.min.css', 'bootstrap-icons.css', 'layout.css', 'vendor/flatpickr.min.css', 'vendor/plugins-monthSelect-style.css', 'vendor/css-tom-select.bootstrap5.min.css', 'pms.css', 'pms-ui.css', 'pms-dash.css', 'pms-nav.css',
  'pms-payroll.css', 'pms-sidebar.css', 'pms-header.css', 'pms-filterbar.css',
];
// phone-h1..h5.css: the staff phone work of the five helper slices (WORK-SPLIT-2026-10-18); each slice owns one file, the shared phone kit stays in hms-overrides.css.
// areas/*.css (MJ, 5 Nov 2026): hms-overrides.css is closed to new rules; each area appends only to its own sheet, so two pieces of work never share an append point.
/** The sheets under public/pallav/areas, in the order they load (last word to the portals). */
export const AREA_SHEETS: readonly string[] = ['kit', 'shell', 'conversations', 'platform', 'group', 'hotel-admin', 'hotel-user', 'company', 'guest'].map((a) => `areas/${a}.css`);
/** Night mode, the overrides, the phone sheets and the area sheets, in order: what pallav-last.css is made of. */
export const LAST_SOURCES: readonly string[] = ['pms-dark.css', 'hms-overrides.css', 'phone-h1.css', 'phone-h2.css', 'phone-h3.css', 'phone-h4.css', 'phone-h5.css', ...AREA_SHEETS];
const BASE = ['pallav-base.css'];
const LAST = ['pallav-last.css'];
/** The two bundles in public/pallav and their sources (the bundler and its test read this). */
export const PALLAV_BUNDLES: Readonly<Record<string, readonly string[]>> = { [BASE[0]]: BASE_SOURCES, [LAST[0]]: LAST_SOURCES };
// A page's own list may name a sheet the base already holds (pms-dash.css for the portals, pms-payroll.css for a hotel's details): it is not loaded again,
// so the bundle keeps its place in the cascade, as the single sheet did.
const BUNDLED = new Set([...BASE_SOURCES, ...LAST_SOURCES, ...BASE, ...LAST]);

/** Every sheet a dashboard loads first, as addresses: app/layout.tsx preloads them on a reload so the real shell styles arrive with the outline. */
export const PALLAV_BASE_URLS: readonly string[] = [...BASE, ...LAST].map((name) => `/pallav/${name}?v=${VERSION}`);

const ATTR = 'data-pallav-css';

/** The stylesheets every dashboard needs, in Pallav's order, as the <link> attributes the server writes (page = the sheets of the screen the dashboard opens on, so that screen is not restyled when its own sheet arrives) into the first HTML of a signed-in page (R48: the shell is styled at first paint). Same name attribute as the ones added in the browser, so they are found and reused. */
export const pallavHeadSheets = (page: string[] = []): { name: string; href: string }[] => {
  // each sheet once: a page's own list may name one the base already loads (pms-dash.css for the portals), and two <link> with the same key break React's
  // list on the first page; the base keeps its place and the last sheets stay last (pms-dark.css and the overrides keep the final word)
  const own = [...new Set(page)].filter((name) => !BUNDLED.has(name));
  return [...BASE, ...own, ...LAST].map((name) => ({ name, href: `/pallav/${name}?v=${VERSION}` }));
};
export const PALLAV_CSS_ATTR = ATTR;
/**
 * Marks the sheets the server wrote into the first HTML (app/layout.tsx). React owns those <link> elements: removing one by hand makes React's own later
 * removal throw ("removeChild: not a child of this node") and the whole app falls over. So they are never removed, only switched off (media "not all": the
 * browser ignores the sheet, which stays loaded) and switched on again. Sheets added here in the browser are still removed as before.
 */
export const PALLAV_SSR_ATTR = 'data-pallav-ssr';

function drop(l: HTMLLinkElement): void {
  if (l.hasAttribute(PALLAV_SSR_ATTR)) l.media = 'not all';
  else l.remove();
}

function link(name: string): HTMLLinkElement {
  const existing = document.head.querySelector<HTMLLinkElement>(`link[${ATTR}="${name}"]`);
  if (existing) {
    if (existing.media === 'not all') existing.removeAttribute('media');
    return existing;
  }
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `/pallav/${name}?v=${VERSION}`;
  l.setAttribute(ATTR, name);
  return l;
}

function loaded(l: HTMLLinkElement): Promise<void> {
  return new Promise((resolve) => {
    if (l.sheet) return resolve();
    l.addEventListener('load', () => resolve(), { once: true });
    // A missing file must not hold the screen forever.
    l.addEventListener('error', () => resolve(), { once: true });
  });
}

/** True when every base sheet is on the page and parsed: a frame mounting then has nothing to wait for. */
export function pallavBaseReady(): boolean {
  return [...BASE, ...LAST].every((name) => document.head.querySelector<HTMLLinkElement>(`link[${ATTR}="${name}"]`)?.sheet != null);
}

/** Adds the base sheets (idempotent) and resolves when they are all ready. */
export function loadPallavBase(): Promise<void> {
  const tail = document.head.querySelector(`link[${ATTR}="${LAST[0]}"]`);
  const waits: Promise<void>[] = [];
  for (const name of [...BASE, ...LAST]) {
    const l = link(name);
    if (!l.isConnected) {
      // Base sheets stay before night mode, which stays last.
      if (LAST.includes(name) || !tail) document.head.appendChild(l);
      else document.head.insertBefore(l, tail);
    }
    waits.push(loaded(l));
  }
  return Promise.all(waits).then(() => undefined);
}

/** Makes exactly `names` the page's own sheets (placed before night mode); one the base bundle already holds is not added. */
export function setPageSheets(names: string[]): Promise<void> {
  const own = names.filter((name) => !BUNDLED.has(name));
  const keep = new Set([...BASE, ...LAST, ...own]);
  document.head.querySelectorAll<HTMLLinkElement>(`link[${ATTR}]`).forEach((l) => {
    if (!keep.has(l.getAttribute(ATTR) ?? '')) drop(l);
  });
  const tail = document.head.querySelector(`link[${ATTR}="${LAST[0]}"]`);
  const waits: Promise<void>[] = [];
  for (const name of own) {
    const l = link(name);
    if (!l.isConnected) {
      if (tail) document.head.insertBefore(l, tail);
      else document.head.appendChild(l);
    }
    waits.push(loaded(l));
  }
  return Promise.all(waits).then(() => undefined);
}

/** Removes every Pallav sheet (sign-out). */
export function unloadPallav(): void {
  document.head.querySelectorAll<HTMLLinkElement>(`link[${ATTR}]`).forEach(drop);
  document.documentElement.removeAttribute('data-theme');
  document.body.classList.remove('has-subnav', 'no-subnav', 'sidebar-collapsed', 'subnav-hidden', 'sidebar-peeking', 'subnav-peeking', 'tb-scrolled', 'hms-guest', 'hms-glass', 'gg-has-large', 'gg-titled');
}
