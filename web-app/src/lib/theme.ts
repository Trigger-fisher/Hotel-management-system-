// Turns the shared design tokens (ui-shared/tokens.ts) into CSS variables, so the
// web styles never copy a colour or size by hand. globals.css maps them into Tailwind.
import { dashThemeCss } from "@/components/ui/dashTheme";
import { auth, color, font, layout, motion, radius, shadow } from "@shared/tokens";

const px = (n: number) => `${n}px`;

const vars: Record<string, string> = {
  "--hms-bg": color.bg,
  "--hms-surface": color.surface,
  "--hms-surface-muted": color.surfaceMuted,
  "--hms-text": color.text,
  "--hms-text-secondary": color.textSecondary,
  "--hms-text-muted": color.textMuted,
  "--hms-border": color.border,
  "--hms-border-strong": color.borderStrong,
  "--hms-input-border": color.inputBorder,
  "--hms-primary": color.primary,
  "--hms-primary-hover": color.primaryHover,
  "--hms-primary-pressed": color.primaryPressed,
  "--hms-on-primary": color.onPrimary,
  "--hms-link": color.link,
  "--hms-focus-ring": color.focusRing,
  "--hms-gold": color.gold,
  "--hms-graphite-100": color.graphite[100],
  "--hms-graphite-800": color.graphite[800],
  "--hms-on-brand": color.onBrand,
  "--hms-on-brand-muted": color.onBrandMuted,
  "--hms-brand-gradient": `linear-gradient(135deg, ${color.brandGradient.join(", ")})`,
  "--hms-success-fg": color.success.fg,
  "--hms-success-bg": color.success.bg,
  "--hms-success-border": color.success.border,
  "--hms-warning-fg": color.warning.fg,
  "--hms-warning-bg": color.warning.bg,
  "--hms-warning-border": color.warning.border,
  "--hms-danger-fg": color.danger.fg,
  "--hms-danger-bg": color.danger.bg,
  "--hms-danger-border": color.danger.border,
  "--hms-info-fg": color.info.fg,
  "--hms-info-bg": color.info.bg,
  "--hms-info-border": color.info.border,
  "--hms-radius-sm": px(radius.sm),
  "--hms-radius-md": px(radius.md),
  "--hms-radius-lg": px(radius.lg),
  "--hms-radius-xl": px(radius.xl),
  "--hms-shadow-sm": shadow.sm,
  "--hms-shadow-md": shadow.md,
  "--hms-shadow-lg": shadow.lg,
  "--hms-ease-out": motion.easeOut,
  "--hms-dur-fast": `${motion.fast}ms`,
  "--hms-dur-base": `${motion.base}ms`,
  "--hms-dur-slow": `${motion.slow}ms`,
  "--hms-input-height": px(layout.inputHeight),
  "--hms-touch": px(layout.touchTarget),
  "--hms-card-max": px(layout.authCardMaxWidth),
};

// Full graphite scale (Pallav p50..p950).
for (const [step, value] of Object.entries(color.graphite)) vars[`--hms-graphite-${step}`] = value;

