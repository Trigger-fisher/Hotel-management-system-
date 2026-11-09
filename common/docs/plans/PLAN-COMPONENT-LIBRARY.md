# Plan: Shared Component (the library and its draft page) (MJ, 11 Oct 2026)

MJ: "create a shared component draft page where we have added the shared components; all the small things as components (CTA, date, header, footer, everything that can be shared)."

Current kit: `web-app/src/dashboards/pallav/ui/` (Dialog, Dropdown, FilterBar, FilterMenu, forms, Kpi, Loading, Modal, money, PageHead, pagerView, PasswordParts, pdf, PhoneField, pickers, PmsTable, RichPoints, SegTabs). Existing dev preview route: `web-app/src/app/dev/dashboard`.

## Rule (also goes into docs/UI.md)
Any UI that appears in more than one place is a shared component. New UI = use a shared component or add one to the kit first. Screens never carry their own copy of a button, badge, tile, tab, pager, field, empty state, alert, header, footer.

## Deliverables
1. Component inventory and duplicate scan: Frontend 1 (kit, hotel/platform/group/super admin screens), Frontend 2 (docs/sessions/audits/COMPONENT-AUDIT-F2.md for its folders).
2. Missing components added to the kit, one typed API each, accessible, day + night + phone: at least CTA/Button (primary, secondary, outline, danger, link, icon, loading, disabled), Badge/StatusChip, Tile/KPI, Tabs/SegTabs, Pager, SearchField, DateField and MonthPicker, Select/Lookup, Field (label, hint, error), Alert/Toast, EmptyState, Skeleton/Loading, ConfirmDialog, WizardSteps, Table and RowCard, Avatar, BackBar/Breadcrumb, SectionHeading, PageHeader (title, back, actions), TopBar (header), SideMenu, Footer (version, copyright, links), UserMenu, DayNightSwitch, Money/Date formatters.
3. Draft page `/dev/shared-component`: grouped (Buttons and CTA, Forms, Date, Feedback, Navigation, Data display, Layout: header and footer), every variant and state (default, hover, focus, disabled, loading, error, empty), day/night toggle, usage snippet. DEV ONLY: not in the production build (same gating as /dev/dashboard; also in the local demo build).
4. Replace duplicates with the shared components (look and behaviour unchanged; tests, lint, tsc green; one browser check per replaced component): Frontend 1 and Frontend 2 in their folders.
5. docs/UI.md: component list, props table, the rule above.

## Percent basis
Inventory 10, kit additions 30, draft page 20, replacements 30, docs 10.

## Added by MJ (11 Oct 2026): colours, colour codes and typography
The draft page ALSO shows the design tokens, so every colour and text style used by the shared components is defined once:
- COLOURS: every named colour with its CSS variable, its hex code in day AND night, its role (brand, text, muted, surface, border, success, warning, danger, info, links, chart colours, status chips) and the contrast ratio of each text-on-background pair that is used (must be 4.5:1 for normal text, 3:1 for large text). Click a swatch to copy the code.
- TYPOGRAPHY: font families (and fallbacks), the full type scale (page title, section heading, card title, body, small, caption, label, numbers/tabular, code), weights, line heights, letter spacing for uppercase labels, with live sample text in day and night.
- ALSO: spacing scale, radius, shadows/elevation, breakpoints, icon sizes, z-index layers.
- Single source: tokens live in ONE place (ui-shared tokens + the CSS variables of the Pallav theme); components and screens must use the tokens, never a literal colour or font size. A scan lists every hard-coded colour/font-size left in screens and fixes it or replaces it with a token.
Percent basis addition: tokens page 10 (taken from replacements 10 and kit additions 0 so totals stay 100): inventory 10, kit additions 25, tokens (colours, codes, typography) 15, draft page 20, replacements 20, docs 10.

## Name (MJ, 11 Oct 2026)
The draft page and the library are called **Shared Component**: page title 'Shared Component', route /dev/shared-component, menu label 'Shared Component' in the demo build, docs section 'Shared Component' in docs/UI.md. Existing kit file names are not renamed (no risk to working screens); the kit index (web-app/src/dashboards/pallav/ui/index.ts) is the single export list of the Shared Component set, and every new reusable piece is added there.


## Enforcement (MJ, 11 Oct 2026): ALL pages must use Shared Component, colour and typography tokens
Done = a script says so, not a promise. Frontend 1 writes web-app/scripts/check-shared.mjs (plain Node, no new library) and the npm script 
pm run check:shared; it fails (exit 1) and prints file:line for every violation in web-app/src/dashboards/**, web-app/src/components/** and web-app/src/app/** (the kit, theme CSS and the Shared Component page itself are the only allowed places):
1. Hard-coded colours: hex (#rgb, #rrggbb), rgb()/rgba()/hsl() literals and named colours in TSX style props and CSS files outside the theme/token files.
2. Hard-coded typography: font-size / font-weight / font-family / line-height literals outside the token files (use the type scale tokens).
3. Raw controls with their own styling instead of the kit: <button class=...> / <input> / <select> / <table> styled inline or with page-local classes where a Shared Component exists (the script keeps a list: Button, Field, Select, DateField, Table, Badge, Tile, Tabs, Pager, Modal, Alert, EmptyState, Skeleton, PageHeader, Footer).
4. Inline style={{ ... }} with colours, font sizes, margins or paddings that tokens cover.
5. Imports of reusable pieces from anywhere except the kit index.
An allowlist file (web-app/scripts/check-shared.allow.json) holds the few justified exceptions, each with a reason; it must stay short and is reviewed in the full check. Target: zero violations. The check also runs in Phase 1 of FULL-CHECK-PLAN and before every release tag.
Order: (1) script first with the current violation count per folder (baseline); (2) replacements until zero; (3) night mode and phone re-checked on every screen touched; (4) the Shared Component page lists the same tokens the script allows.
