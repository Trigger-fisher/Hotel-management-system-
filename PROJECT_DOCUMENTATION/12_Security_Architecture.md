# 12. Security Architecture & Threat Mitigation

HMS implements a **Three-Layer Defence-in-Depth Architecture** validated across three formal security audits.

## 1. Layer 1: Edge Security (Cloudflare)

- **Strict Transport Security (HSTS)**: Forced HTTPS with minimum TLS 1.2 and a 6-month HSTS header (`max-age=15552000; includeSubDomains`).
- **Web Application Firewall (WAF)**: High-sensitivity OWASP Core Rule Set guarding against SQL injection, XSS, and command injection attacks.
- **Edge Rate Limiting**:
  - Public endpoints capped at 60 requests/minute per IP.
  - Sign-in routes capped at 5 requests/minute per IP.
- **Bot Detection**: Cloudflare Bot Fight Mode and Turnstile captcha on login, sign-up, and password recovery pages.
- **Geo-Blocking**: Admin and platform consoles restricted to authorized management jurisdictions.

---

## 2. Layer 2: Application & Host Hardening (Hostinger VPS)

- **Origin Lock (nginx)**: The origin web server refuses direct HTTP connections that bypass Cloudflare (`security/deploy/nginx/hms.conf`).
- **Fail2ban Integration**: Detects repeated authentication failures and blocks malicious IPs directly via Cloudflare API.
- **Argon2id Password Hashing**: Passwords hashed using industry-standard memory-hard Argon2id parameters.
- **Sign-In Brute Force Lockout**: 5 failed password attempts automatically lock the account for 15 minutes.
- **HTTP Security Headers** (`web-app/security-headers.ts`):
  - `Content-Security-Policy`: Restricts scripts and styles to `'self'` and Cloudflare Turnstile hosts.
  - `X-Frame-Options: DENY`: Prevents UI redressing and clickjacking.
  - `X-Content-Type-Options: nosniff`: Blocks MIME-sniffing vulnerabilities.
  - `Referrer-Policy: no-referrer`: Prevents token leakage in HTTP headers.
  - `Cross-Origin-Opener-Policy: same-origin`: Isolates execution context.

---

## 3. Layer 3: Database & Tenant Isolation (PostgreSQL 18)

- **Dedicated Schema per Tenant**: Tenant data is physically separated into individual PostgreSQL schemas (`hotel_<id>`).
- **Dedicated Login-less Role per Tenant**: Every hotel tenant has an unprivileged database role (`hotel_<id>_role`). Cross-schema reads/writes are denied at the database engine level.
- **Row Level Security (RLS)**: Enforced on shared tables (guest and corporate portals) where users only query rows matching their authenticated `userId`.
- **Payment Card Data Immunity**: No credit card or debit card numbers are ever processed or stored on HMS servers. All online transactions are handled exclusively via **Razorpay tokens**.

---

## 4. Active Deception & Canaries

- **Honeypot Routes**: Deceptive endpoints (`/wp-admin`, `/.env`, `/.git`, `/xmlrpc.php`, `/phpmyadmin`) return a standard 404 while silently logging an immediate Warning alert.
- **Canary API Keys**: Artificially generated API keys resembling authentic keys are placed in honeypot decoy files. Any attempt to use a canary key triggers a **Critical Alert** and bans the calling IP.
- **3-Tier Incident Response**:
  - `Info`: Normal operational audit events.
  - `Warning`: 5 failed sign-in attempts, honeypot access (dispatches Slack notification).
  - `Critical`: Canary key activation, unauthorized cross-tenant attempt (dispatches emergency SMS via MSG91/Twilio).
