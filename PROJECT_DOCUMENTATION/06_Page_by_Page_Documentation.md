# 06. Page-by-Page Functional Analysis & Documentation

HMS provides **145 distinct views** across its 5 operational panels, plus public web pages. Below is the comprehensive architectural and functional analysis of core pages across all modules.

---

## 1. Public & Marketing Pages

### 1.1 Home / Landing Page
- **Path**: `/` (`web-app/src/app/page.tsx`)
- **Panel**: Public Web
- **Accessible Roles**: Unauthenticated public, guests, owners.
- **UI Layout**:
  - Header with HMS brand logo, navigation links (`Features`, `Solutions`, `Pricing`, `Integrations`, `About`, `Contact`), and a high-contrast **Sign in** button.
  - Hero Section featuring live demo screenshots (Interactive Room Board preview, Sample GST Tax Invoice).
  - Feature Grid highlighting multi-tenant separation, unified inbox, and automated night audit.
  - Customer review carousel and footer with legal links (`Privacy`, `Terms`).
- **Backend Connectivity**: `GET /api/v1/public/site` for marketing dynamic content.

### 1.2 Unified Sign-In Page
- **Path**: `/login` (`web-app/src/app/login/page.tsx`)
- **Panel**: Public / Authentication
- **Accessible Roles**: All roles.
- **UI Layout**:
  - Split screen on desktop: Left panel displays branded graphite gradient background with subtle gold accent glow and security badges; Right panel contains the minimal card form.
  - Input field for **Username or Email** (both unique across platform).
  - Password field with password visibility toggle.
  - "Remember me" option and "Forgot password?" recovery trigger.
  - Two-Factor Authentication (OTP) challenge state: 6 individual numeric input cells with auto-focus.
  - Password Reset required state: Triggered when `temporary_password` flag is true.
- **Backend Connectivity**:
  - `POST /api/v1/auth/sign-in` (username, password, device metadata).
  - `POST /api/v1/auth/code/verify` (OTP challenge verification).
  - `POST /api/v1/auth/password/forgot` (initiates password reset link).
  - Sets `__Host-hms-session` cookie on success.

---

## 2. Front Office & Operations Pages (Hotel Dashboard)

### 2.1 Room Board (Occupancy Matrix)
- **View ID**: `hotel.fo.board`
- **Route / Host**: `/dev/dashboard?view=hotel.fo.board`
- **Panel**: Hotel Management Suite
- **Accessible Roles**: `hotel_admin`, `hotel_user` (Front Office View/Edit).
- **UI Layout**:
  - **Header**: Current hotel name, active date indicator, quick statistics pills (Total Rooms, Occupied, Vacant, Dirty/Cleaning, Maintenance).
  - **Filter Bar**: Floor selector dropdown, Room Type filter (Deluxe, Suite, Standard), search guest by name or room number.
  - **Main Matrix**: Grid of room cards color-coded by occupancy status:
    - *Green*: Vacant Clean (Ready for Check-in).
    - *Blue*: Occupied (Displays guest name, stay duration, folio balance).
    - *Orange*: Expected Departure / Check-out Pending.
    - *Red*: Out of Order / Maintenance.
    - *Yellow*: Dirty / Housekeeping Needed.
  - **Action Menu (Card Click)**: Opens context drawer: Check-in, View Folio, Add Charge, Transfer Room, Mark Clean.
- **Backend Connectivity**:
  - `GET /api/v1/front-office/board` -> returns room occupancy state matrix.
  - `POST /api/v1/front-office/rooms/{id}/status` -> updates room housekeeping state.

### 2.2 Walk-in Check-In
- **View ID**: `hotel.fo.checkIn`
- **Panel**: Hotel Management Suite (Modal / Drawer)
- **Accessible Roles**: `hotel_admin`, `hotel_user` (Front Office Create/Edit).
- **UI Layout**:
  - Stepper Form:
    1. *Guest Details*: Mobile number typeahead (searches central customer DB), Full Name, Email, Address, ID Proof type (Aadhaar, Passport, Driving License) and ID number.
    2. *Room Allocation*: Room type selector, available room number picker, adults/children count.
    3. *Tariff & Plan*: Base rate, selected food plan (EP, CP, MAP, AP), discount percentage.
    4. *Advance Deposit*: Mode of payment (Cash, UPI, Card), amount in rupees, receipt print trigger.
- **Backend Connectivity**:
  - `POST /api/v1/front-office/stays` -> creates stay record, marks room occupied.
  - `POST /api/v1/billing/advances` -> records advance deposit transaction.

### 2.3 Reservations Register
- **View ID**: `hotel.fo.reservations`
- **Panel**: Hotel Management Suite
- **Accessible Roles**: `hotel_admin`, `hotel_user`.
- **UI Layout**:
  - Tabbed interface: `Upcoming`, `Confirmed`, `Checked-In`, `Cancelled`.
  - Data table with columns: Reservation No, Guest Name, Mobile, Check-In Date, Check-Out Date, Room Category, Advance Paid, Status.
  - Actions: Check-in Guest, Cancel Booking, Resend Confirmation Voucher (Email/WhatsApp).
