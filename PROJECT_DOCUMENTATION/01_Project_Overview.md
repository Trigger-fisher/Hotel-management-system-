# 01. Project Overview & Executive Summary

## 1. Executive Summary

The **Hotel Management System (HMS)** is an enterprise-grade, multi-hotel property management system (PMS) and platform ecosystem. Originally derived from the single-property **Hotel Pallav** Laravel/MySQL system, HMS has been completely re-architected as a modern, multi-tenant single-page application built on **Next.js 16 (App Router)**, **React 19**, **TypeScript 5**, and a dedicated multi-tenant **PostgreSQL 18** engine with schema-level isolation.

The primary mission of the project is to provide a single, unified operational operating system for hospitality businesses—spanning independent boutique hotels, large multi-property chains, hotel platform administrators, corporate partners, and guests.

## 2. Business Mission & Context

HMS operates across multiple operational domains within the hospitality lifecycle:
1. **Hotel Front-Office & Operations**: Real-time room occupancy board, walk-in check-in, reservations management, in-house guest lifecycle, and housekeeping state.
2. **Billing & Financial Ledger**: Invoicing, folio generation, debit bills, advance deposits, and cash books. All monetary transactions are computed and stored in integer **paise** to eliminate floating-point rounding errors.
3. **Guest Experience & Portals**: Dedicated guest self-service portal for stay history, digital invoices, room-service ordering, and real-time requests.
4. **Corporate / CRM Accounts**: Business company billing, company credit ledgers, automated GST lookup, and statement reconciliation.
5. **Human Resources & Payroll**: Complete hotel staff payroll engine, attendance tracking, monthly salary generation, advances, and experience/joining letter generation.
6. **Unified Messaging & Communications**: Dual-channel communication inbox combining Amazon SES inbound/outbound email and WhatsApp messaging with full thread tracking and auto-suppression.
7. **Platform & Multi-Hotel Group Governance**: High-level platform console allowing Super Administrators and Group Administrators to onboard hotels, manage tenant schemas, configure shared mail domains, oversee enterprise vaults, and run database backups.

## 3. High-Level System Scope & Metrics

Based on the actual codebase implementation:
- **Total Registered Dashboard Views**: 145 distinct views across 5 main consoles.
- **Total API Route Endpoints**: 624 API routes implemented in `web-app/src/app/api/v1`.
- **Database Architecture**: 213 unique database tables across Platform (112 tables) and Hotel Schemas (101 tables).
- **Security Posture**: 3-layer defence-in-depth architecture with 0 High-level vulnerabilities identified across 3 audit rounds.
- **Frontend Core**: Single Page Application (SPA) dashboard architecture preserving Hotel Pallav's layout and styling while adding responsive adaptations.

## 4. Multi-Tenancy Architecture Principles

Unlike standard SaaS systems that isolate data merely using a `hotel_id` column with soft filters, HMS implements **Schema-Per-Tenant Isolation**:
1. **Platform Schema (`platform`)**: Holds global multi-tenant entities—hotel registry, groups, user accounts, system roles, audit logs, vault credentials, and global mail configurations.
2. **Dedicated Hotel Schemas (`hotel_<hotel_id>`)**: Each registered hotel receives its own isolated PostgreSQL schema containing its specific operational tables (rooms, bills, guests, payroll, cashbook).
3. **Login-less Database Roles**: Each hotel has a dedicated login-less PostgreSQL role (`hotel_<hotel_id>_role`). When the application handles a request, the connection pool (`hms_app`) executes:
   ```sql
   SET LOCAL ROLE hotel_<hotel_id>_role;
   SET LOCAL search_path TO hotel_<hotel_id>, public;
   ```
   This guarantees that even in the event of an application SQL vulnerability, cross-tenant data leakage is physically blocked at the database engine level.

## 5. Vision for Desktop Application Conversion

While the pilot was implemented as a web application (`web-app`), the architectural blueprint mandates a conversion to a **Desktop Application** (`desktop-app/`). 
The desktop application is targeted for front-desk PCs, back-office cashiers, and property managers. Key drivers for desktop conversion include:
- Direct hardware integration with POS thermal printers (ESC/POS), cash drawers, and barcode/QR scanners.
- Flatbed and passport scanner integration for instant guest ID digitization.
- Zero-latency local operation and offline room-board caching during internet disruptions.
- Operating system native notifications and background synchronization.
