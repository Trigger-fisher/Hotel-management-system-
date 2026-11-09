// Design tokens shared by the web-app.
// Based on the Hotel Pallav look (docs/design/PALLAV_UI_REVIEW_2026-10-04.md), improved:
// calmer (solid buttons, no decoration overload), WCAG AA text contrast, 4px spacing scale.
// Night mode follows the device automatically, with NO toggle (MJ 2026-10-05, all auth screens + signedIn).
// Night values: `auth.night` below (spec: "docs/design/ui-review/09-PALLAV-DESIGN-SPEC.md" section 10, all pairs AA).

export const color = {
  graphite: {
    50: '#F6F6F7', 100: '#EDEDF0', 200: '#E1E1E6', 300: '#B4B4BC', 400: '#8E8E98',
    500: '#6B7080', 600: '#111114', 700: '#2B2B31', 800: '#3A3A42', 900: '#111114', 950: '#111114',
  },
  gold: '#C9A227',

  // Semantic (use these in screens, not the raw scale)
  bg: '#FAFAFB',
  surface: '#FFFFFF',
  surfaceMuted: '#F6F6F7',
  text: '#111114', // 16.9:1 on white
  textSecondary: '#3A3A42', // 9.4:1 on white
  textMuted: '#5D606B', // 6.6:1 on white (Pallav's #6B7080 failed AA at small sizes)
  border: '#E1E1E6',
  borderStrong: '#D0D0D6',
  inputBorder: '#D0D0D6', // Pallav's resting field border (MJ 2026-10-06: copy Pallav exactly)

  primary: '#2B2B31', // button fill, 7.1:1 with white text
  primaryHover: '#3A3A42',
  primaryPressed: '#111114',
  onPrimary: '#FFFFFF',
  link: '#2B2B31',
  focusRing: 'rgba(17, 17, 20, 0.35)',

  success: { fg: '#15803D', bg: '#DCFCE7', border: '#86EFAC' },
  warning: { fg: '#B45309', bg: '#FEF3C7', border: '#FCD34D' },
  danger: { fg: '#B91C1C', bg: '#FEE2E2', border: '#FCA5A5' },
  info: { fg: '#1D4ED8', bg: '#DBEAFE', border: '#93C5FD' },

  /** Brand panel background (web left panel, mobile header). */
  brandGradient: ['#111114', '#3A3A42', '#2B2B31'] as const,
  onBrand: '#FFFFFF',
  onBrandMuted: 'rgba(255, 255, 255, 0.82)', // still AA on #3A3A42
} as const;

/**
 * Auth page look: Hotel Pallav sign-in design, improved (MJ 2026-10-05).
 * Full spec: "docs/design/ui-review/09-PALLAV-DESIGN-SPEC.md". All text colours AA-checked:
 * white on the button gradient >= 5.7:1, 72% white copyright >= 5.4:1.
 */
