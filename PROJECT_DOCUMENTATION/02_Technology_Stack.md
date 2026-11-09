# 02. Technology Stack & Dependency Inventory

## 1. Core Technology Stack

| Layer | Technology | Version | Purpose in Project |
|---|---|---|---|
| **Runtime Environment** | Node.js | `>=22.x` | Server-side JavaScript runtime powering backend & Next.js |
| **Frontend Framework** | Next.js (App Router) | `16.4.3` | React full-stack framework with SSR and API route handling |
| **UI Library** | React | `19.2.8` | Declarative UI component tree rendering |
| **Language** | TypeScript | `^5.x` | Strict type checking across UI shared contracts and server |
| **Styling Engine** | TailwindCSS & PostCSS | `^4.x` | Modern utility-first CSS integration |
| **Legacy CSS Layer** | Bootstrap 5 + Pallav CSS | `5.3.3` | Vendored CSS stylesheets replicating Hotel Pallav look-and-feel |
| **Database Engine** | PostgreSQL | `18` | Multi-tenant schema-per-hotel relational database |
| **Database Driver** | `pg` (node-postgres) | `^8.23.1` | Native PostgreSQL connection pool and query executor |
| **Password Hashing** | `argon2` | `^0.45.1` | Argon2id cryptographically secure password hashing |
| **Data Validation** | `zod` | `4.6.7` | Runtime type validation for API request payloads and schemas |
| **PDF Generation** | `pdfkit` | `^0.20.2` | Server-side programmatic PDF invoice and voucher generation |
| **Image Processing** | `sharp` | `^0.35.5` | Profile picture compression, WebP encoding, and photo resizing |
| **Email Transport** | `nodemailer` | `10.3.1` | Outbound SMTP / Amazon SES email transmission |
| **IMAP Client** | `imapflow` | `2.9.1` | Inbound IMAP mailbox synchronization and message retrieval |
| **MIME Parser** | `mailparser` | `3.12.4` | Parsing incoming RFC 822 email headers and attachments |
| **QR Code Engine** | `qrcode` | `^1.5.4` | Generation of UPI and payment QR codes on bills and receipts |
| **HTML Sanitizer** | `sanitize-html` | `2.18.1` | XSS prevention for user-rendered HTML email previews |
| **Execution Tooling** | `tsx` | `4.23.15` | Zero-config TypeScript execution for scripts, tests, and CLI |

## 2. Dev & Build Tooling

- **Linter**: ESLint 9 (`eslint`, `eslint-config-next`) with custom database and SQL lint rules (`npm run lint:db`, `npm run lint:sql`).
- **Test Runner**: Node.js native test runner (`node --test`) paired with `tsx` loaders for unit, integration, and database tests.
- **Compiler**: Babel React Compiler (`babel-plugin-react-compiler`) for optimized memoization.

## 3. Client-Side Vendored Dependencies

The dashboard relies on specific MIT-licensed browser libraries loaded locally to eliminate external CDN dependencies:
- **Flatpickr**: Native date and range pickers for reservation bookings and report filters.
- **Tom Select**: High-performance searchable dropdowns for company profiles and room allocation.
- **Bootstrap Icons (`bi-*`)**: Complete icon set for menus, action buttons, and status indicators.

## 4. Frontend-Backend Communication Architecture

The communication between the frontend client and the backend server follows strict rules:
1. **JSON API Over HTTPS**: All client interactions post to `/api/v1/*` endpoints.
2. **Unified API Result Contract (`ApiResult<T>`)**:
   ```typescript
   export type ApiResult<T> = 
     | { ok: true; data: T } 
     | { ok: false; error: ApiError };
   ```
   API calls are wrapped in client-side adapters such that network calls never throw unhandled exceptions; instead, a structured `ApiError` is returned to the UI.
3. **Session Cookies with `__Host-` Prefix**:
   Authentication state is maintained via HTTP-only, Secure, SameSite cookies named `__Host-hms-session`. Tokens cannot be read or stolen by client-side scripts.
