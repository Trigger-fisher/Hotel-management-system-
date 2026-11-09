# 04 - Web review rules: Next.js 16.3, React 19.2, Tailwind 4

`web-app/` runs Next.js 16.3.8, React 19.2.8, Tailwind 4, ESLint 9 (eslint-plugin-react-hooks 7.1.1). Its `AGENTS.md` warns that this Next.js is newer than most training data, so these rules were checked against the **bundled docs** in `web-app/node_modules/next/dist/docs/` ([next-docs]) and the Next source, plus react.dev, tailwindcss.com, web.dev, MDN and W3C (research 2026-10-05).

## 1. Rendering and routing (Next 16)

| # | Check | Source |
|---|---|---|
| W1 | `'use client'` is the **first line**, above imports, and only on entry files imported by a server component. Props across the boundary are serialisable (no functions from the server page) | [next-docs] 01-app/03-api-reference/01-directives/use-client.md |
| W2 | `page.tsx` / `layout.tsx` stay **server components** if they export `metadata` / `viewport`. The client AuthShell lives in its own file | [next-docs] generate-metadata.md |
| W3 | `searchParams` in page props is a **Promise** (sync access removed in v16): use `await` or `use()`. Types via global `PageProps<'/'>` / `LayoutProps` (no import) | [next-docs] page.md; upgrading/version-16.md |
| W4 | Any component using `useSearchParams` on the prerendered `/` is inside `<Suspense>`, or **`next build` fails** ("Missing Suspense boundary"). Dev hides this: always run the build | [next-docs] use-search-params.md |
| W5 | No `window.location` / `history` read **during render** (hydration mismatch). Read in an effect, event handler or `useSyncExternalStore` | react.dev useSyncExternalStore |
| W6 | Native `history.pushState/replaceState` is supported and syncs `usePathname` / `useSearchParams` | [next-docs] 01-getting-started/04-linking-and-navigating.md |
| W7 | **Trap (from Next source):** Next patches pushState/replaceState in the Router's effect, which runs *after* child mount effects. A push/replace in a child's mount effect hits the unpatched API, drops Next's `__NA` key, and later Back is ignored or does a full reload. Safe: `history.pushState({ ...history.state, step }, '', url)`, and the app's own `popstate` listener restores the step | next/dist/client/components/app-router.js |
| W8 | When the reset/invite token is stripped with `replaceState`, `useSearchParams` loses it, so the token must already be in state/ref | same |
| W9 | `turbopack` is top-level (not `experimental.turbo`); `turbopack.root` is absolute (`path.join(__dirname, '..')`) so `../ui-shared` resolves. Turbopack is default for dev and build | [next-docs] turbopack.md; version-16.md |
| W10 | `next lint` is **removed** and `next build` no longer lints. Script is `eslint` with flat config (it is) | [next-docs] version-16.md; eslint.md |
| W11 | Font via `next/font` with `variable: '--font-x'` wired in `@theme inline { --font-sans: var(--font-x) }`. Template Geist must be replaced or consciously kept (decision) | [next-docs] font.md |
| W12 | `viewport.colorScheme` is `'light dark'` and `theme-color` is set for both modes (night mode follows the device) | [next-docs] generate-viewport.md |
| W13 | `reactCompiler` is stable but off by default; note whether it is on | [next-docs] version-16.md |
| W14 | `scroll-behavior: smooth` is no longer overridden on navigation unless `<html data-scroll-behavior="smooth">` | [next-docs] version-16.md |

## 2. Lint rules that will bite (react-hooks 7, on by default as errors)

`set-state-in-effect`, `refs` (no `ref.current` read during render), `purity`, `immutability`, `globals`, `static-components`, `set-state-in-render`.
Common failure: setting the step from the URL inside `useEffect` → use a reducer init function or `useSyncExternalStore` instead.

## 3. React 19.2

| # | Check | Source |
|---|---|---|
| R1 | `ref` is a normal prop; new components should not use `forwardRef` (slated for deprecation). Ref callbacks may return a cleanup. `<Context value>` replaces `.Provider` | react.dev/blog/2024/12/05/react-19 |
| R2 | `useFormStatus` reads only its **parent** `<form>` (call it in a child). `useActionState` returns `[state, action, isPending]` | same |
| R3 | One `<title>` at a time; its child is **one string** (`` {`${title} · HMS`} ``, not `{title} · HMS`) | react.dev title |
| R4 | `useEffectEvent` only called from effects; never in deps, props or render | react.dev useEffectEvent |
| R5 | `<Activity mode="hidden">` keeps DOM and input values. Do not keep password/code fields alive in hidden Activities; clear secrets on step change | react.dev Activity |
| R6 | `useId` for label / `aria-describedby` wiring only; never for keys or CSS selectors | react.dev useId |