// ---- Pallav auth look (docs/design/ui-review/09-PALLAV-DESIGN-SPEC.md) ----
const bg = auth.background;
const fade = (f: number) => `transparent ${Math.round(f * 100)}%`;
const glows = bg.glowShapes.map(
  (g, i) => `radial-gradient(${g.width}px ${g.height}px at ${g.x}% ${g.y}%, ${bg.glows[i]}, ${fade(bg.glowFadeAt)})`,
);
Object.assign(vars, {
  "--hms-auth-bg": [...glows, `linear-gradient(${bg.angleDeg}deg, ${bg.stops[0]} 0%, ${bg.stops[1]} 50%, ${bg.stops[2]} 100%)`].join(", "),
  "--hms-auth-bg-base": bg.stops[0],
  "--hms-auth-ring-1": `radial-gradient(circle, ${bg.rings[0]}, ${fade(bg.ringFadeAt)})`,
  "--hms-auth-ring-2": `radial-gradient(circle, ${bg.rings[1]}, ${fade(bg.ringFadeAt)})`,
  "--hms-auth-ring-border": bg.ringBorder,
  "--hms-auth-ring-1-size": px(bg.ringShapes[0].size),
  "--hms-auth-ring-1-right": px(bg.ringShapes[0].right),
  "--hms-auth-ring-1-top": px(bg.ringShapes[0].top),
  "--hms-auth-ring-2-size": px(bg.ringShapes[1].size),
  "--hms-auth-ring-2-left": px(bg.ringShapes[1].left),
  "--hms-auth-ring-2-bottom": px(bg.ringShapes[1].bottom),
  "--hms-auth-tile-size": px(auth.brandTile.size),
  "--hms-auth-tile-radius": px(auth.brandTile.radius),
  "--hms-auth-tile-fill": auth.brandTile.fill,
  "--hms-auth-tile-border": auth.brandTile.border,
  "--hms-auth-tile-shadow": auth.brandTile.shadow,
  "--hms-auth-tagline": auth.tagline,
  "--hms-auth-card-max": px(auth.card.maxWidth),
  "--hms-auth-card-radius": px(auth.card.radius),
  "--hms-auth-card-radius-phone": px(auth.card.phoneRadius),
  "--hms-auth-card-border": auth.card.border,
  "--hms-auth-card-shadow": auth.card.shadow,
  "--hms-auth-card-pad": `${px(auth.card.padding.top)} ${px(auth.card.padding.x)} ${px(auth.card.padding.bottom)}`,
  "--hms-auth-card-pad-phone": `${px(auth.card.phonePadding.top)} ${px(auth.card.phonePadding.x)} ${px(auth.card.phonePadding.bottom)}`,
  "--hms-auth-input-radius": px(auth.input.radius),
  "--hms-auth-input-height": px(auth.input.height),
  "--hms-auth-btn-radius": px(auth.button.radius),
  "--hms-auth-btn-fill": `linear-gradient(${auth.button.angleDeg}deg, ${auth.button.gradient.join(", ")})`,
  "--hms-auth-btn-fill-hover": `linear-gradient(${auth.button.angleDeg}deg, ${auth.button.gradientHover.join(", ")})`,
  "--hms-auth-btn-shadow": auth.button.shadow,
  "--hms-auth-btn-shadow-hover": auth.button.shadowHover,
  "--hms-auth-focus-ring": `0 0 0 ${px(auth.focusRing.width)} ${auth.focusRing.color}`,
  "--hms-auth-title": px(auth.title.size),
  "--hms-auth-title-leading": px(auth.title.lineHeight),
  "--hms-auth-title-phone": px(auth.title.phoneSize),
  "--hms-auth-title-weight": auth.title.weight,
  "--hms-auth-copyright": auth.copyright,
  "--hms-auth-note-success-bg": auth.note.success.bg,
  "--hms-auth-note-success-border": auth.note.success.border,
  "--hms-auth-note-success-fg": auth.note.success.fg,
  "--hms-auth-note-error-bg": auth.note.error.bg,
  "--hms-auth-note-error-border": auth.note.error.border,
  "--hms-auth-note-error-fg": auth.note.error.fg,
});

// ---- Role colours for the auth screens and signedIn. Components use ONLY these names
// (Tailwind: bg-card, text-ink, border-input…), so night mode is just a second value set. ----
const v = color.graphite;
const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
export const dayRoles: Record<string, string> = {
  "page-base": auth.background.stops[0],
  card: color.surface,
  "card-border": auth.card.border,
  "card-shadow": auth.card.shadow,
  inset: color.surface,
  hairline: color.border,
  ink: color.text,
  "ink-2": color.textSecondary,
  "ink-muted": color.textMuted,
  input: color.inputBorder,
  "input-hover": v[300],
  "input-focus": v[500],
  "focus-ring": `0 0 0 ${auth.focusRing.width}px ${auth.focusRing.color}`,
  "field-icon": color.textMuted,
  "reveal-hover": v[50],
  "reveal-hover-ink": v[700],
  link: v[700],
  "link-hover": v[800],
  pill: v[50],
  "pill-ink": v[700],
  status: v[100],
  "status-ink": v[700],
  "cta-shadow": auth.button.shadow,
  "cta-shadow-hover": auth.button.shadowHover,
  sec: color.surface,
  "sec-ink": v[700],
  "sec-border": color.borderStrong,
  "sec-hover": v[50],
  "sec-hover-border": v[400],
  "sec-hover-ink": v[700],
  "note-success-bg": auth.note.success.bg,
  "note-success-border": auth.note.success.border,
  "note-success-fg": auth.note.success.fg,
  "note-error-bg": auth.note.error.bg,
  "note-error-border": auth.note.error.border,
  "note-error-fg": auth.note.error.fg,
  "note-info-bg": color.info.bg,
  "note-info-border": color.info.border,
  "note-info-fg": color.info.fg,
  "note-warning-bg": color.warning.bg,
  "note-warning-border": color.warning.border,
  "note-warning-fg": color.warning.fg,
  aside: v[50],
  "aside-ink": color.textSecondary,
  "aside-icon": v[500],
  "rule-met": color.success.fg,
  "rule-unmet": color.textMuted,
  "rule-bad": color.danger.fg,
  "check-border": color.inputBorder,
  "check-fill": v[700],
  codes: color.surfaceMuted,
  "codes-ink": color.text,
  "chip-bg": color.bg,
  "chip-border": color.borderStrong,
  "chip-tile": v[100],
  "chip-tile-ink": v[700],
  app: color.bg,
  appbar: mix(color.surface, 82),
  "appbar-border": color.border,
  "role-card": color.surface,
  "role-card-border": color.border,
  dashed: color.borderStrong,
  dialog: color.surface,
  "dialog-border": color.border,
  scrim: mix(color.text, 40),
};
for (const [k, val] of Object.entries(dayRoles)) vars[`--r-${k}`] = val;