export const auth = {
  background: {
    angleDeg: 160,
    /** Base gradient stops. */
    stops: ['#111114', '#1B1B20', '#3A3A42'] as const,
    glows: ['rgba(17, 17, 20, 0.45)', 'rgba(17, 17, 20, 0.55)'] as const,
    /** Radial glows: size and centre (percent of the page); colour fades out at fadeAt. */
    glowShapes: [
      { width: 900, height: 600, x: 15, y: 0 },
      { width: 800, height: 600, x: 100, y: 100 },
    ] as const,
    glowFadeAt: 0.6,
    rings: ['rgba(180, 180, 188, 0.14)', 'rgba(201, 162, 39, 0.08)'] as const,
    /** Two static rings. Offsets are px from the page edges (negative = partly off screen). */
    ringShapes: [
      { size: 720, right: -260, top: -300 },
      { size: 560, left: -220, bottom: -280 },
    ] as const,
    ringBorder: 'rgba(255, 255, 255, 0.08)',
    ringFadeAt: 0.65,
  },
  brandTile: {
    size: 46,
    radius: 14,
    fill: 'rgba(255, 255, 255, 0.14)',
    border: 'rgba(255, 255, 255, 0.24)',
    shadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
  },
  tagline: '#D0D0D6',
  card: {
    maxWidth: 420,
    radius: 24,
    phoneRadius: 18,
    border: 'rgba(255, 255, 255, 0.6)',
    /** top / sides / bottom */
    padding: { top: 34, x: 32, bottom: 26 },
    phonePadding: { top: 26, x: 20, bottom: 20 },
    shadow: '0 30px 70px -20px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.25)',
  },
  /** Pallav: 42px field, 14px text. Phones (<= 480px) keep 16px text so iPhone Safari does not zoom on focus (unavoidable phone adaptation). */
  input: { radius: 11, height: 42, fontSize: 14, phoneFontSize: 16 },
  button: {
    radius: 12,
    /** Pallav: 44px. */
    height: 44,
    /** 140deg gradient p600 -> p800; hover p700 -> p800. */
    angleDeg: 140,
    gradient: ['#111114', '#3A3A42'] as const,
    gradientHover: ['#2B2B31', '#3A3A42'] as const,
    shadow: '0 1px 2px rgba(17, 17, 20, 0.24), 0 6px 18px rgba(17, 17, 20, 0.28)',
    shadowHover: '0 2px 4px rgba(17, 17, 20, 0.22), 0 12px 28px rgba(17, 17, 20, 0.36)',
  },
  focusRing: { width: 3, color: 'rgba(17, 17, 20, 0.22)' },
  /** size / line height; phone size for narrow screens. */
  title: { size: 25, lineHeight: 30, phoneSize: 22, weight: '800' },
  copyright: 'rgba(255, 255, 255, 0.72)',
  note: {
    success: { bg: '#F0FDF4', border: '#BBF7D0', fg: '#166534' },
    error: { bg: '#FEF2F2', border: '#FECACA', fg: '#991B1B' },
  },

  /** Night mode (device dark mode). Shapes, sizes and radii are the same as day. */
  night: {
    background: {
      angleDeg: 160,
      stops: ['#0F0F12', '#16161A', '#1E1E24'] as const,
      /** Position of the middle stop. */
      middleAt: 0.55,
      glows: ['rgba(17, 17, 20, 0.35)', 'rgba(17, 17, 20, 0.45)'] as const,
      ringBorder: 'rgba(255, 255, 255, 0.06)',
      rings: ['rgba(180, 180, 188, 0.10)', 'rgba(201, 162, 39, 0.06)'] as const,
    },
    surface: '#19191C',
    inset: '#1E1E22',
    line: '#2E2E34',
    card: {
      border: '#3A3A42',
      highlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      shadow: '0 30px 70px -20px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.35)',
    },
    text: '#ECECEF',
    textSecondary: '#C4C4CC',
    textMuted: '#9A9AA4',
    input: { border: '#6B7080', borderHover: '#3A3A42', focus: '#B4B4BC', focusRing: 'rgba(180, 180, 188, 0.35)' },
    link: '#D0D0D6',
    linkHover: '#E6E6EA',
    pill: { bg: 'rgba(17, 17, 20, 0.18)', fg: '#E6E6EA' },
    statusIcon: { bg: 'rgba(17, 17, 20, 0.18)', fg: '#D0D0D6' },
    /** Primary keeps the day gradient (auth.button.gradient); only the shadow changes. */
    primaryShadow: '0 6px 18px -8px rgba(17, 17, 20, 0.7)',
    secondary: {
      fg: '#D0D0D6',
      border: '#3A3A42',
      hoverBg: 'rgba(17, 17, 20, 0.14)',
      hoverBorder: '#8E8E98',
      hoverFg: '#ECECEF',
    },
    note: {
      success: { bg: 'rgba(21, 128, 61, 0.16)', border: 'rgba(21, 128, 61, 0.35)', fg: '#86EFAC' },
      error: { bg: 'rgba(185, 28, 28, 0.16)', border: 'rgba(185, 28, 28, 0.35)', fg: '#FCA5A5' },
      info: { bg: 'rgba(59, 130, 246, 0.16)', border: 'rgba(59, 130, 246, 0.35)', fg: '#93C5FD' },
      warning: { bg: 'rgba(217, 119, 6, 0.16)', border: 'rgba(217, 119, 6, 0.35)', fg: '#FCD34D' },
    },
    aside: { bg: 'rgba(17, 17, 20, 0.10)', icon: '#B4B4BC' },
    signedIn: { page: '#0D0D10', appBar: 'rgba(21, 17, 31, 0.82)' },
    dialogScrim: 'rgba(5, 3, 10, 0.6)',
    /** The 2FA QR code always stays dark-on-white so it scans. */
    qr: { fg: '#111114', bg: '#FFFFFF' },
  },
} as const;

/** 4px base scale. */
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

export const font = {
  family: 'Inter',
  /** size / line height in px */
  size: {
    caption: [12, 16], small: [13, 18], body: [15, 22], bodyLg: [16, 24],
    heading: [20, 28], title: [24, 30], display: [32, 38],
    /** The sign-in family's buttons (measured on Pallav's login: 14px, and 14.5px for the sign-in call to action). */
    button: [14, 20], buttonSignIn: [14.5, 20],
  },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700', heavy: '800' },
} as const;

/** Pallav's layered, ink-tinted elevation scale (pms.css :root --sh-xs ... --sh-xl). */
export const shadow = {
  xs: '0 1px 2px rgba(17, 17, 20, 0.06)',
  sm: '0 1px 2px rgba(17, 17, 20, 0.06), 0 2px 6px rgba(17, 17, 20, 0.05)',
  md: '0 2px 4px rgba(17, 17, 20, 0.05), 0 6px 16px rgba(17, 17, 20, 0.08)',
  lg: '0 4px 8px rgba(17, 17, 20, 0.05), 0 14px 36px rgba(17, 17, 20, 0.12)',
  xl: '0 8px 16px rgba(17, 17, 20, 0.06), 0 28px 64px rgba(17, 17, 20, 0.18)',
  focus: '0 0 0 3px rgba(17, 17, 20, 0.22)',
} as const;

export const motion = {
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  fast: 120, base: 220, slow: 380,
} as const;

export const layout = {
  /** Minimum touch target (mobile and web). */
  touchTarget: 44,
  inputHeight: 48,
  authCardMaxWidth: 440,
  breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280 },
} as const;