## 4. Tailwind 4

| # | Check | Source |
|---|---|---|
| T1 | Tokens defined in CSS (`@theme`; `@theme inline` when a value references another var). Values must match `ui-shared/tokens.ts` exactly. `--color-*: initial` wipes the default palette (good: stops stray `zinc-*`) | tailwindcss.com/docs/theme |
| T2 | `dark:` follows `prefers-color-scheme` by default, which is what we want (no toggle). Replace the template's dark block with the night tokens; no class-based toggle | tailwindcss.com/docs/dark-mode |
| T3 | If `../ui-shared` ever holds class names, add `@source` for it (today it has none) | tailwindcss.com detecting-classes |
| T4 | v4 traps: `outline-none` really removes the outline (use `outline-hidden` to keep the forced-colours fallback); `ring` is 1px currentColor; default border colour is currentColor; placeholder is 50% currentColor (contrast!); buttons get `cursor: default`; `hover:` only on hover-capable devices; `transition` now animates `outline-color`; shadow/rounded/blur scales renamed | tailwindcss.com/docs/upgrade-guide |
| T5 | No arbitrary values (`p-[13px]`, `text-[#xxxxxx]`) unless they map to a token | (house) |

## 5. Forms and accessibility on the web

| # | Check | Source |
|---|---|---|
| F1 | One `<form>` per step, real `<label for>`, stable `id`/`name`, `type="submit"` | web.dev sign-in form best practices |
| F2 | autocomplete: `username`, `current-password`, `new-password`, `one-time-code`, `email` (WCAG 1.3.5) | web.dev; W3C |
| F3 | OTP: `type="text" inputmode="numeric" autocomplete="one-time-code"`, **never `type="number"`**. Recovery code: `inputmode="text"`, `spellcheck="false"` | web.dev sms-otp-form |
| F4 | New-password forms (change, reset, invite) include a hidden `autocomplete="username"` field; after success the password form is removed so password managers detect it | chromium.org create-amazing-password-forms |
| F5 | Show/Hide is `<button type="button">` with `aria-pressed` or a changing label; paste not blocked | web.dev |
| F6 | Errors: `aria-invalid="true"` + `aria-describedby` → message id; hints also in `aria-describedby` | W3C 3.3.1, 3.3.3 |
| F7 | Live regions (`role="status"` / `role="alert"`) **exist in the DOM before** their text changes | MDN; WCAG 4.1.3 |
| F8 | Step change: focus to heading (`tabIndex={-1}`) or first field; `<title>` updates | WAI practice; 2.4.2, 2.4.3 |
| F9 | Caps Lock via `e.getModifierState('CapsLock')`, announced politely | MDN |
| F10 | `focus-visible:` styles on every control; never removed | WCAG 2.4.7 |
| F11 | 320px width: no sideways scroll (1.4.10); survives text spacing overrides (1.4.12); 200% text (1.4.4) | W3C |
| F12 | `@media (prefers-reduced-motion: reduce)` disables movement | MDN |

## 6. Client-side checks (frontend only)

| # | Check | Source |
|---|---|---|
| S2 | After reading `?reset=` / `?invite=`, `history.replaceState({ ...history.state }, '', '/')` so the link leaves the address bar and Back | W7/W8 |
| S3 | No secrets in client code or `NEXT_PUBLIC_*` (inlined at build). Grep `.next/static` after build | [next-docs] environment-variables.md |
| S4 | Dev helpers gated with a **literal** `process.env.NODE_ENV !== 'production'`; confirm with a grep of the built chunks that "Demo accounts" is gone | (verify in build output) |
| S5 | Demo password `Demo@Pass2026` must not appear in the production bundle (it lives in `mock.ts`; the mock itself is only for step 3, swapped in step 6) | (house) |

## 7. Commands I run (read-only)

```
cd "web-app"
npm run lint
npx tsc --noEmit
npm run build
grep -rl "Demo accounts\|Demo@Pass2026" .next/static   # should find nothing in a production build
```
