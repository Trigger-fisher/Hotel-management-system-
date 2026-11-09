// Dashboard CSS variables (--d-*), built only from ui-shared tokens.
// Look: docs/design/ui-review/10-DASHBOARD-DESIGN-SPEC.md. Night follows the device (no toggle), using auth.night.
import { auth, color, font, layout, motion, radius, shadow } from '@shared/tokens';
import type { Tone } from '@shared/dashboards/common';

const px = (n: number) => `${n}px`;
const v = color.graphite;
const n = auth.night;
const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

type ToneSet = { bg: string; fg: string; border: string };

const dayTones: Record<Tone, ToneSet> = {
  neutral: { bg: color.surfaceMuted, fg: color.textSecondary, border: color.border },
  graphite: { bg: v[50], fg: v[700], border: v[200] },
  success: { bg: color.success.bg, fg: color.success.fg, border: color.success.border },
  warning: { bg: color.warning.bg, fg: color.warning.fg, border: color.warning.border },
  danger: { bg: color.danger.bg, fg: color.danger.fg, border: color.danger.border },
  info: { bg: color.info.bg, fg: color.info.fg, border: color.info.border },
};

const nightTones: Record<Tone, ToneSet> = {
  neutral: { bg: n.inset, fg: n.textSecondary, border: n.card.border },
  graphite: { bg: n.pill.bg, fg: n.pill.fg, border: n.secondary.border },
  success: n.note.success,
  warning: n.note.warning,
  danger: n.note.error,
  info: n.note.info,
};

const day: Record<string, string> = {
  page: color.bg,
  surface: color.surface,
  inset: color.surfaceMuted,
  'card-border': color.border,
  line: color.border,
  'border-strong': color.borderStrong,
  ink: color.text,
  'ink-2': color.textSecondary,
  muted: color.textMuted,
  input: color.inputBorder,
  'input-bg': color.surface,
  'input-hover': v[300],
  focus: v[500],
  ring: `0 0 0 ${px(auth.focusRing.width)} ${auth.focusRing.color}`,
  accent: v[700],
  'accent-strong': v[800],
  'accent-soft': v[50],
  'accent-soft-2': v[100],
  'primary-fill': `linear-gradient(${auth.button.angleDeg}deg, ${auth.button.gradient.join(', ')})`,
  'primary-fill-hover': `linear-gradient(${auth.button.angleDeg}deg, ${auth.button.gradientHover.join(', ')})`,
  'primary-shadow': auth.button.shadow,
  'primary-shadow-hover': auth.button.shadowHover,
  'on-primary': color.onPrimary,
  'sec-bg': color.surface,
  'sec-fg': v[700],
  'sec-border': color.borderStrong,
  'sec-hover-bg': v[50],
  'sec-hover-border': v[400],
  'sec-hover-fg': v[700],
  'ghost-hover': v[50],
  'danger-solid': color.danger.fg,
  'danger-solid-hover': auth.note.error.fg,
  'danger-soft': auth.note.error.bg,
  'row-hover': v[50],
  'th-bg': v[50],
  'th-fg': v[800],
  bar: v[600],
  'check-fill': v[700],
  scrim: mix(color.text, 45),
  'shadow-xs': shadow.xs,
  'shadow-sm': shadow.sm,
  'shadow-md': shadow.md,
  'shadow-lg': shadow.lg,
  'shadow-xl': shadow.xl,
  'sidebar-bg': v[800],
  'sidebar-border': 'transparent',
  'sidebar-shadow': `0 22px 44px -22px ${mix(v[950], 65)}`,
  'on-brand': color.onBrand,
  'on-brand-82': color.onBrandMuted,
  'on-brand-72': auth.copyright,
  'brand-tile': auth.brandTile.fill,
  'brand-tile-border': auth.brandTile.border,
  'brand-tile-shadow': auth.brandTile.shadow,
  glass: mix(color.surface, 82),
  'toast-glass': mix(color.surface, 86),
  'skel-base': v[50],
  'skel-shine': v[100],
  'kpi-glow': v[100],
  gold: color.gold,
};
for (const [tone, s] of Object.entries(dayTones)) {
  day[`t-${tone}-bg`] = s.bg;
  day[`t-${tone}-fg`] = s.fg;
  day[`t-${tone}-border`] = s.border;
}

