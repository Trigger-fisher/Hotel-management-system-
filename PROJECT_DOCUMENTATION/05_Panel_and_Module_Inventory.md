# 05. Panel and Module Inventory

HMS consists of **5 distinct operational panels** registered in `common/ui-shared/dashboards/nav.ts`.

## 1. Inventory Summary

| Panel ID | Panel Display Name | Target Personas | Total Registered Screens | Primary Operational Focus |
|---|---|---|---|---|
| `hotel` | **Hotel Management Suite** | Hotel Admin, Managers, Receptionists, Cashiers | 52 views | Comprehensive daily property operations, PMS, billing, payroll, CRM, and website administration |
| `platform` | **Platform Console** | Super Administrators, Platform Administrators | 31 views | Multi-hotel governance, tenant provisioning, group management, security vault, and system audit |
| `group` | **Group Console** | Group Hotel Administrators | 12 views | Consolidated multi-hotel performance oversight, shared payments, and hotel invitations |
| `corporate` | **Company Portal** | Corporate Clients, Corporate Travel Desks | 8 views | Invoices, credit ledger statements, payment receipts, and corporate company profile |
| `guest` | **Guest Portal** | In-House Guests, Former Guests | 6 views | Active stay room board, dining room-service ordering, folios, and payment receipts |

---

## 2. Panel 1: Hotel Management Suite (`hotel`)

### Navigation Hierarchy
- **Front desk**:
  - `hotel.fo.board`: Room Board (occupancy grid by room and floor)
  - `hotel.fo.reservations`: Reservations register
  - `hotel.fo.inHouse`: In-house guests list
  - `hotel.fo.rooms`: Room master status
  - `hotel.fo.checkIn`: Walk-in guest check-in modal
- **Guest services**:
  - `hotel.fo.roomOrders`: Room dining and room-service order tracking
  - `hotel.fo.requests`: Real-time guest requests
- **Messages**:
  - `hotel.email`: Hotel inbox (Amazon SES inbound/outbound)
  - `hotel.myMailbox`: Staff personal email mailbox
  - `hotel.conversations`: Unified thread history
- **Billing**:
  - `hotel.billing.bills`: Invoices and billing registry
  - `hotel.billing.advances`: Advance deposits and deposit receipts
- **Cash**:
  - `hotel.cash.revenue`: Revenue book (hotel revenue, food revenue)
  - `hotel.cash.expenses`: Expense book (miscellaneous expenses, advances)
  - `hotel.cash.handover`: Shift cashier handover ledger
- **Companies**:
  - `hotel.co.profiles`: Corporate company register
  - `hotel.co.ledger`: Corporate credit statement
  - `hotel.co.notifications`: Corporate notification notices
- **Customers and marketing**:
  - `hotel.co.customers`: Customer database
  - `hotel.co.marketing`: Email marketing campaign engine
- **Staff**:
  - `hotel.payroll.home`: Staff payroll and attendance center
- **Reports**:
  - `hotel.reports.daily`: Daily revenue, food, and occupancy report
  - `hotel.reports.occupancy`: Historical occupancy percentages
  - `hotel.reports.gst`: GST tax liability breakdown (5%, 12%, 18%, 28%)
  - `hotel.reports.foodPlan`: Meal plan summary
- **Website**:
  - `hotel.web.overview`: Website content overview
  - `hotel.web.enquiries`: Website booking enquiries
- **Settings**:
  - `hotel.admin.settings`: General, tax, and hotel identity settings
  - `hotel.admin.payments`: Online payments (Razorpay configuration)
  - `hotel.admin.masters`: Catalog categories, menu items, and plan rates
  - `hotel.admin.users`: Hotel user accounts
  - `hotel.admin.roles`: Role and RBAC permission manager
- **Logs and health**:
  - `hotel.admin.log`: Hotel activity log
  - `hotel.admin.forceLog`: System override audit
  - `hotel.admin.system`: Hotel subsystem health

---

## 3. Panel 2: Platform Console (`platform`)

### Navigation Hierarchy
- **Overview**: `platform.overview` (Global platform KPI summary)
- **Hotels**:
  - `platform.hotels`: Master hotel directory
  - `platform.groups`: Multi-hotel ownership groups
  - `platform.admins`: Hotel administrator directory
  - `platform.vault`: Enterprise credentials vault (Super Admin only)
  - `platform.archived`: Decommissioned hotels
- **New hotels**:
  - `platform.demoRequests`: Inbound demo leads from website
  - `platform.invitations`: Pending hotel onboarding invites
- **Central**: `platform.central` (Universal database of logins, guest profiles, company profiles, and GST registry)
- **Messages**:
  - `platform.email`: Platform support & sales inbox
  - `platform.announcements`: Global broadcast notices
  - `platform.hotelMail`: Hotel email domain setup & pause control
- **Platform Governance (Super Admin)**:
  - `platform.staff`: Platform admin accounts
  - `platform.users`: Universal user directory
  - `platform.settings`: Global platform settings
- **Security and Health**:
  - `platform.audit`: Platform-wide audit log
  - `platform.signins`: Global sign-in history & security incidents
  - `platform.health`: Subsystem health, memory, and database connection monitors

---

## 4. Panel 3: Group Console (`group`)

Designed for owners of hotel chains (e.g., managing 3-10 distinct properties):
- **Overview**: `group.overview` (Cross-hotel consolidated performance metrics)
- **Hotels**: `group.hotels` (List of affiliated group properties)
- **Admins**: `group.admins` (Administrators managing group member hotels)
- **Payments**: `group.payments` (Centralized Razorpay routing)
- **Invitations**: `group.invitations` (Onboarding invitations for member hotels)
- **Messages**: `group.email` (Consolidated group email inbox)

---

## 5. Panel 4: Company Portal (`corporate`)

Designed for corporate business accounts holding credit lines with a hotel:
- **Overview**: `corporate.dashboard` (Active corporate bookings and pending balance)
- **Accounts**:
  - `corporate.bills`: Invoices issued to the company
  - `corporate.payments`: Payment ledger
  - `corporate.ledger`: Running account statement
  - `corporate.support`: Direct hotel support inquiries
- **Company**: `corporate.profile` (Company GSTIN, address, and billing contacts)

---

## 6. Panel 5: Guest Portal (`guest`)

Designed for in-house and past guests:
- **Your stay**:
  - `guest.home`: Active room details, WiFi password, check-out time
  - `guest.order`: In-room dining room-service ordering catalog
- **Money**:
  - `guest.bills`: Itemized stay bills and folios
  - `guest.history`: Payment history and receipts
- **Account**: `guest.profile` (Personal profile, ID verification status)
