# HMS UI Master List (research note, MJ, 24 Oct 2026)

Status: **research and reference, not an order.** Nothing in this list changes the binding rules while they stand:
- `DECISIONS.md` 1: the UI is 100% Hotel Pallav; "premium" is polish inside Pallav's look, never a new look.
- `DECISIONS.md` 6 and 23: no mobile app, no PWA or store app in the pilot (`MOBILE-APP-FEEL-PLAN-2026-10-18.md` is the website on a phone, designed like an app).
- `UI.md` 0: dashboards are Pallav CSS + Bootstrap 5.3.3 CSS, calm motion, no Bootstrap JS, no Tailwind in dashboards; the Shared Component kit (`PLAN-COMPONENT-LIBRARY.md`) is the component library.

Where this list can be used today without breaking those rules: sections 2 (AutoAnimate for list changes, if MJ allows a library), 7 (the simple rules), 8 (the native-look rules: 44px targets, safe areas, `100dvh`, `overscroll-behavior`, skeletons, which match the mobile feel plan) and 9 (system design reading for the backend). Sections 1, 3, 4, 5 and 6 (shadcn, Aceternity, Magic UI, React Bits, a dashboard starter, a dark-and-gold theme) need a decision by MJ first, because they are a new look.

---

Project: Hotel Management System (Next.js)
Style: modern, luxury, eye catching
Note: star and download numbers are rough. Different sources show slightly different numbers.

## 1. Main Libraries

| # | Name | Stars | Best for | Link |
|---|---|---|---|---|
| 1 | shadcn/ui | 125K+ | Base of everything: buttons, forms, tables, dialogs, charts | ui.shadcn.com |
| 2 | Motion (Framer Motion) | about 30K, 3.6M weekly downloads | Animation engine under most of these libraries | motion.dev |
| 3 | Magic UI | about 22K, 247 components | Free, polished animations (shiny text, number ticker, beams) | magicui.design |
| 4 | React Bits | 24K+, 110+ components | Fast growing, easy to customize (text effects, backgrounds, cards) | reactbits.dev |
| 5 | Aceternity UI | about 28K by one count | Dramatic 3D cards, spotlight, glow effects (some blocks are paid) | ui.aceternity.com |

## 2. Other Libraries We Saw

| Name | Stars | Note |
|---|---|---|
| Cult UI | 3.8K | Animated components plus AI patterns |
| Kokonut UI | 1.8K+ | Focus on specific design styles, subtle animation |
| Spectrum UI | not checked | 250+ components on top of shadcn, uses Magic UI and Aceternity parts |
| Motion Primitives | not checked | Light animation parts for shadcn |
| Origin UI | not checked | Extra shadcn components |
| Hyperiux Vault | not checked | Creative effects, WebGL and Three.js scenes |
| AutoAnimate | 13K+, 200K+ weekly downloads | Very small (under 3 kB) auto animation for lists |
| 21st.dev | not checked | Community marketplace to preview shadcn components |

## 3. Dashboard Templates

| Name | Stars | Note |
|---|---|---|
| Next Shadcn Dashboard Starter (Kiranism) | about 5.9K to 6.6K | Best free Next.js dashboard. Our pick for HMS |
| Shadcn Admin (Sat Naing) | 11K to 12.4K | Most popular, but uses Vite, not Next.js |
| Devias Kit (Material UI) | 5.6K | Next.js with Material UI |
| TailAdmin Next.js | 2.3K | Tailwind based |
| Materio MUI Next.js | 1.9K | Material UI based |
| Studio Admin | 1.6K | Next.js with theme presets |
| Vercel Admin Dashboard | 1.6K | Official Next.js and Postgres template |
| Premium options (paid) | | Apex, Flux, Zenith, Haze, Ember (healthcare), Vault, Fortress |

## 4. Where To Use Each One In HMS

| HMS part | Use | Example |
|---|---|---|
| Login and landing page | Aceternity | Spotlight, background beams, 3D card |
| Hero text and titles | React Bits | Animated text, soft backgrounds |
| Dashboard numbers | Magic UI | Number ticker for revenue, occupancy, bookings |
| Room cards | Aceternity | Hover effect cards |
| Bookings, guests, billing | shadcn/ui | Tables, forms, dialogs, date picker, tabs |
| Charts | shadcn/ui Charts | Occupancy and income graphs |
| Page changes and menus | Motion | Fade, slide, smooth sidebar |
| Whole layout | Dashboard starter | Sidebar, header, auth, base pages |

## 5. Install Commands

- shadcn/ui: `npx shadcn@latest init`, then `npx shadcn@latest add button card table`
- Motion: `npm install motion`
- Aceternity: `npx shadcn@latest add @aceternity/[component-name]`
- Magic UI and React Bits: copy the command or code from each component page
- Dashboard starter: `git clone https://github.com/Kiranism/next-shadcn-dashboard-starter`, then `npm install`

## 6. Setup Order

1. Clone the dashboard starter (gives the Next.js base).
2. Run shadcn init and add the basic components.
3. Install Motion.
4. Add Magic UI parts for the dashboard.
5. Add Aceternity and React Bits only for login, landing and hero.
6. Set the luxury theme: dark colors, gold accent, slow smooth animation.

## 7. Simple Rules

- Keep animation light on work screens (bookings, billing), so staff stay fast.
- Use big effects only on guest facing pages.
- Copy only the components we need. Do not add the whole library.
- Check the license of the starter before final use.

## 8. Skill: Mobile Native Feel

Idea: one Next.js web app. On a phone it installs as a PWA and looks like a native app.

### Tools

| Need | Use |
|---|---|
| Installable app, works offline | PWA: Next.js manifest file and Serwist (service worker) |
| Bottom sheets and drawers | shadcn Drawer (uses Vaul) |
| Swipe, drag, smooth page changes | Motion |
| Real App Store or Play Store app later | Capacitor (wraps the same web app) |

