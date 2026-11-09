# 03. Complete Project Structure & Directory Analysis

## 1. Root Directory Layout

```
Hotel-Management-System-Pilot-main/
├── ai/                      # AI & Document OCR services (ID scanner integration)
├── common/                  # Shared platform assets, DB migrations, shared UI contracts
│   ├── db/                  # Database migrations (platform & hotel), seeds, scripts
│   ├── docs/                # Architecture decisions, UI guidelines, deploy guides
│   ├── scripts/             # Mail background workers and CLI utilities
│   └── ui-shared/           # Shared TypeScript interfaces, navigation, design tokens
├── desktop-app/             # Target directory for Desktop Application version
├── other-features/          # Experimental & auxiliary modules
├── security/                # VPS hardening scripts, Fail2ban rules, security audits
├── web-app/                 # Next.js 16 Web Application (dashboards, API routes, server)
├── website/                 # Product landing site assets
├── website-templates/       # 10 custom hotel website themes & build tools
├── MASTER.md                # Founding architecture specification
└── README.md                # Project entrypoint guide
```

## 2. Deep Dive: `common/` Structure

`common/` contains the single source of truth shared across the entire ecosystem:
- **`common/db/migrations/platform/`** (96 SQL scripts):
  Contains all platform-level database schema migrations:
  - `0000_foundation.sql` to `0006_account_role_and_subject.sql`: Core users, auth, and tenancy.
  - `0100_user_ui_theme.sql` to `0172_readable_hotel_schemas.sql`: Hotel lifecycles, invitations, group hubs, GST registries, and vault encryption.
- **`common/db/migrations/hotel/`** (60 SQL scripts):
  Contains the schema definition applied to every individual hotel tenant:
  - `0000_foundation.sql` to `0015_payroll_pay_rules.sql`: Front-office, rooms, reservations, bills, cash books, and payroll.
  - `0020_room_service_menu.sql` to `0053_conv_mail_sources.sql`: Dining orders, Pathik police verification runner, and email storage.
- **`common/ui-shared/`**:
  - `dashboards/`: Type definitions and mock state for all 145 screens (`nav.ts`, `routes.ts`, `billing.ts`, `cash.ts`, `platform.ts`, etc.).
  - `auth/`: Authentication contracts (`types.ts`, `session.ts`).
  - `tokens.ts`: The unified design token definition (ink color scales, typography, button sizes).

## 3. Deep Dive: `web-app/` Structure

The core Next.js 16 application is located in `web-app/`:
- **`src/app/`**:
  - `page.tsx`: Public marketing home page.
  - `login/page.tsx`: Universal authentication page (handles username/password, OTP challenge, password reset).
  - `dev/dashboard/page.tsx`: Primary SPA host for all dashboard views.
  - `api/v1/`: 624 API routes organized hierarchically by module:
    - `/admin/`: Hotel settings, backup, masters, roles, and user management.
    - `/auth/`: Sign-in, sign-out, session verification, and OTP workflows.
    - `/billing/`: Invoices, folios, advances, PDF export, and refunds.
    - `/cash/`: Revenue transactions, miscellaneous expenses, and shift handover.
    - `/companies/`: Corporate CRM, GSTIN validation, and ledgers.
    - `/front-office/`: Room board, reservations, stays, check-in, and guest folios.
    - `/payroll/`: Staff records, attendance, salary generation, and pay slips.
    - `/platform/`: Hotel provisioning, group consoles, audit logs, and security events.
- **`src/dashboards/`**:
  - `shell/`: Central shell component (`RoleDashboard.tsx`), top navigation bar, attention bell, user profile card, and smart search bar.
  - `groups/`: UI screen components grouped by module (`admin`, `billing`, `cash`, `frontOffice`, `payrollCore`, `platform`, `guest`, `corporate`).
- **`src/server/`**:
  - `services/`: Business logic implementations organized by domain.
  - `repos/`: Repository abstractions for PostgreSQL database operations with memory fallbacks for mock mode.
  - `compose/`: Context factory wiring repositories, services, and session objects into execution units (`createPgUnit`).
  - `http/`: API wrappers, rate limiters, session extractors, and error handlers.
