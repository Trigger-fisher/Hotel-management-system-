# 18. Complete Architecture Diagrams (Mermaid)

## 1. Overall System Architecture

```mermaid
graph TD
    ClientWeb["Web Browser (React 19 / Next.js SPA)"]
    ClientDesktop["Desktop Application (Tauri 2.0 / Local SQLite)"]
    Edge["Cloudflare Edge (WAF, SSL Strict, Turnstile, Rate Limit)"]
    AppServer["Hostinger VPS (Nginx Origin Lock + Next.js App)"]
    DB[(PostgreSQL 18 Multi-Tenant Engine)]
    ExtRazorpay["Razorpay Gateway"]
    ExtSES["Amazon SES / SNS"]
    ExtGST["GST Lookup Service"]

    ClientWeb -->|HTTPS / WSS| Edge
    ClientDesktop -->|HTTPS API| Edge
    Edge -->|Encrypted Origin Pull| AppServer
    AppServer -->|SET LOCAL ROLE & Schema| DB
    AppServer -->|API Calls / Webhooks| ExtRazorpay
    AppServer -->|SMTP / SNS Webhooks| ExtSES
    AppServer -->|REST API| ExtGST
```

---

## 2. Authentication & Authorization Execution Flow

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant API as /api/v1/auth/sign-in
    participant Guard as Rate Limiter & Lockout Guard
    participant DB as Platform DB

    User->>Browser: Enter Identifier & Password
    Browser->>API: POST credentials + device metadata
    API->>Guard: Check IP attempts & account lock status
    Guard-->>API: Status OK
    API->>DB: Query user by username/email
    DB-->>API: Return user row & Argon2id hash
    API->>API: Verify password with Argon2id
    alt Valid Password & 2FA Enabled
        API->>DB: Generate 6-digit OTP challenge
        API->>Browser: Return 200 OK (status: 'two_factor_required')
        Browser->>User: Display OTP Entry Screen
    else Valid Password & No 2FA
        API->>Browser: Set __Host-hms-session cookie & return session
        Browser->>User: Navigate to Role Dashboard
    else Invalid Password
        API->>DB: Increment failed_login_count
        API-->>Browser: Return 401 INVALID_CREDENTIALS
    end
```

---

## 3. Desktop Application Runtime Architecture

```mermaid
graph LR
    subgraph DesktopApp ["Tauri 2.0 Desktop Container"]
        subgraph Webview ["Webview Frontend (Chromium / WebKit)"]
            UIComponents["React 19 UI / Pallav Components"]
            StateMgmt["Local Dashboard State"]
        end
        subgraph Core ["Rust Core Backend"]
            PrinterDriver["ESC/POS Printer Service"]
            ScannerHook["USB HID Scanner Listener"]
            OfflineSync["Sync & Queue Manager"]
            LocalDB[(Embedded SQLite Cache)]
        end
    end

    subgraph Cloud ["Cloud Platform Infrastructure"]
        CloudAPI["HMS Next.js Cloud API"]
        CloudDB[(PostgreSQL 18 Multi-Tenant)]
    end

    UIComponents <-->|Tauri IPC Invoke| Core
    PrinterDriver -->|Raw USB / Network| HardwarePrinter["POS Thermal Printer / Cash Drawer"]
    ScannerHook <--|Input Events| HardwareScanner["Barcode / Passport Scanner"]
    OfflineSync <--> LocalDB
    OfflineSync <-->|Encrypted HTTPS API| CloudAPI
    CloudAPI <--> CloudDB
```