// Night mode: the person's own choice with the theme toggle, never the device (MJ, 5 Nov 2026). Same role names, night values.
const n = auth.night;
const nb = n.background;
export const nightRoles: Record<string, string> = {
  ...dayRoles,
  "page-base": nb.stops[0],
  card: n.surface,
  "card-border": n.card.border,
  "card-shadow": `${n.card.highlight}, ${n.card.shadow}`,
  inset: n.inset,
  hairline: n.line,
  ink: n.text,
  "ink-2": n.textSecondary,
  "ink-muted": n.textMuted,
  input: n.input.border,
  "input-hover": n.input.borderHover,
  "input-focus": n.input.focus,
  "focus-ring": `0 0 0 ${auth.focusRing.width}px ${n.input.focusRing}`,
  "field-icon": n.textMuted,
  "reveal-hover": n.secondary.hoverBg,
  "reveal-hover-ink": n.linkHover,
  link: n.link,
  "link-hover": n.linkHover,
  pill: n.pill.bg,
  "pill-ink": n.pill.fg,
  status: n.statusIcon.bg,
  "status-ink": n.statusIcon.fg,
  "cta-shadow": n.primaryShadow,
  "cta-shadow-hover": n.primaryShadow,
  sec: "transparent",
  "sec-ink": n.secondary.fg,
  "sec-border": n.secondary.border,
  "sec-hover": n.secondary.hoverBg,
  "sec-hover-border": n.secondary.hoverBorder,
  "sec-hover-ink": n.secondary.hoverFg,
  "note-success-bg": n.note.success.bg,
  "note-success-border": n.note.success.border,
  "note-success-fg": n.note.success.fg,
  "note-error-bg": n.note.error.bg,
  "note-error-border": n.note.error.border,
  "note-error-fg": n.note.error.fg,
  "note-info-bg": n.note.info.bg,
  "note-info-border": n.note.info.border,
  "note-info-fg": n.note.info.fg,
  "note-warning-bg": n.note.warning.bg,
  "note-warning-border": n.note.warning.border,
  "note-warning-fg": n.note.warning.fg,
  aside: n.aside.bg,
  "aside-ink": n.textSecondary,
  "aside-icon": n.aside.icon,
  "rule-met": n.note.success.fg,
  "rule-unmet": n.textMuted,
  "rule-bad": n.note.error.fg,
  "check-border": n.input.border,
  "check-fill": v[600],
  codes: n.inset,
  "codes-ink": n.text,
  "chip-bg": n.inset,
  "chip-border": n.secondary.border,
  "chip-tile": n.pill.bg,
  "chip-tile-ink": n.pill.fg,
  app: n.signedIn.page,
  appbar: n.signedIn.appBar,
  "appbar-border": n.line,
  "role-card": n.surface,
  "role-card-border": n.card.border,
  dashed: n.card.border,
  dialog: n.surface,
  "dialog-border": n.card.border,
  scrim: n.dialogScrim,
};
const nightVars: Record<string, string> = {};
for (const [k, val] of Object.entries(nightRoles)) if (val !== dayRoles[k]) nightVars[`--r-${k}`] = val;
const nightGlows = bg.glowShapes.map(
  (g, i) => `radial-gradient(${g.width}px ${g.height}px at ${g.x}% ${g.y}%, ${nb.glows[i]}, ${fade(bg.glowFadeAt)})`,
);
Object.assign(nightVars, {
  "--hms-auth-bg": [...nightGlows, `linear-gradient(${nb.angleDeg}deg, ${nb.stops[0]} 0%, ${nb.stops[1]} ${Math.round(nb.middleAt * 100)}%, ${nb.stops[2]} 100%)`].join(", "),
  "--hms-auth-bg-base": nb.stops[0],
  "--hms-auth-ring-1": `radial-gradient(circle, ${nb.rings[0]}, ${fade(bg.ringFadeAt)})`,
  "--hms-auth-ring-2": `radial-gradient(circle, ${nb.rings[1]}, ${fade(bg.ringFadeAt)})`,
  "--hms-auth-ring-border": nb.ringBorder,
});

for (const [name, [size, lh]] of Object.entries(font.size)) {
  vars[`--hms-text-${name}`] = px(size);
  vars[`--hms-leading-${name}`] = px(lh);
}
for (const [name, weight] of Object.entries(font.weight)) vars[`--hms-weight-${name}`] = weight;
// The sign-in title's line height as a ratio of its size (30 / 25), for CSS that must follow a size that changes on phones.
vars["--hms-leading-ratio-title"] = String(auth.title.lineHeight / auth.title.size);

const block = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, val]) => `${k}:${val}`)
    .join(";");

/**
 * One theme for the whole app: the sign-in roles (--hms-* / --r-*) and the shared component library
 * (--d-*, built in components/ui/dashTheme.ts from the same ui-shared tokens). Injected once by the root layout.
 * Day values on :root; night values only under <html data-theme="dark">, set only when the signed-in person chose night (MJ, 5 Nov 2026: never the device's setting).
 */
export const themeCss = `:root{${block(vars)}}:root[data-theme="dark"]{${block(nightVars)}}${dashThemeCss}`;