### Native look rules

- Bottom tab bar on mobile (Home, Bookings, Rooms, Guests, More). Sidebar only on desktop.
- Bottom sheets instead of popups.
- Big touch buttons, at least 44px.
- Safe areas: use `env(safe-area-inset-*)` so nothing hides behind the notch or home bar.
- Full screen: `display: standalone` in the manifest, plus `viewport-fit=cover`.
- Use `100dvh`, not `100vh`.
- Remove web feel: turn off tap highlight, text select on buttons, and rubber band scroll (`overscroll-behavior`).
- Smooth page slide when opening a screen, and a swipe back gesture.
- Pull to refresh on lists.
- Skeleton loaders, not spinners.
- Set theme color and app icons.

### Where it helps in HMS

- Staff: check in and check out guests, see room status, mark rooms clean.
- Guests: view booking, request services.
- Owner: quick revenue numbers.

### Build order

1. Make the layout responsive first (sidebar on desktop, tab bar on mobile).
2. Add PWA manifest and icons.
3. Add the service worker for offline basics.
4. Add drawers, gestures and page transitions.
5. Test on a real phone (Android and iPhone).

Warning: iPhone PWAs have limits, like weaker push notifications. If we need full native features later, use Capacitor.

## 9. System Design Resources (Backend and Architecture)

Note: these help us plan how HMS is built behind the screen (database, cache, scaling). They are learning material, not UI.

| Name | Stars | Best for | Link |
|---|---|---|---|
| donnemartin/system-design-primer | 374K | Main reference. Topics like load balancer, cache, database, sharding, plus interview questions with solutions and Anki flashcards | github.com/donnemartin/system-design-primer |
| ByteByteGoHq/system-design-101 | 82K to 84K | Easy visual explanations for beginners | github.com/ByteByteGoHq/system-design-101 |
| karanpratapsingh/system-design | about 33K | Book style, beginner to advanced, read front to back | github.com/karanpratapsingh/system-design |
| InterviewReady/system-design-resources | about 16K | Collection of resources | github.com/InterviewReady/system-design-resources |
| madd86/awesome-system-design | not checked | Curated list of articles, videos and tools | github.com/madd86/awesome-system-design |
| binhnguyennus/awesome-scalability | not checked | Real company scaling stories | github.com/binhnguyennus/awesome-scalability |

Things to know about the primer:
- It is the most starred system design repo. We found nothing with more stars in this topic.
- It is mainly for interview prep and general theory. Some parts are older (written around 2017).
- It does not cover Next.js or hotel booking. Use it for the basics, then design HMS ourselves.

How to use it for HMS:
- Database choice (SQL is the right fit for bookings, billing, rooms because we need transactions).
- Caching for room availability and dashboard numbers.
- Preventing double booking (needs strong consistency).
- Background jobs for emails, invoices and reports (message and task queues).
- Backups and uptime planning.

## 10. Repository links (checked 24 Oct 2026)

Every GitHub link below was opened on 24 Oct 2026 and the star count read from the page that day.

| Name | Link | Stars on 24 Oct 2026 |
|---|---|---|
| shadcn/ui | https://github.com/shadcn-ui/ui | 126.4K |
| Motion (Framer Motion) | https://github.com/motiondivision/motion | 34.5K |
| Magic UI | https://github.com/magicuidesign/magicui | 22.8K |
| React Bits | https://github.com/DavidHDev/react-bits | 50.1K (the 24K in section 1 is old) |
| Aceternity UI | https://ui.aceternity.com (no official GitHub repo found; it is a copy-paste library served from the site's own registry) | not on GitHub |
| AutoAnimate | https://github.com/formkit/auto-animate | 13.9K |
| Next Shadcn Dashboard Starter (Kiranism) | https://github.com/Kiranism/next-shadcn-dashboard-starter | see section 3 |
| Shadcn Admin (Sat Naing, Vite) | https://github.com/satnaing/shadcn-admin | see section 3 |
| Devias Kit (free, Material UI) | https://github.com/devias-io/material-kit-react | 5.6K |
| TailAdmin Next.js (free) | https://github.com/TailAdmin/free-nextjs-admin-dashboard | 2.6K |
| Materio MUI Next.js (free) | https://github.com/themeselection/materio-mui-nextjs-admin-template-free | 2.0K (MIT, attribution required) |
| System Design Primer | https://github.com/donnemartin/system-design-primer | see section 9 |
| System Design 101 (ByteByteGo) | https://github.com/ByteByteGoHq/system-design-101 | see section 9 |
| System Design by Karan Pratap Singh | https://github.com/karanpratapsingh/system-design | see section 9 |
| InterviewReady resources | https://github.com/InterviewReady/system-design-resources | see section 9 |
| Awesome System Design | https://github.com/madd86/awesome-system-design | see section 9 |
| Awesome Scalability | https://github.com/binhnguyennus/awesome-scalability | see section 9 |

Not checked (no link found): Cult UI, Kokonut UI, Spectrum UI, Motion Primitives, Origin UI, Hyperiux Vault, 21st.dev, Studio Admin, Vercel Admin Dashboard, the paid templates.

## 11. Sources

- peerlist.io/vaibhavgupta/articles/react-animation-libraries
- pkgpulse.com/guides/react-bits-vs-aceternity-magic-ui-2026
- 21st.dev/blog/magic-ui-alternatives
- adminlte.io/blog/free-shadcn-admin-dashboards
- rocket.new/blog/best-react-ui-library-how-to-choose-for-projects
- pkgpulse.com/guides/framer-motion-vs-motion-one-vs-autoanimate-2026