const night: Record<string, string> = {
  page: n.signedIn.page,
  surface: n.surface,
  inset: n.inset,
  'card-border': n.card.border,
  line: n.line,
  'border-strong': n.card.border,
  ink: n.text,
  'ink-2': n.textSecondary,
  muted: n.textMuted,
  input: n.input.border,
  'input-bg': n.inset,
  'input-hover': n.input.borderHover,
  focus: n.input.focus,
  ring: `0 0 0 ${px(auth.focusRing.width)} ${n.input.focusRing}`,
  accent: n.link,
  'accent-strong': n.linkHover,
  'accent-soft': n.pill.bg,
  'accent-soft-2': n.pill.bg,
  'primary-shadow': n.primaryShadow,
  'primary-shadow-hover': n.primaryShadow,
  'sec-bg': 'transparent',
  'sec-fg': n.secondary.fg,
  'sec-border': n.secondary.border,
  'sec-hover-bg': n.secondary.hoverBg,
  'sec-hover-border': n.secondary.hoverBorder,
  'sec-hover-fg': n.secondary.hoverFg,
  'ghost-hover': n.secondary.hoverBg,
  'danger-soft': n.note.error.bg,
  'row-hover': mix(v[500], 8),
  'th-bg': n.inset,
  'th-fg': n.textSecondary,
  bar: n.input.focus,
  'check-fill': v[600],
  scrim: n.dialogScrim,
  // Black-based shadows at night (spec 10 section 7).
  'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.35), 0 1px 3px rgba(0, 0, 0, 0.25)',
  'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.3)',
  'shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.3)',
  'shadow-lg': n.card.shadow,
  'shadow-xl': '0 8px 16px rgba(0, 0, 0, 0.4), 0 28px 64px rgba(0, 0, 0, 0.5)',
  'sidebar-bg': n.background.stops[1],
  'sidebar-border': n.card.border,
  'sidebar-shadow': '0 22px 44px -22px rgba(0, 0, 0, 0.7)',
  glass: n.signedIn.appBar,
  'toast-glass': mix(n.surface, 86),
  'skel-base': n.inset,
  'skel-shine': n.line,
  'kpi-glow': n.pill.bg,
};
for (const [tone, s] of Object.entries(nightTones)) {
  night[`t-${tone}-bg`] = s.bg;
  night[`t-${tone}-fg`] = s.fg;
  night[`t-${tone}-border`] = s.border;
}

const fixed: Record<string, string> = {
  'r-sm': px(radius.sm),
  'r-md': px(radius.md),
  'r-lg': px(radius.lg),
  'r-xl': px(radius.xl),
  'r-input': px(auth.input.radius),
  'r-btn': px(auth.button.radius),
  'r-frame': '22px',
  touch: px(layout.touchTarget),
  ease: motion.easeOut,
  fast: `${motion.fast}ms`,
  base: `${motion.base}ms`,
  slow: `${motion.slow}ms`,
};
for (const [name, [size, lh]] of Object.entries(font.size)) {
  fixed[`fs-${name}`] = px(size);
  fixed[`lh-${name}`] = px(lh);
}

const block = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, val]) => `--d-${k}:${val}`)
    .join(';');

const nightOnly: Record<string, string> = {};
for (const [k, val] of Object.entries(night)) if (val !== day[k]) nightOnly[k] = val;

/**
 * Injected once by the shell. Day values on :root, night values with the device setting.
 * The body behind the dashboard frame takes the page colour (the auth page body is graphite).
 */
export const dashThemeCss =
  `:root{${block({ ...fixed, ...day })}}` +
  `:root[data-theme="dark"]{${block(nightOnly)}}` +
  '';

/** Breakpoints used by the shell (px). */
export const breakpoints = layout.breakpoints;