- **Backend Connectivity**:
  - `GET /api/v1/front-office/reservations`
  - `POST /api/v1/front-office/reservations/{id}/cancel`

---

## 3. Billing & Cash Pages (Hotel Dashboard)

### 3.1 Invoices & Billing Folio
- **View ID**: `hotel.billing.bills`
- **Panel**: Hotel Management Suite
- **Accessible Roles**: `hotel_admin`, `hotel_user` (Bills View/Edit).
- **UI Layout**:
  - Split view or full table: Filter by date range, bill status (Settled, Pending, Debit).
  - Master Folio Editor:
    - Guest details, room charges breakdown by day.
    - Restaurant / Room Service charge lines.
    - Subtotal, CGST (2.5% / 6%), SGST (2.5% / 6%), Total in Rupees.
    - Advance adjustments deduction table.
    - Net Balance Due.
  - Action buttons: "Settle Bill", "Print Tax Invoice PDF", "Email Invoice", "Create Debit Bill".
- **Backend Connectivity**:
  - `GET /api/v1/billing/bills`
  - `POST /api/v1/billing/bills/{id}/settle`
  - `GET /api/v1/billing/bills/{id}/pdf` -> streaming PDF binary via `pdfkit`.

### 3.2 Cash Book (Revenue & Shift Handover)
- **View ID**: `hotel.cash.revenue`, `hotel.cash.handover`
- **Panel**: Hotel Management Suite
- **Accessible Roles**: `hotel_admin`, `hotel_user` (Cashier).
- **UI Layout**:
  - Running balance banner showing physical cash drawer total.
  - Revenue entries categorized by Hotel Front Desk vs Restaurant/Food.
  - Cashier Shift Handover modal:
    - Physical cash denomination counter (Rs 500, 200, 100, 50, 20, 10).
    - Calculated total vs system expected total.
    - Cash drawer variance note and signature acknowledgement.
- **Backend Connectivity**:
  - `GET /api/v1/cash/revenue`
  - `POST /api/v1/cash/handover`

---

## 4. Corporate & Company Accounts

### 4.1 Company Profiles & GSTIN Auto-Fill
- **View ID**: `hotel.co.profiles`
- **Panel**: Hotel Management Suite
- **Accessible Roles**: `hotel_admin`, `hotel_user` (Companies View/Edit).
- **UI Layout**:
  - Searchable directory of corporate accounts.
  - Add Company Modal with **Instant GST Lookup**:
    - User types 15-character GSTIN.
    - System calls external GST registry API (`gstinapi.in`).
    - Automatically populates Company Legal Name, Trade Name, Registered Address, City, State, PIN code, and Active Taxpayer Status.
- **Backend Connectivity**:
  - `GET /api/v1/companies/profiles`
  - `POST /api/v1/companies/gst-lookup` -> talks to platform GST registry cache.

---

## 5. Staff Payroll & HR

### 5.1 Payroll Center
- **View ID**: `hotel.payroll.home`
- **Panel**: Hotel Management Suite
- **Accessible Roles**: `hotel_admin` (Payroll Full).
- **UI Layout**:
  - Staff Roster: Employee code, Name, Designation, Department, Base Salary, Duty Type.
  - Attendance Tracker: Monthly grid with status markers (Present, Absent, Half-Day, Paid Leave).
  - Salary Computation:
    - Calculation of payable days, deductions (miscellaneous, advance recovery, food charges).
    - One-click "Generate Monthly Payroll".
    - Download Payslip PDF.
- **Backend Connectivity**:
  - `GET /api/v1/payroll/staff`
  - `POST /api/v1/payroll/salaries/generate`
  - `GET /api/v1/payroll/salaries/{id}/pdf`

---

## 6. Platform Governance (Super Admin)

### 6.1 Hotel Provisioning & Tenant Manager
- **View ID**: `platform.hotels`
- **Panel**: Platform Console
- **Accessible Roles**: `super_admin`, `platform_admin`.
- **UI Layout**:
  - Multi-tenant directory table listing all onboarded hotels: Hotel Name, Tenant Schema (`hotel_<id>`), Subdomain / Custom Domain, Status (Active, Suspended, Provisioning), Primary Admin.
  - "Onboard New Hotel" button: Opens provisioning modal with schema name validator, default tax rates, and primary administrator assignment.
- **Backend Connectivity**:
  - `GET /api/v1/platform/hotels`
  - `POST /api/v1/platform/hotels` -> triggers SQL schema creation and seed population.

### 6.2 Enterprise Security Vault
- **View ID**: `platform.vault`
- **Panel**: Platform Console
- **Accessible Roles**: `super_admin` only (denied to Platform Admins).
- **UI Layout**:
  - Master credential safe storing sensitive hotel integration keys (Razorpay Secret Key, Google OAuth Client Secrets, SMTP credentials, Cloudflare zone tokens).
  - Values are masked by default (`••••••••`). Clicking "Reveal" decrypts AES-256-GCM ciphertext on the server and logs an immutable audit row.
  - Auto-clipboard wipe after 30 seconds.
- **Backend Connectivity**:
  - `GET /api/v1/platform/vault`
  - `POST /api/v1/platform/vault/reveal`
