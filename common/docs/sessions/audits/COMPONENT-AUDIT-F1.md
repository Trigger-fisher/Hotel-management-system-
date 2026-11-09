# Shared Component audit, Frontend 1 (check:shared baseline)

`npm run check:shared` (web-app/scripts/check-shared.mjs, allowlist scripts/check-shared.allow.json, empty) lists every violation as file:line. Rules: colour, type, control, inline, import. Exit 1 while any remain.

Baseline 12 Oct 2026: 448 violations.

| Folder | Violations |
|---|---|
| groups/payrollPay | 116 (control 42, type 33, inline 40, colour 1) |
| groups/admin | 101 (control 19, inline 46, type 27, colour 9) |
| groups/payrollCore | 44 (inline 14, type 12, control 18) |
| groups/corporate | 27 (type 10, inline 17) |
| groups/website | 21 (control 16, inline 4, colour 1) |
| groups/cash | 19 (control 18, colour 1) |
| groups/platform | 19 (control 19) |
| groups/guest | 13 (inline 10, type 3) |
| groups/companies | 12 |
| groups/frontOffice | 10 |
| groups/billing | 9 |
| groups/overview | 9 |
| groups/group | 4 |
| pallav (outside ui/) | 11 |
| components/ui | 15 |
| app | 20 |

The `control` rule is a heuristic (a raw button/select/textarea/table with a page-local class) and is tuned as the kit grows.

Tokens: status colours (--ok/--bad/--warn/--info + -bg, --accent-solid) by Frontend 2; type scale (--fs-*), weights (--fw-*), fonts, --link, --white, --brand-deep-*/--brand-soft-*, .fs-* classes by Frontend 1; all at the end of web-app/public/pallav/hms-overrides.css.
