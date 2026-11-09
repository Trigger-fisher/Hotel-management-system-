# MASTER PROJECT DOCUMENTATION: REVERSE ENGINEERING, TECHNICAL BLUEPRINT & DESKTOP ROADMAP

> **Single Source of Truth** for the Hotel Management System (HMS) codebase, architectural design, database schemas, API contracts, security mechanisms, and desktop conversion roadmap.

---

## 1. Executive Summary & Key Metrics

HMS is a multi-tenant property management platform engineered with schema-level tenant isolation, paise-accurate financial arithmetic, and a high-contrast graphite UI design system.

### Verified Codebase Metrics
- **Total API Route Handlers**: **624** endpoints across `web-app/src/app/api/v1/`.
- **Total Registered Dashboard Screens**: **145** views across 5 main operational consoles.
- **Total Database Tables**: **213** tables (112 Platform schema + 101 Hotel schema).
- **Core Technology Stack**: Next.js 16.4.3, React 19.2.8, TypeScript 5, TailwindCSS 4, Bootstrap 5.3.3, PostgreSQL 18, Argon2id, PDFKit.
- **Security Audits**: 3 comprehensive audit rounds conducted with **0 High-level vulnerabilities**.
- **Tenant Isolation**: PostgreSQL schema and dedicated login-less role per hotel tenant (`hotel_<id>_role`).

---

## 2. Master Documentation Directory Index

All detailed technical documentation files reside in [`PROJECT_DOCUMENTATION/`](./PROJECT_DOCUMENTATION/):

| # | Document | File Link | Primary Scope & Contents |
|---|---|---|---|
| **01** | **Project Overview** | [01_Project_Overview.md](./PROJECT_DOCUMENTATION/01_Project_Overview.md) | Business mission, architectural background, multi-tenancy principles, and desktop vision |
| **02** | **Technology Stack** | [02_Technology_Stack.md](./PROJECT_DOCUMENTATION/02_Technology_Stack.md) | Comprehensive dependency inventory, versions, client/server libraries, runtime tools |
| **03** | **Project Structure** | [03_Complete_Project_Structure.md](./PROJECT_DOCUMENTATION/03_Complete_Project_Structure.md) | Directory tree analysis (`ai`, `common`, `web-app`, `security`), entrypoints, execution flow |
| **04** | **Roles & Permissions** | [04_Roles_and_Permissions.md](./PROJECT_DOCUMENTATION/04_Roles_and_Permissions.md) | 7 System roles, RBAC catalog (54+ catalog items), permission engine, session boundaries |
| **05** | **Panels & Modules** | [05_Panel_and_Module_Inventory.md](./PROJECT_DOCUMENTATION/05_Panel_and_Module_Inventory.md) | 5 Consoles (Hotel, Platform, Group, Corporate, Guest), navigation hierarchies, modules |
| **06** | **Page-by-Page Analysis** | [06_Page_by_Page_Documentation.md](./PROJECT_DOCUMENTATION/06_Page_by_Page_Documentation.md) | Deep breakdown of 145 screens, routes, layouts, UI forms, user workflows, API integration |
| **07** | **UI/UX Design System** | [07_UI_UX_Design_System.md](./PROJECT_DOCUMENTATION/07_UI_UX_Design_System.md) | Pallav design system, graphite & gold color tokens, dual day/night themes, spacing rules |
| **08** | **Component Library** | [08_Component_Library.md](./PROJECT_DOCUMENTATION/08_Component_Library.md) | Reusable components (`RoleDashboard`, `PhoneSearch`, `AttentionBell`, `Notch`, flatpickr) |
| **09** | **Backend Architecture** | [09_Backend_Architecture.md](./PROJECT_DOCUMENTATION/09_Backend_Architecture.md) | Layered services, repository pattern, unit context (`createPgUnit`), paise arithmetic, idempotency |
| **10** | **Complete API Docs** | [10_Complete_API_Documentation.md](./PROJECT_DOCUMENTATION/10_Complete_API_Documentation.md) | Inventory of all 624 API routes, payloads, responses, status codes, validations |
| **11** | **Database Schema & ERD** | [11_Database_Schema_and_ERD.md](./PROJECT_DOCUMENTATION/11_Database_Schema_and_ERD.md) | 213 tables, Platform vs Hotel schemas, columns, foreign keys, indexes, ER diagram |
| **12** | **Security Architecture** | [12_Security_Architecture.md](./PROJECT_DOCUMENTATION/12_Security_Architecture.md) | 3-Layer defence (Cloudflare Edge, VPS hardening, DB roles), honeypots, canaries, reset |
| **13** | **Third-Party Integrations** | [13_Third_Party_Integrations.md](./PROJECT_DOCUMENTATION/13_Third_Party_Integrations.md) | Razorpay, Amazon SES/SNS, GST lookup, Cloudflare, Sharp, Twilio, Google Drive |
| **14** | **Business Logic & Workflows** | [14_Business_Logic_and_Workflows.md](./PROJECT_DOCUMENTATION/14_Business_Logic_and_Workflows.md) | Step-by-step logic and sequence diagrams for check-in, billing, handover, payroll |
| **15** | **Reports & Analytics** | [15_Reports_and_Analytics.md](./PROJECT_DOCUMENTATION/15_Reports_and_Analytics.md) | Daily operational reports, GST tax summaries, occupancy KPIs, cashier handover, PDF export |
| **16** | **Desktop Requirements** | [16_Desktop_Application_Requirements.md](./PROJECT_DOCUMENTATION/16_Desktop_Application_Requirements.md) | Tauri 2.0 evaluation, hardware peripherals (thermal printer, cash drawer, scanner), offline sync |
| **17** | **Technical Debt & Gaps** | [17_Technical_Debt_and_Gaps.md](./PROJECT_DOCUMENTATION/17_Technical_Debt_and_Gaps.md) | Audit of incomplete modules, unencrypted ID risks, missing TOTP, DPDP compliance gaps |
| **18** | **Architecture Diagrams** | [18_Architecture_Diagrams.md](./PROJECT_DOCUMENTATION/18_Architecture_Diagrams.md) | Master collection of Mermaid diagrams: System, Auth, Data Flow, Desktop Architecture |
| **19** | **Desktop Conversion Roadmap** | [19_Desktop_Conversion_Roadmap.md](./PROJECT_DOCUMENTATION/19_Desktop_Conversion_Roadmap.md) | Phase-by-phase implementation plan, Gantt chart, milestones, and packaging strategy |

---

## 3. Recommended Desktop Application Conversion Strategy

1. **Framework**: **Tauri 2.0** utilizing a lightweight Rust core coupled with the existing Next.js React frontend.
2. **Reusability**: 100% of the existing 145 screen components, CSS layers, design tokens, and validation schemas can be packaged directly into the desktop client without rewriting UI components.
3. **Hardware Advantages**: Desktop implementation unlocks native thermal printing (ESC/POS) on receipt printers, automated cash drawer triggering, USB barcode scanner integration, and offline room-board caching via local SQLite.
