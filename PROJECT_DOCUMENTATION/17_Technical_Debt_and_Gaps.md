# 17. Technical Debt, Gaps & Architectural Limitations

An audit of the codebase reveals several technical debts and planned features that require resolution before enterprise deployment.

## 1. Feature Implementations Marked "Off" or "Upcoming"

The following views in `common/ui-shared/dashboards/nav.ts` are currently marked `off: true` or `upcoming: true` (code exists but features are incomplete):
1. **Reservation Calendar (`hotel.fo.calendar`)**: Visual multi-day timeline calendar of reservations.
2. **Maintenance Tickets (`hotel.fo.maintenance`)**: Room breakdown and repair ticketing engine.
3. **Night Audit Automation (`hotel.fo.nightAudit`)**: Day-closing automated revenue posting.
4. **WhatsApp Cloud API Integration (`hotel.whatsapp`)**: Direct WhatsApp Business Cloud API sync (currently marked `off: true` pending Meta credentials).
5. **Guest Support Notices (`guest.notices`, `corporate.notices`)**: Guest broadcast noticeboard.

---

## 2. Security & Compliance Gaps

1. **Unencrypted Guest Personal Data (Decision 11)**:
   - Currently, guest ID numbers, address proofs, and phone numbers are stored in plain text columns in PostgreSQL.
   - *Recommendation*: Implement column-level envelope encryption (AES-256-GCM) prior to real public guest data ingestion.
2. **Missing TOTP Two-Factor Authentication for Admins**:
   - Today, 2FA relies on emailed 6-digit OTP codes. Administrators lack TOTP authenticator app (Google Authenticator / Authy) support.
3. **Digital Personal Data Protection (DPDP) Act 2023**:
   - The system lacks formal guest consent logging, automated data erasure ("Right to be Forgotten"), and statutory data export tools required under Indian privacy legislation.

---

## 3. Architectural Bottlenecks

1. **Large Schema Migration Footprint**:
   - With 96 platform migrations and 60 hotel migrations, provisioning new hotels runs dozens of sequential SQL statements.
   - *Recommendation*: Generate a single baseline snapshot migration (`0000_consolidated_baseline.sql`) for new hotel tenants.
2. **Single-Connection Mock vs Real Database Divergence**:
   - Development frequently utilizes in-memory mock repositories (`src/server/repos/memory/*`). While fast, certain edge-case SQL constraints (such as Postgres `CHECK` constraints and `FOR UPDATE` lock contention) can only be verified in PostgreSQL mode.
